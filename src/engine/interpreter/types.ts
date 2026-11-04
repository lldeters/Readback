/** Where a Python interpreter candidate came from, in resolution order. */
export type InterpreterSource = 'setting' | 'pythonExtension' | 'path';

/** Scope of the hearback.engine.pythonPath value that is in effect. */
export type SettingScope = 'user' | 'workspace' | 'workspaceFolder';

export interface InterpreterCandidate {
  readonly source: InterpreterSource;
  /** Absolute path of the executable to spawn. */
  readonly command: string;
  /** Arguments placed before the Python arguments, e.g. ['-3'] for the Windows py launcher. */
  readonly prefixArgs: readonly string[];
}

/** What the probe ("-I -S -c <script>") reported about an interpreter. */
export interface PythonProbe {
  /** sys.executable: the engine is spawned with this absolute path, never via py or a shim. */
  readonly executable: string;
  readonly version: readonly [number, number, number];
  readonly releaseLevel: string;
  readonly implementation: string;
  readonly platform: string;
  readonly bits64: boolean;
}

/** Why a candidate was not used without being run. */
export type SkipReason =
  | 'notConfigured'
  | 'notInstalled'
  | 'noEnvironment'
  | 'untrustedWorkspace'
  | 'declined'
  | 'insideWorkspace'
  | 'storeAlias'
  | 'xcodeShim'
  | 'notFound';

/** Why a candidate (or source) failed. */
export type FailureReason =
  | 'notFound'
  | 'notExecutable'
  | 'invalidPath'
  | 'insideWorkspace'
  | 'tooOld'
  | 'notCPython'
  | 'probeFailed'
  | 'timeout'
  | 'apiError';

/** Why a hearback.engine.pythonPath value could not be turned into a path (localized later). */
export type PathProblem = 'workspaceFolderUntrusted' | 'relativeUntrusted' | 'unsupportedVariable';

export type AttemptOutcome =
  | { readonly kind: 'ok'; readonly probe: PythonProbe }
  | { readonly kind: 'skipped'; readonly reason: SkipReason; readonly detail?: string }
  | {
      readonly kind: 'failed';
      readonly reason: FailureReason;
      /** Raw technical detail (OS or interpreter output, a version); shown as is. */
      readonly detail?: string;
      readonly pathProblem?: PathProblem;
    };

export interface ResolutionAttempt {
  readonly source: InterpreterSource;
  /** Path or command that was looked at, if any. */
  readonly command?: string;
  /** For the setting source: which settings scope the value came from. */
  readonly scope?: SettingScope;
  readonly outcome: AttemptOutcome;
}

export interface ResolvedInterpreter {
  readonly candidate: InterpreterCandidate;
  readonly probe: PythonProbe;
}

export interface ResolutionResult {
  readonly interpreter: ResolvedInterpreter | undefined;
  readonly attempts: readonly ResolutionAttempt[];
  /**
   * True when hearback.engine.pythonPath is set but unusable. Like Microsoft's template we then
   * stop instead of silently falling back to another interpreter.
   */
  readonly blockedBySetting: boolean;
  /** Workspace trust at resolution time. */
  readonly trusted: boolean;
}
