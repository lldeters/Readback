// Static checks of theme.css: rules that are easy to break and invisible in jsdom.
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Reads the stylesheet from disk. Vitest blanks every .css import (including ?raw) while CSS
 * processing is off, and webview/ is compiled without Node types, hence the untyped import.
 */
async function readStylesheet(): Promise<string> {
  const specifier = 'node:fs/promises';
  const fs = (await import(/* @vite-ignore */ specifier)) as {
    readFile(path: URL, encoding: 'utf8'): Promise<string>;
  };
  // Through a variable: Vite rewrites `new URL(…, import.meta.url)` into a dev-server URL.
  const base = import.meta.url;
  return fs.readFile(new URL('../src/theme.css', base), 'utf8');
}

let css = '';

beforeAll(async () => {
  css = (await readStylesheet()).replace(/\/\*[\s\S]*?\*\//g, '');
});

/** Every var(--vscode-…) expression with its full argument list. */
function vscodeVariableUses(source: string): string[] {
  const uses: string[] = [];
  for (const match of source.matchAll(/var\(\s*--vscode-/g)) {
    let depth = 0;
    for (let index = match.index; index < source.length; index++) {
      const character = source[index];
      if (character === '(') {
        depth++;
      } else if (character === ')') {
        depth--;
        if (depth === 0) {
          uses.push(source.slice(match.index, index + 1));
          break;
        }
      }
    }
  }
  return uses;
}

function hasTopLevelComma(expression: string): boolean {
  let depth = 0;
  for (const character of expression) {
    if (character === '(') {
      depth++;
    } else if (character === ')') {
      depth--;
    } else if (character === ',' && depth === 1) {
      return true;
    }
  }
  return false;
}

describe('theme.css', () => {
  it('gives every VS Code variable a fallback (themes may not define it)', () => {
    const uses = vscodeVariableUses(css);
    expect(uses.length).toBeGreaterThan(30);
    expect(uses.filter((use) => !hasTopLevelComma(use))).toEqual([]);
  });

  it('loads nothing else and needs no inline styles', () => {
    expect(css).not.toMatch(/@import|url\(|@font-face/);
  });

  it('defines the marker diagnostics.ts checks', () => {
    expect(css).toMatch(/:root\s*\{[^}]*--readback-stylesheet:\s*loaded/);
  });

  it('maps the React Flow variables to VS Code colors', () => {
    for (const variable of [
      '--xy-background-color',
      '--xy-node-color',
      '--xy-node-background-color',
      '--xy-node-border',
      '--xy-edge-stroke',
      '--xy-edge-stroke-selected',
      '--xy-controls-button-background-color',
      '--xy-controls-button-color',
      '--xy-minimap-background-color',
      '--xy-minimap-node-background-color',
    ]) {
      // Directly, or through --readback-focus-color (which is --vscode-focusBorder).
      expect(css).toMatch(
        new RegExp(`${variable}:\\s*[^;]*var\\(\\s*(--vscode-|--readback-focus-color\\))`),
      );
    }
  });

  it('has high contrast rules for dark and light high contrast themes', () => {
    expect(css).toContain('body.vscode-high-contrast .react-flow');
    expect(css).toContain('body.vscode-high-contrast-light .react-flow');
    expect(css).toContain('--vscode-contrastBorder');
    expect(css).toContain('--vscode-contrastActiveBorder');
  });

  it('shows keyboard focus with the focus border color', () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:[^;]*var\(--readback-focus-color\)/);
    expect(css).toMatch(/--readback-focus-color:\s*var\(--vscode-focusBorder,/);
  });

  it('turns off motion when VS Code asks for reduced motion', () => {
    expect(css).toMatch(/body\.vscode-reduce-motion \*[^{]*\{[^}]*transition: none !important/);
    expect(css).toMatch(/body\.vscode-reduce-motion \*[^{]*\{[^}]*animation: none !important/);
  });

  it('prepares change symbols so status never relies on color alone', () => {
    expect(css).toContain("--readback-change-added-symbol: '+'");
    expect(css).toContain("--readback-change-modified-symbol: '~'");
    expect(css).toContain("--readback-change-deleted-symbol: '\\2212'");
  });
});
