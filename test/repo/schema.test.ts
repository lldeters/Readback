// The JSON Schemas in shared/ are the single source of truth (spec 5.3). The engine runs the same
// examples through Python's jsonschema (engine/tests/test_schema_conformance.py).
import { Ajv2020 } from 'ajv/dist/2020';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  EdgeKind,
  EdgePropsByKind,
  NodeKind,
  NodePropsByKind,
} from '../../src/shared/generated/graph';
import { asRecord, readJson, repoRoot } from './helpers';

const graphSchema = asRecord(readJson('shared/graph-schema.json'));
const protocolSchema = asRecord(readJson('shared/engine-protocol.schema.json'));

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
ajv.addSchema(protocolSchema);
ajv.addSchema(graphSchema);
const validateGraph = definition('graph', 'GraphDocument');

function definition(schema: 'graph' | 'protocol', name: string) {
  const source = schema === 'graph' ? graphSchema : protocolSchema;
  const pointer = name === 'GraphDocument' ? '' : `#/$defs/${name}`;
  const validate = ajv.getSchema(`${String(source.$id)}${pointer}`);
  if (!validate) {
    throw new Error(`no ${name} in the ${schema} schema`);
  }
  return validate;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

type JsonObject = Record<string, unknown>;

/** true when A and B are the same union of keys, false otherwise. */
type SameKeys<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

interface ExampleNode extends JsonObject {
  id: string;
  kind: string;
  parent?: string;
  props?: JsonObject;
  range?: { start: { line: number } };
}

interface ExampleDocument extends JsonObject {
  focus?: string;
  nodes: ExampleNode[];
  edges: (JsonObject & { source: string; target: string })[];
  diagnostics: (JsonObject & { nodeId?: string })[];
}

const anatomy = readJson('shared/examples/graph-class-anatomy.json') as ExampleDocument;

/** A one-node document for checks of the node rules. */
function documentWith(node: JsonObject): JsonObject {
  return {
    schemaVersion: 2,
    view: 'classAnatomy',
    nodes: [node],
    edges: [],
    diagnostics: [],
    meta: { engineVersion: '0.0.1', durationMs: 0 },
  };
}

function nodeOf(kind: string, props: JsonObject, extra: JsonObject = {}): JsonObject {
  return { id: 'py:m.x', kind, label: 'x', props, ...extra };
}

function defsOf(schema: JsonObject): Record<string, JsonObject> {
  return schema.$defs as Record<string, JsonObject>;
}

describe('graph schema', () => {
  it('accepts the example document', () => {
    expect(validateGraph(anatomy), JSON.stringify(validateGraph.errors)).toBe(true);
  });

  it('accepts the example change summary', () => {
    const validate = definition('graph', 'ChangeSummary');
    const example = readJson('shared/examples/change-summary.json');
    expect(validate(example), JSON.stringify(validate.errors)).toBe(true);
  });

  it('has examples whose ids refer to their own nodes', () => {
    const summary = readJson('shared/examples/change-summary.json') as { symbols: ExampleNode[] };
    for (const nodes of [anatomy.nodes, summary.symbols]) {
      const ids = new Set(nodes.map((node) => node.id));
      expect(ids.size).toBe(nodes.length);
      for (const node of nodes) {
        if (node.parent !== undefined) {
          expect(ids.has(node.parent), node.parent).toBe(true);
        }
      }
    }
    const ids = new Set(anatomy.nodes.map((node) => node.id));
    expect(anatomy.focus !== undefined && ids.has(anatomy.focus)).toBe(true);
    for (const edge of anatomy.edges) {
      expect(ids.has(edge.source) && ids.has(edge.target), JSON.stringify(edge)).toBe(true);
    }
    for (const diagnostic of anatomy.diagnostics) {
      expect(diagnostic.nodeId === undefined || ids.has(diagnostic.nodeId)).toBe(true);
    }
  });

  it('requires a reason and a reason code for unresolved nodes', () => {
    const document = clone(anatomy);
    const unresolved = document.nodes.find((node) => node.kind === 'unresolved');
    expect(unresolved).toBeDefined();
    if (unresolved) {
      delete unresolved.reason;
    }
    expect(validateGraph(document)).toBe(false);

    const withoutCode = clone(anatomy);
    const node = withoutCode.nodes.find((entry) => entry.kind === 'unresolved');
    if (node?.props) {
      delete node.props.reasonCode;
    }
    expect(validateGraph(withoutCode)).toBe(false);
    expect(validateGraph(documentWith(nodeOf('unresolved', {}, { reason: 'why' })))).toBe(false);
    expect(validateGraph(documentWith(nodeOf('unresolved', { reasonCode: 'dynamic-call' })))).toBe(
      false,
    );
    expect(
      validateGraph(
        documentWith(nodeOf('unresolved', { reasonCode: 'dynamic-call' }, { reason: 'why' })),
      ),
    ).toBe(true);
  });

  it('rejects props keys that the def of the node kind lacks', () => {
    // A v1 key that no props def has.
    expect(validateGraph(documentWith(nodeOf('method', { complexity: 2 })))).toBe(false);
    // A key of another kind's def: ClassProps has bases, FunctionProps does not.
    expect(validateGraph(documentWith(nodeOf('method', { bases: [] })))).toBe(false);
    expect(validateGraph(documentWith(nodeOf('class', { bases: [] })))).toBe(true);
    // Kinds without props in this schema version take none.
    expect(validateGraph(documentWith(nodeOf('table', { bases: [] })))).toBe(false);
    expect(validateGraph(documentWith(nodeOf('table', {})))).toBe(true);
    // Nested defs are closed too.
    const metrics = { complexity: 1, nesting: 0, lines: 1, sloc: 1, parameters: 0 };
    expect(validateGraph(documentWith(nodeOf('function', { metrics })))).toBe(true);
    expect(
      validateGraph(documentWith(nodeOf('function', { metrics: { ...metrics, cognitive: 1 } }))),
    ).toBe(false);
  });

  it('rejects edge props that the def of the edge kind lacks', () => {
    const document = clone(anatomy);
    const edge = document.edges.find((entry) => entry.kind === 'mutates');
    expect(edge).toBeDefined();
    if (edge) {
      edge.props = { resolvedBy: 'jedi' };
    }
    expect(validateGraph(document)).toBe(false);
    if (edge) {
      edge.props = { mutation: 'method', method: 'append' };
    }
    expect(validateGraph(document), JSON.stringify(validateGraph.errors)).toBe(true);
  });

  it('gives external packages and exception classes nodes of their own', () => {
    const external = (props?: JsonObject): JsonObject => ({
      id: 'py:os',
      kind: 'external',
      label: 'os',
      ...(props ? { props } : {}),
    });
    const stdlib = { group: 'stdlib', package: 'os' };
    // One collapsed node per top-level package lists the names behind its edges.
    expect(validateGraph(documentWith(external({ ...stdlib, names: ['os', 'os.path'] })))).toBe(
      true,
    );
    expect(validateGraph(documentWith(external({ ...stdlib, names: ['os', 'os'] })))).toBe(false);
    // Every external node needs its group and package.
    expect(validateGraph(documentWith(external()))).toBe(false);
    expect(validateGraph(documentWith(external({ group: 'stdlib' })))).toBe(false);
    // An exception class outside the workspace is a node of its own, the target of raises and
    // catches edges (spec 11.1: _request_with_retry catches TimeoutError).
    const timeout = {
      id: 'py:builtins.TimeoutError',
      kind: 'external',
      label: 'TimeoutError',
      props: { group: 'stdlib', package: 'builtins', symbol: 'builtins.TimeoutError' },
    };
    const method = { id: 'py:m.C.f', kind: 'method', label: 'f' };
    const catches = {
      id: 'e:catches:py:m.C.f->py:builtins.TimeoutError',
      kind: 'catches',
      source: method.id,
      target: timeout.id,
      confidence: 'certain',
    };
    const document = { ...documentWith(method), nodes: [method, timeout], edges: [catches] };
    expect(validateGraph(document), JSON.stringify(validateGraph.errors)).toBe(true);
  });

  it('accepts ranges with a revision and rejects an empty revision', () => {
    const ghost = {
      file: '/workspace/retrying_client.py',
      start: { line: 35, character: 4 },
      end: { line: 36, character: 33 },
      revision: '3f2c1d9e8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e',
    };
    const node = { id: 'py:m.f', kind: 'function', label: 'f', range: ghost, change: 'deleted' };
    expect(validateGraph(documentWith(node)), JSON.stringify(validateGraph.errors)).toBe(true);
    expect(validateGraph(documentWith({ ...node, range: { ...ghost, revision: '' } }))).toBe(false);
  });

  it('rejects unknown properties, diagnostic codes and confidence values', () => {
    const extra = clone(anatomy);
    if (extra.nodes[0]) {
      extra.nodes[0].colour = 'red';
    }
    expect(validateGraph(extra)).toBe(false);

    const badConfidence = clone(anatomy);
    if (badConfidence.edges[0]) {
      badConfidence.edges[0].confidence = 'probably';
    }
    expect(validateGraph(badConfidence)).toBe(false);

    const badCode = clone(anatomy);
    if (badCode.diagnostics[0]) {
      badCode.diagnostics[0].code = 'something-else';
    }
    expect(validateGraph(badCode)).toBe(false);
  });

  it('rejects negative positions', () => {
    const document = clone(anatomy);
    const range = document.nodes[0]?.range;
    if (range) {
      range.start.line = -1;
    }
    expect(validateGraph(document)).toBe(false);
  });

  it('maps every node and edge kind to a props def', () => {
    const defs = defsOf(graphSchema);
    const kinds = (name: string) => (defs[name] as { enum: string[] }).enum;
    const mapped = (name: string) => Object.keys(defs[name]?.properties as JsonObject);
    expect(mapped('NodePropsByKind')).toEqual(kinds('NodeKind'));
    expect(mapped('EdgePropsByKind')).toEqual(kinds('EdgeKind'));
    // The same holds for the generated types that propsOf() in the webview relies on: the
    // assignments fail to typecheck when the key sets differ.
    const nodeKindsMatch: SameKeys<keyof NodePropsByKind, NodeKind> = true;
    const edgeKindsMatch: SameKeys<keyof EdgePropsByKind, EdgeKind> = true;
    expect([nodeKindsMatch, edgeKindsMatch]).toEqual([true, true]);
  });
});

describe('engine protocol schema', () => {
  it('accepts the example initialize result', () => {
    const validate = definition('protocol', 'InitializeResult');
    const example = readJson('shared/examples/initialize-result.json');
    expect(validate(example), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects an initialize result without python info', () => {
    const validate = definition('protocol', 'InitializeResult');
    const example = asRecord(clone(readJson('shared/examples/initialize-result.json')));
    delete example.python;
    expect(validate(example)).toBe(false);
  });

  it('accepts the params of the analysis requests and checks their bounds', () => {
    const source = { file: '/w/retrying_client.py' };
    const position = { line: 17, character: 8 };
    const workspace = { root: '/w', files: ['/w/retrying_client.py'] };
    const callGraph = definition('protocol', 'CallGraphParams');
    const params = { source, position, hops: 2, direction: 'both', workspace };
    expect(callGraph(params), JSON.stringify(callGraph.errors)).toBe(true);
    expect(callGraph({ ...params, hops: 11 })).toBe(false);
    expect(callGraph({ ...params, direction: 'up' })).toBe(false);
    expect(callGraph({ ...params, options: { maxNodes: 49 } })).toBe(false);
    expect(
      callGraph({ ...params, base: { revision: 'abc', text: null, file: '/w/old.py' } }),
      JSON.stringify(callGraph.errors),
    ).toBe(true);
    expect(callGraph({ ...params, base: { revision: 'abc' } })).toBe(false);
    const batch = definition('protocol', 'IndexFilesParams');
    const files = Array.from({ length: 500 }, (_, index) => `/w/m${String(index)}.py`);
    expect(batch({ workspace: { root: '/w', files } })).toBe(true);
    expect(batch({ workspace: { root: '/w', files: [...files, '/w/x.py'] } })).toBe(false);
    const compare = definition('protocol', 'DiffCompareParams');
    expect(compare({ language: 'python', source })).toBe(true);
    expect(compare({ language: 'sql', source })).toBe(false);
    // A file deleted in the working tree has null text; its symbols come back as ghosts.
    const deleted = { file: '/w/gone.py', text: null };
    const base = { revision: 'abc', text: 'def f():\n    pass\n' };
    expect(compare({ language: 'python', source: deleted, base })).toBe(true);
    expect(compare({ language: 'python', source: { ...deleted, text: 1 }, base })).toBe(false);
    const initialize = definition('protocol', 'InitializeParams');
    expect(
      initialize({
        protocolVersion: 2,
        client: { name: 'vscode', version: '1.105.1' },
        logLevel: 'info',
        workspaceTrusted: true,
        storageDirectory: '/home/u/globalStorage/lldeters.hearback/engine',
      }),
      JSON.stringify(initialize.errors),
    ).toBe(true);
  });

  it('targets call graphs and control flow by position or by symbol id', () => {
    const source = { file: '/w/retrying_client.py' };
    const position = { line: 17, character: 8 };
    const symbol = 'py:retrying_client.RetryingClient.get';
    const workspace = { root: '/w', files: ['/w/retrying_client.py'] };
    const callGraph = definition('protocol', 'CallGraphParams');
    const call = { source, hops: 2, direction: 'both', workspace };
    expect(callGraph({ ...call, position })).toBe(true);
    expect(callGraph({ ...call, symbol }), JSON.stringify(callGraph.errors)).toBe(true);
    expect(callGraph({ ...call, position, symbol })).toBe(true);
    expect(callGraph(call)).toBe(false);
    expect(callGraph({ ...call, symbol: '' })).toBe(false);
    const controlFlow = definition('protocol', 'ControlFlowParams');
    expect(controlFlow({ source, symbol })).toBe(true);
    expect(controlFlow({ source })).toBe(false);
    // Class anatomy shows the whole file and may focus on nothing.
    const anatomy = definition('protocol', 'ClassAnatomyParams');
    expect(anatomy({ source })).toBe(true);
    expect(anatomy({ source, symbol })).toBe(true);
  });

  it('switches comparison on per folder and sends class anatomy the workspace files', () => {
    const revision = '3f2c1d9e8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e';
    const files = definition('protocol', 'WorkspaceFiles');
    const folder = { root: '/w', files: ['/w/a.py', '/w/b.py'] };
    const bases = [{ file: '/w/gone.py', base: { revision, text: 'x = 1\n' } }];
    expect(files({ ...folder, baseRevision: revision })).toBe(true);
    expect(files({ ...folder, baseRevision: revision, bases, omittedBases: ['/w/b.py'] })).toBe(
      true,
    );
    // Bases and omitted bases only come with the revision that switches comparison on.
    expect(files({ ...folder, bases })).toBe(false);
    expect(files({ ...folder, omittedBases: ['/w/b.py'] })).toBe(false);
    expect(files({ ...folder, baseRevision: '' })).toBe(false);
    const anatomy = definition('protocol', 'ClassAnatomyParams');
    const source = { file: '/w/a.py' };
    expect(anatomy({ source, workspace: { ...folder, overlays: [] } })).toBe(true);
    expect(anatomy({ source, workspace: { root: '/w' } })).toBe(false);
  });

  it('does not reference the graph schema', () => {
    expect(JSON.stringify(protocolSchema)).not.toContain('graph-schema.json#');
    const references = [...JSON.stringify(protocolSchema).matchAll(/"\$ref":"([^"]*)"/g)];
    expect(references.length).toBeGreaterThan(0);
    for (const [, reference] of references) {
      expect(reference?.startsWith('#/$defs/'), reference).toBe(true);
    }
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
