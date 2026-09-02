import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Shelf } from '@/components/home/shelves';

/**
 * The shelf's arrows.
 *
 * jsdom lays nothing out — every element is zero by zero and `scrollBy` does
 * not exist — so the geometry has to be stubbed to be tested at all. What is
 * being checked is the *arithmetic*: that a click advances by a whole number
 * of cards rather than by a fraction of the rail, because the failure that
 * produces is subtle and permanent. A percentage of the width leaves the row
 * stopped with a sliver of the next album showing, which reads as the scroll
 * having broken rather than as there being more to see.
 */

/** Gives an element the box jsdom refuses to give it. */
function size(element: Element, width: number) {
  Object.defineProperty(element, 'offsetWidth', {
    value: width,
    configurable: true,
  });
}

const CARD = 168;
const GAP = 16;

function shelf(rail: { width: number }) {
  const scrollBy = vi.fn();

  const view = render(
    <Shelf title="Made for you">
      <div data-testid="card">one</div>
      <div>two</div>
      <div>three</div>
    </Shelf>,
  );

  const track = view.container.querySelector('.snap-x') as HTMLElement;

  Object.defineProperty(track, 'clientWidth', {
    value: rail.width,
    configurable: true,
  });
  Object.defineProperty(track, 'scrollWidth', {
    value: 4000,
    configurable: true,
  });
  track.scrollBy = scrollBy as unknown as typeof track.scrollBy;

  for (const card of track.children) size(card, CARD);
  // Set inline rather than mocked: jsdom reflects inline styles through
  // `getComputedStyle`, and stubbing that function globally breaks Testing
  // Library's own accessible-name queries, which call it too.
  track.style.columnGap = `${GAP}px`;

  return { view, track, scrollBy };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('scrolling a shelf', () => {
  it('advances by a whole page of cards', async () => {
    // 900px of rail fits four 168px cards and their gaps, with change left
    // over. A click should move four cards, not 900 × some fraction.
    const { track, scrollBy } = shelf({ width: 900 });

    await act(async () => {
      track.dispatchEvent(new Event('scroll'));
    });

    const right = screen.getByRole('button', { name: /scroll .* right/i });
    await act(async () => {
      right.click();
    });

    expect(scrollBy).toHaveBeenCalledWith({
      left: (CARD + GAP) * 4,
      behavior: 'smooth',
    });
  });

  it('always moves at least one card, however narrow the rail', async () => {
    // A rail narrower than a single card would floor to zero pages, and the
    // arrow would be a button that does nothing.
    const { track, scrollBy } = shelf({ width: 100 });

    await act(async () => {
      track.dispatchEvent(new Event('scroll'));
    });

    const right = screen.getByRole('button', { name: /scroll .* right/i });
    await act(async () => {
      right.click();
    });

    expect(scrollBy).toHaveBeenCalledWith({
      left: CARD + GAP,
      behavior: 'smooth',
    });
  });

  it('goes back by the same page it came forward by', async () => {
    const { track, scrollBy } = shelf({ width: 900 });

    Object.defineProperty(track, 'scrollLeft', {
      value: 600,
      configurable: true,
    });
    await act(async () => {
      track.dispatchEvent(new Event('scroll'));
    });

    const left = screen.getByRole('button', { name: /scroll .* left/i });
    await act(async () => {
      left.click();
    });

    expect(scrollBy).toHaveBeenCalledWith({
      left: -(CARD + GAP) * 4,
      behavior: 'smooth',
    });
  });
});

describe('the shelf heading', () => {
  it('puts the eyebrow above the name', () => {
    render(
      <Shelf eyebrow="Made for" title="Mad Blast">
        <div>one</div>
      </Shelf>,
    );

    // Above rather than below, so a column of ten shelves reads as a structure
    // rather than as ten unrelated headings.
    const heading = screen.getByRole('heading', { name: 'Mad Blast' });
    const eyebrow = screen.getByText('Made for');

    expect(
      eyebrow.compareDocumentPosition(heading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('says nothing where there is no eyebrow', () => {
    render(
      <Shelf title="Featured">
        <div>one</div>
      </Shelf>,
    );

    expect(screen.getByRole('heading', { name: 'Featured' })).toBeVisible();
  });
});
