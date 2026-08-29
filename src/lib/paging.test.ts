import { describe, expect, it } from 'vitest';

import { PAGE_SIZE, pageNumbers, pageOf } from '@/lib/paging';

describe('which slice to show', () => {
  it('grows from the top in infinite mode', () => {
    expect(pageOf(500, 'infinite', 1)).toMatchObject({
      from: 0,
      to: PAGE_SIZE,
    });
    expect(pageOf(500, 'infinite', 3)).toMatchObject({
      from: 0,
      to: PAGE_SIZE * 3,
    });
  });

  it('shows one page at a time in paged mode', () => {
    expect(pageOf(500, 'pages', 3)).toMatchObject({
      from: PAGE_SIZE * 2,
      to: PAGE_SIZE * 3,
    });
  });

  it('never runs off the end', () => {
    const page = pageOf(20, 'infinite', 99);
    expect(page.to).toBe(20);
    expect(page.hasMore).toBe(false);
  });

  it('clamps a page number below one', () => {
    expect(pageOf(500, 'pages', 0).number).toBe(1);
    expect(pageOf(500, 'pages', -3).from).toBe(0);
  });

  it('reports one page for an empty list rather than none', () => {
    // A pager showing "page 1 of 0" is worse than showing an empty page 1.
    const page = pageOf(0, 'pages', 1);
    expect(page.count).toBe(1);
    expect(page.from).toBe(0);
    expect(page.to).toBe(0);
    expect(page.hasMore).toBe(false);
  });

  it('reports the total, so the pager can say "of 412"', () => {
    expect(pageOf(412, 'pages', 2).total).toBe(412);
  });

  it('keeps your place when the mode changes', () => {
    // The same `shown` in either mode is the same distance through the list;
    // only whether the earlier pages stay on screen differs.
    expect(pageOf(500, 'pages', 4).to).toBe(pageOf(500, 'infinite', 4).to);
  });
});

describe('the page numbers a pager offers', () => {
  it('lists them all when they fit', () => {
    expect(pageNumbers(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('elides the middle of a long list', () => {
    const pages = pageNumbers(10, 40);
    expect(pages[0]).toBe(1);
    expect(pages).toContain(null);
    expect(pages[pages.length - 1]).toBe(40);
    expect(pages).toContain(10);
  });

  it('never elides a single page', () => {
    // "1 … 3" takes more room than "1 2 3" and reads worse.
    for (const pages of [pageNumbers(4, 20), pageNumbers(17, 20)]) {
      for (const [at, page] of pages.entries()) {
        if (page !== null) continue;
        const before = pages[at - 1];
        const after = pages[at + 1];
        expect(before !== null && after !== null && after! - before! > 2).toBe(
          true,
        );
      }
    }
  });

  it('stays a manageable width however long the list', () => {
    expect(pageNumbers(500, 1000).length).toBeLessThanOrEqual(11);
  });

  it('is in order and has no duplicates', () => {
    const pages = pageNumbers(3, 30).filter((page) => page !== null);
    expect(pages).toEqual([...new Set(pages)].sort((a, b) => a - b));
  });
});
