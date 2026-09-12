import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Art, Shelf } from '@/components/home/shelves';

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

/**
 * Cover art on a card.
 *
 * Every one of these is about the same mistake in two places: a card is
 * **reused**. A rail re-renders with a different feed, the card keeps its
 * position in the tree, and only `src` changes. Anything this component
 * remembers about the last picture is therefore a statement about a picture
 * that is no longer there — and both things it remembered were booleans, so
 * the previous cover decided what the next one was allowed to do.
 *
 * The gradient underneath is why this is so easy to miss: nothing ever looks
 * broken. A cover that never appears looks exactly like a record that has no
 * cover, which is a perfectly ordinary thing for a record to be.
 */
describe('cover art on a card', () => {
  const SEED: [string, string] = ['#111111', '#222222'];

  const art = () => screen.queryByRole('presentation');

  /**
   * Makes an already-decoded picture, the way a cached one arrives.
   *
   * `defineProperty` rather than `vi.spyOn`: jsdom's `complete` and
   * `naturalWidth` are prototype getters a spy does not reliably replace, and a
   * helper that quietly failed to stub them would make these two tests pass for
   * the wrong reason - which for a test about an invisible failure is the worst
   * possible outcome.
   */
  const stubbed: string[] = [];

  function alreadyLoaded(naturalWidth: number) {
    const values: Record<string, unknown> = {
      complete: true,
      naturalWidth,
    };
    for (const name of Object.keys(values)) {
      Object.defineProperty(HTMLImageElement.prototype, name, {
        configurable: true,
        get: () => values[name],
      });
      stubbed.push(name);
    }
  }

  afterEach(() => {
    for (const name of stubbed.splice(0)) {
      Reflect.deleteProperty(HTMLImageElement.prototype, name);
    }
  });

  it('fades the picture in once it has loaded', () => {
    render(<Art seedCover={SEED} src="a.jpg" alt="" />);

    expect(art()).toHaveClass('opacity-0');
    fireEvent.load(art()!);
    expect(art()).toHaveClass('opacity-100');
  });

  it('leaves the gradient showing when the picture fails', () => {
    render(<Art seedCover={SEED} src="a.jpg" alt="" />);

    fireEvent.error(art()!);

    // Not an error state: a gradient is a perfectly good cover.
    expect(art()).not.toBeInTheDocument();
  });

  /**
   * The one that made covers go missing across the app.
   *
   * With a boolean, one dead url condemned every later cover that landed on
   * the same card — and because the gradient stays underneath, the card simply
   * looked like a record without art for the rest of the session.
   */
  it('shows a later cover on a card whose last one failed', () => {
    const view = render(<Art seedCover={SEED} src="dead.jpg" alt="" />);
    fireEvent.error(art()!);
    expect(art()).not.toBeInTheDocument();

    view.rerender(<Art seedCover={SEED} src="good.jpg" alt="" />);

    expect(art()).toBeInTheDocument();
    expect(art()).toHaveAttribute('src', 'good.jpg');
  });

  /**
   * And the mirror image: a card that has loaded must not declare its
   * successor loaded before it arrives, or the new picture is painted at full
   * opacity while it is still blank.
   */
  it('does not call the next cover loaded because the last one was', () => {
    const view = render(<Art seedCover={SEED} src="a.jpg" alt="" />);
    fireEvent.load(art()!);
    expect(art()).toHaveClass('opacity-100');

    view.rerender(<Art seedCover={SEED} src="b.jpg" alt="" />);

    expect(art()).toHaveClass('opacity-0');
  });

  /**
   * The one that looks like a caching bug, and is one in a sense.
   *
   * `onLoad` is a subscription, and a picture the browser already has can be
   * complete before anything subscribes. The event that would have revealed it
   * has been and gone, so the image sits at `opacity-0` over its gradient
   * *having loaded perfectly well* — and only ever for pictures that were
   * cached, which is what makes it look like stale cache rather than a bug.
   */
  it('reveals a picture that was already decoded before React listened', () => {
    alreadyLoaded(600);

    render(<Art seedCover={SEED} src="cached.jpg" alt="" />);

    // No load event is fired here, deliberately: there would not have been one.
    expect(art()).toHaveClass('opacity-100');
  });

  /** `complete` is true for a broken picture too, so width is the test. */
  it('does not reveal a broken picture that reports itself complete', () => {
    alreadyLoaded(0);

    render(<Art seedCover={SEED} src="broken.jpg" alt="" />);

    expect(art()).not.toBeInTheDocument();
  });
});
