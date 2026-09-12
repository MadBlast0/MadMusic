import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Opening and closing the widget window.
 *
 * This is a state machine with exactly one interesting property, and it is the
 * one that broke: **the app asks for a state, not for a transition.** React's
 * `StrictMode` mounts an effect, unmounts it and mounts it again, so a single
 * press of the compact-player button produced open, close, open — three
 * concurrent async commands whose completion order is not their call order.
 * Both failure modes were seen in the real app: two builds racing the same
 * window label left an orphan widget on the desktop with no track in it, and a
 * close landing last left no widget at all.
 *
 * So these tests are about *what reaches Rust*, not about what the window
 * looks like. The module holds its state at module scope — deliberately, since
 * it has to outlive any one mount — which is why every case re-imports it
 * through `resetModules` rather than sharing one instance.
 */

const invoke = vi.hoisted(() => vi.fn<(command: string) => Promise<void>>());
const isNative = vi.hoisted(() => vi.fn(() => true));

vi.mock('@/lib/native', () => ({ invoke, isNative }));

/** A fresh copy of the module, with its module-scope state back at the start. */
async function fresh() {
  vi.resetModules();
  return import('@/lib/widget-link');
}

/** What was asked of Rust, in order. */
const commands = () => invoke.mock.calls.map(([command]) => command);

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  isNative.mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('asking for the widget window', () => {
  it('opens it', async () => {
    const { setWidgetOpen } = await fresh();

    await setWidgetOpen(true);

    expect(commands()).toEqual(['widget_open']);
  });

  it('closes it again', async () => {
    const { setWidgetOpen } = await fresh();

    await setWidgetOpen(true);
    await setWidgetOpen(false);

    expect(commands()).toEqual(['widget_open', 'widget_close']);
  });

  /**
   * The one the duplicate widget came from.
   *
   * Mount, unmount, mount — issued synchronously, before the first command has
   * resolved. The app wants the window open at the end of that, and it wanted
   * it open at the start, so the only honest thing to send is a single open.
   */
  it('collapses a StrictMode remount into one open', async () => {
    const { setWidgetOpen } = await fresh();

    const mount = setWidgetOpen(true);
    const unmount = setWidgetOpen(false);
    const remount = setWidgetOpen(true);
    await Promise.all([mount, unmount, remount]);

    expect(commands()).toEqual(['widget_open']);
  });

  /**
   * And the mirror image: a mount that is genuinely undone before the command
   * lands must not leave a window behind. Here the app ends up wanting it
   * closed, so the open has to be followed by a close rather than dropped —
   * the window exists by then.
   */
  it('closes a window that was opened and then no longer wanted', async () => {
    const { setWidgetOpen } = await fresh();

    const opening = setWidgetOpen(true);
    const closing = setWidgetOpen(false);
    await Promise.all([opening, closing]);

    expect(commands()).toEqual(['widget_open', 'widget_close']);
  });

  /** One command in flight at a time, whatever the app is doing. */
  it('never has two commands in flight at once', async () => {
    const { setWidgetOpen } = await fresh();

    let running = 0;
    let overlapped = false;
    invoke.mockImplementation(async () => {
      running += 1;
      if (running > 1) overlapped = true;
      await Promise.resolve();
      running -= 1;
    });

    await Promise.all([
      setWidgetOpen(true),
      setWidgetOpen(false),
      setWidgetOpen(true),
      setWidgetOpen(false),
    ]);

    expect(overlapped).toBe(false);
  });

  /**
   * A failure has to reach the caller.
   *
   * `MiniPlayer` leaves the compact-player mode when this rejects, rather than
   * sitting in a mode whose window does not exist — which is the whole reason
   * the promise is returned at all.
   */
  it('reports a command that failed', async () => {
    const { setWidgetOpen } = await fresh();
    invoke.mockRejectedValueOnce(new Error('no window for you'));

    await expect(setWidgetOpen(true)).rejects.toThrow('no window for you');
  });

  /** A later ask still works after one failed. */
  it('recovers after a failure', async () => {
    const { setWidgetOpen } = await fresh();
    invoke.mockRejectedValueOnce(new Error('not this time'));

    await expect(setWidgetOpen(true)).rejects.toThrow();
    await setWidgetOpen(true);

    expect(commands()).toEqual(['widget_open', 'widget_open']);
  });

  /** In a browser tab there is no window to open, and nothing to invoke. */
  it('asks Rust for nothing when this is not the desktop app', async () => {
    isNative.mockReturnValue(false);
    const { setWidgetOpen } = await fresh();

    await setWidgetOpen(true);

    expect(invoke).not.toHaveBeenCalled();
  });
});
