/**
 * What this build can actually do, and why not, where it cannot.
 *
 * # Why this exists
 *
 * Every optional integration in MadMusic degrades quietly on purpose. No
 * Last.fm key and recommendations come from your own listening; no Discogs
 * token and credits come from MusicBrainz alone; no Discord application id and
 * there is no rich presence. That restraint is right — a switch that can never
 * work is worse than no switch — but it was only ever half implemented.
 *
 * The Rust side had been answering the question all along. `discogs_available`,
 * `discord_available`, `lastfm_api_available` and the rest each return an
 * `available` flag **and a sentence explaining the absence**, written for a
 * settings screen to show:
 *
 *   > "This build has no Discogs token, so credits come from MusicBrainz
 *   > alone."
 *
 * Those commands were registered and never once called. The sentences were
 * written, compiled, shipped, and displayed nowhere. So the features vanished
 * *silently*, which is the failure the design was trying to avoid: somebody
 * wondering why there are no credits had nothing to read, and somebody who had
 * put a key in `.env.local` had no way to tell whether it had been picked up.
 *
 * # Why a list rather than a check per screen
 *
 * Because the question people ask is "what is switched on", not "is Discogs
 * switched on". A row per integration in one place answers it once, and it is
 * also the only honest place to say that a key needs a rebuild to take effect —
 * see `src-tauri/build.rs`.
 */

import { isNative, tryInvoke } from '@/lib/native';

/** One optional integration, and whether this build has what it needs. */
export type Capability = {
  id: string;
  /** What it is, in the user's terms rather than the vendor's. */
  label: string;
  /** What it adds when it is on. Shown whether or not it is. */
  adds: string;
  available: boolean;
  /** Rust's own sentence about the absence. Empty when available. */
  reason: string;
};

/** The shape the Rust probes return. */
type Availability = { available: boolean; reason: string };

/**
 * The integrations, in the order somebody would look for them.
 *
 * `probe` is the command name; `key` is the environment variable that turns it
 * on, named here so the reason can point at something actionable rather than
 * leaving the reader to search the repository.
 */
const CAPABILITIES: {
  id: string;
  label: string;
  adds: string;
  probe: string;
  key: string;
}[] = [
  {
    id: 'lastfm',
    label: 'Last.fm recommendations',
    adds: 'Similar artists, charts and an artist’s top tracks.',
    probe: 'lastfm_api_available',
    key: 'LASTFM_API_KEY',
  },
  {
    id: 'discogs',
    label: 'Discogs credits',
    adds: 'Engineers, producers and pressing details MusicBrainz has no record of.',
    probe: 'discogs_available',
    key: 'DISCOGS_TOKEN',
  },
  {
    id: 'acoustid',
    label: 'Audio recognition',
    adds: 'Identifies untagged files from the audio itself.',
    probe: 'acoustid_available',
    key: 'ACOUSTID_API_KEY',
  },
  {
    id: 'discord',
    label: 'Discord presence',
    adds: 'Shows what you are playing on your Discord profile.',
    probe: 'discord_available',
    key: 'DISCORD_APP_ID',
  },
];

/**
 * Asks each probe what it can do.
 *
 * `tryInvoke` with a browser-shaped default rather than a `isNative()` guard
 * around the whole thing: in a browser tab none of these can work, and saying
 * so per row is more use than hiding the list. Every probe is asked in
 * parallel — they are all local and none touches the network.
 */
export async function capabilities(): Promise<Capability[]> {
  const browser = !isNative();

  return Promise.all(
    CAPABILITIES.map(async (entry) => {
      const answer = browser
        ? {
            available: false,
            reason: 'This needs the desktop app.',
          }
        : await tryInvoke<Availability>(entry.probe, undefined, {
            available: false,
            reason: '',
          });

      return {
        id: entry.id,
        label: entry.label,
        adds: entry.adds,
        available: answer.available === true,
        // Rust's sentence where there is one, and a pointer at the variable
        // where there is not — a probe that answers `false` with no reason is
        // a probe that has told us nothing the reader can act on.
        reason: answer.available
          ? ''
          : answer.reason || `Set ${entry.key} and rebuild to switch this on.`,
      };
    }),
  );
}
