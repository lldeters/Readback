// Path rules for Restricted Mode: an untrusted workspace must never be able to make Hearback run a
// binary that lives inside it (a .venv symlink to a system Python still runs attacker code through
// pyvenv.cfg 'home', even under -I -S).
import path from 'node:path';

export function pathApi(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix;
}

/** Windows and the default macOS file system compare paths case-insensitively. */
function comparable(value: string, platform: NodeJS.Platform): string {
  return platform === 'win32' || platform === 'darwin' ? value.toLowerCase() : value;
}

/** True if `child` is `parent` itself or lies below it. Both are resolved first. */
export function isPathInside(child: string, parent: string, platform: NodeJS.Platform): boolean {
  const api = pathApi(platform);
  const resolvedChild = comparable(api.resolve(child), platform);
  const resolvedParent = comparable(api.resolve(parent), platform);
  if (resolvedChild === resolvedParent) {
    return true;
  }
  const prefix = resolvedParent.endsWith(api.sep) ? resolvedParent : resolvedParent + api.sep;
  return resolvedChild.startsWith(prefix);
}

export function isInsideAny(
  candidate: string,
  folders: readonly string[],
  platform: NodeJS.Platform,
): boolean {
  return folders.some((folder) => isPathInside(candidate, folder, platform));
}

const DROPPED_VARIABLES = new Set([
  'VIRTUAL_ENV',
  'CONDA_PREFIX',
  'CONDA_DEFAULT_ENV',
  'CONDA_SHLVL',
  '__PYVENV_LAUNCHER__',
]);

/**
 * Environment for probe and engine processes. Removes PYTHON* (ignored under -I anyway, but also
 * PYTHONHOME/PYTHONPATH for interpreters that predate -I) and variables that switch environments.
 */
export function sanitizedEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    const upper = key.toUpperCase();
    if (value === undefined || upper.startsWith('PYTHON') || DROPPED_VARIABLES.has(upper)) {
      continue;
    }
    result[key] = value;
  }
  // The Windows Python install manager must not download a runtime as a side effect of a probe.
  result.PYTHON_MANAGER_AUTOMATIC_INSTALL = '0';
  return result;
}
