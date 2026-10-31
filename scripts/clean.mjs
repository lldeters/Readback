// @ts-check
// Removes build output that must never reach the VSIX. vsce includes a file as soon as any "!"
// pattern in .vscodeignore matches it, so stale source maps or Python bytecode inside the allowed
// folders would be packaged; deleting them before packaging is the reliable fix.
//   node scripts/clean.mjs dist      remove dist/ (before a production build)
//   node scripts/clean.mjs pycache   remove __pycache__ folders and *.pyc below engine/
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = new Set(process.argv.slice(2));
if (targets.size === 0 || [...targets].some((target) => !['dist', 'pycache'].includes(target))) {
  console.error('Usage: node scripts/clean.mjs [dist] [pycache]');
  process.exit(2);
}

/** @param {string} directory */
async function removeBytecode(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__pycache__') {
        await rm(entryPath, { recursive: true, force: true });
      } else {
        await removeBytecode(entryPath);
      }
    } else if (entry.name.endsWith('.pyc') || entry.name.endsWith('.pyo')) {
      await rm(entryPath, { force: true });
    }
  }
}

if (targets.has('dist')) {
  await rm(path.join(root, 'dist'), { recursive: true, force: true });
}
if (targets.has('pycache')) {
  await removeBytecode(path.join(root, 'engine'));
}
