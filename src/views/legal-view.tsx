import { useMemo, useState } from 'react';

import { Input } from '@/components/ui/input';
import { TabStrip, type TabDefinition } from '@/components/common/tab-strip';
import { ViewShell, ViewTitle } from '@/views/view-shell';
import { openExternal } from '@/lib/desktop';
import attributions from '@/lib/attributions.json';
import { cn } from '@/lib/utils';

/**
 * What the app does with your data, and what it is built from.
 *
 * # Why the privacy page is written out rather than linked
 *
 * A link to a policy on a website is a policy that can change without the
 * build changing, and one that is unreadable on a machine with no network. The
 * text is in the application because the application is what makes the claims
 * true — and if the code changes, this file is in the same commit.
 *
 * # Why the attributions are generated
 *
 * Because a hand-written list is wrong the day after it is written.
 * `scripts/attributions.mjs` reads the two dependency trees that actually
 * ship, and `--check` fails a build where the list has drifted. A list nobody
 * verifies is worse than none: it is a claim about other people's licences.
 */
type Tab = 'privacy' | 'licences';

const TABS: TabDefinition<Tab>[] = [
  { id: 'privacy', label: 'Privacy' },
  {
    id: 'licences',
    label: 'Open source',
    badge: attributions.packages.length,
  },
];

export function LegalView() {
  const [tab, setTab] = useState<Tab>('privacy');

  return (
    <ViewShell
      header={
        <div className="flex flex-col gap-4">
          <ViewTitle eyebrow="About" title="Privacy and licences" />
          <TabStrip
            tabs={TABS}
            value={tab}
            onChange={setTab}
            label="Privacy and licences"
          />
        </div>
      }
    >
      <div className="max-w-3xl">
        {tab === 'privacy' ? <Privacy /> : <Licences />}
      </div>
    </ViewShell>
  );
}

/**
 * The data-handling page.
 *
 * Written as a set of specific claims rather than as a policy, because a policy
 * is a document written to be defensible and this is a document written to be
 * checked. Every statement below names the file that makes it true, so somebody
 * who does not believe it can go and look.
 */
function Privacy() {
  return (
    <div className="flex flex-col gap-8">
      <Section title="The short version">
        <p>
          MadMusic has no server. There is no MadMusic account, nothing is
          uploaded by default, and your library never leaves this machine unless
          you switch something on that says it will.
        </p>
      </Section>

      <Section title="What stays on this machine, always">
        <List
          items={[
            'Your music files. They are read from the folder you chose and nowhere else.',
            'Your library index — titles, artists, play counts, ratings, tags — in a SQLite database in the app’s own data folder.',
            'Playlists, liked songs and listening history.',
            'Every setting on every screen.',
            'Listening statistics. They are computed from the database here and never sent anywhere.',
          ]}
        />
      </Section>

      <Section title="What leaves this machine, and only when it must">
        <p className="mb-3">
          Playing music from the catalogue means asking YouTube for it. That is
          unavoidable — it is where the audio is — and it is the one thing this
          app cannot do privately.
        </p>
        <List
          items={[
            'A search query, when you search the catalogue.',
            'A video id, when you play a catalogue track.',
            'An artist or album name, when metadata is fetched — MusicBrainz, Discogs, Last.fm and the Cover Art Archive. This can be switched off entirely.',
            'A feed address, when a podcast refreshes.',
          ]}
        />
        <p className="mt-3">
          Nothing in that list carries an identifier for you. There is no
          account to attach it to.
        </p>
      </Section>

      <Section title="What is off unless you turn it on">
        <List
          items={[
            'Sync. Needs an account with the identity provider and a backend you configure yourself. Without one, the feature is absent rather than idle.',
            'Scrobbling to Last.fm. The session key is encrypted with the operating system’s own key store where there is one — see Diagnostics for whether that worked on this machine.',
            'Crash reports. Recorded locally either way so the Diagnostics page has something to show; sending is a separate switch, and there is nowhere to send to yet.',
            'Anonymous telemetry, with a preview of exactly what would be sent before anything is.',
            'Publishing what you are playing — to friends, or to Discord.',
          ]}
        />
      </Section>

      <Section title="What is never collected">
        <List
          items={[
            'Paths from your music folder. The diagnostics report carries counts — “3 folders, 12,401 tracks” — and a test fails if a field capable of carrying a path is ever added to it.',
            'Track titles or artist names, in any report.',
            'Anything at all when the app is offline.',
          ]}
        />
      </Section>

      <Section title="Deleting it">
        <p>
          Everything lives in the app’s data folder, which the Diagnostics page
          will open for you. Deleting that folder removes the library index,
          playlists, history and every setting. Your music files are not in it
          and are not touched.
        </p>
      </Section>
    </div>
  );
}

/** The generated list of everything the app is built from. */
function Licences() {
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return attributions.packages;
    return attributions.packages.filter(
      (entry) =>
        entry.name.toLowerCase().includes(needle) ||
        entry.licence.toLowerCase().includes(needle),
    );
  }, [query]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        MadMusic is built on {attributions.packages.length} open-source
        packages. This list is generated from the dependency trees that actually
        ship, so it cannot drift from what is in the binary.
      </p>

      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Filter by name or licence"
        aria-label="Filter packages"
        className="max-w-sm"
      />

      <p className="text-xs text-muted-foreground" aria-live="polite">
        {shown.length === attributions.packages.length
          ? `${shown.length} packages`
          : `${shown.length} of ${attributions.packages.length} packages`}
      </p>

      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {shown.map((entry) => (
          <li
            key={`${entry.from}:${entry.name}`}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5"
          >
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {entry.url ? (
                <button
                  type="button"
                  onClick={() => void openExternal(entry.url)}
                  className="underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {entry.name}
                </button>
              ) : (
                entry.name
              )}
            </span>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {entry.version}
            </span>
            <span
              className={cn(
                'shrink-0 rounded-full bg-accent/50 px-2 py-0.5 text-[10px] text-muted-foreground',
              )}
            >
              {entry.licence}
            </span>
          </li>
        ))}

        {shown.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-muted-foreground">
            Nothing matches “{query.trim()}”.
          </li>
        )}
      </ul>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 font-display text-lg font-semibold tracking-tight">
        {title}
      </h2>
      <div className="text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-5">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
