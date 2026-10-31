/* eslint-disable */
// Generated from shared/graph-schema.json by scripts/gen-schema-types.mjs. Do not edit.

/**
 * Which visualization the document feeds.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "ViewKind".
 */
export type ViewKind =
  | 'classAnatomy'
  | 'stateMatrix'
  | 'callGraph'
  | 'controlFlow'
  | 'moduleGraph'
  | 'queryAnatomy'
  | 'columnLineage'
  | 'tableLineage'
  | 'dbtModelGraph'
  | 'tableAccess';
/**
 * Python structure, SQL/dbt objects, control-flow elements, and placeholders for external or unresolvable targets.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "NodeKind".
 */
export type NodeKind =
  | 'package'
  | 'module'
  | 'class'
  | 'function'
  | 'method'
  | 'attribute'
  | 'property'
  | 'parameter'
  | 'variable'
  | 'statement'
  | 'query'
  | 'subquery'
  | 'cte'
  | 'table'
  | 'view'
  | 'column'
  | 'model'
  | 'source'
  | 'seed'
  | 'snapshot'
  | 'entry'
  | 'exit'
  | 'block'
  | 'condition'
  | 'loop'
  | 'try'
  | 'handler'
  | 'finally'
  | 'with'
  | 'match'
  | 'case'
  | 'return'
  | 'raise'
  | 'break'
  | 'continue'
  | 'external'
  | 'unresolved';
/**
 * Change relative to the diff base. Absent when no base was compared.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "ChangeStatus".
 */
export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'unchanged';
/**
 * Who wrote the change (filled from agent hooks, phase 4).
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "Attribution".
 */
export type Attribution = 'ai' | 'human' | 'unknown';
/**
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "EdgeKind".
 */
export type EdgeKind =
  | 'calls'
  | 'reads'
  | 'writes'
  | 'mutates'
  | 'inherits'
  | 'overrides'
  | 'imports'
  | 'depends_on'
  | 'lineage'
  | 'joins'
  | 'raises'
  | 'catches'
  | 'flow';
/**
 * certain: proven by static analysis; inferred: plausible (heuristic, f-string SQL, type inference); unresolved: target unknown.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "Confidence".
 */
export type Confidence = 'certain' | 'inferred' | 'unresolved';
/**
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "Severity".
 */
export type Severity = 'error' | 'warning' | 'information' | 'hint';

/**
 * Readback graph model. Single source of truth for the analysis engine (Python), the extension host and the webview (TypeScript). Positions are zero-based; 'character' counts UTF-16 code units (LSP semantics).
 */
export interface GraphDocument {
  /**
   * Major version of this schema. Bumped on every incompatible change.
   */
  schemaVersion: 1;
  view: ViewKind;
  nodes: Node[];
  edges: Edge[];
  diagnostics: Diagnostic[];
  meta: Meta;
}
/**
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "Node".
 */
export interface Node {
  /**
   * Stable identifier, e.g. py:shop.orders.OrderService.place_order, sql:cte:revenue, sql:col:raw.orders.amount_cents.
   */
  id: string;
  kind: NodeKind;
  label: string;
  /**
   * Id of the containing node (the class of a method, the CTE of a column, ...).
   */
  parent?: string;
  range?: Range;
  props?: Props;
  change?: ChangeStatus;
  attribution?: Attribution;
  /**
   * Why the target could not be resolved. Required for kind 'unresolved'.
   */
  reason?: string;
}
/**
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "Range".
 */
export interface Range {
  /**
   * Absolute file system path, exactly as the extension passed it to the engine.
   */
  file: string;
  start: Position;
  end: Position;
}
/**
 * Zero-based line and UTF-16 code unit offset within the line.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "Position".
 */
export interface Position {
  line: number;
  character: number;
}
/**
 * View-specific facts such as decorators, visibility, async, complexity, side effects or a lineage transformation.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "Props".
 */
export interface Props {
  [k: string]: unknown | undefined;
}
/**
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "Edge".
 */
export interface Edge {
  id: string;
  kind: EdgeKind;
  /**
   * Node id.
   */
  source: string;
  /**
   * Node id.
   */
  target: string;
  confidence: Confidence;
  /**
   * Where in the code the edge comes from (e.g. every call site).
   */
  evidence?: Range[];
  props?: Props;
  change?: ChangeStatus;
}
/**
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "Diagnostic".
 */
export interface Diagnostic {
  severity: Severity;
  /**
   * Stable machine-readable code, e.g. syntax-error, newer-syntax, unknown-macro. The UI localizes by code and args.
   */
  code: string;
  /**
   * English fallback text.
   */
  message: string;
  args?: {
    [k: string]: string | number | boolean | undefined;
  };
  range?: Range;
  nodeId?: string;
}
/**
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "Meta".
 */
export interface Meta {
  engineVersion: string;
  durationMs: number;
  /**
   * Git revision of the diff base.
   */
  baseRevision?: string;
  /**
   * SQL dialect used for parsing.
   */
  dialect?: string;
  /**
   * True when the graph was cut at readback.graph.maxNodes.
   */
  truncated?: boolean;
}
