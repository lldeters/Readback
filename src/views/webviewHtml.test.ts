// @vitest-environment jsdom
// Parses the generated HTML with a real HTML parser (jsdom) to prove that escaped values stay inside
// their attributes. src/ is compiled without DOM types, so the few DOM members used are typed here.
import { describe, expect, it } from 'vitest';
import type { WebviewBootData } from '../shared/webviewProtocol';
import {
  BOOT_ELEMENT_ID,
  ROOT_ELEMENT_ID,
  contentSecurityPolicy,
  createNonce,
  escapeHtmlAttribute,
  renderWebviewHtml,
  type WebviewHtmlOptions,
} from './webviewHtml';

interface ParsedElement {
  readonly tagName: string;
  readonly textContent: string | null;
  readonly attributes: { readonly length: number };
  getAttribute(name: string): string | null;
}

interface ParsedDocument {
  readonly doctype: { readonly name: string } | null;
  readonly documentElement: ParsedElement;
  readonly head: ParsedElement;
  querySelector(selectors: string): ParsedElement | null;
  querySelectorAll(selectors: string): Iterable<ParsedElement> & { readonly length: number };
}

function parseHtml(html: string): ParsedDocument {
  const { DOMParser } = globalThis as unknown as {
    DOMParser: new () => { parseFromString(source: string, type: 'text/html'): ParsedDocument };
  };
  return new DOMParser().parseFromString(html, 'text/html');
}

const CSP_SOURCE = "'self' https://*.vscode-cdn.net";
const NONCE = 'q7Lw0Zg5YFbfh3c4Rk9xVA==';

function boot(overrides: Partial<WebviewBootData> = {}): WebviewBootData {
  return {
    view: 'graph',
    locale: 'de',
    l10nBundle: { 'No graph to show yet.': 'Noch kein Graph vorhanden.' },
    workerUri: 'https://file+.vscode-resource.vscode-cdn.net/ext/dist/webview/layout.worker.js',
    ...overrides,
  };
}

function options(overrides: Partial<WebviewHtmlOptions> = {}): WebviewHtmlOptions {
  return {
    cspSource: CSP_SOURCE,
    nonce: NONCE,
    scriptUri: 'https://file+.vscode-resource.vscode-cdn.net/ext/dist/webview/main.js',
    styleUri: 'https://file+.vscode-resource.vscode-cdn.net/ext/dist/webview/main.css',
    boot: boot(),
    lang: 'de',
    ...overrides,
  };
}

function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`missing ${what}`);
  }
  return value;
}

describe('contentSecurityPolicy', () => {
  it('is exactly the approved policy', () => {
    expect(contentSecurityPolicy(CSP_SOURCE, NONCE)).toBe(
      "default-src 'none'; script-src 'nonce-q7Lw0Zg5YFbfh3c4Rk9xVA=='; " +
        "style-src 'self' https://*.vscode-cdn.net; connect-src 'self' https://*.vscode-cdn.net; " +
        "worker-src blob:; base-uri 'none'; form-action 'none';",
    );
  });

  it('never allows inline code or eval', () => {
    const policy = contentSecurityPolicy(CSP_SOURCE, NONCE);
    expect(policy).not.toContain('unsafe-inline');
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).not.toContain('*;');
  });
});

describe('createNonce', () => {
  it('returns 16 random bytes as base64', () => {
    const nonce = createNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(Buffer.from(nonce, 'base64')).toHaveLength(16);
  });

  it('differs between calls', () => {
    const nonces = new Set(Array.from({ length: 64 }, () => createNonce()));
    expect(nonces.size).toBe(64);
  });
});

describe('escapeHtmlAttribute', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtmlAttribute(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('leaves other text untouched', () => {
    expect(escapeHtmlAttribute('OrderService.place_order → ✓ 漢字')).toBe(
      'OrderService.place_order → ✓ 漢字',
    );
  });
});

describe('renderWebviewHtml', () => {
  it('produces the documented structure in order', () => {
    const html = renderWebviewHtml(options());
    const positions = [
      '<!DOCTYPE html>',
      '<html lang="de">',
      '<meta charset="utf-8">',
      '<meta http-equiv="Content-Security-Policy"',
      '<meta name="viewport"',
      '<link rel="stylesheet"',
      `<meta id="${BOOT_ELEMENT_ID}"`,
      `<div id="${ROOT_ELEMENT_ID}"></div>`,
      '<script nonce=',
    ].map((fragment) => html.indexOf(fragment));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('carries the exact CSP, the stylesheet, the script and the language', () => {
    const document = parseHtml(renderWebviewHtml(options()));
    expect(document.doctype?.name).toBe('html');
    expect(document.documentElement.getAttribute('lang')).toBe('de');
    const csp = required(
      document.querySelector('meta[http-equiv="Content-Security-Policy"]'),
      'CSP meta',
    );
    expect(csp.getAttribute('content')).toBe(contentSecurityPolicy(CSP_SOURCE, NONCE));
    const stylesheet = required(document.querySelector('link[rel="stylesheet"]'), 'stylesheet');
    expect(stylesheet.getAttribute('href')).toBe(options().styleUri);
    const scripts = [...document.querySelectorAll('script')];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.getAttribute('nonce')).toBe(NONCE);
    expect(scripts[0]?.getAttribute('src')).toBe(options().scriptUri);
  });

  it('has no inline scripts, inline styles or event handler attributes', () => {
    const html = renderWebviewHtml(options());
    const document = parseHtml(html);
    for (const script of document.querySelectorAll('script')) {
      expect(script.textContent).toBe('');
    }
    expect(document.querySelectorAll('style')).toHaveLength(0);
    expect(document.querySelectorAll('[style]')).toHaveLength(0);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it('round-trips the boot data through the data-boot attribute', () => {
    const data = boot();
    const document = parseHtml(renderWebviewHtml(options({ boot: data })));
    const meta = required(document.querySelector(`#${BOOT_ELEMENT_ID}`), 'boot meta');
    expect(JSON.parse(required(meta.getAttribute('data-boot'), 'data-boot'))).toEqual(data);
  });

  it('keeps hostile strings inside their attributes', () => {
    const hostile = `"></script><script>alert(1)</script><img src=x onerror='alert(2)'>&amp;`;
    const data = boot({ l10nBundle: { [hostile]: hostile }, locale: hostile });
    const html = renderWebviewHtml(
      options({
        boot: data,
        lang: `en" onload="alert(3)`,
        styleUri: `https://x/main.css"><script>alert(4)</script>`,
        scriptUri: `https://x/main.js' onload='alert(5)`,
      }),
    );
    const document = parseHtml(html);
    expect(document.querySelectorAll('script')).toHaveLength(1);
    expect(document.querySelectorAll('img')).toHaveLength(0);
    expect(document.documentElement.getAttribute('lang')).toBe(`en" onload="alert(3)`);
    expect(document.documentElement.getAttribute('onload')).toBeNull();
    const meta = required(document.querySelector(`#${BOOT_ELEMENT_ID}`), 'boot meta');
    expect(meta.attributes.length).toBe(2);
    expect(JSON.parse(required(meta.getAttribute('data-boot'), 'data-boot'))).toEqual(data);
    // Every '&' in the markup starts one of the five entities the escaper produces.
    expect(html.replace(/&(amp|lt|gt|quot|#39);/g, '')).not.toContain('&');
  });

  it('omits an undefined l10n bundle (English) from the boot data', () => {
    const document = parseHtml(
      renderWebviewHtml(options({ boot: boot({ l10nBundle: undefined }) })),
    );
    const meta = required(document.querySelector(`#${BOOT_ELEMENT_ID}`), 'boot meta');
    const parsed = JSON.parse(required(meta.getAttribute('data-boot'), 'data-boot')) as object;
    expect(parsed).not.toHaveProperty('l10nBundle');
  });

  it('rejects a nonce that could break out of the policy', () => {
    expect(() => renderWebviewHtml(options({ nonce: "abc'; script-src *" }))).toThrow(/nonce/);
    expect(() => renderWebviewHtml(options({ nonce: '' }))).toThrow(/nonce/);
  });

  it('uses a fresh nonce from createNonce', () => {
    const nonce = createNonce();
    const document = parseHtml(renderWebviewHtml(options({ nonce })));
    expect(document.querySelector('script')?.getAttribute('nonce')).toBe(nonce);
    expect(
      document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content'),
    ).toContain(`'nonce-${nonce}'`);
  });
});
