import { useCallback, useEffect, useState } from 'react';

import { ListeningGoal } from '@/components/common/listening-goal';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StaticClock } from '@/components/icons';
import { store } from '@/lib/store';
import type { Review, TopEntry } from '@/lib/store/types';
import { formatNumber } from '@/lib/i18n';
import { exportHistoryFile } from '@/lib/playlist-io';
import { saveTextFile } from '@/lib/save-file';
import { ViewShell, ViewTitle } from '@/views/view-shell';

/**
 * What you actually listened to.
 *
 * # Why this can exist now
 *
 * Because the store records *events* rather than counters. A counter can say
 * "412 plays" and nothing else; the play table can answer questions nobody
 * thought of when the schema was written — which artist you played most in
 * March, what time of day you listen, how long your longest streak was.
 *
 * # Everything here is local
 *
 * No account, no upload, no service. The numbers are computed from the
 * database on this machine and never leave it, which is the difference between
 * a statistics page and an analytics product.
 */

/** The ranges the picker offers. */
const RANGES = [
  { id: '4w', label: 'Last 4 weeks', days: 28 },
  { id: '6m', label: 'Last 6 months', days: 182 },
  { id: '1y', label: 'This year', days: 365 },
  { id: 'all', label: 'All time', days: 0 },
] as const;

type RangeId = (typeof RANGES)[number]['id'];

export function StatisticsView() {
  const [rangeId, setRangeId] = useState<RangeId>('4w');
  // Stored with the range it was computed for, so "is this stale" is derived
  // rather than written — see `hooks/use-async-value.ts` for the same idea.
  const [state, setState] = useState<{ range: RangeId; review: Review | null }>(
    {
      range: ' never' as RangeId,
      review: null,
    },
  );

  useEffect(() => {
    let cancelled = false;

    // `Date.now()` inside the effect rather than during render: reading the
    // clock while rendering is an impure call, and the answer is only needed
    // when the query actually runs.
    const chosen = RANGES.find((entry) => entry.id === rangeId) ?? RANGES[0];
    const range = {
      from: chosen.days > 0 ? Date.now() - chosen.days * 86_400_000 : 0,
      to: 0,
    };

    void store
      .statsReview(range)
      .catch((): Review | null => null)
      .then((next) => {
        if (!cancelled) setState({ range: rangeId, review: next });
      });

    return () => {
      cancelled = true;
    };
  }, [rangeId]);

  const loading = state.range !== rangeId;
  const review = state.review;
  const summary = review?.summary;
  const empty = !loading && (summary?.plays ?? 0) === 0;

  /**
   * Writes the listening history out.
   *
   * Reads afresh rather than reusing what the charts are built from: the charts
   * are a *summary* over the selected range, and somebody exporting their
   * history wants the history, not the top ten.
   */
  const exportHistory = useCallback(async (format: 'csv' | 'json') => {
    const tracks = await store
      .tracks({ minPlays: 1, sort: 'last_played', desc: true, limit: 0 })
      .catch(() => []);

    if (tracks.length === 0) {
      toast.info('There is no history to export yet');
      return;
    }

    const file = exportHistoryFile(tracks, format);
    const written = await saveTextFile(file.name, file.contents, format).catch(
      () => null,
    );

    if (written === null) toast.error('Could not write the file');
    else if (written) toast.success('History exported');
  }, []);

  return (
    <ViewShell
      header={
        <ViewTitle
          eyebrow="Your listening"
          title="Statistics"
          subtitle="Computed on this machine, from your own history. Nothing is sent anywhere."
          action={
            <Tabs
              value={rangeId}
              onValueChange={(value) => setRangeId(value as RangeId)}
            >
              <TabsList>
                {RANGES.map((entry) => (
                  <TabsTrigger key={entry.id} value={entry.id}>
                    {entry.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          }
        />
      }
    >
      {!empty && (
        <div className="mb-6 flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void exportHistory('csv')}
          >
            Export CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void exportHistory('json')}
          >
            Export JSON
          </Button>
        </div>
      )}

      {empty ? (
        <Empty>
          <EmptyHeader>
            <StaticClock className="size-8 text-muted-foreground" />
            <EmptyTitle>Nothing to count yet</EmptyTitle>
            <EmptyDescription>
              Play something for more than thirty seconds and it will appear
              here. Skips do not count — a “top artist” you skipped four hundred
              times would be worse than useless.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-10">
          {summary && (
            <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Listening" value={formatHours(summary.seconds)} />
              <Stat label="Plays" value={formatNumber(summary.plays)} />
              <Stat label="Tracks" value={formatNumber(summary.tracks)} />
              <Stat label="Artists" value={formatNumber(summary.artists)} />
              <Stat label="Albums" value={formatNumber(summary.albums)} />
              <Stat
                label="Longest streak"
                value={`${summary.streakDays} ${summary.streakDays === 1 ? 'day' : 'days'}`}
              />
            </section>
          )}

          {/* Before the year in review and after the totals: it is a thing
              somebody set for themselves, and it belongs next to the numbers
              it is measured against rather than at the bottom of the page. */}
          <ListeningGoal />

          {review && (
            <>
              <TopList
                title="Top artists"
                entries={review.topArtists}
                unit="plays"
              />
              <TopList
                title="Top tracks"
                entries={review.topTracks}
                unit="plays"
              />
              <TopList
                title="Top albums"
                entries={review.topAlbums}
                unit="plays"
              />
              {review.topGenres.length > 0 && (
                <TopList
                  title="Top genres"
                  entries={review.topGenres}
                  unit="plays"
                />
              )}

              <Histogram
                title="When you listen"
                subtitle="By hour of the day, in your own timezone"
                buckets={review.byHour.map((bucket) => ({
                  label: `${Number(bucket.key)}:00`,
                  short: String(Number(bucket.key)),
                  value: bucket.plays,
                }))}
              />

              <Histogram
                title="Which days"
                subtitle="Sunday first, matching the way SQLite counts them"
                buckets={review.byWeekday.map((bucket) => ({
                  label: WEEKDAYS[Number(bucket.key)] ?? bucket.key,
                  short: (WEEKDAYS[Number(bucket.key)] ?? bucket.key).slice(
                    0,
                    2,
                  ),
                  value: bucket.plays,
                }))}
              />

              {review.firstTrack && (
                <section className="rounded-lg border bg-card p-5">
                  <h2 className="font-display text-lg font-semibold">
                    The one that started it
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    The first thing you played in this period.
                  </p>
                  <p className="mt-3 font-medium">{review.firstTrack.label}</p>
                  <p className="text-sm text-muted-foreground">
                    {review.firstTrack.secondary}
                  </p>
                </section>
              )}
            </>
          )}
        </div>
      )}
    </ViewShell>
  );
}

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums">
        {value}
      </p>
    </div>
  );
}

/**
 * A ranked list.
 *
 * The bar is a background width rather than a chart component: twenty rows of
 * "name, count, proportion" is a list with a fill, and reaching for a charting
 * library for it would add a hundred kilobytes to draw rectangles.
 */
function TopList({
  title,
  entries,
  unit,
}: {
  title: string;
  entries: TopEntry[];
  unit: string;
}) {
  if (entries.length === 0) return null;
  const highest = Math.max(...entries.map((entry) => entry.plays), 1);

  return (
    <section>
      <h2 className="mb-3 font-display text-lg font-semibold">{title}</h2>
      <ol className="space-y-1">
        {entries.map((entry, index) => (
          <li
            key={`${entry.id}-${index}`}
            className="relative overflow-hidden rounded-md"
          >
            <div
              className="absolute inset-y-0 left-0 bg-accent/40"
              style={{ width: `${(entry.plays / highest) * 100}%` }}
              aria-hidden
            />
            <div className="relative flex items-baseline gap-3 px-3 py-2">
              <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {entry.label}
              </span>
              {entry.secondary && (
                <span className="hidden min-w-0 flex-1 truncate text-sm text-muted-foreground sm:block">
                  {entry.secondary}
                </span>
              )}
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {formatNumber(entry.plays)} {unit}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** A bar chart, drawn as bars. */
function Histogram({
  title,
  subtitle,
  buckets,
}: {
  title: string;
  subtitle: string;
  buckets: { label: string; short: string; value: number }[];
}) {
  if (buckets.length === 0) return null;
  const highest = Math.max(...buckets.map((bucket) => bucket.value), 1);

  return (
    <section>
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <p className="mt-1 mb-3 text-sm text-muted-foreground">{subtitle}</p>
      <div className="flex h-32 items-end gap-1">
        {buckets.map((bucket) => (
          <div
            key={bucket.label}
            className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
            // The value is on the element rather than in a tooltip component:
            // a hundred tooltips is a hundred more nodes, and the browser's own
            // is announced by screen readers without any work.
            title={`${bucket.label}: ${bucket.value}`}
          >
            <div
              className="w-full rounded-t-sm bg-primary/70 transition-colors group-hover:bg-primary"
              style={{
                height: `${Math.max(2, (bucket.value / highest) * 100)}%`,
              }}
            />
            <span className="truncate text-[10px] text-muted-foreground">
              {bucket.short}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Seconds as the hours-and-minutes a person would say. */
function formatHours(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours === 0) return `${minutes} min`;
  return hours >= 100 ? `${formatNumber(hours)} h` : `${hours}h ${minutes}m`;
}

/**
 * The year in review, as its own export.
 *
 * Rendered from the same `Review` the statistics page uses, so the two can
 * never disagree — a "wrapped" screen computed separately would eventually show
 * a different top artist from the statistics screen, and both would be right
 * according to their own query.
 */
export function YearInReview({ year }: { year: number }) {
  const [review, setReview] = useState<Review | null>(null);

  useEffect(() => {
    const from = new Date(year, 0, 1).getTime();
    const to = new Date(year + 1, 0, 1).getTime();
    void store
      .statsReview({ from, to })
      .then(setReview)
      .catch(() => setReview(null));
  }, [year]);

  if (!review || review.summary.plays === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Nothing recorded for {year}</EmptyTitle>
          <EmptyDescription>
            A review needs a year of listening behind it. Come back in December.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const top = review.topArtists[0];

  return (
    <div className="space-y-8">
      <section className="rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 p-8">
        <p className="text-xs font-medium tracking-wide uppercase">{year}</p>
        <h2 className="mt-2 font-display text-4xl font-semibold">
          {formatHours(review.summary.seconds)} of music
        </h2>
        {top && (
          <p className="mt-3 text-lg">
            Mostly <span className="font-semibold">{top.label}</span>, who you
            played {formatNumber(top.plays)} times.
          </p>
        )}
      </section>

      <TopList
        title={`Your ${year} artists`}
        entries={review.topArtists}
        unit="plays"
      />
      <TopList
        title={`Your ${year} tracks`}
        entries={review.topTracks}
        unit="plays"
      />

      <Histogram
        title="Across the year"
        subtitle="Plays per month"
        buckets={review.byMonth.map((bucket) => ({
          label: bucket.key,
          short: bucket.key.slice(5),
          value: bucket.plays,
        }))}
      />

      <p className="text-sm text-muted-foreground">
        Built from {formatNumber(review.summary.plays)} plays across{' '}
        {formatNumber(review.summary.activeDays)} days. All of it computed here;
        none of it sent anywhere.
      </p>
      <Button variant="outline" size="sm" onClick={() => window.print()}>
        Save as a PDF
      </Button>
    </div>
  );
}
