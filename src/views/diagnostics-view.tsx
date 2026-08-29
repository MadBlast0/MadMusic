import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { Check, FolderOpen, Refresh, Shield } from '@/components/icons';
import { isNative, invoke, tryInvoke } from '@/lib/native';
import { formatBytes } from '@/lib/downloads';
import {
  BUDGET,
  median,
  recent as recentStartups,
  type Startup,
} from '@/lib/startup';
import { clearCrashes, pendingCrashes, reportText } from '@/lib/telemetry';
import { ViewShell, ViewTitle } from '@/views/view-shell';

/**
 * What to send when something is wrong.
 *
 * # Why a screen and not a log file
 *
 * Because "send me your logs" is a request most people cannot act on. The file
 * is in a different place on every platform, it is not obviously the right
 * file, and opening it shows a wall of text nobody can judge for sensitive
 * content before pasting it somewhere public.
 *
 * So this assembles the report, shows it in full, and offers to copy it. The
 * showing is the point: a user is entitled to read exactly what they are about
 * to hand over.
 *
 * # What is not in it
 *
 * No paths from the library, no track titles, no account identifiers, no
 * tokens. Counts instead — "3 folders, 12,401 tracks" answers the same
 * questions and names nobody. `diagnostics.rs` has a test that fails if a field
 * capable of carrying one is ever added.
 */
type Report = {
  appVersion: string;
  tauriVersion: string;
  os: string;
  arch: string;
  build: string;
  extractorInstalled: boolean;
  fingerprinterInstalled: boolean;
  databaseOk: boolean;
  databaseSizeBytes: number;
  schemaVersion: number;
  trackCount: number;
  playlistCount: number;
  folderCount: number;
  playCount: number;
  syncPending: number;
  syncParked: number;
  failedDownloads: number;
  /** Whether this platform can encrypt a stored credential at all. */
  secretsSupported: boolean;
  /** Whether the stored Last.fm session actually is encrypted. */
  credentialProtected: boolean;
  /** Whether the OS accepted this app as a media player. */
  osMediaControls: boolean;
  /** Whether the Windows taskbar accepted the thumbnail buttons. */
  taskbarButtons: boolean;
  dataDir: string;
};

export function DiagnosticsView() {
  const [report, setReport] = useState<Report | null>(null);
  const [text, setText] = useState('');
  const [integrity, setIntegrity] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  /**
   * Bumped by the refresh button, and by anything that changes the database.
   *
   * A counter rather than calling a loader directly: the read below has to live
   * in an effect so its writes are visibly asynchronous, and an effect is
   * re-run by its dependencies rather than by being called.
   */
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      tryInvoke<Report | null>('diagnostics_report', undefined, null),
      tryInvoke<string>('diagnostics_text', undefined, ''),
    ]).then(([found, asText]) => {
      if (cancelled) return;
      setReport(found);
      setText(asText);
    });

    return () => {
      cancelled = true;
    };
  }, [tick]);

  const load = useCallback(() => setTick((count) => count + 1), []);

  const crashes = pendingCrashes();

  if (!isNative()) {
    return (
      <ViewShell header={<ViewTitle eyebrow="Support" title="Diagnostics" />}>
        <p className="text-sm text-muted-foreground">
          Diagnostics read the native shell&rsquo;s own state — the database,
          the sidecars, the data directory — none of which exist in a browser.
        </p>
      </ViewShell>
    );
  }

  return (
    <ViewShell
      header={
        <ViewTitle
          eyebrow="Support"
          title="Diagnostics"
          subtitle="Everything here is safe to paste in public. No paths from your library, no track names, no account details."
          action={
            <Button variant="ghost" size="sm" onClick={() => void load()}>
              <Refresh className="size-4" />
              Refresh
            </Button>
          }
        />
      }
    >
      <div className="space-y-8">
        {report && !report.databaseOk && (
          <Alert variant="destructive">
            <AlertTitle>The library database could not be read</AlertTitle>
            <AlertDescription>
              The app is running from memory, which means nothing is being kept.
              Run the integrity check below, and if it fails, the file is at{' '}
              {report.dataDir}.
            </AlertDescription>
          </Alert>
        )}

        {report && (
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Fact
              label="Version"
              value={`${report.appVersion} (${report.build})`}
            />
            <Fact label="Platform" value={`${report.os}/${report.arch}`} />
            <Fact label="Tauri" value={report.tauriVersion} />
            <Fact label="Schema" value={String(report.schemaVersion)} />
            <Fact label="Tracks" value={report.trackCount.toLocaleString()} />
            <Fact
              label="Playlists"
              value={report.playlistCount.toLocaleString()}
            />
            <Fact label="Folders" value={report.folderCount.toLocaleString()} />
            <Fact
              label="Plays recorded"
              value={report.playCount.toLocaleString()}
            />
            <Fact
              label="Database"
              value={formatBytes(report.databaseSizeBytes)}
            />
            <Fact
              label="Extractor"
              value={report.extractorInstalled ? 'installed' : 'missing'}
              warn={!report.extractorInstalled}
            />
            <Fact
              label="Fingerprinter"
              value={
                report.fingerprinterInstalled ? 'installed' : 'not installed'
              }
            />
            <Fact
              label="Sync queue"
              value={
                report.syncParked > 0
                  ? `${report.syncPending} waiting, ${report.syncParked} stuck`
                  : `${report.syncPending} waiting`
              }
              warn={report.syncParked > 0}
            />
            {/* The three answers that were previously unanswerable without the
                hardware in front of you. "Does the lock screen show my music"
                and "is my Last.fm session actually encrypted" are exactly the
                questions a diagnostics screen exists for. */}
            <Fact
              label="Lock screen"
              value={
                report.osMediaControls
                  ? 'the system knows about us'
                  : 'not registered'
              }
              warn={!report.osMediaControls}
            />
            <Fact
              label="Taskbar buttons"
              value={
                report.taskbarButtons
                  ? 'installed'
                  : isWindows(report.os)
                    ? 'not installed'
                    : 'Windows only'
              }
              warn={report.taskbarButtons === false && isWindows(report.os)}
            />
            <Fact
              label="Stored credential"
              value={
                report.credentialProtected
                  ? 'encrypted'
                  : report.secretsSupported
                    ? 'in the clear'
                    : 'in the clear (this platform cannot encrypt it)'
              }
              warn={!report.credentialProtected}
            />
          </section>
        )}

        <StartupTimes />

        <section>
          <h2 className="mb-2 font-display text-lg font-semibold">
            The report
          </h2>
          <Textarea
            readOnly
            rows={16}
            value={text}
            className="font-mono text-xs"
            aria-label="Diagnostic report"
          />
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(text).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
              }}
            >
              {copied ? <Check className="size-4" /> : null}
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void tryInvoke('diagnostics_open_folder', undefined, null)
              }
              animate
            >
              <FolderOpen className="size-4" />
              Open the data folder
            </Button>
          </div>
        </section>

        <section>
          <h2 className="mb-2 font-display text-lg font-semibold">
            Maintenance
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Both of these read or rewrite the whole database, so they take a
            moment on a large library. Neither loses anything.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void invoke<string>('diagnostics_check_database')
                  .then(setIntegrity)
                  .catch((cause) => setIntegrity(String(cause)))
                  .finally(() => setBusy(false));
              }}
            >
              <Shield className="size-4" />
              Check the database
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void invoke<number>('diagnostics_compact')
                  .then((bytes) =>
                    setIntegrity(`Compacted. Now ${formatBytes(bytes)}.`),
                  )
                  .catch((cause) => setIntegrity(String(cause)))
                  .finally(() => {
                    setBusy(false);
                    void load();
                  });
              }}
            >
              Compact and reindex
            </Button>
          </div>
          {integrity && (
            <p
              className={
                integrity === 'ok'
                  ? 'mt-3 text-sm text-emerald-600 dark:text-emerald-500'
                  : 'mt-3 text-sm'
              }
            >
              {integrity === 'ok' ? 'The database is intact.' : integrity}
            </p>
          )}
        </section>

        {crashes.length > 0 && (
          <section>
            <h2 className="mb-2 font-display text-lg font-semibold">
              {crashes.length} {crashes.length === 1 ? 'error' : 'errors'} this
              session
            </h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Recorded locally. Nothing has been sent anywhere — there is no
              telemetry server to send it to, by design.
            </p>
            <ul className="space-y-2">
              {crashes.map((crash, index) => (
                <li key={index} className="rounded border p-3">
                  <p className="text-sm font-medium">{crash.message}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    On the {crash.route} screen
                  </p>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      Details
                    </summary>
                    <pre className="mt-2 overflow-x-auto text-xs">
                      {reportText(crash)}
                    </pre>
                  </details>
                </li>
              ))}
            </ul>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={clearCrashes}
            >
              Clear
            </Button>
          </section>
        )}
      </div>
    </ViewShell>
  );
}

function Fact({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p
        className={
          warn
            ? 'mt-0.5 text-sm text-amber-600 dark:text-amber-500'
            : 'mt-0.5 text-sm'
        }
      >
        {value}
      </p>
    </div>
  );
}

/**
 * Whether a reported platform string is Windows.
 *
 * Used only to word one row: "not installed" is a problem on Windows and simply
 * the truth everywhere else, and a warning triangle beside a feature that was
 * never on offer teaches people to ignore warning triangles.
 */
function isWindows(os: string): boolean {
  return os.toLowerCase().includes('windows');
}

/**
 * How long the last few launches took.
 *
 * # Why this is on the diagnostics page and not in a document
 *
 * A cold-start budget written down is a budget nobody checks. Here it is the
 * real numbers from this machine, compared against the target, so "it feels
 * slower than it used to" becomes something anybody can look up.
 *
 * The median is what is compared, not the last launch: one launch that fought
 * a virus scanner should not make the app look broken, and one lucky launch
 * should not make it look fine.
 */
function StartupTimes() {
  const [history, setHistory] = useState<Startup[]>([]);

  useEffect(() => {
    let live = true;
    void recentStartups().then((found) => {
      if (live) setHistory(found);
    });
    return () => {
      live = false;
    };
  }, []);

  if (history.length === 0) return null;

  const paint = median(history.map((entry) => entry.paint));
  const interactive = median(history.map((entry) => entry.interactive));
  const library = median(history.map((entry) => entry.library));

  return (
    <section>
      <h2 className="mb-1 font-display text-lg font-semibold">Startup</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        The median of the last {history.length}{' '}
        {history.length === 1 ? 'launch' : 'launches'} on this machine.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Fact
          label="First paint"
          value={`${paint} ms`}
          warn={paint > BUDGET.paint}
        />
        <Fact
          label="Interactive"
          value={`${interactive} ms`}
          warn={interactive > BUDGET.interactive}
        />
        {/* Never marked as over budget: it is proportional to how much music
            somebody has, so a warning here would be a warning about the size
            of their library rather than about the app. */}
        <Fact
          label="Library ready"
          value={library > 0 ? `${library} ms` : 'no folder'}
        />
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        The targets are {BUDGET.paint} ms to first paint and{' '}
        {BUDGET.interactive} ms to interactive. Nothing enforces them — a budget
        that failed the launch would be worse than a slow launch.
      </p>
    </section>
  );
}
