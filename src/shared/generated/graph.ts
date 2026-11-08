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
 * The props of any node kind; the kind decides which one applies (NodePropsByKind).
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "NodeProps".
 */
export type NodeProps =
  | PackageProps
  | ModuleProps
  | ClassProps
  | FunctionProps
  | AttributeProps
  | PropertyProps
  | NoProps
  | FlowNodeProps
  | ExternalProps
  | UnresolvedProps;
/**
 * R: the method reads the attribute; W: it writes or mutates it; RW: both.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "StateAccess".
 */
export type StateAccess = 'R' | 'W' | 'RW';
/**
 * As in inspect.Parameter: before '/', regular, *args, after '*' or *args, **kwargs.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "ParameterKind".
 */
export type ParameterKind =
  'positionalOnly' | 'positionalOrKeyword' | 'varPositional' | 'keywordOnly' | 'varKeyword';
/**
 * dunder: __name__; private: a leading underscore otherwise, name-mangled __name included; public: everything else.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "Visibility".
 */
export type Visibility = 'public' | 'private' | 'dunder';
/**
 * How a method binds its first parameter: instance (self), class (@classmethod, cls) or static (@staticmethod, none). Absent for plain functions.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "MethodKind".
 */
export type MethodKind = 'instance' | 'class' | 'static';
/**
 * The section of the class card: a @staticmethod, @classmethod or @abstractmethod decorator beats the visibility.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "MethodGroup".
 */
export type MethodGroup = 'public' | 'private' | 'dunder' | 'static' | 'class' | 'abstract';
/**
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "SideEffectCategory".
 */
export type SideEffectCategory =
  | 'output'
  | 'logging'
  | 'file'
  | 'network'
  | 'subprocess'
  | 'database'
  | 'write'
  | 'environment'
  | 'global-state'
  | 'argument-mutation';
/**
 * Confidence of a fact the analysis found, such as a side effect or an exception: certain or inferred, never unresolved.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "FactConfidence".
 */
export type FactConfidence = 'certain' | 'inferred';
/**
 * class: declared in the class body; instance: assigned through the receiver, e.g. self.x = ....
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "AttributeScope".
 */
export type AttributeScope = 'class' | 'instance';
/**
 * get: the getter; set: the setter; delete: the deleter.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "AccessorKind".
 */
export type AccessorKind = 'get' | 'set' | 'delete';
/**
 * stdlib: in sys.stdlib_module_names (builtins included); thirdParty: everything else outside the workspace.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "ExternalGroup".
 */
export type ExternalGroup = 'stdlib' | 'thirdParty';
/**
 * Why a target could not be resolved; the UI localizes by code and args (UnresolvedArgsByCode) and falls back to Node.reason. dynamic-call: a call through getattr or a similar dynamic lookup. subscript-call: a call of a subscript result, such as handlers[kind](). local-value: a call of a local variable or parameter of unknown value. unknown-receiver-type: the type of the receiver of obj.method() is unknown. type-resolution-off: obj.method() needs type-aware resolution (hearback.engine.useJedi), which is off. type-resolution-skipped: type-aware resolution is on but did not examine the call, because Jedi's time budget ran out (jedi-budget-exceeded) or Jedi failed (jedi-unavailable). external-base: the lookup reached a base class outside the workspace. never-assigned: the attribute is never assigned in the class hierarchy. undefined-name: no scope, import or builtin defines the name, or the workspace module it is imported from does not define it. computed-import: the imported module name is computed at run time. module-not-found: no workspace file provides the imported module, e.g. a relative import of a missing file. computed-class: a base class or an exception class depends on a run-time value, e.g. class A(make_base()), raise make_error() or except self.retryable.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "UnresolvedReasonCode".
 */
export type UnresolvedReasonCode =
  | 'dynamic-call'
  | 'subscript-call'
  | 'local-value'
  | 'unknown-receiver-type'
  | 'type-resolution-off'
  | 'type-resolution-skipped'
  | 'external-base'
  | 'never-assigned'
  | 'undefined-name'
  | 'computed-import'
  | 'module-not-found'
  | 'computed-class';
/**
 * The args of any unresolved reason; the reason code decides which def applies (UnresolvedArgsByCode).
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "UnresolvedArgs".
 */
export type UnresolvedArgs =
  | DynamicCallArgs
  | NoArgs
  | LocalValueArgs
  | ReceiverArgs
  | ExternalBaseArgs
  | NeverAssignedArgs
  | UndefinedNameArgs
  | ModuleNotFoundArgs;
/**
 * Change relative to the diff base. Absent when no base was compared. A node is modified if and only if the position-free AST of its own part differs; formatting and comments never count.
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
 * The props of any edge kind; the kind decides which one applies (EdgePropsByKind).
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "EdgeProps".
 */
export type EdgeProps =
  CallEdgeProps | AccessEdgeProps | NoProps | ImportEdgeProps | ExceptionEdgeProps | FlowEdgeProps;
/**
 * Which optional resolution step found the call (spec 6.1.3): jedi (step 3) or languageServer (step 4); both are inferred. Absent for steps 1 and 2 (local scopes, self, cls, super() and workspace imports).
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "ResolvedBy".
 */
export type ResolvedBy = 'jedi' | 'languageServer';
/**
 * How a mutates edge changes the attribute's value: subscript (self.x[k] = v), attribute (self.x.y = v), delete (del self.x[k]) or method (a known mutating method such as self.x.append(v)).
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "MutationKind".
 */
export type MutationKind = 'subscript' | 'attribute' | 'delete' | 'method';
/**
 * typeOnly: under if TYPE_CHECKING; deferred: inside a function; conditional: inside if or try at module level; lazy: a lazy import (PEP 810); star: from x import *; dynamic: importlib.import_module with a constant name (inferred).
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "ImportFlag".
 */
export type ImportFlag = 'typeOnly' | 'deferred' | 'conditional' | 'lazy' | 'star' | 'dynamic';
/**
 * hard: a cycle of import-time edges only; soft: the cycle needs TYPE_CHECKING, deferred or lazy edges.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "CycleKind".
 */
export type CycleKind = 'hard' | 'soft';
/**
 * Why the edge is taken; the UI localizes it. true and false: a condition; loopNext: the next iteration; loopDone: the loop is exhausted; loopElse: exhausted, into the else block; case: a case matched; noMatch: no case matched; exception: to a handler or out of the function; finallyThen: on from a finally block with the jump that entered it; back: back to the loop header.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "FlowBranch".
 */
export type FlowBranch =
  | 'true'
  | 'false'
  | 'loopNext'
  | 'loopDone'
  | 'loopElse'
  | 'case'
  | 'noMatch'
  | 'exception'
  | 'finallyThen'
  | 'back';
/**
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "Severity".
 */
export type Severity = 'error' | 'warning' | 'information' | 'hint';
/**
 * Stable diagnostic codes; the UI localizes by code and args (DiagnosticArgsByCode) and falls back to the English message. syntax-error: the file does not parse (the last valid graph stays visible). newer-syntax: the file uses syntax newer than the engine's interpreter. base-syntax-error: the base version does not parse, so its changes cannot be computed. self-unused: a method does not use self. attribute-outside-init: an instance attribute is first assigned outside the initializers. mro-conflict: the bases allow no consistent method resolution order. duplicate-definition: a name is defined more than once in one scope. import-cycle: modules import each other in a cycle. rules-file-invalid: the side-effect rules file is invalid; the built-in rules still apply. graph-truncated: the engine reached its safety cap (meta.truncated). file-too-large: a file exceeds the size limit and was skipped. file-unreadable: a file is not a regular file or could not be read. symbol-not-found: there is no suitable symbol at the requested position. jedi-unavailable: Jedi failed, the call graph continues without it. jedi-budget-exceeded: Jedi's time budget ran out, the remaining call sites stay unresolved. changes-partial: change information is incomplete. git-unavailable: Git is not available, so there is no diff base.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "DiagnosticCode".
 */
export type DiagnosticCode =
  | 'syntax-error'
  | 'newer-syntax'
  | 'base-syntax-error'
  | 'self-unused'
  | 'attribute-outside-init'
  | 'mro-conflict'
  | 'duplicate-definition'
  | 'import-cycle'
  | 'rules-file-invalid'
  | 'graph-truncated'
  | 'file-too-large'
  | 'file-unreadable'
  | 'symbol-not-found'
  | 'jedi-unavailable'
  | 'jedi-budget-exceeded'
  | 'changes-partial'
  | 'git-unavailable';
/**
 * The args of any diagnostic; the code decides which def applies (DiagnosticArgsByCode).
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "DiagnosticArgs".
 */
export type DiagnosticArgs =
  | DetailArgs
  | NewerSyntaxArgs
  | SelfUnusedArgs
  | AttributeOutsideInitArgs
  | MroConflictArgs
  | DuplicateDefinitionArgs
  | ImportCycleArgs
  | RulesFileInvalidArgs
  | GraphTruncatedArgs
  | FileTooLargeArgs
  | FileUnreadableArgs
  | SymbolNotFoundArgs
  | JediBudgetExceededArgs
  | ChangesPartialArgs
  | GitUnavailableArgs;
/**
 * Why the engine could not read a file. notRegular: not a regular file, e.g. a directory, a FIFO or a device. notFound: the file does not exist. accessDenied: the file may not be read. decodeFailed: its bytes do not decode in the file's encoding (PEP 263). readFailed: another file system error.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "UnreadableReason".
 */
export type UnreadableReason =
  'notRegular' | 'notFound' | 'accessDenied' | 'decodeFailed' | 'readFailed';
/**
 * Why Git gives no diff base. untrusted: Restricted Mode, in which the Git extension does not run. extensionDisabled: the Git extension is disabled. gitDisabled: git.enabled is false. gitMissing: no Git executable was found. noRepository: the file is in no Git repository. notOpened: its repository is not opened, e.g. a parent folder or an unsafe repository.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "GitUnavailableReason".
 */
export type GitUnavailableReason =
  'untrusted' | 'extensionDisabled' | 'gitDisabled' | 'gitMissing' | 'noRepository' | 'notOpened';

/**
 * Hearback graph model. Single source of truth for the analysis engine (Python), the extension host and the webview (TypeScript). The root is the GraphDocument; the other analysis results (ChangeSummary, IndexResult) and the typed props of every node and edge kind are $defs. Positions are zero-based; 'character' counts UTF-16 code units (LSP semantics).
 */
export interface GraphDocument {
  /**
   * Major version of this schema. Bumped on every incompatible change; ChangeSummary and IndexResult carry the same value.
   */
  schemaVersion: 2;
  view: ViewKind;
  /**
   * Id of the node the request focused on: the symbol at the requested position, when there is one.
   */
  focus?: string;
  nodes: Node[];
  edges: Edge[];
  diagnostics: Diagnostic[];
  meta: Meta;
}
/**
 * range covers the whole node, a definition from its first decorator to its last statement (cursor sync uses it); selectionRange covers the name of a definition, inside range (the navigation target of a click). props are view-specific facts and must match the props def of the node's kind (NodePropsByKind).
 *
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
  selectionRange?: Range;
  props?: NodeProps;
  change?: ChangeStatus;
  changeDetail?: ChangeDetail;
  attribution?: Attribution;
  /**
   * English fallback text: why the target could not be resolved. Required for kind 'unresolved', which also requires props.reasonCode.
   */
  reason?: string;
}
/**
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "Range".
 */
export interface Range {
  /**
   * Absolute file system path, exactly as the extension passed it to the engine. For a range with a revision of a renamed file, the path the file had in that revision.
   */
  file: string;
  start: Position;
  end: Position;
  /**
   * Git revision (commit SHA) whose text the positions refer to, instead of the working text: set on the ranges of deleted nodes (ghosts) and of evidence that exists only in the base version. Such ranges never take part in cursor sync; navigation opens that revision.
   */
  revision?: string;
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
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "PackageProps".
 */
export interface PackageProps {
  /**
   * An implicit namespace package (PEP 420): a directory without __init__.py.
   */
  namespace?: boolean;
}
/**
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "ModuleProps".
 */
export interface ModuleProps {
  /**
   * The module is the __init__.py of a regular package, whose submodules have it as their parent.
   */
  packageInit?: boolean;
}
/**
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "ClassProps".
 */
export interface ClassProps {
  /**
   * The base class expressions as written, e.g. BaseClient or Generic[T].
   */
  bases?: string[];
  /**
   * The decorator expressions as written, without '@', e.g. dataclass(frozen=True).
   */
  decorators?: string[];
  /**
   * The method resolution order (C3) as ids, starting with the class itself: workspace classes by their node ids, classes outside the workspace by their symbol ids (py:<dotted name>, e.g. py:builtins.object), and a base that cannot be resolved by the id of its unresolved node (unresolved:<class id>/<expression>), which the class's inherits edge targets. Classes outside the workspace and unresolved bases enter C3 with object as their only base; the side panel marks both. The list ends where mroError stops it.
   */
  mro?: string[];
  /**
   * English text: why no consistent method resolution order exists (diagnostic mro-conflict).
   */
  mroError?: string;
  /**
   * LCOM4-like groups: the ids of methods and attributes that belong together. More than one group means the class consists of independent parts. Constructors, static and class methods, methods that do not use self and methods with dynamic self access are left out.
   */
  components?: string[][];
  /**
   * The class is defined in another workspace file and appears only as a context card, for example a base class of a class in the analyzed file.
   */
  context?: boolean;
  matrix?: StateMatrix;
}
/**
 * The state matrix of a class: methods × attributes with R, W or RW (mutates counts as W).
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "StateMatrix".
 */
export interface StateMatrix {
  /**
   * Method ids, in display order.
   */
  rows: string[];
  /**
   * Attribute ids, in display order, inherited attributes included.
   */
  columns: string[];
  /**
   * The non-empty cells.
   */
  cells: StateCell[];
}
/**
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "StateCell".
 */
export interface StateCell {
  /**
   * Method id, one of StateMatrix.rows.
   */
  row: string;
  /**
   * Attribute id, one of StateMatrix.columns.
   */
  column: string;
  access: StateAccess;
}
/**
 * Props of functions and methods.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "FunctionProps".
 */
export interface FunctionProps {
  /**
   * The parameter list and return annotation as written, e.g. (self, url: str) -> bytes.
   */
  signature?: string;
  /**
   * All parameters in order, the receiver (self, cls) included.
   */
  parameters?: Parameter[];
  async?: boolean;
  /**
   * The decorator expressions as written, without '@'.
   */
  decorators?: string[];
  visibility?: Visibility;
  methodKind?: MethodKind;
  group?: MethodGroup;
  /**
   * Decorated with @abstractmethod.
   */
  abstract?: boolean;
  /**
   * The signatures of the @overload stubs folded into this implementation.
   */
  overloads?: string[];
  /**
   * The method does not use its receiver (diagnostic self-unused).
   */
  selfUnused?: boolean;
  metrics?: Metrics;
  sideEffects?: SideEffect[];
  /**
   * False when calls with unresolved targets may add side effects or exceptions the analysis cannot see ('may raise more').
   */
  sideEffectsComplete?: boolean;
  /**
   * Exceptions that may leave the function: its own raises that no handler of it surely catches (certain) and exceptions propagated from its callees (inferred, with via). python/callGraph draws them as raises edges, together with the raises that a handler surely catches (ExceptionEdgeProps.handled).
   */
  raises?: ExceptionInfo[];
  /**
   * Exceptions its handlers catch; python/callGraph draws them as catches edges.
   */
  catches?: ExceptionInfo[];
  /**
   * Names of the builtins it calls, e.g. print. Builtins are not call targets.
   */
  builtinCalls?: string[];
  /**
   * The method accesses its receiver dynamically, e.g. getattr(self, name) or vars(self).
   */
  dynamicSelfAccess?: boolean;
}
/**
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "Parameter".
 */
export interface Parameter {
  name: string;
  kind: ParameterKind;
  /**
   * The annotation as written.
   */
  annotation?: string;
  /**
   * The default value as written.
   */
  default?: string;
}
/**
 * Neutral metrics of a function.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "Metrics".
 */
export interface Metrics {
  /**
   * Cyclomatic complexity (McCabe, counted as radon does).
   */
  complexity: number;
  /**
   * Deepest nesting of if, for, while, try, with and match blocks.
   */
  nesting: number;
  /**
   * Lines from the first decorator to the end.
   */
  lines: number;
  /**
   * Lines without blank and comment-only lines.
   */
  sloc: number;
  /**
   * Number of parameters without self and cls.
   */
  parameters: number;
}
/**
 * A side effect found by a rule of the side-effect rules (built-in or from hearback.sideEffects.rulesFile). confidence is certain when import resolution or the builtins prove the matched name, inferred for a method name on an unknown receiver.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "SideEffect".
 */
export interface SideEffect {
  category: SideEffectCategory;
  /**
   * Id of the rule that matched, e.g. output.print. The UI localizes built-in rule ids.
   */
  rule: string;
  confidence: FactConfidence;
  /**
   * What matched, as written, e.g. self.session.request.
   */
  detail?: string;
  /**
   * Every place where it happens; at least one.
   */
  evidence: Range[];
}
/**
 * An exception a function raises or catches.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "ExceptionInfo".
 */
export interface ExceptionInfo {
  /**
   * The exception as written, e.g. RuntimeError or requests.HTTPError.
   */
  type: string;
  /**
   * Symbol id of the exception class, when it is resolved: the class node's id for a workspace class, py:<dotted name> otherwise, e.g. py:builtins.RuntimeError. In python/callGraph the raises or catches edge targets the node with this id; other views have that node only when the class itself belongs to them.
   */
  target?: string;
  confidence: FactConfidence;
  /**
   * For a propagated exception: the ids of the called functions it comes through.
   */
  via?: string[];
  /**
   * Where it comes from in this function: raise statements, except clauses, or for a propagated exception the calls it comes through.
   */
  evidence?: Range[];
}
/**
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "AttributeProps".
 */
export interface AttributeProps {
  scope?: AttributeScope;
  /**
   * The annotation as written.
   */
  annotation?: string;
  /**
   * For class attributes: the value assigned in the class body, as written.
   */
  default?: string;
  /**
   * Where the attribute is assigned (rebound, not mutated).
   */
  assignments?: AttributeAssignment[];
  /**
   * The attribute is first assigned outside the initializers (diagnostic attribute-outside-init).
   */
  outsideInit?: boolean;
  /**
   * Id of the class that defines the attribute: the first class along the MRO that assigns it. The attribute's id starts with it. A card lists an attribute whose owner is another class as inherited.
   */
  owner?: string;
}
/**
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "AttributeAssignment".
 */
export interface AttributeAssignment {
  /**
   * Id of the function or method that assigns it; absent for the class body.
   */
  method?: string;
  range: Range;
}
/**
 * A property: its accessors fold into one node.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "PropertyProps".
 */
export interface PropertyProps {
  accessors?: PropertyAccessor[];
}
/**
 * One accessor of a property; range covers its definition from its first decorator.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "PropertyAccessor".
 */
export interface PropertyAccessor {
  kind: AccessorKind;
  /**
   * The accessor's parameter list and return annotation as written.
   */
  signature?: string;
  range?: Range;
}
/**
 * For kinds without props of their own in this schema version (parameter, variable, the SQL and dbt objects until phase 2, and edges such as inherits): props, if present, must be empty.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "NoProps".
 */
export interface NoProps {}
/**
 * Props of the control-flow node kinds.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "FlowNodeProps".
 */
export interface FlowNodeProps {
  /**
   * On an exit: the exceptional exit that uncaught exceptions reach.
   */
  exceptional?: boolean;
  /**
   * On a block: the number of simple statements merged into it; the label shows the first.
   */
  statements?: number;
  /**
   * No path from the entry reaches the node, e.g. code after a return.
   */
  unreachable?: boolean;
  /**
   * A return, raise, break or continue that leaves before the end of its function or loop body.
   */
  earlyExit?: boolean;
  /**
   * When compared: the number of base lines deleted at this place.
   */
  removedLines?: number;
}
/**
 * A target outside the workspace. Calls and imports collapse into one node per top-level package, with the id py:<package> (py:os for os.path); the views show it collapsed and list its names when it is expanded (spec 6.1.5). An exception class outside the workspace gets a node of its own, with the id py:<symbol>, for raises and catches edges.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "ExternalProps".
 */
export interface ExternalProps {
  group: ExternalGroup;
  /**
   * The top-level package name, e.g. json, os or builtins.
   */
  package: string;
  /**
   * On a package node: the dotted names behind its edges, sorted, e.g. os and os.path for import os and import os.path, or json.dumps for a call of json.dumps.
   */
  names?: string[];
  /**
   * On an exception node: the exception class as a dotted name, as the imports resolve it, e.g. builtins.TimeoutError or requests.HTTPError.
   */
  symbol?: string;
}
/**
 * Props of unresolved nodes. args must match the def of the reasonCode (UnresolvedArgsByCode).
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "UnresolvedProps".
 */
export interface UnresolvedProps {
  /**
   * The expression that could not be resolved, as written, e.g. getattr(self, name)().
   */
  expression?: string;
  reasonCode: UnresolvedReasonCode;
  args?: UnresolvedArgs;
}
/**
 * Args of dynamic-call.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "DynamicCallArgs".
 */
export interface DynamicCallArgs {
  /**
   * The builtin that looks the target up, e.g. getattr.
   */
  function: string;
}
/**
 * For codes without args (subscript-call, computed-import and computed-class): args, if present, must be empty.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "NoArgs".
 */
export interface NoArgs {}
/**
 * Args of local-value.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "LocalValueArgs".
 */
export interface LocalValueArgs {
  /**
   * The local variable or parameter that holds the target.
   */
  name: string;
}
/**
 * Args of unknown-receiver-type, type-resolution-off and type-resolution-skipped.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "ReceiverArgs".
 */
export interface ReceiverArgs {
  /**
   * The receiver as written, e.g. self.session or c.
   */
  receiver: string;
  /**
   * The called method's name, e.g. request.
   */
  method: string;
}
/**
 * Args of external-base.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "ExternalBaseArgs".
 */
export interface ExternalBaseArgs {
  /**
   * The base class outside the workspace where the lookup ended, as a dotted name, e.g. requests.Session.
   */
  base: string;
  /**
   * The name that was looked up.
   */
  name: string;
}
/**
 * Args of never-assigned.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "NeverAssignedArgs".
 */
export interface NeverAssignedArgs {
  /**
   * The attribute's name.
   */
  attribute: string;
}
/**
 * Args of undefined-name.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "UndefinedNameArgs".
 */
export interface UndefinedNameArgs {
  /**
   * The undefined name.
   */
  name: string;
  /**
   * For a from-import: the dotted name of the workspace module that does not define it.
   */
  module?: string;
}
/**
 * Args of module-not-found.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "ModuleNotFoundArgs".
 */
export interface ModuleNotFoundArgs {
  /**
   * The module as written, e.g. .missing or shop.missing.
   */
  module: string;
}
/**
 * What kind of change a node saw, next to its change status, so that later phases can treat some changes as understood without changing the rule for 'modified'.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "ChangeDetail".
 */
export interface ChangeDetail {
  /**
   * Only formatting or comments changed; the node stays unchanged.
   */
  formattingOnly?: boolean;
  /**
   * Only the docstring changed; the node is modified.
   */
  docstringOnly?: boolean;
  /**
   * Only the order of the module's imports changed; the module is modified.
   */
  importsReorderedOnly?: boolean;
  /**
   * Only the order of the members changed; the class or module is modified, the members are not.
   */
  membersReorderedOnly?: boolean;
  /**
   * Number of nested definitions, at any depth, that are added, modified or deleted. Containers count only their own statements for their own status.
   */
  changedDescendants?: number;
  /**
   * Id of the base version's node that this added node was renamed from; that node gets no ghost.
   */
  renamedFrom?: string;
}
/**
 * props are view-specific facts and must match the props def of the edge's kind (EdgePropsByKind).
 *
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
  props?: EdgeProps;
  change?: ChangeStatus;
}
/**
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "CallEdgeProps".
 */
export interface CallEdgeProps {
  resolvedBy?: ResolvedBy;
}
/**
 * Props of reads, writes and mutates edges.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "AccessEdgeProps".
 */
export interface AccessEdgeProps {
  mutation?: MutationKind;
  /**
   * For mutation 'method': the mutating method's name, e.g. append.
   */
  method?: string;
}
/**
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "ImportEdgeProps".
 */
export interface ImportEdgeProps {
  /**
   * Set only when every import statement behind the edge has the flag.
   */
  flags?: ImportFlag[];
  cycle?: ImportCycle;
}
/**
 * Membership of the edge in an import cycle (diagnostic import-cycle).
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "ImportCycle".
 */
export interface ImportCycle {
  /**
   * Number of the cycle (strongly connected component), equal for all its edges.
   */
  index: number;
  kind: CycleKind;
}
/**
 * Props of raises and catches edges. python/callGraph draws them from a function or method to the exception class: its class node for a workspace class, an external node with symbol otherwise, or an unresolved node (computed-class, undefined-name) when the class cannot be determined. FunctionProps.raises, without the handled raises, and FunctionProps.catches carry the same facts in every view that has the function.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "ExceptionEdgeProps".
 */
export interface ExceptionEdgeProps {
  /**
   * For a propagated exception (inferred): the ids of the called functions it comes through.
   */
  via?: string[];
  /**
   * On a raises edge: a handler of the same function surely catches the exception, so it does not propagate to callers.
   */
  handled?: boolean;
}
/**
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "FlowEdgeProps".
 */
export interface FlowEdgeProps {
  branch?: FlowBranch;
  /**
   * A source fragment shown with the branch label, e.g. the exception type of an exception edge or the pattern of a case.
   */
  text?: string;
  /**
   * An exception edge: inferred and drawn dashed.
   */
  exceptional?: boolean;
  /**
   * The edge leads back to a loop header, from the end of the loop body or from a continue.
   */
  back?: boolean;
}
/**
 * A finding of an analysis. args must match the def of its code (DiagnosticArgsByCode).
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "Diagnostic".
 */
export interface Diagnostic {
  severity: Severity;
  code: DiagnosticCode;
  /**
   * English fallback text.
   */
  message: string;
  args?: DiagnosticArgs;
  /**
   * Absolute path of the file that a diagnostic about a whole file concerns, such as file-too-large or file-unreadable, exactly as the host passed it. A diagnostic with a range names its file in range.file.
   */
  file?: string;
  range?: Range;
  nodeId?: string;
}
/**
 * Args of syntax-error, base-syntax-error and jedi-unavailable.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "DetailArgs".
 */
export interface DetailArgs {
  /**
   * The failing component's own message in English, e.g. CPython's expected ':' or the type of Jedi's exception.
   */
  detail: string;
}
/**
 * Args of newer-syntax.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "NewerSyntaxArgs".
 */
export interface NewerSyntaxArgs {
  /**
   * The syntax feature, e.g. except* or PEP 701 f-strings.
   */
  feature: string;
  /**
   * The first Python version that has the feature, e.g. 3.11.
   */
  requiredVersion: string;
  /**
   * The version of the engine's interpreter, e.g. 3.10.20.
   */
  runningVersion: string;
}
/**
 * Args of self-unused.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "SelfUnusedArgs".
 */
export interface SelfUnusedArgs {
  /**
   * The method's name.
   */
  method: string;
}
/**
 * Args of attribute-outside-init.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "AttributeOutsideInitArgs".
 */
export interface AttributeOutsideInitArgs {
  /**
   * The attribute's name.
   */
  attribute: string;
  /**
   * The name of the method that assigns it first.
   */
  method: string;
}
/**
 * Args of mro-conflict.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "MroConflictArgs".
 */
export interface MroConflictArgs {
  /**
   * The name of the class that has no consistent method resolution order.
   */
  className: string;
}
/**
 * Args of duplicate-definition.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "DuplicateDefinitionArgs".
 */
export interface DuplicateDefinitionArgs {
  /**
   * The name that is defined more than once in its scope.
   */
  name: string;
}
/**
 * Args of import-cycle.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "ImportCycleArgs".
 */
export interface ImportCycleArgs {
  /**
   * The dotted module names in import order, separated by ' → ', with the first repeated at the end, e.g. a → b → a.
   */
  modules: string;
  /**
   * The number of modules in the cycle.
   */
  count: number;
  kind: CycleKind;
}
/**
 * Args of rules-file-invalid.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "RulesFileInvalidArgs".
 */
export interface RulesFileInvalidArgs {
  /**
   * Absolute path of the rules file.
   */
  path: string;
  /**
   * What is wrong, in English and without the file's contents.
   */
  detail: string;
  /**
   * The index of the rule at fault in rules, when one rule is.
   */
  rule?: number;
}
/**
 * Args of graph-truncated.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "GraphTruncatedArgs".
 */
export interface GraphTruncatedArgs {
  /**
   * The safety cap that the engine reached: 10 × maxNodes, at most 10,000 nodes.
   */
  limit: number;
}
/**
 * Args of file-too-large.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "FileTooLargeArgs".
 */
export interface FileTooLargeArgs {
  /**
   * The file's size in bytes.
   */
  size: number;
  /**
   * The largest size the engine reads, in bytes.
   */
  limit: number;
}
/**
 * Args of file-unreadable.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "FileUnreadableArgs".
 */
export interface FileUnreadableArgs {
  reason: UnreadableReason;
}
/**
 * Args of symbol-not-found.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "SymbolNotFoundArgs".
 */
export interface SymbolNotFoundArgs {
  /**
   * The requested symbol id, when the request named one; otherwise the diagnostic's range marks the requested position.
   */
  symbol?: string;
}
/**
 * Args of jedi-budget-exceeded.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "JediBudgetExceededArgs".
 */
export interface JediBudgetExceededArgs {
  /**
   * Jedi's time budget per request, in milliseconds.
   */
  budgetMs: number;
  /**
   * The number of call sites left unresolved (type-resolution-skipped).
   */
  skipped: number;
}
/**
 * Args of changes-partial.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "ChangesPartialArgs".
 */
export interface ChangesPartialArgs {
  /**
   * The number of changed files without change information (WorkspaceFiles.omittedBases).
   */
  files: number;
}
/**
 * Args of git-unavailable.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "GitUnavailableArgs".
 */
export interface GitUnavailableArgs {
  reason: GitUnavailableReason;
}
/**
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "Meta".
 */
export interface Meta {
  engineVersion: string;
  durationMs: number;
  /**
   * Git revision (commit SHA) of the diff base the result was compared with. Absent without a base.
   */
  baseRevision?: string;
  /**
   * SQL dialect used for parsing.
   */
  dialect?: string;
  /**
   * True when the engine reached its safety cap (10 × hearback.graph.maxNodes, at most 10,000 nodes) and cut the graph; a graph-truncated diagnostic explains it. The webview collapses graphs above maxNodes itself.
   */
  truncated?: boolean;
}
/**
 * The args def of every diagnostic code, as a type-level mapping (never sent). Diagnostic.args must match the def of the diagnostic's code; the localized texts of host and webview interpolate these names.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "DiagnosticArgsByCode".
 */
export interface DiagnosticArgsByCode {
  'syntax-error': DetailArgs;
  'newer-syntax': NewerSyntaxArgs;
  'base-syntax-error': DetailArgs;
  'self-unused': SelfUnusedArgs;
  'attribute-outside-init': AttributeOutsideInitArgs;
  'mro-conflict': MroConflictArgs;
  'duplicate-definition': DuplicateDefinitionArgs;
  'import-cycle': ImportCycleArgs;
  'rules-file-invalid': RulesFileInvalidArgs;
  'graph-truncated': GraphTruncatedArgs;
  'file-too-large': FileTooLargeArgs;
  'file-unreadable': FileUnreadableArgs;
  'symbol-not-found': SymbolNotFoundArgs;
  'jedi-unavailable': DetailArgs;
  'jedi-budget-exceeded': JediBudgetExceededArgs;
  'changes-partial': ChangesPartialArgs;
  'git-unavailable': GitUnavailableArgs;
}
/**
 * The args def of every unresolved reason code, as a type-level mapping (never sent). UnresolvedProps.args must match the def of its reasonCode; the localized texts of host and webview interpolate these names.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "UnresolvedArgsByCode".
 */
export interface UnresolvedArgsByCode {
  'dynamic-call': DynamicCallArgs;
  'subscript-call': NoArgs;
  'local-value': LocalValueArgs;
  'unknown-receiver-type': ReceiverArgs;
  'type-resolution-off': ReceiverArgs;
  'type-resolution-skipped': ReceiverArgs;
  'external-base': ExternalBaseArgs;
  'never-assigned': NeverAssignedArgs;
  'undefined-name': UndefinedNameArgs;
  'computed-import': NoArgs;
  'module-not-found': ModuleNotFoundArgs;
  'computed-class': NoArgs;
}
/**
 * The props def of every node kind, as a type-level mapping (never sent). Node.props must match the def of the node's kind.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "NodePropsByKind".
 */
export interface NodePropsByKind {
  package: PackageProps;
  module: ModuleProps;
  class: ClassProps;
  function: FunctionProps;
  method: FunctionProps;
  attribute: AttributeProps;
  property: PropertyProps;
  parameter: NoProps;
  variable: NoProps;
  statement: NoProps;
  query: NoProps;
  subquery: NoProps;
  cte: NoProps;
  table: NoProps;
  view: NoProps;
  column: NoProps;
  model: NoProps;
  source: NoProps;
  seed: NoProps;
  snapshot: NoProps;
  entry: FlowNodeProps;
  exit: FlowNodeProps;
  block: FlowNodeProps;
  condition: FlowNodeProps;
  loop: FlowNodeProps;
  try: FlowNodeProps;
  handler: FlowNodeProps;
  finally: FlowNodeProps;
  with: FlowNodeProps;
  match: FlowNodeProps;
  case: FlowNodeProps;
  return: FlowNodeProps;
  raise: FlowNodeProps;
  break: FlowNodeProps;
  continue: FlowNodeProps;
  external: ExternalProps;
  unresolved: UnresolvedProps;
}
/**
 * The props def of every edge kind, as a type-level mapping (never sent). Edge.props must match the def of the edge's kind.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "EdgePropsByKind".
 */
export interface EdgePropsByKind {
  calls: CallEdgeProps;
  reads: AccessEdgeProps;
  writes: AccessEdgeProps;
  mutates: AccessEdgeProps;
  inherits: NoProps;
  overrides: NoProps;
  imports: ImportEdgeProps;
  depends_on: NoProps;
  lineage: NoProps;
  joins: NoProps;
  raises: ExceptionEdgeProps;
  catches: ExceptionEdgeProps;
  flow: FlowEdgeProps;
}
/**
 * Result of diff/compare: the outline of one file, with change status per symbol when compared with a base, and the line hunks.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "ChangeSummary".
 */
export interface ChangeSummary {
  /**
   * Equal to GraphDocument.schemaVersion.
   */
  schemaVersion: 2;
  /**
   * The analyzed file, exactly as the extension passed it.
   */
  file: string;
  /**
   * The dotted module name derived from the file path and the source roots, e.g. shop.orders.
   */
  module: string;
  /**
   * The base revision the symbols were compared with; absent without a base. meta.baseRevision carries the same value.
   */
  baseRevision?: string;
  /**
   * The module, its classes, functions, methods and properties, with change and changeDetail when compared; deleted symbols as ghosts whose ranges carry the base revision.
   */
  symbols: Node[];
  /**
   * Line hunks between the base and the working text; empty without a base.
   */
  hunks: Hunk[];
  diagnostics: Diagnostic[];
  meta: Meta;
}
/**
 * One changed run of lines: the base lines are replaced by the working lines.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "Hunk".
 */
export interface Hunk {
  base: LineSpan;
  working: LineSpan;
}
/**
 * A run of count lines from the zero-based line start. With count 0 (an insertion or deletion), start is the line before which it happens.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "LineSpan".
 */
export interface LineSpan {
  start: number;
  count: number;
}
/**
 * Result of python/indexFiles: the engine parsed one batch of workspace files into its per-file summaries.
 *
 * This interface was referenced by `GraphDocument`'s JSON-Schema
 * via the `definition` "IndexResult".
 */
export interface IndexResult {
  /**
   * Equal to GraphDocument.schemaVersion.
   */
  schemaVersion: 2;
  /**
   * The workspace folder of the batch, exactly as the extension passed it.
   */
  root: string;
  /**
   * Number of files in the batch.
   */
  files: number;
  /**
   * Files read and parsed for this request.
   */
  parsed: number;
  /**
   * Files whose cached summary was still valid.
   */
  reused: number;
  /**
   * Files that could not be read or parsed (file-too-large, file-unreadable, syntax-error, newer-syntax); each diagnostic names its file in file, or in range.file when it has a range.
   */
  diagnostics: Diagnostic[];
  meta: Meta;
}
