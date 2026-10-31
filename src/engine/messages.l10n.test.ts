// Every user-visible sentence must go through vscode.l10n.t (spec 0.9: complete German
// localization). The l10n stub wraps each translated message in «…»; any text outside the markers
// would be hard-coded English. Raw technical details may only appear as placeholder arguments.
import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', async () => {
  const stub = await vi.importActual<typeof import('../../test/stubs/vscode')>('vscode');
  return {
    ...stub,
    l10n: {
      ...stub.l10n,
      t: (message: string, ...args: unknown[]) => `«${stub.l10n.t(message, ...args)}»`,
    },
  };
});

const { EngineRequestFailure, EngineStartFailure } = await import('./engineConnection');
const { describeFailure, describeOutcome, describeRequestFailure } = await import('./messages');

const START_KINDS = [
  'spawnFailed',
  'pythonTooOld',
  'bootstrapFailed',
  'exitedDuringStartup',
  'startupTimeout',
  'protocolMismatch',
  'initializeFailed',
] as const;

const SKIP_REASONS = [
  'notConfigured',
  'notInstalled',
  'noEnvironment',
  'untrustedWorkspace',
  'declined',
  'insideWorkspace',
  'storeAlias',
  'xcodeShim',
  'notFound',
] as const;

const FAILURE_REASONS = [
  'notFound',
  'notExecutable',
  'invalidPath',
  'insideWorkspace',
  'tooOld',
  'notCPython',
  'probeFailed',
  'timeout',
  'apiError',
] as const;

function expectLocalized(text: string): void {
  expect(text.startsWith('«') && text.endsWith('»'), text).toBe(true);
}

const emptyResolution = {
  trusted: true,
  blockedBySetting: true,
  interpreter: undefined,
  attempts: [],
};

describe('localization coverage', () => {
  it('localizes every attempt outcome', () => {
    for (const reason of SKIP_REASONS) {
      expectLocalized(describeOutcome({ kind: 'skipped', reason }));
    }
    for (const reason of FAILURE_REASONS) {
      expectLocalized(describeOutcome({ kind: 'failed', reason, detail: 'x' }));
    }
    for (const pathProblem of [
      'workspaceFolderUntrusted',
      'relativeUntrusted',
      'unsupportedVariable',
    ] as const) {
      const text = describeOutcome({
        kind: 'failed',
        reason: 'invalidPath',
        detail: '${env:X}',
        pathProblem,
      });
      expectLocalized(text);
      // The nested reason is localized as well, not appended in English.
      expect(text).toMatch(/^«invalid path: «.+»»$/);
    }
  });

  it('localizes every start failure', () => {
    for (const kind of START_KINDS) {
      const error = new EngineStartFailure(kind, 'English log text', undefined, undefined, {
        code: 1,
        signal: null,
      });
      const text = describeFailure({ kind: 'start', error, resolution: emptyResolution });
      expectLocalized(text);
    }
  });

  it('localizes the other failures and request failures', () => {
    expectLocalized(describeFailure({ kind: 'noInterpreter', resolution: emptyResolution }));
    expectLocalized(describeFailure({ kind: 'settingUnusable', resolution: emptyResolution }));
    expectLocalized(
      describeFailure({
        kind: 'crashLoop',
        lastExit: { code: 1, signal: null, expected: false, hung: false },
      }),
    );
    for (const kind of ['cancelled', 'timeout', 'unavailable', 'engineError'] as const) {
      expectLocalized(describeRequestFailure(new EngineRequestFailure(kind, 'English', -32603)));
    }
  });
});
