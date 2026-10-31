import { describe, expect, it } from 'vitest';
import type { GraphPanelState } from '../shared/webviewProtocol';
import {
  CLOSED_PANEL_STATE,
  MAX_RECORDED_ENTRIES,
  handleWebviewMessage,
  openedPanelState,
} from './graphPanelState';

function readyState(): GraphPanelState {
  return handleWebviewMessage(openedPanelState(), { type: 'ready' }).state;
}

describe('panel states', () => {
  it('starts closed and empty', () => {
    expect(CLOSED_PANEL_STATE).toEqual({
      open: false,
      ready: false,
      workerReady: false,
      workerRoundTripMs: undefined,
      cspViolations: [],
      errors: [],
    });
    expect(Object.isFrozen(CLOSED_PANEL_STATE)).toBe(true);
  });

  it('opens without any report from the page', () => {
    expect(openedPanelState()).toEqual({ ...CLOSED_PANEL_STATE, open: true });
  });
});

describe('handleWebviewMessage', () => {
  it('answers ready with an empty graph and records readiness', () => {
    const outcome = handleWebviewMessage(openedPanelState(), { type: 'ready' });
    expect(outcome.reply).toEqual({ type: 'setGraph', document: null });
    expect(outcome.state.ready).toBe(true);
    expect(outcome.log.level).toBe('debug');
  });

  it('forgets the previous worker result when the page reloads', () => {
    const withWorker = handleWebviewMessage(readyState(), {
      type: 'workerReady',
      roundTripMs: 4,
    }).state;
    const reloaded = handleWebviewMessage(withWorker, { type: 'ready' }).state;
    expect(reloaded.workerReady).toBe(false);
    expect(reloaded.workerRoundTripMs).toBeUndefined();
  });

  it('records a working layout worker', () => {
    const outcome = handleWebviewMessage(readyState(), { type: 'workerReady', roundTripMs: 12.6 });
    expect(outcome.state).toMatchObject({ workerReady: true, workerRoundTripMs: 12.6 });
    expect(outcome.reply).toBeUndefined();
    expect(outcome.log).toEqual({
      level: 'info',
      message: 'Graph view: layout worker ready (round trip 13 ms).',
    });
  });

  it('shows sub-10 ms round trips with one decimal', () => {
    const outcome = handleWebviewMessage(readyState(), { type: 'workerReady', roundTripMs: 2.345 });
    expect(outcome.log.message).toContain('round trip 2.3 ms');
  });

  it('records a failed layout worker as an error', () => {
    const working = handleWebviewMessage(readyState(), { type: 'workerReady', roundTripMs: 3 });
    const outcome = handleWebviewMessage(working.state, {
      type: 'workerError',
      message: 'The layout worker did not answer within 5000 ms.',
    });
    expect(outcome.state.workerReady).toBe(false);
    expect(outcome.state.workerRoundTripMs).toBeUndefined();
    expect(outcome.state.errors).toEqual([
      'Layout worker: The layout worker did not answer within 5000 ms.',
    ]);
    expect(outcome.log.level).toBe('error');
  });

  it('records CSP violations and logs them as warnings', () => {
    const outcome = handleWebviewMessage(readyState(), {
      type: 'cspViolation',
      directive: 'style-src-elem',
      blockedUri: 'https://example.com/x.css',
    });
    expect(outcome.state.cspViolations).toEqual([
      { directive: 'style-src-elem', blockedUri: 'https://example.com/x.css' },
    ]);
    expect(outcome.log).toEqual({
      level: 'warn',
      message:
        'Graph view: the Content Security Policy blocked https://example.com/x.css (style-src-elem).',
    });
  });

  it('describes inline violations, which have no blocked URI', () => {
    const outcome = handleWebviewMessage(readyState(), {
      type: 'cspViolation',
      directive: 'script-src-elem',
      blockedUri: '',
    });
    expect(outcome.log.message).toContain('blocked a resource (script-src-elem)');
  });

  it('records errors from the page', () => {
    const outcome = handleWebviewMessage(readyState(), { type: 'error', message: 'TypeError: x' });
    expect(outcome.state.errors).toEqual(['TypeError: x']);
    expect(outcome.log).toEqual({ level: 'error', message: 'Graph view: TypeError: x' });
  });

  it('keeps page text on one log line', () => {
    const outcome = handleWebviewMessage(readyState(), {
      type: 'error',
      message: 'first\n[error] forged line\r third',
    });
    expect(outcome.log.message).toBe('Graph view: first [error] forged line third');
    // The recorded state keeps the original text.
    expect(outcome.state.errors).toEqual(['first\n[error] forged line\r third']);
  });

  it('bounds the recorded entries', () => {
    let state = readyState();
    for (let index = 0; index < MAX_RECORDED_ENTRIES + 5; index++) {
      state = handleWebviewMessage(state, { type: 'error', message: `error ${index}` }).state;
      state = handleWebviewMessage(state, {
        type: 'cspViolation',
        directive: 'img-src',
        blockedUri: `https://x/${index}`,
      }).state;
    }
    expect(state.errors).toHaveLength(MAX_RECORDED_ENTRIES);
    expect(state.errors[0]).toBe('error 0');
    expect(state.cspViolations).toHaveLength(MAX_RECORDED_ENTRIES);
  });

  it('never mutates the previous state', () => {
    const before = readyState();
    const snapshot = structuredClone(before);
    handleWebviewMessage(before, { type: 'error', message: 'x' });
    handleWebviewMessage(before, { type: 'cspViolation', directive: 'a', blockedUri: 'b' });
    expect(before).toEqual(snapshot);
  });

  it.each([
    ['null', null, 'null'],
    ['a string', 'ready', 'a string'],
    ['an array', [{ type: 'ready' }], 'an array'],
    ['an unknown type', { type: 'launchMissiles' }, 'type "launchMissiles"'],
    ['a missing type', { message: 'x' }, 'an object without a string type'],
    ['a negative round trip', { type: 'workerReady', roundTripMs: -1 }, 'type "workerReady"'],
    ['an oversized error', { type: 'error', message: 'x'.repeat(2001) }, 'type "error"'],
    [
      'a CSP report without a directive',
      { type: 'cspViolation', blockedUri: 'x' },
      'type "cspViolation"',
    ],
  ])('drops %s and logs a warning', (_name, message, description) => {
    const before = readyState();
    const outcome = handleWebviewMessage(before, message);
    expect(outcome.state).toBe(before);
    expect(outcome.reply).toBeUndefined();
    expect(outcome.log).toEqual({
      level: 'warn',
      message: `Graph view: dropped an invalid message (${description}).`,
    });
  });

  it('does not echo long or multi-line types into the log', () => {
    const outcome = handleWebviewMessage(readyState(), { type: `a\nb${'c'.repeat(100)}` });
    expect(outcome.log.message).toBe(
      `Graph view: dropped an invalid message (type "a b${'c'.repeat(37)}").`,
    );
  });
});
