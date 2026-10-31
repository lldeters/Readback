// VS Code marks the active theme on <body> (one of the vscode-* classes plus data-vscode-theme-kind)
// and updates both in place when the user switches themes.
import { useMemo, useSyncExternalStore } from 'react';

export type ThemeKind = 'light' | 'dark' | 'high-contrast' | 'high-contrast-light';

/** React Flow's colorMode only picks its built-in fallback colors; theme.css maps the rest. */
export type FlowColorMode = 'light' | 'dark';

export interface Theme {
  readonly kind: ThemeKind;
  readonly colorMode: FlowColorMode;
}

const KIND_BY_TOKEN: Readonly<Record<string, ThemeKind>> = {
  'vscode-light': 'light',
  'vscode-dark': 'dark',
  'vscode-high-contrast': 'high-contrast',
  'vscode-high-contrast-light': 'high-contrast-light',
};

const OBSERVED_ATTRIBUTES = ['class', 'data-vscode-theme-kind'];

/** Reads the theme kind from the body's attribute, falling back to its classes. */
export function readThemeKind(body: HTMLElement): ThemeKind {
  const fromAttribute = KIND_BY_TOKEN[body.dataset.vscodeThemeKind ?? ''];
  if (fromAttribute) {
    return fromAttribute;
  }
  const classes = body.classList;
  // High contrast light also carries vscode-high-contrast for backwards compatibility.
  if (classes.contains('vscode-high-contrast-light')) {
    return 'high-contrast-light';
  }
  if (classes.contains('vscode-high-contrast')) {
    return 'high-contrast';
  }
  return classes.contains('vscode-light') ? 'light' : 'dark';
}

export function colorModeOf(kind: ThemeKind): FlowColorMode {
  return kind === 'light' || kind === 'high-contrast-light' ? 'light' : 'dark';
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { attributes: true, attributeFilter: OBSERVED_ATTRIBUTES });
  return () => {
    observer.disconnect();
  };
}

function snapshot(): ThemeKind {
  return readThemeKind(document.body);
}

/** The current VS Code theme kind; re-renders when the user switches themes. */
export function useThemeKind(): Theme {
  const kind = useSyncExternalStore(subscribe, snapshot);
  return useMemo(() => ({ kind, colorMode: colorModeOf(kind) }), [kind]);
}
