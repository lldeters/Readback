// Finds Python interpreters on PATH ourselves instead of letting spawn() do it: on Windows, libuv
// searches the current directory before PATH, and bare names could resolve to py/pyenv shims.
import { constants as fsConstants } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { isInsideAny, pathApi } from './policy';
import type { SkipReason } from './types';

export interface PathSearchFs {
  stat(path: string): Promise<{ isFile(): boolean }>;
  lstat(path: string): Promise<{ isFile(): boolean; isSymbolicLink(): boolean }>;
  access(path: string, mode: number): Promise<void>;
  realpath(path: string): Promise<string>;
  readlink(path: string): Promise<string>;
}

export const nodeFs: PathSearchFs = {
  stat: (path) => fsPromises.stat(path),
  lstat: (path) => fsPromises.lstat(path),
  access: (path, mode) => fsPromises.access(path, mode),
  realpath: (path) => fsPromises.realpath(path),
  readlink: (path) => fsPromises.readlink(path),
};

export interface PathSearchOptions {
  readonly platform: NodeJS.Platform;
  readonly pathEnv: string | undefined;
  /** Folders whose interpreters must not be used (the workspace folders in Restricted Mode). */
  readonly excludeFolders: readonly string[];
  readonly fs: PathSearchFs;
  /** macOS only: `xcode-select -p`, i.e. the developer directory, or undefined if none is installed. */
  readonly developerDirectory?: () => Promise<string | undefined>;
}

export interface PathCandidate {
  readonly command: string;
  readonly prefixArgs: readonly string[];
}

export interface PathSkip {
  readonly command: string;
  readonly reason: Extract<SkipReason, 'insideWorkspace' | 'storeAlias' | 'xcodeShim'>;
}

export interface PathSearchResult {
  readonly candidates: readonly PathCandidate[];
  readonly skipped: readonly PathSkip[];
}

interface ExecutableName {
  readonly file: string;
  readonly prefixArgs: readonly string[];
}

/** Order from spec 5.2: `py -3` on Windows, otherwise python3 first. */
export function executableNames(platform: NodeJS.Platform): readonly ExecutableName[] {
  return platform === 'win32'
    ? [
        { file: 'py.exe', prefixArgs: ['-3'] },
        { file: 'python.exe', prefixArgs: [] },
        { file: 'python3.exe', prefixArgs: [] },
      ]
    : [
        { file: 'python3', prefixArgs: [] },
        { file: 'python', prefixArgs: [] },
      ];
}

/** Stub binaries of macOS that open the "install command line developer tools" dialog. */
const MACOS_SHIMS = new Set(['/usr/bin/python3', '/usr/bin/python']);
/** Target of Windows "App execution aliases" that only open the Microsoft Store. */
const STORE_REDIRECTOR = 'appinstallerpythonredirector.exe';

async function isExecutableFile(
  file: string,
  platform: NodeJS.Platform,
  fs: PathSearchFs,
): Promise<boolean> {
  try {
    if (platform === 'win32') {
      // App execution aliases are reparse points that stat() cannot open; lstat() still sees them.
      const info = await fs.stat(file).catch(() => fs.lstat(file));
      return info.isFile() || ('isSymbolicLink' in info && info.isSymbolicLink());
    }
    const info = await fs.stat(file);
    if (!info.isFile()) {
      return false;
    }
    await fs.access(file, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function isStoreRedirector(file: string, fs: PathSearchFs): Promise<boolean> {
  try {
    const target = await fs.readlink(file);
    return target.toLowerCase().endsWith(STORE_REDIRECTOR);
  } catch {
    return false;
  }
}

function pathDirectories(options: PathSearchOptions): string[] {
  const api = pathApi(options.platform);
  return (
    (options.pathEnv ?? '')
      .split(api.delimiter)
      .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1'))
      // Relative entries would resolve against the cwd: never trust them.
      .filter((entry) => entry.length > 0 && api.isAbsolute(entry))
  );
}

export type PathLookup =
  | { readonly kind: 'found'; readonly command: string; readonly realpath: string }
  | { readonly kind: 'skipped'; readonly skip: PathSkip }
  | { readonly kind: 'missing' };

/** Looks up one executable file name on PATH. The first hit wins, like in a shell. */
export async function findOnPath(file: string, options: PathSearchOptions): Promise<PathLookup> {
  const { platform, fs } = options;
  const api = pathApi(platform);
  const fileName =
    platform === 'win32' && !file.toLowerCase().endsWith('.exe') ? `${file}.exe` : file;
  for (const directory of pathDirectories(options)) {
    const candidate = api.join(directory, fileName);
    if (!(await isExecutableFile(candidate, platform, fs))) {
      continue;
    }
    const real = await fs.realpath(candidate).catch(() => candidate);
    if (
      isInsideAny(directory, options.excludeFolders, platform) ||
      isInsideAny(real, options.excludeFolders, platform)
    ) {
      return { kind: 'skipped', skip: { command: candidate, reason: 'insideWorkspace' } };
    }
    if (platform === 'win32' && (await isStoreRedirector(candidate, fs))) {
      return { kind: 'skipped', skip: { command: candidate, reason: 'storeAlias' } };
    }
    if (platform === 'darwin' && MACOS_SHIMS.has(real)) {
      const developerDirectory = await options.developerDirectory?.();
      const realBinary = developerDirectory
        ? api.join(developerDirectory, 'usr', 'bin', 'python3')
        : undefined;
      if (!realBinary || !(await isExecutableFile(realBinary, platform, fs))) {
        return { kind: 'skipped', skip: { command: candidate, reason: 'xcodeShim' } };
      }
      return { kind: 'found', command: realBinary, realpath: realBinary };
    }
    return { kind: 'found', command: candidate, realpath: real };
  }
  return { kind: 'missing' };
}

/** The first PATH match of every standard executable name, deduplicated by real path. */
export async function searchPath(options: PathSearchOptions): Promise<PathSearchResult> {
  const candidates: PathCandidate[] = [];
  const skipped: PathSkip[] = [];
  const seen = new Set<string>();
  for (const name of executableNames(options.platform)) {
    const lookup = await findOnPath(name.file, options);
    if (lookup.kind === 'skipped') {
      skipped.push(lookup.skip);
    } else if (lookup.kind === 'found') {
      const key = options.platform === 'win32' ? lookup.realpath.toLowerCase() : lookup.realpath;
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push({ command: lookup.command, prefixArgs: name.prefixArgs });
      }
    }
  }
  return { candidates, skipped };
}
