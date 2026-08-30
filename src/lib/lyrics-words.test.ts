import { describe, expect, it } from 'vitest';

import { parseLrc } from '@/lib/lyrics';

/**
 * Enhanced LRC, the format with a timestamp before every word.
 *
 * These cases are taken from the file that exposed the bug: the timings were
 * being rendered as text, so the panel showed `<00:11.92> Fall <00:12.17> in`
 * instead of "Fall in". The parser read the `[mm:ss.xx]` at the head of a line
 * and left the rest of it alone.
 */
describe('word timings', () => {
  it('takes the markers out of the text', () => {
    const [line] = parseLrc('[00:11.92]<00:11.92> Fall <00:12.17> in');

    expect(line.text).toBe('Fall in');
  });

  it('keeps each word and when it is sung', () => {
    const [line] = parseLrc('[00:11.92]<00:11.92> Fall <00:12.17> in');

    expect(line.words).toEqual([
      { at: 11.92, text: 'Fall' },
      { at: 12.17, text: 'in' },
    ]);
  });

  it('reads a marker with no word after it as the end of the line', () => {
    const [line] = parseLrc(
      '[00:11.92]<00:11.92> Fall <00:12.17> in <00:14.98>',
    );

    expect(line.until).toBe(14.98);
    expect(line.words).toHaveLength(2);
  });

  it('does not mistake a gap in the middle for the end', () => {
    // Two markers in a row is a pause the singer leaves, and a word follows it.
    const [line] = parseLrc(
      '[00:12.30]<00:12.30> <00:12.82> (fall <00:14.04> in)',
    );

    expect(line.text).toBe('(fall in)');
    expect(line.until).toBeUndefined();
  });

  it('leaves an ordinary line alone', () => {
    const [line] = parseLrc('[00:23.14]Fall in love again');

    expect(line.text).toBe('Fall in love again');
    expect(line.words).toBeUndefined();
  });

  it('starts a line from its first word when it has no line stamp', () => {
    const [line] = parseLrc('<00:36.05> Fall <00:36.27> in');

    expect(line.at).toBe(36.05);
    expect(line.text).toBe('Fall in');
  });

  it('does not treat other angle brackets as timings', () => {
    const [line] = parseLrc('[00:01.00]a <b> c');

    expect(line.text).toBe('a <b> c');
    expect(line.words).toBeUndefined();
  });

  it('keeps a chorus tagged with several stamps on every one of them', () => {
    const lines = parseLrc('[00:10.00][00:20.00]<00:10.00> Fall');

    expect(lines.map((line) => line.at)).toEqual([10, 20]);
    expect(lines[1].text).toBe('Fall');
  });
});
