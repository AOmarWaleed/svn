import { describe, expect, it } from 'vitest';
import {
  applyHunkChoices,
  countConflictMarkers,
  parseConflictMarkers,
} from '../utils/conflictParser';

describe('conflictParser', () => {
  const twoWayContent = [
    'const header = true;',
    '<<<<<<< .working',
    'const rate = 0.13;',
    '=======',
    'const rate = 0.14;',
    '>>>>>>> .merge-right.r144',
    'const footer = true;',
  ].join('\n');

  const diff3Content = [
    'line 1',
    '<<<<<<< .working',
    'mine change',
    '||||||| .merge-left.r140',
    'base original',
    '=======',
    'theirs change',
    '>>>>>>> .merge-right.r145',
    'line end',
  ].join('\n');

  it('counts conflict markers accurately', () => {
    expect(countConflictMarkers(twoWayContent)).toBe(1);
    expect(countConflictMarkers('clean file\nno conflicts')).toBe(0);
  });

  it('parses 2-way conflict markers into segments and hunks', () => {
    const parsed = parseConflictMarkers(twoWayContent);
    expect(parsed.markerCount).toBe(1);
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.hunks[0].mineLines).toEqual(['const rate = 0.13;']);
    expect(parsed.hunks[0].theirsLines).toEqual(['const rate = 0.14;']);
    expect(parsed.segments).toHaveLength(3);
  });

  it('parses 3-way diff3 markers including base lines', () => {
    const parsed = parseConflictMarkers(diff3Content);
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.hunks[0].mineLines).toEqual(['mine change']);
    expect(parsed.hunks[0].baseLines).toEqual(['base original']);
    expect(parsed.hunks[0].theirsLines).toEqual(['theirs change']);
  });

  it('applies mine, theirs, both, and custom choices cleanly', () => {
    const { segments } = parseConflictMarkers(twoWayContent);

    expect(applyHunkChoices(segments, { 'hunk-1': 'mine' })).toBe(
      ['const header = true;', 'const rate = 0.13;', 'const footer = true;'].join('\n')
    );

    expect(applyHunkChoices(segments, { 'hunk-1': 'theirs' })).toBe(
      ['const header = true;', 'const rate = 0.14;', 'const footer = true;'].join('\n')
    );

    expect(applyHunkChoices(segments, { 'hunk-1': 'both-mine-first' })).toBe(
      [
        'const header = true;',
        'const rate = 0.13;',
        'const rate = 0.14;',
        'const footer = true;',
      ].join('\n')
    );

    expect(applyHunkChoices(segments, { 'hunk-1': 'both-theirs-first' })).toBe(
      [
        'const header = true;',
        'const rate = 0.14;',
        'const rate = 0.13;',
        'const footer = true;',
      ].join('\n')
    );

    expect(applyHunkChoices(segments, { 'hunk-1': { custom: 'const rate = 0.15;' } })).toBe(
      ['const header = true;', 'const rate = 0.15;', 'const footer = true;'].join('\n')
    );
  });
});
