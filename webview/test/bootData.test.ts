import { describe, expect, it } from 'vitest';
import { BOOT_ELEMENT_ID, parseBootData, readBootData } from '../src/bootData';
import { WORKER_URI, bootData } from './fakes';

function documentWith(head: string): Document {
  return new DOMParser().parseFromString(
    `<!DOCTYPE html><html><head>${head}</head><body></body></html>`,
    'text/html',
  );
}

describe('readBootData', () => {
  it('decodes the HTML-escaped attribute the host writes', () => {
    // As written by escapeHtmlAttribute in src/views/webviewHtml.ts, including hostile text.
    const document = documentWith(
      `<meta id="${BOOT_ELEMENT_ID}" data-boot="{&quot;view&quot;:&quot;graph&quot;,` +
        `&quot;locale&quot;:&quot;de&quot;,&quot;l10nBundle&quot;:{&quot;&lt;/script&gt;&quot;:` +
        `&quot;&#39;&amp;&quot;},&quot;workerUri&quot;:&quot;${WORKER_URI}&quot;}">`,
    );
    expect(readBootData(document)).toEqual({
      ok: true,
      data: bootData({ locale: 'de', l10nBundle: { '</script>': "'&" } }),
    });
  });

  it('treats a missing bundle as English', () => {
    const document = documentWith(
      `<meta id="${BOOT_ELEMENT_ID}" data-boot="{&quot;view&quot;:&quot;graph&quot;,` +
        `&quot;locale&quot;:&quot;en&quot;,&quot;workerUri&quot;:&quot;${WORKER_URI}&quot;}">`,
    );
    const result = readBootData(document);
    expect(result).toEqual({ ok: true, data: bootData() });
  });

  it('reports a missing element or attribute', () => {
    expect(readBootData(documentWith(''))).toEqual({
      ok: false,
      reason: 'the #readback-boot element or its data-boot attribute is missing',
    });
    expect(readBootData(documentWith(`<meta id="${BOOT_ELEMENT_ID}">`))).toMatchObject({
      ok: false,
    });
  });

  it('reports invalid JSON', () => {
    const document = documentWith(`<meta id="${BOOT_ELEMENT_ID}" data-boot="{view:">`);
    expect(readBootData(document)).toEqual({ ok: false, reason: 'data-boot is not valid JSON' });
  });
});

describe('parseBootData', () => {
  it('accepts null as "no bundle"', () => {
    expect(parseBootData({ ...bootData(), l10nBundle: null })).toEqual({
      ok: true,
      data: bootData(),
    });
  });

  it.each([
    ['an array', [], 'the boot data is not an object'],
    ['null', null, 'the boot data is not an object'],
    ['another view', { ...bootData(), view: 'callGraph' }, 'the view is not "graph"'],
    ['a numeric locale', { ...bootData(), locale: 1 }, 'the locale is not a string'],
    [
      'a bundle with non-string values',
      { ...bootData(), l10nBundle: { a: 1 } },
      'the l10n bundle is not a map of strings',
    ],
    [
      'a bundle array',
      { ...bootData(), l10nBundle: ['x'] },
      'the l10n bundle is not a map of strings',
    ],
    ['no worker URI', { ...bootData(), workerUri: undefined }, 'the worker URI is missing'],
    ['an empty worker URI', { ...bootData(), workerUri: '' }, 'the worker URI is missing'],
  ])('rejects %s', (_name, value, reason) => {
    expect(parseBootData(value)).toEqual({ ok: false, reason });
  });

  it('drops unknown properties', () => {
    const result = parseBootData({ ...bootData(), extra: 'ignored' });
    expect(result).toEqual({ ok: true, data: bootData() });
  });
});
