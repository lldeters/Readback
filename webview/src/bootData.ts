// Reads the WebviewBootData that src/views/webviewHtml.ts embeds in the page. The contract (ids,
// shape and validation) lives in src/shared/webviewProtocol.ts.
import {
  BOOT_ELEMENT_ID,
  parseWebviewBootData,
  type BootDataResult,
} from '../../src/shared/webviewProtocol';

export { BOOT_ELEMENT_ID, type BootDataResult };

/** Validates already parsed boot data. */
export const parseBootData = parseWebviewBootData;

/** Parses the data-boot attribute of the #hearback-boot element. */
export function readBootData(document: Document): BootDataResult {
  const raw = document.getElementById(BOOT_ELEMENT_ID)?.dataset.boot;
  if (raw === undefined) {
    return {
      ok: false,
      reason: `the #${BOOT_ELEMENT_ID} element or its data-boot attribute is missing`,
    };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'data-boot is not valid JSON' };
  }
  return parseWebviewBootData(value);
}
