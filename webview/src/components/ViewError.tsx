import * as l10n from '@vscode/l10n';

/** Replaces the view when it cannot start or has crashed; the details go to the host's log. */
export function ViewError() {
  return (
    <div className="view-error" role="alert">
      <p>{l10n.t('Readback could not display this view. See the Readback log for details.')}</p>
    </div>
  );
}
