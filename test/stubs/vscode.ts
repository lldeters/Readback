// Minimal stand-in for the 'vscode' module in Vitest unit tests (aliased in vitest.config.mts).
// Production code keeps its logic in vscode-free modules; this stub only covers the thin
// adapters. Tests extend or override it with vi.mock('vscode', ...).

type Listener<T> = (event: T) => unknown;

export class Disposable {
  constructor(private readonly callOnDispose: () => void) {}
  static from(...items: { dispose(): unknown }[]): Disposable {
    return new Disposable(() => {
      for (const item of items) {
        item.dispose();
      }
    });
  }
  dispose(): void {
    this.callOnDispose();
  }
}

export class EventEmitter<T> {
  private listeners: Listener<T>[] = [];
  readonly event = (listener: Listener<T>): Disposable => {
    this.listeners.push(listener);
    return new Disposable(() => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    });
  };
  fire(data: T): void {
    for (const listener of [...this.listeners]) {
      listener(data);
    }
  }
  dispose(): void {
    this.listeners = [];
  }
}

export class Uri {
  private constructor(
    readonly scheme: string,
    readonly fsPath: string,
  ) {}
  static file(fsPath: string): Uri {
    return new Uri('file', fsPath);
  }
  static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri(base.scheme, [base.fsPath, ...segments].join('/'));
  }
  get path(): string {
    return this.fsPath;
  }
  toString(): string {
    return `${this.scheme}://${this.fsPath}`;
  }
}

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}

export enum LogLevel {
  Off = 0,
  Trace = 1,
  Debug = 2,
  Info = 3,
  Warning = 4,
  Error = 5,
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function format(message: string, args: unknown[]): string {
  const [first] = args;
  if (args.length === 1 && typeof first === 'object' && first !== null) {
    const named = first as Record<string, unknown>;
    return message.replace(/\{(\w+)\}/g, (match, key: string) =>
      key in named ? text(named[key]) : match,
    );
  }
  return message.replace(/\{(\d+)\}/g, (match, index: string) => {
    const value = args[Number(index)];
    return value === undefined ? match : text(value);
  });
}

export const l10n = {
  bundle: undefined as Record<string, string> | undefined,
  uri: undefined,
  t(message: string | { message: string; args?: unknown[] }, ...args: unknown[]): string {
    if (typeof message === 'string') {
      return format(message, args);
    }
    return format(message.message, message.args ?? []);
  },
};

const resolved = (): Promise<undefined> => Promise.resolve(undefined);

export const env = {
  language: 'en',
  appName: 'Visual Studio Code',
  clipboard: { writeText: resolved },
};

export const workspace = {
  isTrusted: true,
  workspaceFolders: undefined as unknown[] | undefined,
  getConfiguration: () => ({
    get: <T>(_key: string, defaultValue?: T) => defaultValue,
    inspect: () => undefined,
    update: resolved,
  }),
  onDidChangeConfiguration: new EventEmitter<unknown>().event,
  onDidGrantWorkspaceTrust: new EventEmitter<void>().event,
};

export const extensions = {
  getExtension: (): undefined => undefined,
  onDidChange: new EventEmitter<void>().event,
};

export const window = {
  showInformationMessage: resolved,
  showWarningMessage: resolved,
  showErrorMessage: resolved,
};

export const commands = {
  registerCommand: (): Disposable =>
    new Disposable(() => {
      // nothing to release in the stub
    }),
  executeCommand: resolved,
};
