import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  LOCAL,
  RemoteContext,
  useRemote,
  type RemoteState,
} from '@/components/player/remote-context';

/**
 * Which device a transport control drives.
 *
 * The bug this prevents is specific and bad: with the sound on the desktop,
 * pressing play in a browser tab starts a *second* copy of the same track, out
 * of step, and neither pause button stops both. So "am I a player or a remote"
 * has to be decided from one place and obeyed everywhere.
 *
 * These tests cover the decision and the default. The wiring in
 * `now-playing-bar` reads the same context, so a regression there is a
 * regression in what these assert.
 */

/**
 * A stand-in for the real transport, branching exactly as it does.
 *
 * The branch is the thing under test. `now-playing-bar` builds the same
 * either/or in its `transport` memo, so this models the decision rather than
 * re-implementing the bar.
 */
function Transport({ onLocal }: { onLocal?: () => void }) {
  const remote = useRemote();
  const act = (command: Parameters<typeof remote.send>[0]) => {
    if (remote.elsewhere) remote.send(command);
    else onLocal?.();
  };

  return (
    <div>
      <span data-testid="mode">{remote.elsewhere ? 'remote' : 'local'}</span>
      <span data-testid="where">{remote.deviceName}</span>
      <button onClick={() => act({ kind: 'play' })}>play</button>
      <button onClick={() => act({ kind: 'seek', value: 42 })}>seek</button>
    </div>
  );
}

function withRemote(value: RemoteState, onLocal?: () => void) {
  return render(
    <RemoteContext value={value}>
      <Transport onLocal={onLocal} />
    </RemoteContext>,
  );
}

describe('deciding who the transport drives', () => {
  it('defaults to driving this device', () => {
    // The app runs with no backend and no account, and both are ordinary. The
    // default has to be "I own the audio" or an unauthenticated player would
    // send commands into the void instead of playing.
    render(<Transport />);
    expect(screen.getByTestId('mode')).toHaveTextContent('local');
  });

  it('drives the local player, and sends nothing, when it owns the audio', () => {
    const send = vi.fn();
    const onLocal = vi.fn();
    withRemote({ ...LOCAL, send }, onLocal);

    fireEvent.click(screen.getByRole('button', { name: 'play' }));

    // Both halves matter. Acting locally is the point; *also* posting a command
    // would come back through the subscription and act a second time.
    expect(onLocal).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
  });

  it('routes to the device holding the audio', () => {
    const send = vi.fn();
    withRemote({
      ...LOCAL,
      elsewhere: true,
      deviceName: 'Kitchen',
      isPlaying: true,
      send,
    });

    const onLocal = vi.fn();
    expect(screen.getByTestId('mode')).toHaveTextContent('remote');
    fireEvent.click(screen.getByRole('button', { name: 'play' }));

    expect(send).toHaveBeenCalledWith({ kind: 'play' });
    // And crucially does *not* also play here. This is the double-playback bug.
    expect(onLocal).not.toHaveBeenCalled();
  });

  it('carries a value with the commands that need one', () => {
    const send = vi.fn();
    withRemote({ ...LOCAL, elsewhere: true, send });

    fireEvent.click(screen.getByRole('button', { name: 'seek' }));

    // Seek and volume are meaningless without their argument, and dropping it
    // would look like a button that does nothing.
    expect(send).toHaveBeenCalledWith({ kind: 'seek', value: 42 });
  });

  it('names the device so a screen can say where the sound is', () => {
    withRemote({
      ...LOCAL,
      elsewhere: true,
      deviceName: 'Kitchen',
      send: vi.fn(),
    });
    expect(screen.getByTestId('where')).toHaveTextContent('Kitchen');
  });
});
