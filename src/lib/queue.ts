/**
 * The queue.
 *
 * # Why this is a model and not an array
 *
 * Because "the queue" is three different lists that every music app shows as
 * one:
 *
 * 1. **What you are playing** — one track.
 * 2. **What you explicitly queued** — "play next", in the order you asked.
 * 3. **What comes after that by context** — the rest of the album, playlist or
 *    radio you started from.
 *
 * Collapsing them into one array loses the distinction, and the distinction is
 * exactly what users rely on: queueing a song must not lose your place in the
 * album, and starting a new album must not throw away what you queued. Spotify
 * and Apple Music both show these as separate sections, and they show them
 * separately because they *are* separate.
 *
 * # Shuffle is a permutation, not a random `next`
 *
 * Picking a random track each time is the obvious implementation and it is
 * wrong: it repeats, it can never guarantee you hear everything, and going
 * *back* is impossible because there is no history of a decision that had not
 * been made yet. So shuffle computes an order up front, and skipping walks it.
 */

/** Where a queued item came from, which is what the sections are drawn from. */
type QueueSource =
  /** The user asked for this one specifically. */
  | { kind: 'manual' }
  /** The rest of a context — an album, a playlist, a search, the library. */
  | { kind: 'context'; label: string }
  /** Generated because the queue ran out. */
  | { kind: 'radio'; label: string };

export type QueueItem = {
  /** Unique within the queue. A track can appear twice, so this is not its id. */
  key: string;
  trackId: string;
  source: QueueSource;
};

export type RepeatMode = 'off' | 'all' | 'one';

/** A section of the track to loop, in seconds. */
export type AbLoop = { start: number; end: number } | null;

export type ShuffleMode =
  /** No shuffle. */
  | 'off'
  /** A uniform permutation of what is in the queue. */
  | 'on'
  /** Shuffled, but never two tracks by the same artist in a row. */
  | 'spread'
  /** Albums shuffled, each album kept in its own order. */
  | 'album'
  /**
   * Shuffled, with tracks from the library mixed in every few songs.
   *
   * The seeding happens in the player rather than here, because it needs the
   * library and this module is pure. See `smartShuffle` in the provider.
   */
  | 'smart';

export type Queue = {
  /** Everything, in the order it was built. Shuffle does not reorder this. */
  items: QueueItem[];
  /** Index into [`order`], not into [`items`]. */
  cursor: number;
  /**
   * The playing order as indices into `items`.
   *
   * The identity permutation when shuffle is off. Keeping it explicit rather
   * than reordering `items` is what lets shuffle be turned off mid-queue
   * without losing where you are.
   */
  order: number[];
  repeat: RepeatMode;
  shuffle: ShuffleMode;
  loop: AbLoop;
};

export const EMPTY_QUEUE: Queue = {
  items: [],
  cursor: 0,
  order: [],
  repeat: 'off',
  shuffle: 'off',
  loop: null,
};

let counter = 0;

/**
 * A key that is unique within a session.
 *
 * A counter rather than `crypto.randomUUID`: this is called once per queued
 * track and the queue never leaves the machine, so uniqueness within the
 * process is the whole requirement.
 */
function queueKey(trackId: string): string {
  counter += 1;
  return `${trackId}#${counter}`;
}

/** The item playing now, or null for an empty queue. */
export function current(queue: Queue): QueueItem | null {
  const index = queue.order[queue.cursor];
  return index === undefined ? null : (queue.items[index] ?? null);
}

/** Everything after the cursor, in playing order. */
export function upcoming(queue: Queue): QueueItem[] {
  return queue.order
    .slice(queue.cursor + 1)
    .map((index) => queue.items[index])
    .filter((item): item is QueueItem => Boolean(item));
}

/** What the queue panel draws: the manual section, then the context one. */
export function sections(queue: Queue): {
  manual: QueueItem[];
  context: QueueItem[];
  contextLabel: string;
} {
  const rest = upcoming(queue);
  const manual = rest.filter((item) => item.source.kind === 'manual');
  const context = rest.filter((item) => item.source.kind !== 'manual');
  const first = context[0]?.source;

  return {
    manual,
    context,
    contextLabel: first && first.kind !== 'manual' ? first.label : '',
  };
}

/* ── building ────────────────────────────────────────────────────────── */

/**
 * Starts a new context, keeping anything queued by hand.
 *
 * The manual items survive because the user put them there on purpose and
 * starting an album is not a request to forget them. They keep their position
 * at the front, which is what "play next" meant when it was asked for.
 */
export function playContext(
  queue: Queue,
  trackIds: string[],
  label: string,
  startAt = 0,
): Queue {
  const manual = queue.items.filter(
    (item, index) =>
      item.source.kind === 'manual' &&
      queue.order.indexOf(index) > queue.cursor,
  );

  const context: QueueItem[] = trackIds.map((trackId) => ({
    key: queueKey(trackId),
    trackId,
    source: { kind: 'context', label },
  }));

  // The chosen track first, then the manual items, then the rest of the album.
  // Putting the manual items after the current track rather than before it is
  // the difference between "play next" and "play instead".
  const head = context.slice(startAt, startAt + 1);
  const tail = [...context.slice(startAt + 1), ...context.slice(0, startAt)];
  const items = [...head, ...manual, ...tail];

  return reorder({ ...queue, items, cursor: 0, order: identity(items.length) });
}

/** Puts tracks immediately after the current one. */
export function playNext(queue: Queue, trackIds: string[]): Queue {
  const additions: QueueItem[] = trackIds.map((trackId) => ({
    key: queueKey(trackId),
    trackId,
    source: { kind: 'manual' },
  }));

  const items = [...queue.items, ...additions];
  const at = queue.cursor + 1;
  const newIndices = additions.map((_, offset) => queue.items.length + offset);
  const order = [
    ...queue.order.slice(0, at),
    ...newIndices,
    ...queue.order.slice(at),
  ];

  return { ...queue, items, order };
}

/** Puts tracks at the very end. */
export function enqueue(queue: Queue, trackIds: string[]): Queue {
  const additions: QueueItem[] = trackIds.map((trackId) => ({
    key: queueKey(trackId),
    trackId,
    source: { kind: 'manual' },
  }));

  const items = [...queue.items, ...additions];
  const order = [
    ...queue.order,
    ...additions.map((_, offset) => queue.items.length + offset),
  ];
  return { ...queue, items, order };
}

/**
 * Removes items by key.
 *
 * Rebuilt rather than spliced. Removing from `items` invalidates every index in
 * `order` after it, and the bugs that come from patching two parallel arrays in
 * place are not worth the allocations saved.
 */
export function remove(queue: Queue, keys: string[]): Queue {
  const doomed = new Set(keys);
  const playing = current(queue);

  const items = queue.items.filter((item) => !doomed.has(item.key));
  if (items.length === queue.items.length) return queue;

  const position = new Map(items.map((item, index) => [item.key, index]));
  const order = queue.order
    .map((index) => queue.items[index])
    .filter((item): item is QueueItem => Boolean(item) && !doomed.has(item.key))
    .map((item) => position.get(item.key))
    .filter((index): index is number => index !== undefined);

  // Keep playing what is playing. Removing something earlier in the queue must
  // not skip the current track, and removing the current track lands on
  // whatever took its place.
  const cursor =
    playing && !doomed.has(playing.key)
      ? order.findIndex((index) => items[index]?.key === playing.key)
      : Math.min(queue.cursor, Math.max(0, order.length - 1));

  return { ...queue, items, order, cursor: Math.max(0, cursor) };
}

/** Reorders the upcoming items to exactly this list of keys. */
export function reorderUpcoming(queue: Queue, keys: string[]): Queue {
  const byKey = new Map(queue.items.map((item, index) => [item.key, index]));
  const moved = keys
    .map((key) => byKey.get(key))
    .filter((index): index is number => index !== undefined);

  const before = queue.order.slice(0, queue.cursor + 1);
  return { ...queue, order: [...before, ...moved] };
}

export function clearUpcoming(queue: Queue): Queue {
  const keep = new Set(queue.order.slice(0, queue.cursor + 1));
  const items = queue.items.filter((_, index) => keep.has(index));
  const position = new Map(items.map((item, index) => [item.key, index]));
  const order = queue.order
    .slice(0, queue.cursor + 1)
    .map((index) => queue.items[index])
    .filter((item): item is QueueItem => Boolean(item))
    .map((item) => position.get(item.key) ?? 0);

  return { ...queue, items, order, cursor: Math.max(0, order.length - 1) };
}

/* ── moving ──────────────────────────────────────────────────────────── */

/** Whether there is anything after the current track. */
export function hasNext(queue: Queue): boolean {
  if (queue.repeat === 'one' || queue.repeat === 'all')
    return queue.items.length > 0;
  return queue.cursor + 1 < queue.order.length;
}

export function hasPrevious(queue: Queue): boolean {
  return queue.cursor > 0 || queue.repeat === 'all';
}

/**
 * Advances.
 *
 * `manual` says whether the user pressed skip or the track simply ended, and it
 * matters for one case: repeat-one repeats when a track *ends*, and does not
 * when somebody presses next. A skip button that plays the same song again is
 * the most annoying possible reading of repeat-one.
 */
export function next(queue: Queue, manual = false): Queue {
  if (queue.items.length === 0) return queue;
  if (queue.repeat === 'one' && !manual) return queue;

  const at = queue.cursor + 1;
  if (at < queue.order.length) return { ...queue, cursor: at, loop: null };
  if (queue.repeat === 'all') {
    // Reshuffle at the wrap, so a repeating shuffled queue is not the same
    // order forever — which is what makes repeat-plus-shuffle feel broken.
    return reorder({ ...queue, cursor: 0, loop: null });
  }
  return queue;
}

export function previous(queue: Queue): Queue {
  if (queue.items.length === 0) return queue;
  if (queue.cursor > 0)
    return { ...queue, cursor: queue.cursor - 1, loop: null };
  if (queue.repeat === 'all') {
    return {
      ...queue,
      cursor: Math.max(0, queue.order.length - 1),
      loop: null,
    };
  }
  return queue;
}

/** Jumps to a specific item, by key. */
export function jumpTo(queue: Queue, key: string): Queue {
  const index = queue.items.findIndex((item) => item.key === key);
  if (index < 0) return queue;
  const cursor = queue.order.indexOf(index);
  return cursor < 0 ? queue : { ...queue, cursor, loop: null };
}

/* ── shuffle ─────────────────────────────────────────────────────────── */

function identity(length: number): number[] {
  return Array.from({ length }, (_, index) => index);
}

/**
 * A Fisher-Yates shuffle.
 *
 * Written out rather than `sort(() => Math.random() - 0.5)`, which is the
 * common version and is not a shuffle at all: comparison sorts assume a
 * consistent comparator, and a random one produces a distribution that is
 * visibly biased towards leaving items where they were.
 */
function shuffled<T>(indices: T[]): T[] {
  const out = [...indices];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Spreads a shuffled order so the same artist does not come up twice running.
 *
 * A uniform shuffle of a library that is 40% one artist *will* produce runs,
 * and every one of those runs reads as "the shuffle is broken" — which is the
 * complaint that made Spotify rewrite theirs. This does one pass, swapping a
 * clash forward with the next track that does not clash. It does not guarantee
 * no runs (with two artists and ten tracks that is impossible), it just removes
 * the ones that can be removed.
 */
function spread(
  order: number[],
  artistOf: (index: number) => string,
): number[] {
  const out = [...order];
  for (let i = 1; i < out.length; i += 1) {
    if (artistOf(out[i]) !== artistOf(out[i - 1])) continue;
    const swap = out.findIndex(
      (candidate, j) =>
        j > i &&
        artistOf(candidate) !== artistOf(out[i - 1]) &&
        (j + 1 >= out.length || artistOf(out[j + 1]) !== artistOf(out[i])),
    );
    if (swap > i) [out[i], out[swap]] = [out[swap], out[i]];
  }
  return out;
}

/** Shuffles whole albums, keeping each album in its own running order. */
function byAlbum(
  order: number[],
  albumOf: (index: number) => string,
): number[] {
  const groups = new Map<string, number[]>();
  for (const index of order) {
    const key = albumOf(index);
    groups.set(key, [...(groups.get(key) ?? []), index]);
  }
  return shuffled([...groups.keys()]).flatMap((key) => groups.get(key) ?? []);
}

/**
 * How the queue reads a track's artist and album when shuffling.
 *
 * Passed in rather than stored on the item, so the queue holds ids and nothing
 * else — the moment it carries denormalised metadata it has to be invalidated
 * when a track is retagged.
 */
type TrackLookup = {
  artist: (trackId: string) => string;
  album: (trackId: string) => string;
};

let lookup: TrackLookup = { artist: () => '', album: () => '' };

/** Tells the queue how to resolve metadata for the smarter shuffles. */
export function setQueueLookup(next: TrackLookup): void {
  lookup = next;
}

/**
 * Rebuilds the playing order for the current shuffle mode.
 *
 * The currently playing item is kept at the cursor: shuffling is not a request
 * to skip the song you are listening to.
 */
export function reorder(queue: Queue): Queue {
  if (queue.items.length === 0) return { ...queue, order: [], cursor: 0 };

  const playing = queue.order[queue.cursor];
  const all = identity(queue.items.length);

  if (queue.shuffle === 'off') {
    return {
      ...queue,
      order: all,
      cursor: playing === undefined ? 0 : Math.max(0, all.indexOf(playing)),
    };
  }

  const rest = all.filter((index) => index !== playing);
  const artistOf = (index: number) =>
    lookup.artist(queue.items[index]?.trackId ?? '');
  const albumOf = (index: number) =>
    lookup.album(queue.items[index]?.trackId ?? '');

  let mixed: number[];
  switch (queue.shuffle) {
    case 'album':
      mixed = byAlbum(rest, albumOf);
      break;
    case 'spread':
      mixed = spread(shuffled(rest), artistOf);
      break;
    default:
      mixed = shuffled(rest);
  }

  const order = playing === undefined ? mixed : [playing, ...mixed];
  return { ...queue, order, cursor: playing === undefined ? 0 : 0 };
}

/** Turns shuffle on, off, or to another strategy. */
export function setShuffle(queue: Queue, shuffle: ShuffleMode): Queue {
  return reorder({ ...queue, shuffle });
}

/** Cycles repeat the way the button does: off → all → one → off. */
export function cycleRepeat(mode: RepeatMode): RepeatMode {
  return mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off';
}

/* ── the A–B loop ────────────────────────────────────────────────────── */

/**
 * Sets one end of the loop, or clears it.
 *
 * Pressing the button three times means: mark A, mark B, clear. That is the
 * interaction every looper uses and it needs no separate clear control.
 */
export function markLoop(loop: AbLoop, position: number): AbLoop {
  if (loop === null) return { start: position, end: Number.POSITIVE_INFINITY };
  if (!Number.isFinite(loop.end)) {
    // A B before the A is a mistake nobody means; swapping is what they meant.
    return position > loop.start
      ? { start: loop.start, end: position }
      : { start: position, end: loop.start };
  }
  return null;
}

/** Should the playhead jump back? Called on the ordinary progress tick. */
export function shouldLoopBack(loop: AbLoop, position: number): boolean {
  return loop !== null && Number.isFinite(loop.end) && position >= loop.end;
}

/* ── persistence ─────────────────────────────────────────────────────── */

/**
 * The queue as something that can be stored.
 *
 * Only what cannot be recomputed: the shuffled order is kept because losing it
 * on restart would silently reshuffle, and somebody who left a queue in a
 * particular order expects to find it in that order.
 */
export function serialiseQueue(queue: Queue): string {
  return JSON.stringify(queue);
}

/**
 * Reads a stored queue, discarding anything malformed.
 *
 * The same reasoning as `parseSaved`: this is on disk, it may have been written
 * by an older build, and a queue that will not parse must cost the user their
 * queue rather than their launch.
 */
export function parseQueue(stored: string | null): Queue {
  if (!stored) return EMPTY_QUEUE;
  try {
    const parsed = JSON.parse(stored) as Partial<Queue>;
    if (!Array.isArray(parsed.items)) return EMPTY_QUEUE;

    const items = parsed.items.filter(
      (item): item is QueueItem =>
        Boolean(item) &&
        typeof item.key === 'string' &&
        typeof item.trackId === 'string',
    );
    const order = Array.isArray(parsed.order)
      ? parsed.order.filter(
          (index) => Number.isInteger(index) && index < items.length,
        )
      : identity(items.length);

    return {
      items,
      order: order.length === items.length ? order : identity(items.length),
      cursor: Math.min(
        Math.max(0, parsed.cursor ?? 0),
        Math.max(0, order.length - 1),
      ),
      repeat:
        parsed.repeat === 'all' || parsed.repeat === 'one'
          ? parsed.repeat
          : 'off',
      shuffle:
        parsed.shuffle === 'on' ||
        parsed.shuffle === 'spread' ||
        parsed.shuffle === 'album'
          ? parsed.shuffle
          : 'off',
      // A loop is a within-this-session thing. Restoring one would leave the
      // app looping eight seconds of a song with no visible reason why.
      loop: null,
    };
  } catch {
    return EMPTY_QUEUE;
  }
}
