// HTML document of Readback's webview panels. Pure functions without 'vscode' so the Content
// Security Policy and the attribute escaping can be unit-tested.
import { randomBytes } from 'node:crypto';
import { BOOT_ELEMENT_ID, ROOT_ELEMENT_ID, type WebviewBootData } from '../shared/webviewProtocol';

export { BOOT_ELEMENT_ID, ROOT_ELEMENT_ID };

export interface WebviewHtmlOptions {
  /** webview.cspSource: where resources loaded through asWebviewUri come from. */
  readonly cspSource: string;
  /** A fresh value from createNonce() for every rendered document. */
  readonly nonce: string;
  /** asWebviewUri of dist/webview/main.js. */
  readonly scriptUri: string;
  /** asWebviewUri of dist/webview/main.css. */
  readonly styleUri: string;
  readonly boot: WebviewBootData;
  /** Language tag for <html lang>, normally vscode.env.language. */
  readonly lang: string;
}

// Base64 alphabet only, so a nonce can never end the CSP source expression or the attribute early.
const NONCE_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

const ATTRIBUTE_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** A random CSP nonce: 128 bits, base64-encoded. */
export function createNonce(): string {
  return randomBytes(16).toString('base64');
}

/**
 * The webview's Content Security Policy. Scripts run only with the nonce; styles and fetches come
 * only from the extension's webview resources; workers only from blob: URLs, because webviews
 * cannot start workers from resource URLs. There is no 'unsafe-inline' or 'unsafe-eval', and base
 * URLs and form targets are locked because they do not fall back to default-src.
 */
export function contentSecurityPolicy(cspSource: string, nonce: string): string {
  const directives = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src ${cspSource}`,
    `connect-src ${cspSource}`,
    'worker-src blob:',
    "base-uri 'none'",
    "form-action 'none'",
  ];
  return `${directives.join('; ')};`;
}

/** Escapes text for a quoted HTML attribute value. */
export function escapeHtmlAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ATTRIBUTE_ESCAPES[character] ?? character);
}

/**
 * Renders the webview document. It has no inline script or style: the boot data travels as
 * HTML-escaped JSON in a data attribute and main.js reads it synchronously at startup.
 */
export function renderWebviewHtml(options: WebviewHtmlOptions): string {
  const { cspSource, nonce, scriptUri, styleUri, boot, lang } = options;
  if (!NONCE_PATTERN.test(nonce)) {
    throw new Error('The CSP nonce must be a base64 string (use createNonce()).');
  }
  const attribute = escapeHtmlAttribute;
  return [
    '<!DOCTYPE html>',
    `<html lang="${attribute(lang)}">`,
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${attribute(contentSecurityPolicy(cspSource, nonce))}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<link rel="stylesheet" href="${attribute(styleUri)}">`,
    `<meta id="${BOOT_ELEMENT_ID}" data-boot="${attribute(JSON.stringify(boot))}">`,
    '</head>',
    '<body>',
    `<div id="${ROOT_ELEMENT_ID}"></div>`,
    `<script nonce="${attribute(nonce)}" src="${attribute(scriptUri)}"></script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
