import { describe, expect, it } from 'vitest';
import { isInsideAny, isPathInside, sanitizedEnv } from './policy';

describe('isPathInside', () => {
  it('handles POSIX paths', () => {
    expect(isPathInside('/work/repo/.venv/bin/python', '/work/repo', 'linux')).toBe(true);
    expect(isPathInside('/work/repo', '/work/repo', 'linux')).toBe(true);
    expect(isPathInside('/work/repository/python', '/work/repo', 'linux')).toBe(false);
    expect(isPathInside('/work/repo/../other/python', '/work/repo', 'linux')).toBe(false);
    // Linux file systems are case-sensitive.
    expect(isPathInside('/Work/Repo/python', '/work/repo', 'linux')).toBe(false);
  });

  it('is case-insensitive on Windows and macOS', () => {
    expect(isPathInside('C:\\WORK\\Repo\\python.exe', 'c:\\work\\repo', 'win32')).toBe(true);
    expect(isPathInside('/Users/Dev/Repo/bin/python', '/users/dev/repo', 'darwin')).toBe(true);
  });

  it('checks several folders', () => {
    expect(isInsideAny('/b/python', ['/a', '/b'], 'linux')).toBe(true);
    expect(isInsideAny('/c/python', ['/a', '/b'], 'linux')).toBe(false);
    expect(isInsideAny('/c/python', [], 'linux')).toBe(false);
  });
});

describe('sanitizedEnv', () => {
  it('removes Python and environment-switching variables', () => {
    const env = sanitizedEnv({
      PATH: '/usr/bin',
      HOME: '/home/dev',
      PYTHONPATH: '/evil',
      PYTHONHOME: '/evil',
      PythonStartup: '/evil.py',
      VIRTUAL_ENV: '/venv',
      CONDA_PREFIX: '/conda',
      __PYVENV_LAUNCHER__: '/x',
    });
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/dev',
      PYTHON_MANAGER_AUTOMATIC_INSTALL: '0',
    });
  });
});
