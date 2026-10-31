// Reads the WebviewBootData that src/views/webviewHtml.ts embeds in the page. The attribute is the
// only input the page gets before it can talk to the host, so it is validated like a message.
import type { WebviewBootData } from '../../src/shared/webviewProtocol';

/** Must match BOOT_ELEMENT_ID in src/views/webviewHtml.ts. */
export const BOOT_ELEMENT_ID = 'readback-boot';

export type BootDataResult =
  | { readonly ok: true; readonly data: WebviewBootData }
  | { readonly ok: false; readonly reason: string };

/** Parses the data-boot attribute of the #readback-boot element. */
export function readBootData(document: Document): BootDataResult {
  const raw = document.getElementById(BOOT_ELEMENT_ID)?.dataset.boot;
  if (raw === undefined) {
    return invalid(`the #${BOOT_ELEMENT_ID} element or its data-boot attribute is missing`);
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return invalid('data-boot is not valid JSON');
  }
  return parseBootData(value);
}

/** Validates already parsed boot data. */
export function parseBootData(value: unknown): BootDataResult {
  if (!isRecord(value)) {
    return invalid('the boot data is not an object');
  }
  const { view, locale, l10nBundle, workerUri } = value;
  if (view !== 'graph') {
    return invalid('the view is not "graph"');
  }
  if (typeof locale !== 'string') {
    return invalid('the locale is not a string');
  }
  // JSON has no undefined: an English page has no l10nBundle property at all.
  if (l10nBundle !== undefined && l10nBundle !== null && !isStringRecord(l10nBundle)) {
    return invalid('the l10n bundle is not a map of strings');
  }
  if (typeof workerUri !== 'string' || workerUri === '') {
    return invalid('the worker URI is missing');
  }
  return {
    ok: true,
    data: { view, locale, l10nBundle: l10nBundle ?? undefined, workerUri },
  };
}

function invalid(reason: string): BootDataResult {
  return { ok: false, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}
