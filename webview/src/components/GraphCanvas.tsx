import * as l10n from '@vscode/l10n';
import {
  Background,
  Controls,
  ReactFlow,
  type AriaLabelConfig,
  type Edge,
  type Node,
} from '@xyflow/react';
import { useCallback, useMemo } from 'react';
import type { FlowColorMode } from '../hooks/useThemeKind';

// Stable empty arrays: new ones on every render would make React Flow resynchronize its store.
const NO_NODES: Node[] = [];
const NO_EDGES: Edge[] = [];

export interface GraphCanvasProps {
  readonly colorMode: FlowColorMode;
  /** Receives React Flow's own error reports (for example a container without size). */
  readonly onFlowError: (message: string) => void;
}

/** The pannable, zoomable canvas. Readback graphs are read-only: nothing can be moved or deleted. */
export function GraphCanvas({ colorMode, onFlowError }: GraphCanvasProps) {
  // Read after l10n.config() has run, so these must not be module constants.
  const ariaLabels = useMemo(() => flowAriaLabels(), []);
  const controlsLabel = ariaLabels['controls.ariaLabel'];
  const handleError = useCallback(
    (code: string, message: string) => {
      onFlowError(`React Flow error ${code}: ${message}`);
    },
    [onFlowError],
  );
  return (
    <ReactFlow
      nodes={NO_NODES}
      edges={NO_EDGES}
      colorMode={colorMode}
      fitView={false}
      nodesDraggable={false}
      nodesConnectable={false}
      deleteKeyCode={null}
      aria-label={l10n.t('Graph canvas')}
      ariaLabelConfig={ariaLabels}
      onError={handleError}
    >
      <Background />
      {/* React Flow names the control panel but gives it no role; the group makes the name count. */}
      <div role="group" aria-label={controlsLabel}>
        <Controls showInteractive={false} />
      </div>
    </ReactFlow>
  );
}

function flowAriaLabels(): Partial<AriaLabelConfig> & { 'controls.ariaLabel': string } {
  const selectNode = l10n.t('Press Enter or Space to select a node.');
  return {
    'controls.ariaLabel': l10n.t('Graph controls'),
    'controls.zoomIn.ariaLabel': l10n.t('Zoom in'),
    'controls.zoomOut.ariaLabel': l10n.t('Zoom out'),
    'controls.fitView.ariaLabel': l10n.t('Fit view'),
    // React Flow shows one of these depending on disableKeyboardA11y; nodes cannot move here.
    'node.a11yDescription.default': selectNode,
    'node.a11yDescription.keyboardDisabled': selectNode,
    'edge.a11yDescription.default': l10n.t('Press Enter or Space to select an edge.'),
  };
}
