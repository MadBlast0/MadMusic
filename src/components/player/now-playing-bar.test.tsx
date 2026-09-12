import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { NowPlayingBar } from '@/components/player/now-playing-bar';
import {
  usePlayer,
  type PlayerTrack,
} from '@/components/player/player-context';
import { renderWithProviders } from '@/test/utils';

/**
 * The transport bar's controls.
 *
 * The bar renders an empty state until something is playing, so a track is put
 * into the real player rather than mocked — which is also the only way the
 * volume slider is reading the value it will read in the app.
 */
const TRACK: PlayerTrack = {
  id: 't1',
  title: 'Golden Brown',
  artist: 'Elliot Sutton',
  cover: ['#111111', '#222222'],
  duration: 73,
  handle: 'handle:t1',
};

function Playing() {
  const { play } = usePlayer();
  useEffect(() => {
    play(TRACK, [TRACK]);
  }, [play]);
  return null;
}

function renderBar() {
  return renderWithProviders(
    <>
      <Playing />
      <NowPlayingBar
        queueOpen={false}
        onToggleQueue={() => {}}
        lyricsOpen={false}
        onToggleLyrics={() => {}}
        compact="normal"
        onPresent={() => {}}
        immersive={false}
        onToggleImmersive={() => {}}
      />
    </>,
  );
}

const bar = () => screen.getByRole('contentinfo', { name: 'Player' });

afterEach(() => {
  localStorage.clear();
});

describe('the transport bar', () => {
  it('carries the controls on the bar rather than behind a menu', async () => {
    renderBar();
    await screen.findByText('Golden Brown');

    for (const label of [
      // 'Stop' is deliberately absent: the ✕ that ended the session sat where
      // every other surface puts the heart, so "save this" and "throw the
      // queue away" were a pixel apart.
      'Save this track',
      'Lyrics',
      'Show queue',
      'Mute',
      'Full screen',
    ]) {
      expect(
        within(bar()).getByRole('button', { name: label }),
      ).toBeInTheDocument();
    }
  });

  it('shows the volume slider itself, up to 150%', async () => {
    // It used to be a dropdown behind a chevron, which made the one control
    // people expect to find without opening anything the one control they had
    // to go looking for.
    renderBar();
    await screen.findByText('Golden Brown');

    const volume = within(bar()).getByRole('slider', { name: 'Volume' });
    expect(volume).toHaveAttribute('aria-valuemax', '150');
    // Unity by default: the file as it was mastered, with the boost available
    // above it rather than applied.
    expect(volume).toHaveAttribute('aria-valuenow', '100');
  });
});

/**
 * The overflow menu.
 *
 * # Why every one of these is worth a test
 *
 * Because they were all broken in the same way, and it was invisible to every
 * other kind of check. Speed, the sleep timer, the shuffle mode and casting
 * each rendered a `DropdownMenu` of their own *inside this menu's content* — a
 * second, unrelated menu drawn inside the first rather than a branch of it.
 * Radix reads the inner content opening as an interaction outside the outer
 * menu: it dismissed this one, unmounted the inner trigger, and took the menu
 * that was opening down with it. Four controls that flashed and vanished.
 *
 * It type-checked, it linted, and it rendered. The only thing that catches it
 * is opening each one and finding something inside.
 *
 * # Why the branches are driven from the keyboard
 *
 * Not to work around jsdom, though it is true that `userEvent.click` cannot
 * reach into a portalled submenu there. It is that **the keyboard is the thing
 * that was broken.** The controls these replaced sat in bare `div`s inside the
 * menu, and Radix's roving focus only visits menu items — so the arrow keys
 * walked straight past all of them and the menu could not be operated without
 * a mouse at all. Opening a branch with ArrowRight and choosing a row with
 * ArrowDown and Enter asserts exactly the capability that was missing.
 */
describe('the overflow menu', () => {
  /**
   * Opens the overflow menu and returns it.
   *
   * `find` rather than `get` because Radix's menu is modal: while one is open
   * every element outside it carries `aria-hidden`, so the trigger is
   * genuinely unreachable until the previous menu has finished closing.
   * Retrying is not papering over a race — it is waiting for what a user waits
   * for.
   */
  async function openMenu(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByText('Golden Brown');
    await user.click(
      await screen.findByRole('button', { name: 'More player controls' }),
    );
    return screen.findByRole('menu');
  }

  /** Opens one of its branches with the arrow keys, and returns the branch. */
  async function openBranch(
    user: ReturnType<typeof userEvent.setup>,
    name: RegExp,
  ) {
    const menu = await openMenu(user);
    within(menu).getByRole('menuitem', { name }).focus();
    await user.keyboard('{ArrowRight}');
    return screen.findByRole('menu', { name });
  }

  /** Every row in a menu that focus can land on, in the order it walks them. */
  const rowsOf = (menu: HTMLElement) =>
    Array.from(
      menu.querySelectorAll<HTMLElement>(
        '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]',
      ),
    );

  /**
   * Walks to a row and chooses it.
   *
   * ArrowRight leaves focus on the branch's first row, so the distance to walk
   * is that row's index.
   */
  async function choose(
    user: ReturnType<typeof userEvent.setup>,
    menu: HTMLElement,
    label: string | RegExp,
  ) {
    const rows = rowsOf(menu);
    const matches = (text: string) =>
      typeof label === 'string' ? text === label : label.test(text);
    const index = rows.findIndex((row) => matches(row.textContent ?? ''));
    expect(index).toBeGreaterThanOrEqual(0);

    // Guarded: the first row is already focused, and `keyboard('')` throws.
    if (index > 0) await user.keyboard('{ArrowDown}'.repeat(index));
    expect(document.activeElement).toBe(rows[index]);
    await user.keyboard('{Enter}');
  }

  it('lists each control as a row rather than a strip of bare icons', async () => {
    const user = userEvent.setup();
    renderBar();

    const menu = await openMenu(user);

    for (const name of [
      /^Speed/,
      /^Sleep timer/,
      /^Shuffle/,
      /Repeat a section/,
      /Equaliser/,
      /Share/,
    ]) {
      expect(within(menu).getByRole('menuitem', { name })).toBeInTheDocument();
    }
  });

  it('carries the current value of each control on its own row', async () => {
    const user = userEvent.setup();
    renderBar();

    const menu = await openMenu(user);

    // Read from the row, not decoded from a glyph. Nothing is set, so each one
    // says so.
    expect(
      within(menu).getByRole('menuitem', { name: /^Speed/ }),
    ).toHaveTextContent('1');
    expect(
      within(menu).getByRole('menuitem', { name: /^Sleep timer/ }),
    ).toHaveTextContent('Off');
    expect(
      within(menu).getByRole('menuitem', { name: /^Shuffle/ }),
    ).toHaveTextContent('Off');
  });

  it('walks into a branch with the arrow keys and out again', async () => {
    const user = userEvent.setup();
    renderBar();

    const speed = await openBranch(user, /^Speed/);
    // ArrowRight opened it and left focus on the first row inside.
    expect(speed).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard('{ArrowLeft}');
    expect(
      screen.queryByRole('menu', { name: /^Speed/ }),
    ).not.toBeInTheDocument();
    // The parent is still open — which is the whole difference from a second
    // menu rendered inside the first.
    expect(await screen.findByRole('menu')).toBeInTheDocument();
  });

  it('opens the speed branch, with the current rate marked', async () => {
    const user = userEvent.setup();
    renderBar();

    const speed = await openBranch(user, /^Speed/);

    const checked = within(speed)
      .getAllByRole('menuitemradio')
      .filter((rate) => rate.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveTextContent('Normal');
  });

  it('changes the playback speed from the branch', async () => {
    const user = userEvent.setup();
    renderBar();

    const speed = await openBranch(user, /^Speed/);
    await choose(user, speed, /^1\.5/);

    const menu = await openMenu(user);
    expect(
      within(menu).getByRole('menuitem', { name: /^Speed/ }),
    ).toHaveTextContent('1.5');
  });

  it('opens the sleep-timer branch', async () => {
    const user = userEvent.setup();
    renderBar();

    const sleep = await openBranch(user, /^Sleep timer/);

    expect(
      within(sleep).getByRole('menuitem', { name: 'In 30 minutes' }),
    ).toBeInTheDocument();
    // The two that are not clocks are states rather than actions, so they tick
    // rather than fire — and unticking one cancels it.
    expect(
      within(sleep).getByRole('menuitemcheckbox', {
        name: 'At the end of this track',
      }),
    ).toHaveAttribute('aria-checked', 'false');
  });

  it('sets a sleep timer, and says so on the row that opened it', async () => {
    const user = userEvent.setup();
    renderBar();

    const sleep = await openBranch(user, /^Sleep timer/);
    await choose(user, sleep, 'At the end of this track');

    const menu = await openMenu(user);
    expect(
      within(menu).getByRole('menuitem', { name: /^Sleep timer/ }),
    ).toHaveTextContent('End of track');
  });

  /**
   * Shuffle is two pieces of state — whether it is on, and how it shuffles —
   * and the old control only offered the second, so it rendered nothing at all
   * while shuffle was off. One list of five answers covers both.
   */
  it('turns shuffle on by choosing how it should shuffle', async () => {
    const user = userEvent.setup();
    renderBar();

    const shuffle = await openBranch(user, /^Shuffle/);
    expect(
      within(shuffle).getByRole('menuitemradio', { name: 'Off' }),
    ).toHaveAttribute('aria-checked', 'true');

    await choose(user, shuffle, 'Spread artists');

    expect(
      await screen.findByRole('button', { name: 'Shuffle on' }),
    ).toBeInTheDocument();
    const menu = await openMenu(user);
    expect(
      within(menu).getByRole('menuitem', { name: /^Shuffle/ }),
    ).toHaveTextContent('Spread artists');
  });

  it('turns shuffle off again from the same list', async () => {
    const user = userEvent.setup();
    renderBar();

    let shuffle = await openBranch(user, /^Shuffle/);
    await choose(user, shuffle, 'Whole albums');
    await screen.findByRole('button', { name: 'Shuffle on' });

    shuffle = await openBranch(user, /^Shuffle/);
    await choose(user, shuffle, 'Off');

    expect(
      await screen.findByRole('button', { name: 'Shuffle off' }),
    ).toBeInTheDocument();
  });

  /**
   * The A-B loop was offered twice — a lettered button in the icon strip and
   * an item saying the same thing — so the menu described the same loop in two
   * languages. One row, three presses.
   */
  it('marks the loop points from one row', async () => {
    const user = userEvent.setup();
    renderBar();

    let menu = await openMenu(user);
    await user.click(
      within(menu).getByRole('menuitem', { name: /Repeat a section/ }),
    );

    menu = await openMenu(user);
    expect(
      within(menu).getByRole('menuitem', {
        name: /Set where the section ends/,
      }),
    ).toBeInTheDocument();
  });

  /**
   * A menu item that opens a dialog.
   *
   * Worth asserting because the two fight over focus: a menu closing returns
   * focus to its trigger, and a dialog opening takes focus for itself, and
   * both happen on the same commit. The menu used to win, so the equaliser
   * opened with focus back on the button behind it and the first Escape closed
   * nothing the user could see.
   */
  it('opens the equaliser, and gives it the focus', async () => {
    const user = userEvent.setup();
    renderBar();

    const menu = await openMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: /Equaliser/ }));

    const dialog = await screen.findByRole('dialog', { name: /equaliser/i });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });
});
