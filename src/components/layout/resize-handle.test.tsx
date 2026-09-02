import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ResizeHandle } from '@/components/layout/resize-handle';
import { SIDEBAR_LIMITS } from '@/lib/panes';

/**
 * `setPointerCapture` is not implemented in jsdom, and the handle calls it on
 * every pointer down. Stubbed rather than guarded in the component: the capture
 * is what makes a drag survive leaving the strip, and a component that skipped
 * it when it looked unavailable would be untested in the way that matters.
 */
function stubCapture(element: Element) {
  Object.assign(element, {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  });
}

/** Runs whatever `requestAnimationFrame` callbacks are outstanding. */
function frame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function drag(handle: Element, from: number, to: number[]) {
  handle.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      clientX: from,
      button: 0,
    }),
  );
  for (const x of to) {
    handle.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: x }),
    );
  }
}

function setup() {
  const onResize = vi.fn();
  const onPreview = vi.fn();

  render(
    <ResizeHandle
      label="Resize the library panel"
      width={300}
      limits={SIDEBAR_LIMITS}
      edge="right"
      onResize={onResize}
      onPreview={onPreview}
      onDragging={vi.fn()}
    />,
  );

  const handle = screen.getByRole('separator');
  stubCapture(handle);
  return { handle, onResize, onPreview };
}

describe('dragging a pane wider', () => {
  it('previews the width without committing it', async () => {
    const { handle, onPreview, onResize } = setup();

    drag(handle, 300, [340]);
    await frame();

    expect(onPreview).toHaveBeenCalledWith(340);
    // The commit is a `setState` at the top of the app. Doing it per move is
    // what made a drag re-render every view in the window.
    expect(onResize).not.toHaveBeenCalled();
  });

  it('coalesces several moves in one frame into a single write', async () => {
    const { handle, onPreview } = setup();

    // A 1000Hz mouse delivers eight of these between two frames, and seven of
    // them are layout work for a picture nobody sees.
    drag(handle, 300, [310, 320, 330, 340]);
    await frame();

    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenCalledWith(340);
  });

  it('commits the last move once, on release', async () => {
    const { handle, onPreview, onResize } = setup();

    drag(handle, 300, [340, 380]);
    handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledWith(380);
    // Null hands the width back to React, which renders the value just
    // committed. Without it the element keeps an inline width that the
    // collapse animation can no longer move.
    expect(onPreview).toHaveBeenLastCalledWith(null);
  });

  it('commits the last move even when no frame ever ran', async () => {
    const { handle, onResize } = setup();

    // Release inside the same frame as the move. The preview never fired, and
    // dropping the width with it would silently discard the whole drag.
    drag(handle, 300, [340]);
    handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

    expect(onResize).toHaveBeenCalledWith(340);
  });

  it('does nothing at all until a drag has begun', async () => {
    const { handle, onPreview, onResize } = setup();

    handle.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: 500 }),
    );
    await frame();

    expect(onPreview).not.toHaveBeenCalled();
    expect(onResize).not.toHaveBeenCalled();
  });

  it('stays inside the pane limits', async () => {
    const { handle, onPreview } = setup();

    drag(handle, 300, [-5000]);
    await frame();

    expect(onPreview).toHaveBeenCalledWith(SIDEBAR_LIMITS.min);
  });
});

describe('the keyboard path', () => {
  it('commits directly, since there is no drag to preview', () => {
    const { handle, onResize } = setup();

    handle.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' }),
    );

    // The handle is on the right of the left-hand pane, so left narrows it.
    expect(onResize).toHaveBeenCalledWith(292);
  });
});
