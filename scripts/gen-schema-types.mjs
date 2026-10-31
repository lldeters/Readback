// @ts-check
// Generates TypeScript types from the JSON Schemas in shared/ (the single source of truth).
//   node scripts/gen-schema-types.mjs           write src/shared/generated/*.ts
//   node scripts/gen-schema-types.mjs --check   fail if the committed files are out of date (CI)
import { compileFromFile } from 'json-schema-to-typescript';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const targets = [
  { schema: 'shared/graph-schema.json', out: 'src/shared/generated/graph.ts' },
  { schema: 'shared/engine-protocol.schema.json', out: 'src/shared/generated/engineProtocol.ts' },
];

const stale = [];
for (const { schema, out } of targets) {
  const outPath = path.join(root, out);
  const generated = await compileFromFile(path.join(root, schema), {
    bannerComment: `/* eslint-disable */\n// Generated from ${schema} by scripts/gen-schema-types.mjs. Do not edit.`,
    cwd: path.join(root, 'shared'),
    format: false,
    strictIndexSignatures: true,
    unreachableDefinitions: true,
  });
  const options = (await prettier.resolveConfig(outPath)) ?? {};
  const formatted = await prettier.format(generated, { ...options, filepath: outPath });
  const current = await readFile(outPath, 'utf8').catch(() => undefined);
  if (current === formatted) {
    continue;
  }
  if (check) {
    stale.push(out);
  } else {
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, formatted);
    console.log(`wrote ${out}`);
  }
}

if (stale.length > 0) {
  console.error(`Out of date: ${stale.join(', ')}. Run "npm run schema:generate".`);
  process.exit(1);
}
