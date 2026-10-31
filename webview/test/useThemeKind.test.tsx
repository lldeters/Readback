import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  colorModeOf,
  readThemeKind,
  useThemeKind,
  type ThemeKind,
} from '../src/hooks/useThemeKind';

function setBody(classes: string, kind?: string): void {
  document.body.className = classes;
  if (kind === undefined) {
    delete document.body.dataset.vscodeThemeKind;
  } else {
    document.body.dataset.vscodeThemeKind = kind;
  }
}

/** Changes the body inside act() so the MutationObserver callback and the re-render complete. */
async function switchTheme(classes: string, kind?: string): Promise<void> {
  await act(async () => {
    setBody(classes, kind);
    // MutationObserver callbacks run as microtasks.
    await Promise.resolve();
  });
}

afterEach(() => {
  setBody('');
});

describe('readThemeKind', () => {
  it.each<[string, string, string | undefined, ThemeKind]>([
    ['the light class', 'vscode-light', undefined, 'light'],
    ['the dark class', 'vscode-dark', undefined, 'dark'],
    ['the high contrast class', 'vscode-high-contrast', undefined, 'high-contrast'],
    [
      'both high contrast classes (as VS Code sets them for light)',
      'vscode-high-contrast-light vscode-high-contrast',
      undefined,
      'high-contrast-light',
    ],
    ['the theme kind attribute over the class', 'vscode-dark', 'vscode-light', 'light'],
    ['an unknown attribute value', 'vscode-high-contrast', 'vscode-sepia', 'high-contrast'],
    ['nothing (outside VS Code)', '', undefined, 'dark'],
  ])('reads %s', (_name, classes, kind, expected) => {
    setBody(classes, kind);
    expect(readThemeKind(document.body)).toBe(expected);
  });
});

describe('colorModeOf', () => {
  it('maps light kinds to light and the others to dark', () => {
    expect(colorModeOf('light')).toBe('light');
    expect(colorModeOf('high-contrast-light')).toBe('light');
    expect(colorModeOf('dark')).toBe('dark');
    expect(colorModeOf('high-contrast')).toBe('dark');
  });
});

describe('useThemeKind', () => {
  it('reports the current theme', () => {
    setBody('vscode-light', 'vscode-light');
    const { result } = renderHook(() => useThemeKind());
    expect(result.current).toEqual({ kind: 'light', colorMode: 'light' });
  });

  it('follows body class changes', async () => {
    setBody('vscode-light');
    const { result } = renderHook(() => useThemeKind());
    await switchTheme('vscode-dark');
    expect(result.current).toEqual({ kind: 'dark', colorMode: 'dark' });
    await switchTheme('vscode-high-contrast-light vscode-high-contrast');
    expect(result.current).toEqual({ kind: 'high-contrast-light', colorMode: 'light' });
  });

  it('follows data-vscode-theme-kind changes', async () => {
    setBody('vscode-dark', 'vscode-dark');
    const { result } = renderHook(() => useThemeKind());
    await switchTheme('vscode-dark', 'vscode-high-contrast');
    expect(result.current.kind).toBe('high-contrast');
  });

  it('keeps the same object while the theme stays the same', async () => {
    setBody('vscode-dark');
    const { result } = renderHook(() => useThemeKind());
    const first = result.current;
    await switchTheme('vscode-dark vscode-reduce-motion');
    expect(result.current).toBe(first);
  });

  it('stops observing after unmount', async () => {
    setBody('vscode-dark');
    const { result, unmount } = renderHook(() => useThemeKind());
    unmount();
    await switchTheme('vscode-light');
    expect(result.current.kind).toBe('dark');
  });
});
