import { describe, expect, it } from 'vitest';
import { StderrParser, type StderrRecord } from './stderrLog';

function parse(...chunks: string[]): StderrRecord[] {
  const records: StderrRecord[] = [];
  const parser = new StderrParser((record) => records.push(record));
  for (const chunk of chunks) {
    parser.push(chunk);
  }
  parser.flush();
  return records;
}

describe('StderrParser', () => {
  it('parses log records across chunk boundaries', () => {
    expect(parse('[info] eng', 'ine ready\r\n[debug] x\n')).toEqual([
      { kind: 'log', level: 'info', message: 'engine ready' },
      { kind: 'log', level: 'debug', message: 'x' },
    ]);
  });

  it('attaches continuation lines to the previous level', () => {
    expect(parse('[error] failed\n    Traceback\n    line 2\n')).toEqual([
      { kind: 'log', level: 'error', message: 'failed' },
      { kind: 'log', level: 'error', message: '    Traceback' },
      { kind: 'log', level: 'error', message: '    line 2' },
    ]);
  });

  it('recognizes the fatal startup line', () => {
    expect(
      parse(
        'READBACK_ENGINE_FATAL {"code": "python-too-old", "version": "3.9.6", "required": "3.10"}\n',
      ),
    ).toEqual([
      { kind: 'fatal', error: { code: 'python-too-old', version: '3.9.6', required: '3.10' } },
    ]);
  });

  it('reports everything else as raw output', () => {
    expect(parse('print from a library\n\nREADBACK_ENGINE_FATAL not json\n')).toEqual([
      { kind: 'raw', message: 'print from a library' },
      { kind: 'raw', message: 'READBACK_ENGINE_FATAL not json' },
    ]);
    // Without a preceding record, indented lines are raw too.
    expect(parse('    orphan\n')).toEqual([{ kind: 'raw', message: '    orphan' }]);
  });

  it('flushes a trailing line without newline and cuts very long lines', () => {
    expect(parse('[warning] last')).toEqual([{ kind: 'log', level: 'warning', message: 'last' }]);
    const records = parse('x'.repeat(40_000));
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record.kind === 'raw' && record.message.length).toBeLessThanOrEqual(16_384);
    }
  });
});
