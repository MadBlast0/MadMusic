/**
 * Smart-playlist rules, evaluated in TypeScript.
 *
 * This is the second implementation of the rule semantics — `db::smart` in Rust
 * is the first, and it is the one that runs in the app. This one exists because
 * the browser build has no SQLite, and a smart playlist that silently returns
 * nothing during `pnpm dev` is worse than no smart playlist.
 *
 * Two implementations of one thing is a cost, and it is paid deliberately: the
 * alternative is shipping a WebAssembly SQLite to the browser build purely so
 * that a development-only code path can reuse the SQL. The semantics are small
 * enough to state exactly, and `src/lib/store/rules.test.ts` checks the pairs
 * that matter against the same cases the Rust tests use.
 */

import type { Rule, RuleSet, TrackRow } from '@/lib/store/types';

/** What kind of value a field holds, which decides which operators apply. */
type Kind = 'text' | 'number' | 'date' | 'bool';

/** Reads a field off a track, and says what kind it is. Mirrors `field_sql`. */
function read(track: TrackRow, field: string): [unknown, Kind] | null {
  switch (field) {
    case 'title':
      return [track.title, 'text'];
    case 'artist':
      return [track.artist, 'text'];
    case 'album_artist':
      return [track.albumArtist, 'text'];
    case 'album':
      return [track.album, 'text'];
    case 'genre':
      return [track.genre, 'text'];
    case 'composer':
      return [track.composer, 'text'];
    case 'work':
      return [track.work, 'text'];
    case 'kind':
      return [track.kind, 'text'];
    case 'path':
      return [track.path, 'text'];
    // Tags join with the unit separator so `contains` behaves the way the SQL
    // side's `group_concat(name, char(31))` does.
    case 'tag':
      return [track.tags.join('\u001f'), 'text'];
    case 'year':
      return [track.year, 'number'];
    case 'duration':
      return [track.duration, 'number'];
    case 'bpm':
      return [track.bpm, 'number'];
    case 'track_no':
      return [track.trackNo, 'number'];
    case 'disc_no':
      return [track.discNo, 'number'];
    case 'stars':
      return [track.stars, 'number'];
    case 'plays':
      return [track.plays, 'number'];
    case 'explicit':
      return [track.explicit, 'bool'];
    case 'compilation':
      return [track.compilation, 'bool'];
    case 'liked':
      return [track.liked, 'bool'];
    case 'downloaded':
      // The web adapter has no download table, so nothing is downloaded. That
      // is true rather than a stub: the browser build cannot download.
      return [false, 'bool'];
    case 'added':
      return [track.addedAt, 'date'];
    case 'last_played':
      return [track.lastPlayed, 'date'];
    default:
      return null;
  }
}

const text = (value: unknown): string => String(value ?? '').toLowerCase();

const number = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

/**
 * Tests one rule against one track.
 *
 * An unknown field or an operator that does not apply answers `false` here,
 * where the SQL side drops the clause entirely. The difference is deliberate
 * and it only shows up for a rule set written by a newer build: SQL cannot
 * express "ignore this clause" per row, and answering `false` for a rule
 * nobody can evaluate is the conservative reading.
 */
export function matches(track: TrackRow, rule: Rule): boolean {
  const found = read(track, rule.field);
  if (!found) return false;
  const [raw, kind] = found;

  if (kind === 'text') {
    const value = text(raw);
    const wanted = text(rule.value);
    switch (rule.op) {
      case 'is':
        return value === wanted;
      case 'is_not':
        return value !== wanted;
      case 'contains':
        return wanted !== '' && value.includes(wanted);
      case 'not_contains':
        return wanted !== '' && !value.includes(wanted);
      case 'starts_with':
        return wanted !== '' && value.startsWith(wanted);
      case 'ends_with':
        return wanted !== '' && value.endsWith(wanted);
      case 'empty':
        return value === '';
      case 'not_empty':
        return value !== '';
      default:
        return false;
    }
  }

  if (kind === 'number') {
    const value = number(raw);
    const wanted = number(rule.value);
    if (Number.isNaN(value) || Number.isNaN(wanted)) return false;
    switch (rule.op) {
      case 'is':
        return value === wanted;
      case 'is_not':
        return value !== wanted;
      case 'gt':
        return value > wanted;
      case 'gte':
        return value >= wanted;
      case 'lt':
        return value < wanted;
      case 'lte':
        return value <= wanted;
      case 'between': {
        const upper = number(rule.value2);
        return !Number.isNaN(upper) && value >= wanted && value <= upper;
      }
      default:
        return false;
    }
  }

  if (kind === 'date') {
    const value = number(raw);
    switch (rule.op) {
      // Always relative, for the reason the Rust side gives: an absolute date
      // stops being true the day after you write it.
      case 'within_days':
        return value >= Date.now() - number(rule.value) * 86_400_000;
      case 'not_within_days':
        return value < Date.now() - number(rule.value) * 86_400_000;
      case 'ever':
        return value > 0;
      case 'never':
        return value === 0;
      default:
        return false;
    }
  }

  // bool
  if (rule.op !== 'is') return false;
  const wanted = rule.value === true || number(rule.value) !== 0;
  return Boolean(raw) === wanted;
}

/**
 * Selects the tracks a rule set describes.
 *
 * An empty rule set selects everything, matching the SQL side and for the same
 * reason: a half-written smart playlist should show the library narrowing as
 * you add rules, not an empty screen that looks broken.
 */
export function evaluate(tracks: TrackRow[], rules: RuleSet): TrackRow[] {
  if (rules.rules.length === 0) return [...tracks];
  const any = rules.matchMode === 'any';

  return tracks.filter((track) =>
    any
      ? rules.rules.some((rule) => matches(track, rule))
      : rules.rules.every((rule) => matches(track, rule)),
  );
}
