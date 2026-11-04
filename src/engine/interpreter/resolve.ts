// Interpreter resolution order (spec 5.2): hearback.engine.pythonPath, then the active environment
// of the Python extension, then PATH. vscode-free: the editor-facing sources are injected.
import { isInsideAny, pathApi } from './policy';
import type { PathLookup, PathSearchResult } from './pathSearch';
import type {
  AttemptOutcome,
  InterpreterCandidate,
  PathProblem,
  ResolutionAttempt,
  ResolutionResult,
  ResolvedInterpreter,
  SettingScope,
  SkipReason,
} from './types';

export interface SettingLookup {
  /** Effective value after the workspace-approval check; undefined or '' when unset. */
  readonly value: string | undefined;
  readonly scope: SettingScope | undefined;
  /** A workspace value the user declined to run (approved addition A). */
  readonly declinedWorkspaceValue?: string;
}

export type PythonExtensionLookup =
  | { readonly kind: 'notInstalled' }
  | { readonly kind: 'noEnvironment' }
  | { readonly kind: 'error'; readonly detail: string }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'found'; readonly executable: string };

/**
 * The user's answer for an interpreter inside the workspace: approved (now or earlier), not
 * confirmed (no approval, and no prompt was allowed) or declined earlier in this session.
 */
export type Confirmation = 'approved' | Extract<SkipReason, 'notConfirmed' | 'declinedInSession'>;

export interface ResolveContext {
  readonly platform: NodeJS.Platform;
  readonly trusted: boolean;
  readonly workspaceFolders: readonly string[];
  readonly homeDirectory: string;
  readSetting(): Promise<SettingLookup>;
  pythonExtension(): Promise<PythonExtensionLookup>;
  /**
   * Asks whether an interpreter that the Python extension selected inside the workspace may run:
   * a stored approval, or a one-time prompt in interactive starts. Runs nothing itself.
   */
  confirmWorkspaceInterpreter(path: string): Promise<Confirmation>;
  searchPath(): Promise<PathSearchResult>;
  /** Looks up a bare command name from the setting (e.g. "python3.12") on PATH. */
  findOnPath(name: string): Promise<PathLookup>;
  probe(candidate: InterpreterCandidate): Promise<AttemptOutcome>;
  realpath(path: string): Promise<string>;
}

type Expansion =
  | { readonly kind: 'path'; readonly path: string }
  | { readonly kind: 'command'; readonly name: string }
  | { readonly kind: 'invalid'; readonly problem: PathProblem };

/** Expands ~, ${userHome} and (trusted only) ${workspaceFolder}; bare names are looked up on PATH. */
export function expandSettingPath(
  raw: string,
  context: Pick<ResolveContext, 'platform' | 'trusted' | 'workspaceFolders' | 'homeDirectory'>,
): Expansion {
  const api = pathApi(context.platform);
  let value = raw.trim();
  const folder = context.workspaceFolders[0];
  value = value.replaceAll('${userHome}', context.homeDirectory);
  if (value.includes('${workspaceFolder}')) {
    if (!context.trusted || folder === undefined) {
      return { kind: 'invalid', problem: 'workspaceFolderUntrusted' };
    }
    value = value.replaceAll('${workspaceFolder}', folder);
  }
  if (value === '~' || value.startsWith('~/') || value.startsWith('~\\')) {
    value = api.join(context.homeDirectory, value.slice(1));
  }
  if (/\$\{[^}]*\}/.test(value)) {
    return { kind: 'invalid', problem: 'unsupportedVariable' };
  }
  if (api.isAbsolute(value)) {
    return { kind: 'path', path: api.normalize(value) };
  }
  if (!value.includes('/') && !value.includes('\\')) {
    return { kind: 'command', name: value };
  }
  if (context.trusted && folder !== undefined) {
    return { kind: 'path', path: api.resolve(folder, value) };
  }
  return { kind: 'invalid', problem: 'relativeUntrusted' };
}

type WorkspaceContext = Pick<ResolveContext, 'platform' | 'workspaceFolders' | 'realpath'>;

/**
 * Whether the path or its real path lies inside a workspace folder, compared with the folders as
 * opened and with their real paths: a venv's python links to a base interpreter outside the
 * workspace, so only its own path shows where it lives, also when the folder was opened through a
 * symlink. Nothing is run. Callers pass absolute paths; a relative one counts as inside, because
 * resolving it against the extension host's working directory says nothing about where it lives.
 */
async function liesInsideWorkspace(path: string, context: WorkspaceContext): Promise<boolean> {
  if (!pathApi(context.platform).isAbsolute(path)) {
    return true;
  }
  const real = (file: string): Promise<string> => context.realpath(file).catch(() => file);
  const folders = [
    ...context.workspaceFolders,
    ...(await Promise.all(context.workspaceFolders.map(real))),
  ];
  return [path, await real(path)].some((candidate) =>
    isInsideAny(candidate, folders, context.platform),
  );
}

/**
 * An interpreter from the Python extension may run when it lies outside the workspace folders.
 * Inside, a repository can have chosen it (a committed .venv, python.defaultInterpreterPath), and
 * even probing it runs workspace code, so it needs the user's confirmation first.
 */
export async function checkWorkspaceInterpreter(
  path: string,
  context: WorkspaceContext & Pick<ResolveContext, 'confirmWorkspaceInterpreter'>,
): Promise<'outside' | Confirmation> {
  return (await liesInsideWorkspace(path, context))
    ? context.confirmWorkspaceInterpreter(path)
    : 'outside';
}

export async function resolveInterpreter(context: ResolveContext): Promise<ResolutionResult> {
  const attempts: ResolutionAttempt[] = [];
  const done = (result: Omit<ResolutionResult, 'attempts' | 'trusted'>): ResolutionResult => ({
    ...result,
    attempts,
    trusted: context.trusted,
  });

  // 1. hearback.engine.pythonPath
  const setting = await context.readSetting();
  if (setting.declinedWorkspaceValue !== undefined) {
    attempts.push({
      source: 'setting',
      command: setting.declinedWorkspaceValue,
      scope: 'workspace',
      outcome: { kind: 'skipped', reason: 'declined' },
    });
  }
  const scope = setting.scope === undefined ? {} : { scope: setting.scope };
  const raw = setting.value?.trim() ?? '';
  if (raw.length === 0) {
    attempts.push({ source: 'setting', outcome: { kind: 'skipped', reason: 'notConfigured' } });
  } else {
    const blocked = (command: string, outcome: AttemptOutcome): ResolutionResult => {
      attempts.push({ source: 'setting', command, ...scope, outcome });
      return done({ interpreter: undefined, blockedBySetting: true });
    };
    const expansion = expandSettingPath(raw, context);
    let candidate: InterpreterCandidate;
    if (expansion.kind === 'invalid') {
      return blocked(raw, {
        kind: 'failed',
        reason: 'invalidPath',
        detail: raw,
        pathProblem: expansion.problem,
      });
    } else if (expansion.kind === 'command') {
      // A bare name such as "python3.12": the first PATH match, under the same rules as step 3.
      const lookup = await context.findOnPath(expansion.name);
      if (lookup.kind === 'missing') {
        return blocked(raw, { kind: 'failed', reason: 'notFound' });
      }
      if (lookup.kind === 'skipped') {
        return blocked(lookup.skip.command, { kind: 'failed', reason: 'insideWorkspace' });
      }
      candidate = { source: 'setting', command: lookup.command, prefixArgs: [] };
    } else {
      candidate = { source: 'setting', command: expansion.path, prefixArgs: [] };
    }
    // Restricted Mode: nothing inside the workspace runs, not even through the user's setting.
    if (!context.trusted && (await liesInsideWorkspace(candidate.command, context))) {
      return blocked(candidate.command, { kind: 'failed', reason: 'insideWorkspace' });
    }
    const outcome = await context.probe(candidate);
    if (outcome.kind !== 'ok') {
      return blocked(candidate.command, outcome);
    }
    attempts.push({ source: 'setting', command: candidate.command, ...scope, outcome });
    return done({ interpreter: { candidate, probe: outcome.probe }, blockedBySetting: false });
  }

  // 2. The Python extension (disabled in Restricted Mode anyway; skip it explicitly).
  if (!context.trusted) {
    attempts.push({
      source: 'pythonExtension',
      outcome: { kind: 'skipped', reason: 'untrustedWorkspace' },
    });
  } else {
    const lookup = await context.pythonExtension();
    if (lookup.kind === 'found') {
      const interpreter = await usePythonExtension(lookup.executable, context, attempts);
      if (interpreter) {
        return done({ interpreter, blockedBySetting: false });
      }
    } else {
      attempts.push({ source: 'pythonExtension', outcome: pythonExtensionOutcome(lookup) });
    }
  }

  // 3. PATH
  const { candidates, skipped } = await context.searchPath();
  for (const skip of skipped) {
    attempts.push({
      source: 'path',
      command: skip.command,
      outcome: { kind: 'skipped', reason: skip.reason },
    });
  }
  if (candidates.length === 0 && skipped.length === 0) {
    attempts.push({ source: 'path', outcome: { kind: 'skipped', reason: 'notFound' } });
  }
  for (const found of candidates) {
    const candidate: InterpreterCandidate = { source: 'path', ...found };
    const outcome = await context.probe(candidate);
    attempts.push({ source: 'path', command: found.command, outcome });
    if (outcome.kind === 'ok') {
      return done({ interpreter: { candidate, probe: outcome.probe }, blockedBySetting: false });
    }
  }
  return done({ interpreter: undefined, blockedBySetting: false });
}

/**
 * Probes the Python extension's interpreter unless it lies inside the workspace without the user's
 * confirmation (then the resolution continues with PATH). The engine runs the probed
 * sys.executable, so a different executable that leads into the workspace is checked as well.
 */
async function usePythonExtension(
  command: string,
  context: ResolveContext,
  attempts: ResolutionAttempt[],
): Promise<ResolvedInterpreter | undefined> {
  const skip = (path: string, reason: Exclude<Confirmation, 'approved'>): void => {
    attempts.push({
      source: 'pythonExtension',
      command: path,
      outcome: { kind: 'skipped', reason },
    });
  };
  const reported = await checkWorkspaceInterpreter(command, context);
  if (reported !== 'outside' && reported !== 'approved') {
    skip(command, reported);
    return undefined;
  }
  const candidate: InterpreterCandidate = { source: 'pythonExtension', command, prefixArgs: [] };
  const outcome = await context.probe(candidate);
  // An approval of the reported path covers what it runs; it already ran during the probe.
  if (outcome.kind === 'ok' && reported === 'outside' && outcome.probe.executable !== command) {
    const executable = await checkWorkspaceInterpreter(outcome.probe.executable, context);
    if (executable !== 'outside' && executable !== 'approved') {
      skip(outcome.probe.executable, executable);
      return undefined;
    }
  }
  attempts.push({ source: 'pythonExtension', command, outcome });
  return outcome.kind === 'ok' ? { candidate, probe: outcome.probe } : undefined;
}

function pythonExtensionOutcome(
  lookup: Exclude<PythonExtensionLookup, { kind: 'found' }>,
): AttemptOutcome {
  switch (lookup.kind) {
    case 'notInstalled':
      return { kind: 'skipped', reason: 'notInstalled' };
    case 'noEnvironment':
      return { kind: 'skipped', reason: 'noEnvironment' };
    case 'timeout':
      return { kind: 'failed', reason: 'timeout' };
    case 'error':
      return { kind: 'failed', reason: 'apiError', detail: lookup.detail };
  }
}
