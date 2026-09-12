import { Check, Download, Spinner } from '@/components/icons';
import { IconButton } from '@/components/icons/icon-button';
import { useDownload, type Downloadable } from '@/hooks/use-download';
import { cn } from '@/lib/utils';

/**
 * A track's download control, the same everywhere it appears.
 *
 * # What it draws, and why each state looks the way it does
 *
 * - **Not downloaded:** an arrow. Quiet by default — on a row it only shows
 *   on hover — because a column of forty download arrows is noise on a list
 *   where most rows are not going to be downloaded.
 * - **Downloading:** a spinner, always visible and not pressable. It is doing
 *   something the user started, and an icon that hid itself mid-download would
 *   look like it had stopped.
 * - **Downloaded:** a tick in the accent colour, always visible. The whole point
 *   of downloading is knowing it is there for later, so this is the one state
 *   that must be readable at a glance down a long list.
 * - **Failed:** the arrow again, in the destructive colour, with the reason in
 *   the label. Pressing it retries.
 *
 * Renders nothing for a track that cannot be downloaded — a local file, which
 * is already on disk, or anything in a browser — rather than a disabled button
 * that promises something it can never do.
 */
export function DownloadButton({
  track,
  size = 'sm',
  reveal = false,
  className,
}: {
  track: Downloadable;
  size?: 'sm' | 'md';
  /**
   * Whether the idle arrow waits for hover.
   *
   * True inside a row, where the row's own `group` hover reveals it. False on
   * the player bar, where there is one track and the control should simply be
   * there.
   */
  reveal?: boolean;
  className?: string;
}) {
  const { supported, statusOf, toggle } = useDownload();

  if (!supported || !track.handle) return null;

  const status = statusOf(track.handle);

  const label =
    status === 'downloading'
      ? `Downloading ${track.title}`
      : status === 'downloaded'
        ? `Remove the download of ${track.title}`
        : status === 'failed'
          ? `The download of ${track.title} failed. Try again`
          : `Download ${track.title}`;

  return (
    <IconButton
      label={label}
      size={size}
      disabled={status === 'downloading'}
      active={status === 'downloaded'}
      onClick={(event) => {
        // Rows are themselves buttons that play; a press on this must not also
        // start the track it is sitting in.
        event.stopPropagation();
        toggle(track);
      }}
      className={cn(
        // Hidden until the row is hovered or focused — but never while a
        // download is in flight or done, which are the states worth seeing.
        reveal &&
          status === 'none' &&
          'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
        status === 'failed' && 'text-destructive',
        className,
      )}
    >
      {status === 'downloading' ? (
        <Spinner className="size-4" />
      ) : status === 'downloaded' ? (
        <Check className="size-4" />
      ) : (
        <Download className="size-4" />
      )}
    </IconButton>
  );
}
