import * as l10n from '@vscode/l10n';

/** Shown over the canvas while there is no graph. */
export function EmptyState() {
  return (
    <div className="empty-state" role="status">
      <p className="empty-state__title">{l10n.t('No graph to show yet.')}</p>
      <p className="empty-state__detail">{l10n.t('Readback visualizations will appear here.')}</p>
    </div>
  );
}
