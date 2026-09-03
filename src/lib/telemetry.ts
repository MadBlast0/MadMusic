/**
 * Crash reports and feedback, both opt-in.
 *
 * # The rule
 *
 * **Nothing leaves the machine unless the user turned it on**, and what leaves
 * is shown to them first. Not summarised — shown. A "we collect anonymous usage
 * data" sentence is a promise nobody can check; a screen displaying the exact
 * text about to be sent is one they can.
 *
 * # What is never collected, at all
 *
 * Track titles, artist names, file paths, folder names, playlist names, search
 * queries, account identifiers, IP-derived location. Not "anonymised" — absent.
 * A folder path alone carries somebody's real name often enough that treating it
 * as harmless is a mistake, and a crash report is useless if the person sending
 * it has to audit it first.
 *
 * What is left is version numbers, platform, and the shape of a failure. That is
 * enough to fix almost everything and identifies nobody.
 */

import { store } from '@/lib/store';
import { keys } from '@/lib/store/keys';
import { tryInvoke } from '@/lib/native';

/** The user's answer. Unset is not consent. */
export type TelemetryChoice = 'unset' | 'on' | 'off';

export type TelemetrySettings = {
  choice: TelemetryChoice;
  /** When they were asked, so they are not asked twice in a week. */
  askedAt: number;
};

const DEFAULT: TelemetrySettings = { choice: 'unset', askedAt: 0 };

export async function loadTelemetry(): Promise<TelemetrySettings> {
  const stored = await store.kvGet(keys.TELEMETRY).catch(() => null);
  if (!stored) return { ...DEFAULT };

  try {
    const parsed = JSON.parse(stored) as Partial<TelemetrySettings>;
    return {
      choice:
        parsed.choice === 'on' || parsed.choice === 'off'
          ? parsed.choice
          : 'unset',
      askedAt: typeof parsed.askedAt === 'number' ? parsed.askedAt : 0,
    };
  } catch {
    return { ...DEFAULT };
  }
}

export async function saveTelemetry(
  settings: TelemetrySettings,
): Promise<void> {
  await store.kvSet(keys.TELEMETRY, JSON.stringify(settings));
}

/** One thing that went wrong. */
export type CrashReport = {
  /** The error's own message, with anything path-shaped removed. */
  message: string;
  /** Where it happened, as a stack with paths reduced to file names. */
  stack: string;
  /** What the user was doing, as a route name rather than as a description. */
  route: string;
  appVersion: string;
  platform: string;
  at: number;
};

/**
 * Strips anything that could identify a person from a string.
 *
 * Absolute paths, home directories, drive letters and URLs with query strings.
 * Aggressive on purpose: a stack trace with `/Users/joanna/Music/...` in it has
 * named somebody, and the file name alone is what makes the trace useful.
 */
function scrub(text: string): string {
  return (
    text
      // Windows paths, including UNC.
      .replace(
        /[A-Za-z]:\\[^\s:)"']+/g,
        (match) => `…\\${match.split('\\').pop() ?? ''}`,
      )
      .replace(/\\\\[^\s:)"']+/g, '…')
      // POSIX paths.
      .replace(/\/(?:home|Users)\/[^\s/:)"']+/g, '…')
      .replace(/\/(?:[\w.-]+\/){2,}([\w.-]+)/g, '…/$1')
      // Query strings, which is where tokens live.
      .replace(/\?[^\s)"']*/g, '')
      .slice(0, 2000)
  );
}

/**
 * Builds a report, without sending it.
 *
 * Separate from sending so the confirmation screen can show exactly what would
 * go — which is the whole basis of the promise at the top of this file.
 */
export async function buildReport(
  error: unknown,
  route: string,
): Promise<CrashReport> {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? (error.stack ?? '') : '';

  const diagnostics = await tryInvoke<{
    appVersion: string;
    os: string;
    arch: string;
  }>('diagnostics_report', undefined, {
    appVersion: 'unknown',
    os: 'unknown',
    arch: 'unknown',
  });

  return {
    message: scrub(message),
    stack: scrub(stack),
    // A route name, not a description of what they were doing. "library" says
    // enough to reproduce and nothing about what is in the library.
    route,
    appVersion: diagnostics.appVersion,
    platform: `${diagnostics.os}/${diagnostics.arch}`,
    at: Date.now(),
  };
}

/**
 * The report as the text the user is shown and, if they agree, what is sent.
 *
 * One function for both, so what they read and what leaves cannot differ.
 */
export function reportText(report: CrashReport): string {
  return [
    `MadMusic ${report.appVersion} on ${report.platform}`,
    `Screen: ${report.route}`,
    '',
    report.message,
    '',
    report.stack,
  ]
    .join('\n')
    .trim();
}

/**
 * Reports kept locally until somebody looks at them.
 *
 * There is no endpoint to send to — the project has no telemetry server, and
 * `docs/roadmap.md` rules out running one. So "sending" means putting the text
 * on the clipboard for a bug report, which is honest and is what somebody
 * filing an issue needs anyway.
 *
 * # Why they are written to disk as well
 *
 * Because the ones worth reading are the ones that ended the session, and those
 * are exactly the ones an in-memory list loses. A crash that blanks the window
 * takes its own report with it, so the Diagnostics page shows nothing and
 * somebody reporting a bug has nothing to attach.
 *
 * Written synchronously to `localStorage` rather than through the async store:
 * a report is only useful if the write survives whatever is about to happen,
 * and an awaited write during a crash is a write that may not land.
 */
const KEY = 'madmusic-crashes';

/** How many to keep. A render loop that throws every frame must not fill a disk. */
const KEEP = 20;

const pending: CrashReport[] = readStored();

function readStored(): CrashReport[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (entry): entry is CrashReport =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as CrashReport).message === 'string',
      )
      .slice(-KEEP);
  } catch {
    // A corrupt list costs the reports in it, not the app that reads it.
    return [];
  }
}

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(pending));
  } catch {
    // Full, or storage is unavailable. Losing a crash report is a smaller
    // problem than the crash, and there is nothing useful to do about it.
  }
}

export function recordCrash(report: CrashReport): void {
  pending.push(report);
  // Bounded. A render loop that throws on every frame would otherwise fill
  // memory with reports about filling memory.
  if (pending.length > KEEP) pending.shift();
  persist();
}

export function pendingCrashes(): CrashReport[] {
  return [...pending];
}

export function clearCrashes(): void {
  pending.length = 0;
  persist();
}

/**
 * Installs the global handlers.
 *
 * Returns a cleanup function, and records regardless of the telemetry setting —
 * recording is local, and the setting governs *sending*. A user who has
 * telemetry off but wants to file a bug should still be able to find the report.
 */
export function watchForCrashes(route: () => string): () => void {
  const onError = (event: ErrorEvent) => {
    void buildReport(event.error ?? event.message, route()).then(recordCrash);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    void buildReport(event.reason, route()).then(recordCrash);
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

/* ── feedback ────────────────────────────────────────────────────────────── */

/** What the feedback form produces. */
export type Feedback = {
  kind: 'bug' | 'idea' | 'other';
  body: string;
  /** Whether to attach the diagnostics report. Off by default. */
  includeDiagnostics: boolean;
};

/**
 * Turns feedback into the body of a GitHub issue.
 *
 * Composed here rather than on a server, and opened in the browser rather than
 * posted, because posting would mean the project holding an API token that can
 * write to its own issue tracker — inside a binary anybody can read.
 */
export async function feedbackUrl(feedback: Feedback): Promise<string> {
  const labels = { bug: 'bug', idea: 'enhancement', other: 'question' }[
    feedback.kind
  ];

  const diagnostics = feedback.includeDiagnostics
    ? await tryInvoke<string>('diagnostics_text', undefined, '')
    : '';

  const body = [
    feedback.body.trim(),
    diagnostics
      ? '\n\n<details><summary>Diagnostics</summary>\n\n```\n' +
        diagnostics +
        '\n```\n</details>'
      : '',
  ]
    .join('')
    .slice(0, 6000);

  const params = new URLSearchParams({
    labels,
    title: feedback.body.trim().split('\n')[0]?.slice(0, 80) ?? 'Feedback',
    body,
  });

  return `https://github.com/MadBlast0/MadMusic/issues/new?${params.toString()}`;
}
