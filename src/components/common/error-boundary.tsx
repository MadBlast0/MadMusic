import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { buildReport, recordCrash } from '@/lib/telemetry';

/**
 * Stops one broken component from taking the whole application with it.
 *
 * # Why this was worth adding
 *
 * Because React's default is to unmount *everything* when a render throws and
 * nothing catches it. The result is a blank window with the process still
 * running — which from the outside is indistinguishable from a crash, and gives
 * somebody nothing to report and no way back.
 *
 * That is what happened here. A fault anywhere in the tree ended the session.
 *
 * # Why there are two of them
 *
 * The outer one is the last resort: it catches anything the inner one did not
 * and offers a reload. The inner one wraps only the *view*, so a screen that
 * throws leaves the title bar, the sidebar and the transport working — you can
 * navigate away from a broken page and keep listening, which is the difference
 * between an annoyance and a lost session.
 *
 * # Why it is a class
 *
 * Because there is no hook equivalent. `componentDidCatch` and
 * `getDerivedStateFromError` are the only way to catch a render error, and
 * React has been explicit that this will not change.
 *
 * # What it does with the error
 *
 * Records it locally through the same path the global handler uses, so the
 * Diagnostics page can show it. Recording is unconditional and *sending* is
 * what the telemetry setting governs — somebody with telemetry off who wants to
 * file a bug should still be able to find the report.
 */
type Props = {
  children: ReactNode;
  /** What broke, for the message. "This screen" reads better than "the app". */
  what?: string;
  /** Shown instead of the default panel, for a boundary inside a small area. */
  fallback?: (reset: () => void) => ReactNode;
};

type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Through `buildReport` rather than assembled here, because that is what
    // strips anything path-shaped out of the message and the stack. The privacy
    // page promises no library paths ever appear in a report, and a boundary
    // that built its own would be the one place that broke the promise.
    //
    // The component stack is attached to the error first, so it goes through
    // the same scrubbing: it names the component that threw, which the message
    // alone does not.
    const withStack = new Error(error.message);
    withStack.stack = `${error.stack ?? ''}\n\nComponent stack:${info.componentStack ?? ''}`;

    void buildReport(withStack, this.props.what ?? 'unknown').then(recordCrash);

    // Also to the console, because that is where a developer looks first and
    // React's own message is suppressed once a boundary handles it.
    console.error('A component failed:', error, info.componentStack);
  }

  /**
   * Clears the error so the children mount again.
   *
   * Worth offering rather than only a reload: most render errors come from one
   * piece of bad state, and navigating elsewhere and back is enough. A reload
   * loses the queue and the current track.
   */
  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(this.reset);

    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="max-w-md">
          <h2 className="font-display text-lg font-semibold">
            {this.props.what ?? 'Something'} stopped working
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            The rest of the app is still running — your music has not stopped.
            The details are on the Diagnostics page if you want to report it.
          </p>
          <p className="mt-3 rounded-md bg-muted px-3 py-2 text-left font-mono text-xs break-words text-muted-foreground">
            {error.message || String(error)}
          </p>
        </div>

        <div className="flex gap-2">
          <Button size="sm" onClick={this.reset}>
            Try again
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.location.reload()}
          >
            Reload
          </Button>
        </div>
      </div>
    );
  }
}
