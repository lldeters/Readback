import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  vi.restoreAllMocks();
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

  it('keeps the same object across re-renders while the theme stays the same', () => {
    setBody('vscode-dark');
    const { result, rerender } = renderHook(() => useThemeKind());
    const first = result.current;
    // useSyncExternalStore skips the render while the kind is unchanged, so only a re-render for
    // another reason (here the caller's) shows whether the theme object is memoized.
    rerender();
    expect(result.current).toBe(first);
  });

  it('does not re-render for body changes that keep the theme', async () => {
    setBody('vscode-dark');
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useThemeKind();
    });
    const first = result.current;
    await switchTheme('vscode-dark vscode-reduce-motion');
    expect(renders).toBe(1);
    expect(result.current).toBe(first);
  });

  it('disconnects its observer on unmount', () => {
    // React never re-renders an unmounted hook, so only the observer itself shows a leak.
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const { unmount } = renderHook(() => useThemeKind());
    expect(observe).toHaveBeenCalledOnce();
    const [observer] = observe.mock.contexts;
    expect(disconnect).not.toHaveBeenCalled();
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(disconnect.mock.contexts[0]).toBe(observer);
  });
});
