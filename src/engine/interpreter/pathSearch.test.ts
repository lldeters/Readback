import { describe, expect, it } from 'vitest';
import { executableNames, findOnPath, searchPath, type PathSearchFs } from './pathSearch';

interface FakeFile {
  readonly executable?: boolean;
  readonly realpath?: string;
  readonly link?: string;
  /** Windows app execution alias: stat() fails, lstat() works. */
  readonly alias?: boolean;
}

function fakeFs(files: Record<string, FakeFile>): PathSearchFs {
  const missing = (path: string) => Object.assign(new Error(`ENOENT ${path}`), { code: 'ENOENT' });
  const fileInfo = { isFile: () => true, isSymbolicLink: () => false };
  return {
    stat: (path) => {
      const file = files[path];
      return file && !file.alias ? Promise.resolve(fileInfo) : Promise.reject(missing(path));
    },
    lstat: (path) =>
      files[path]
        ? Promise.resolve({ isFile: () => !files[path]?.alias, isSymbolicLink: () => true })
        : Promise.reject(missing(path)),
    access: (path) =>
      files[path]?.executable === false ? Promise.reject(new Error('EACCES')) : Promise.resolve(),
    realpath: (path) => Promise.resolve(files[path]?.realpath ?? path),
    readlink: (path) =>
      files[path]?.link ? Promise.resolve(files[path].link) : Promise.reject(missing(path)),
  };
}

describe('executableNames', () => {
  it('follows the spec order', () => {
    expect(executableNames('win32').map((n) => [n.file, n.prefixArgs])).toEqual([
      ['py.exe', ['-3']],
      ['python.exe', []],
      ['python3.exe', []],
    ]);
    expect(executableNames('linux').map((n) => n.file)).toEqual(['python3', 'python']);
  });
});

describe('searchPath on Linux', () => {
  it('takes the first match per name and deduplicates by real path', async () => {
    const result = await searchPath({
      platform: 'linux',
      pathEnv: '/home/dev/.local/bin:/usr/bin:relative/bin:',
      excludeFolders: [],
      fs: fakeFs({
        '/usr/bin/python3': { realpath: '/usr/bin/python3.12' },
        '/home/dev/.local/bin/python3': { executable: false },
        '/usr/bin/python': { realpath: '/usr/bin/python3.12' },
        'relative/bin/python': {},
      }),
    });
    expect(result.candidates).toEqual([{ command: '/usr/bin/python3', prefixArgs: [] }]);
    expect(result.skipped).toEqual([]);
  });

  it('skips interpreters inside excluded folders without looking further', async () => {
    const result = await searchPath({
      platform: 'linux',
      pathEnv: '/work/repo/.venv/bin:/usr/bin',
      excludeFolders: ['/work/repo'],
      fs: fakeFs({
        '/work/repo/.venv/bin/python3': { realpath: '/usr/bin/python3.12' },
        '/usr/bin/python3': {},
      }),
    });
    expect(result.skipped).toEqual([
      { command: '/work/repo/.venv/bin/python3', reason: 'insideWorkspace' },
    ]);
    // Like a shell lookup: a later directory does not shadow the first hit.
    expect(result.candidates).toEqual([]);
  });

  it('rejects symlinks whose target lies inside an excluded folder', async () => {
    const result = await searchPath({
      platform: 'linux',
      pathEnv: '/opt/bin',
      excludeFolders: ['/work/repo'],
      fs: fakeFs({ '/opt/bin/python3': { realpath: '/work/repo/python' } }),
    });
    expect(result.skipped).toEqual([{ command: '/opt/bin/python3', reason: 'insideWorkspace' }]);
  });
});

describe('searchPath on Windows', () => {
  it('skips the Microsoft Store redirector but keeps real aliases', async () => {
    const apps = 'C:\\Users\\dev\\AppData\\Local\\Microsoft\\WindowsApps';
    const result = await searchPath({
      platform: 'win32',
      pathEnv: `${apps};C:\\Windows`,
      excludeFolders: [],
      fs: fakeFs({
        [`${apps}\\python.exe`]: {
          alias: true,
          link: 'C:\\Program Files\\WindowsApps\\Microsoft.DesktopAppInstaller\\AppInstallerPythonRedirector.exe',
        },
        [`${apps}\\python3.exe`]: {
          alias: true,
          link: 'C:\\Program Files\\WindowsApps\\PythonSoftwareFoundation.Python.3.13\\python3.13.exe',
        },
        'C:\\Windows\\py.exe': {},
      }),
    });
    expect(result.candidates).toEqual([
      { command: 'C:\\Windows\\py.exe', prefixArgs: ['-3'] },
      { command: `${apps}\\python3.exe`, prefixArgs: [] },
    ]);
    expect(result.skipped).toEqual([{ command: `${apps}\\python.exe`, reason: 'storeAlias' }]);
  });

  it('compares workspace folders case-insensitively', async () => {
    const result = await searchPath({
      platform: 'win32',
      pathEnv: 'c:\\work\\Repo\\Scripts',
      excludeFolders: ['C:\\Work\\repo'],
      fs: fakeFs({ 'c:\\work\\Repo\\Scripts\\python.exe': {} }),
    });
    expect(result.skipped).toEqual([
      { command: 'c:\\work\\Repo\\Scripts\\python.exe', reason: 'insideWorkspace' },
    ]);
  });

  it('finds bare names from the setting with .exe appended', async () => {
    const lookup = await findOnPath('python3.12', {
      platform: 'win32',
      pathEnv: 'C:\\Python312',
      excludeFolders: [],
      fs: fakeFs({ 'C:\\Python312\\python3.12.exe': {} }),
    });
    expect(lookup).toMatchObject({ kind: 'found', command: 'C:\\Python312\\python3.12.exe' });
  });
});

describe('searchPath on macOS', () => {
  it('does not run the stub that opens the developer tools dialog', async () => {
    const result = await searchPath({
      platform: 'darwin',
      pathEnv: '/usr/bin',
      excludeFolders: [],
      fs: fakeFs({ '/usr/bin/python3': {} }),
      developerDirectory: () => Promise.resolve(undefined),
    });
    expect(result.candidates).toEqual([]);
    expect(result.skipped).toEqual([{ command: '/usr/bin/python3', reason: 'xcodeShim' }]);
  });

  it('uses the real Command Line Tools binary when they are installed', async () => {
    const tools = '/Library/Developer/CommandLineTools';
    const result = await searchPath({
      platform: 'darwin',
      pathEnv: '/usr/bin',
      excludeFolders: [],
      fs: fakeFs({ '/usr/bin/python3': {}, [`${tools}/usr/bin/python3`]: {} }),
      developerDirectory: () => Promise.resolve(tools),
    });
    expect(result.candidates).toEqual([{ command: `${tools}/usr/bin/python3`, prefixArgs: [] }]);
  });
});
