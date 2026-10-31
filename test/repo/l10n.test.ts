// The German localization must stay complete (spec 0.9): same keys and placeholders as English.
import { describe, expect, it } from 'vitest';
import { asRecord, placeholders, readJson, readText } from './helpers';

const LOCALES = ['de'];
// vsce only replaces %key% placeholders whose key matches this pattern.
const NLS_KEY = /^[A-Za-z0-9_.]+$/;

function stringMap(relativePath: string): Record<string, string> {
  const record = asRecord(readJson(relativePath));
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== 'string') {
      throw new Error(`${relativePath}: value of ${key} is not a string`);
    }
  }
  return record as Record<string, string>;
}

describe('package.nls (manifest contributions)', () => {
  const english = stringMap('package.nls.json');

  it('uses vsce-compatible keys', () => {
    for (const key of Object.keys(english)) {
      expect(key).toMatch(NLS_KEY);
    }
  });

  it('defines every %key% used in package.json and nothing unused', () => {
    const used = new Set([...readText('package.json').matchAll(/"%([^"%]+)%"/g)].map((m) => m[1]));
    expect([...used].sort()).toEqual(Object.keys(english).sort());
  });

  for (const locale of LOCALES) {
    it(`package.nls.${locale}.json has the same keys and placeholders`, () => {
      const translated = stringMap(`package.nls.${locale}.json`);
      expect(Object.keys(translated).sort()).toEqual(Object.keys(english).sort());
      for (const [key, message] of Object.entries(english)) {
        const target = translated[key] ?? '';
        expect(target.trim(), key).not.toBe('');
        expect(placeholders(target), key).toEqual(placeholders(message));
      }
    });
  }
});

describe('l10n bundles (runtime strings)', () => {
  const english = stringMap('l10n/bundle.l10n.json');

  for (const locale of LOCALES) {
    it(`bundle.l10n.${locale}.json translates every string with the same placeholders`, () => {
      const translated = stringMap(`l10n/bundle.l10n.${locale}.json`);
      expect(Object.keys(translated).sort()).toEqual(Object.keys(english).sort());
      for (const key of Object.keys(english)) {
        const target = translated[key] ?? '';
        expect(target.trim(), key).not.toBe('');
        expect(placeholders(target), key).toEqual(placeholders(key));
      }
    });
  }
});
