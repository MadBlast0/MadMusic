import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  GOAL_METRICS,
  GOAL_PERIODS,
  MAX_TARGET,
  clampTarget,
  describeGoal,
  periodStart,
  progressOf,
  type Goal,
  type GoalMetric,
  type GoalPeriod,
} from '@/lib/goals';
import { store } from '@/lib/store';
import { keys } from '@/lib/store/keys';
import { cn } from '@/lib/utils';

/**
 * A goal, and how it is going.
 *
 * # Why it lives on the statistics page and nowhere else
 *
 * Because that is the page somebody opens when they want to know how they have
 * been listening. A goal on the home screen is a demand; a goal on the page you
 * went to in order to ask is an answer.
 *
 * Nothing about this notifies, badges, or interrupts. `src/lib/goals.ts` sets
 * out the whole position, including why there is no penalty for missing one.
 *
 * # Why the progress is fetched here
 *
 * The statistics page shows a range the user picked — four weeks, a year — and
 * a goal is measured over its own period, which is a different window. Reading
 * the page's summary would show "20 of 20 tracks a month" for a year's worth of
 * plays, which is not what the goal says.
 */
const OFF: Goal | null = null;

export function ListeningGoal() {
  const [goal, setGoal] = useState<Goal | null>(OFF);
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    void store
      .kvGet(keys.GOAL)
      .then((raw) => {
        if (!live) return;
        setGoal(parseGoal(raw));
        setReady(true);
      })
      .catch(() => {
        if (live) setReady(true);
      });
    return () => {
      live = false;
    };
  }, []);

  // The goal's own window, not the page's.
  useEffect(() => {
    if (!goal) return;

    let live = true;
    const from = periodStart(goal.period, Date.now());

    void store
      .statsSummary({ from, to: 0 })
      .then((summary) => {
        if (!live) return;
        setDone(
          goal.metric === 'minutes'
            ? Math.floor(summary.seconds / 60)
            : goal.metric === 'newTracks'
              ? summary.newTracks
              : summary.tracks,
        );
      })
      .catch(() => {
        if (live) setDone(null);
      });

    return () => {
      live = false;
    };
  }, [goal]);

  const save = (next: Goal | null) => {
    setGoal(next);
    setDone(null);
    void store
      .kvSet(keys.GOAL, next ? JSON.stringify(next) : '')
      .catch(() => {});
  };

  if (!ready) return null;

  const progress = goal ? progressOf(goal, done ?? 0) : null;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">A goal, if you want one</h2>
          <p className="mt-0.5 max-w-prose text-xs text-muted-foreground">
            Off unless you turn it on. Nothing here notifies you, and missing
            one costs nothing — the period simply ends and the next begins.
          </p>
        </div>
        <Switch
          checked={goal !== null}
          onCheckedChange={(on) =>
            save(
              on ? { metric: 'newTracks', period: 'month', target: 20 } : null,
            )
          }
          aria-label="Set a listening goal"
        />
      </div>

      {goal && (
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-wrap gap-1.5">
            {GOAL_METRICS.map((entry) => (
              <Chip
                key={entry.id}
                active={goal.metric === entry.id}
                onClick={() =>
                  save({
                    ...goal,
                    metric: entry.id,
                    // Re-clamped: a target of 200 tracks is fine and 200 hours
                    // is not, so switching metric has to bring the number with
                    // it rather than leaving an unreachable one behind.
                    target: clampTarget(entry.id, goal.target),
                  })
                }
              >
                {entry.label}
              </Chip>
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {GOAL_PERIODS.map((entry) => (
              <Chip
                key={entry.id}
                active={goal.period === entry.id}
                onClick={() => save({ ...goal, period: entry.id })}
              >
                {entry.label}
              </Chip>
            ))}
          </div>

          <div className="flex items-center gap-4">
            <Slider
              value={[goal.target]}
              min={1}
              max={MAX_TARGET[goal.metric]}
              step={1}
              onValueChange={([value]) =>
                setGoal({ ...goal, target: clampTarget(goal.metric, value) })
              }
              // Written on release rather than on every frame of a drag: the
              // store is on disk, and a slider would otherwise write a hundred
              // times crossing the track.
              onValueCommit={([value]) =>
                save({ ...goal, target: clampTarget(goal.metric, value) })
              }
              aria-label="Goal"
              className="flex-1"
            />
            <span className="w-12 shrink-0 text-right text-sm tabular-nums">
              {goal.target}
            </span>
          </div>

          {progress && (
            <div>
              <Progress
                label="Progress towards your goal"
                value={progress.fraction * 100}
                className={cn('h-2', progress.met && '[&>div]:bg-primary')}
              />
              <p
                className="mt-2 text-xs text-muted-foreground"
                aria-live="polite"
              >
                {done === null ? 'Counting…' : describeGoal(goal, progress)}
              </p>
            </div>
          )}

          <div>
            <Button variant="ghost" size="sm" onClick={() => save(null)}>
              Remove the goal
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full px-3 py-1 text-xs font-medium transition-colors duration-fast',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-accent/40 text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Reads a stored goal, refusing anything that is not one.
 *
 * A hand-edited or half-written value should mean "no goal" rather than a
 * statistics page that throws.
 */
function parseGoal(raw: string | null): Goal | null {
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    const candidate = parsed as Partial<Goal>;
    const metric = GOAL_METRICS.find(
      (entry) => entry.id === candidate.metric,
    )?.id;
    const period = GOAL_PERIODS.find(
      (entry) => entry.id === candidate.period,
    )?.id;
    if (!metric || !period) return null;

    return {
      metric: metric as GoalMetric,
      period: period as GoalPeriod,
      target: clampTarget(metric, Number(candidate.target)),
    };
  } catch {
    return null;
  }
}
