// @ts-check
// Runs repository Python scripts with a Python >= 3.10: $HEARBACK_PYTHON, else `py -3` (Windows),
// `python3`, `python`. Usage: node scripts/python.mjs <python arguments...>
import { spawnSync } from 'node:child_process';

/** @type {string[][]} */
const candidates = process.env.HEARBACK_PYTHON
  ? [[process.env.HEARBACK_PYTHON]]
  : process.platform === 'win32'
    ? [['py', '-3'], ['python'], ['python3']]
    : [['python3'], ['python']];

for (const [command, ...prefix] of candidates) {
  if (command === undefined) {
    continue;
  }
  const probe = spawnSync(
    command,
    [...prefix, '-c', 'import sys; print(sys.version_info >= (3, 10))'],
    {
      encoding: 'utf8',
    },
  );
  if (probe.status === 0 && probe.stdout.trim() === 'True') {
    const result = spawnSync(command, [...prefix, ...process.argv.slice(2)], { stdio: 'inherit' });
    process.exit(result.status ?? 1);
  }
}
console.error(
  'No Python >= 3.10 found. Set HEARBACK_PYTHON to the path of a suitable interpreter.',
);
process.exit(1);
