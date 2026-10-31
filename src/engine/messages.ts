// Localized texts for interpreter attempts, engine failures and the status report.
import * as vscode from 'vscode';
import type { EngineRequestFailure, EngineStartFailure } from './engineConnection';
import type { EngineFailure, EngineStatus } from './engineService';
import { formatVersion } from './interpreter/probe';
import { PYTHON_PATH_SETTING } from './settings';
import type {
  AttemptOutcome,
  InterpreterSource,
  PathProblem,
  PythonProbe,
  ResolutionAttempt,
  ResolutionResult,
  SettingScope,
} from './interpreter/types';
import { MIN_PYTHON } from './protocol';

const REQUIRED = `${String(MIN_PYTHON.major)}.${String(MIN_PYTHON.minor)}`;

export function sourceLabel(source: InterpreterSource): string {
  switch (source) {
    case 'setting':
      return PYTHON_PATH_SETTING;
    case 'pythonExtension':
      return vscode.l10n.t('Python extension');
    case 'path':
      return 'PATH';
  }
}

export function scopeLabel(scope: SettingScope): string {
  switch (scope) {
    case 'user':
      return vscode.l10n.t('user settings');
    case 'workspace':
      return vscode.l10n.t('workspace settings');
    case 'workspaceFolder':
      return vscode.l10n.t('folder settings');
  }
}

/** The setting name plus where its value came from, e.g. "readback.engine.pythonPath (workspace settings)". */
export function settingLabel(scope: SettingScope | undefined): string {
  return scope === undefined
    ? PYTHON_PATH_SETTING
    : `${PYTHON_PATH_SETTING} (${scopeLabel(scope)})`;
}

function describePathProblem(problem: PathProblem | undefined, value: string): string {
  switch (problem) {
    case 'workspaceFolderUntrusted':
      return vscode.l10n.t('{0} is only replaced in trusted workspaces', '${workspaceFolder}');
    case 'relativeUntrusted':
      return vscode.l10n.t('relative paths are only resolved in trusted workspaces');
    case 'unsupportedVariable':
    case undefined:
      return vscode.l10n.t('unsupported variable in {0}', value);
  }
}

export function describePython(probe: PythonProbe): string {
  return vscode.l10n.t('Python {0}', formatVersion(probe));
}

export function describeOutcome(outcome: AttemptOutcome): string {
  if (outcome.kind === 'ok') {
    return describePython(outcome.probe);
  }
  const detail = outcome.detail ?? '';
  switch (outcome.reason) {
    case 'notConfigured':
      return vscode.l10n.t('not set');
    case 'notInstalled':
      return vscode.l10n.t('not installed');
    case 'noEnvironment':
      return vscode.l10n.t('no active environment');
    case 'untrustedWorkspace':
      return vscode.l10n.t('skipped in Restricted Mode');
    case 'declined':
      return vscode.l10n.t('workspace setting not allowed');
    case 'insideWorkspace':
      return vscode.l10n.t('rejected: lies inside the untrusted workspace');
    case 'storeAlias':
      return vscode.l10n.t('skipped: Microsoft Store alias');
    case 'xcodeShim':
      return vscode.l10n.t('skipped: macOS stub without Command Line Tools');
    case 'notFound':
      return vscode.l10n.t('not found');
    case 'notExecutable':
      return vscode.l10n.t('not executable');
    case 'invalidPath':
      return vscode.l10n.t(
        'invalid path: {0}',
        describePathProblem(outcome.pathProblem, outcome.detail ?? ''),
      );
    case 'tooOld':
      return vscode.l10n.t('Python {0} is too old (needs {1} or newer)', detail, REQUIRED);
    case 'notCPython':
      return vscode.l10n.t('{0} is not supported (needs CPython)', detail);
    case 'probeFailed':
      return vscode.l10n.t('could not run: {0}', detail);
    case 'timeout':
      return vscode.l10n.t('did not respond in time');
    case 'apiError':
      return vscode.l10n.t('error: {0}', detail);
  }
}

export function describeAttempt(attempt: ResolutionAttempt): string {
  const marker = attempt.outcome.kind === 'ok' ? '✓' : '·';
  const source =
    attempt.source === 'setting' ? settingLabel(attempt.scope) : sourceLabel(attempt.source);
  const where = attempt.command ? `${source}: ${attempt.command}` : source;
  return `${marker} ${where} – ${describeOutcome(attempt.outcome)}`;
}

/** A start failure in the user's language; engine and OS details are appended as they are. */
function describeStartFailure(error: EngineStartFailure): string {
  switch (error.kind) {
    case 'pythonTooOld':
      return vscode.l10n.t(
        'Python {0} is too old for Readback. Python {1} or newer is required.',
        error.fatal?.version ?? '?',
        REQUIRED,
      );
    case 'startupTimeout':
      return vscode.l10n.t('The Readback engine did not start in time.');
    case 'spawnFailed':
      return vscode.l10n.t('The Readback engine could not be started: {0}', error.message);
    case 'bootstrapFailed':
      return error.fatal?.detail
        ? vscode.l10n.t('The Readback engine could not load its files: {0}', error.fatal.detail)
        : vscode.l10n.t('The Readback engine could not load its files.');
    case 'exitedDuringStartup':
      return vscode.l10n.t(
        'The Readback engine exited during startup ({0}).',
        error.exit?.signal
          ? vscode.l10n.t('signal {0}', error.exit.signal)
          : vscode.l10n.t('exit code {0}', String(error.exit?.code ?? '?')),
      );
    case 'protocolMismatch':
      return vscode.l10n.t(
        'The Readback engine does not match this version of the extension. Reinstall Readback.',
      );
    case 'initializeFailed':
      return vscode.l10n.t('The Readback engine rejected the start: {0}', error.message);
  }
}

/** Why a request to a running engine failed, for the status report. */
export function describeRequestFailure(error: EngineRequestFailure): string {
  switch (error.kind) {
    case 'timeout':
      return vscode.l10n.t('no answer in time');
    case 'unavailable':
      return vscode.l10n.t('the engine stopped while answering');
    case 'cancelled':
      return vscode.l10n.t('cancelled');
    case 'engineError':
      return vscode.l10n.t('engine error {0}', String(error.code ?? '?'));
  }
}

function lastProblem(resolution: ResolutionResult): ResolutionAttempt | undefined {
  return [...resolution.attempts].reverse().find((attempt) => attempt.outcome.kind === 'failed');
}

/** Headline for an error notification. */
export function describeFailure(failure: EngineFailure): string {
  switch (failure.kind) {
    case 'noInterpreter':
      return vscode.l10n.t(
        'Readback needs Python {0} or newer, but no suitable interpreter was found.',
        REQUIRED,
      );
    case 'settingUnusable': {
      const attempt = lastProblem(failure.resolution);
      return vscode.l10n.t(
        'The interpreter in {0} cannot be used: {1}.',
        settingLabel(attempt?.scope),
        attempt ? describeOutcome(attempt.outcome) : vscode.l10n.t('unknown reason'),
      );
    }
    case 'start':
      return describeStartFailure(failure.error);
    case 'crashLoop':
      return vscode.l10n.t(
        'The Readback engine crashed repeatedly. Automatic restarts are paused.',
      );
  }
}

function stateLabel(status: EngineStatus): string {
  switch (status.state) {
    case 'running':
      return status.pid === undefined
        ? vscode.l10n.t('running')
        : vscode.l10n.t('running (process {0})', status.pid);
    case 'starting':
      return vscode.l10n.t('starting');
    case 'idle':
      return vscode.l10n.t('not started');
    case 'failed':
      return vscode.l10n.t('failed');
    case 'disposed':
      return vscode.l10n.t('stopped');
  }
}

/** The multi-line report shown by "Readback: Show Engine Status" and copied to the clipboard. */
export function formatStatus(
  status: EngineStatus,
  pingMs?: number,
  pingError?: EngineRequestFailure,
): string {
  const lines: string[] = [];
  lines.push(vscode.l10n.t('State: {0}', stateLabel(status)));
  const interpreter = status.resolution?.interpreter;
  if (interpreter) {
    lines.push(
      vscode.l10n.t(
        'Interpreter: {0} (from {1})',
        interpreter.probe.executable,
        sourceLabel(interpreter.candidate.source),
      ),
    );
  }
  const engine = status.engine;
  if (engine) {
    lines.push(
      vscode.l10n.t(
        'Python: {0} ({1}, {2})',
        engine.python.version,
        engine.python.implementation,
        engine.python.platform,
      ),
    );
    lines.push(
      vscode.l10n.t(
        'Engine: {0} · protocol {1} · graph schema {2}',
        engine.engineVersion,
        engine.protocolVersion,
        engine.schemaVersion,
      ),
    );
    const vendored = engine.vendored.map((pkg) => `${pkg.name} ${pkg.version}`).join(', ');
    lines.push(
      vscode.l10n.t(
        'Bundled packages: {0}',
        vendored || vscode.l10n.t('none (run npm run vendor)'),
      ),
    );
    lines.push(
      engine.sandboxed
        ? vscode.l10n.t('Sandbox: active (no processes, no network)')
        : vscode.l10n.t('Sandbox: inactive'),
    );
  }
  lines.push(
    status.trusted
      ? vscode.l10n.t('Workspace: trusted')
      : vscode.l10n.t('Workspace: Restricted Mode'),
  );
  if (status.startupMs !== undefined) {
    lines.push(
      pingMs === undefined
        ? vscode.l10n.t('Startup: {0} ms', Math.round(status.startupMs))
        : vscode.l10n.t(
            'Startup: {0} ms · ping {1} ms',
            Math.round(status.startupMs),
            Math.round(pingMs),
          ),
    );
  }
  if (pingError) {
    lines.push(vscode.l10n.t('Ping: failed ({0})', describeRequestFailure(pingError)));
  }
  if (status.failure) {
    lines.push(vscode.l10n.t('Problem: {0}', describeFailure(status.failure)));
  } else if (pingError) {
    lines.push(
      vscode.l10n.t('Problem: {0}', vscode.l10n.t('The Readback engine does not respond.')),
    );
  }
  if (status.resolution) {
    lines.push('', vscode.l10n.t('Interpreter search:'));
    for (const attempt of status.resolution.attempts) {
      lines.push(`  ${describeAttempt(attempt)}`);
    }
  }
  return lines.join('\n');
}
