// The JSON Schemas in shared/ are the single source of truth (spec 5.3). The engine runs the same
// examples through Python's jsonschema (engine/tests/test_schema_conformance.py).
import { Ajv2020 } from 'ajv/dist/2020';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { asRecord, readJson, repoRoot } from './helpers';

const graphSchema = asRecord(readJson('shared/graph-schema.json'));
const protocolSchema = asRecord(readJson('shared/engine-protocol.schema.json'));

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
ajv.addSchema(protocolSchema);
const validateGraph = ajv.compile(graphSchema);

function protocolValidator(definition: string) {
  const validate = ajv.getSchema(`${String(protocolSchema.$id)}#/$defs/${definition}`);
  if (!validate) {
    throw new Error(`no $defs/${definition} in the protocol schema`);
  }
  return validate;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe('graph schema', () => {
  const example = readJson('shared/examples/graph-class-anatomy.json');

  it('accepts the example document', () => {
    expect(validateGraph(example), JSON.stringify(validateGraph.errors)).toBe(true);
  });

  it('requires a reason for unresolved nodes', () => {
    const document = clone(example) as { nodes: Record<string, unknown>[] };
    const unresolved = document.nodes.find((node) => node.kind === 'unresolved');
    expect(unresolved).toBeDefined();
    if (unresolved) {
      delete unresolved.reason;
    }
    expect(validateGraph(document)).toBe(false);
  });

  it('rejects unknown properties and confidence values', () => {
    const extra = clone(example) as { nodes: Record<string, unknown>[] };
    if (extra.nodes[0]) {
      extra.nodes[0].colour = 'red';
    }
    expect(validateGraph(extra)).toBe(false);

    const badConfidence = clone(example) as { edges: Record<string, unknown>[] };
    if (badConfidence.edges[0]) {
      badConfidence.edges[0].confidence = 'probably';
    }
    expect(validateGraph(badConfidence)).toBe(false);
  });

  it('rejects negative positions', () => {
    const document = clone(example) as {
      nodes: { range?: { start: { line: number } } }[];
    };
    const range = document.nodes[0]?.range;
    if (range) {
      range.start.line = -1;
    }
    expect(validateGraph(document)).toBe(false);
  });
});

describe('engine protocol schema', () => {
  it('accepts the example initialize result', () => {
    const validate = protocolValidator('InitializeResult');
    const example = readJson('shared/examples/initialize-result.json');
    expect(validate(example), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects an initialize result without python info', () => {
    const validate = protocolValidator('InitializeResult');
    const example = asRecord(clone(readJson('shared/examples/initialize-result.json')));
    delete example.python;
    expect(validate(example)).toBe(false);
  });
});

describe('generated TypeScript types', () => {
  it('are up to date with the schemas', () => {
    expect(() =>
      execFileSync(
        process.execPath,
        [path.join(repoRoot, 'scripts/gen-schema-types.mjs'), '--check'],
        {
          cwd: repoRoot,
          stdio: 'pipe',
        },
      ),
    ).not.toThrow();
  });
});
