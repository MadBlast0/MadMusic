import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ErrorBoundary } from '@/components/common/error-boundary';
import { clearCrashes, pendingCrashes } from '@/lib/telemetry';

/**
 * The boundary.
 *
 * What is being proved is one property: a component that throws does not take
 * anything outside the boundary with it. Before this existed, it took the whole
 * application — a blank window with a live process, which somebody experiences
 * as a crash and cannot report.
 */

function Boom({ when = true }: { when?: boolean }): React.ReactNode {
  if (when) throw new Error('the component exploded');
  return <p>recovered</p>;
}

describe('containing a failure', () => {
  beforeEach(() => {
    clearCrashes();
    // React logs the error itself, and so does the boundary. Neither is a test
    // failure; both would drown the output.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a way out instead of a blank screen', () => {
    render(
      <ErrorBoundary what="This screen">
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText(/stopped working/i)).toBeInTheDocument();
    // The message itself, because "something went wrong" is not reportable.
    expect(screen.getByText(/the component exploded/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeVisible();
  });

  it('leaves everything outside it alone', () => {
    // The whole point: the transport keeps playing and the nav still works
    // while one screen is broken.
    render(
      <div>
        <p>the rest of the app</p>
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
      </div>,
    );

    expect(screen.getByText('the rest of the app')).toBeInTheDocument();
  });

  it('records the failure so it can be reported', async () => {
    render(
      <ErrorBoundary what="library">
        <Boom />
      </ErrorBoundary>,
    );

    // The report is built asynchronously — it asks Rust for the version.
    await vi.waitFor(() => expect(pendingCrashes().length).toBeGreaterThan(0));

    const report = pendingCrashes()[0];
    expect(report.message).toContain('exploded');
    expect(report.route).toBe('library');
    // The component stack is the useful half: it names what threw.
    expect(report.stack).toContain('Component stack');
  });

  it('recovers when the cause is gone', async () => {
    // The realistic shape of a transient fault: something *outside* the
    // component was wrong — a half-loaded row, a stale id — and by the time
    // somebody presses Try again it is not any more.
    //
    // Deliberately not modelled as state inside the component: one that throws
    // during its first render never reaches its effects, so it would throw
    // again on every remount and "try again" could never work. That is worth
    // knowing, and it is why the button sits beside Reload rather than alone.
    const user = userEvent.setup();
    let broken = true;

    function DependsOnSomethingElse() {
      return <Boom when={broken} />;
    }

    render(
      <ErrorBoundary>
        <DependsOnSomethingElse />
      </ErrorBoundary>,
    );

    expect(screen.getByText(/stopped working/i)).toBeInTheDocument();

    broken = false;
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(screen.getByText('recovered')).toBeInTheDocument();
  });

  it('shows the fallback again when the cause has not gone', async () => {
    // Try again on a genuinely broken screen must not appear to succeed.
    const user = userEvent.setup();

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(screen.getByText(/stopped working/i)).toBeInTheDocument();
  });

  it('uses a custom fallback where one is given', () => {
    render(
      <ErrorBoundary fallback={() => <p>a smaller apology</p>}>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText('a smaller apology')).toBeInTheDocument();
  });

  it('renders its children untouched when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>ordinary</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText('ordinary')).toBeInTheDocument();
  });
});
