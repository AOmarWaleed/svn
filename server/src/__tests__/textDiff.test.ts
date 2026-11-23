import { describe, expect, it } from 'vitest';
import {
  buildSmartConflictMarkers,
  computeUnifiedDiff,
  countConflictMarkers,
  isBinaryBuffer,
} from '../utils/textDiff';

describe('textDiff', () => {
  it('detects binary vs utf8 buffers', () => {
    expect(isBinaryBuffer(Buffer.from('hello world', 'utf8'))).toBe(false);
    expect(isBinaryBuffer(Buffer.from([0x41, 0x00, 0x42]))).toBe(true);
  });

  it('computes unified diff with hunk headers', () => {
    const oldText = ['line 1', 'line 2', 'line 3', 'line 4'].join('\n');
    const newText = ['line 1', 'line 2 updated', 'line 3', 'line 4', 'line 5'].join('\n');
    const diff = computeUnifiedDiff(oldText, newText, 'src/calc.ts', 'MASTER', 'DEV');
    expect(diff).toContain('Index: src/calc.ts');
    expect(diff).toContain('-line 2');
    expect(diff).toContain('+line 2 updated');
    expect(diff).toContain('+line 5');
  });

  it('builds surgical conflict markers preserving identical surrounding code', () => {
    const target = [
      'export function calc(x: number) {',
      '  const base = x;',
      '  const vat = base * 0.14;',
      '  return base + vat;',
      '}',
    ].join('\n');
    const source = [
      'export function calc(x: number) {',
      '  const base = x;',
      '  const vat = base * 0.15;',
      '  const fee = 15;',
      '  return base + vat + fee;',
      '}',
    ].join('\n');

    const res = buildSmartConflictMarkers(target, source, 'MASTER', 'DEV');
    expect(res.conflictCount).toBe(1);
    expect(res.content).toContain('export function calc(x: number) {');
    expect(res.content).toContain('  const base = x;');
    expect(res.content).toContain('<<<<<<< MASTER');
    expect(res.content).toContain('  const vat = base * 0.14;');
    expect(res.content).toContain('=======');
    expect(res.content).toContain('  const vat = base * 0.15;');
    expect(res.content).toContain('>>>>>>> DEV');
    expect(countConflictMarkers(res.content)).toBe(1);
  });
});
