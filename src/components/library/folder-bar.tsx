import { Folder, FolderOpen, Spinner } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { IconButton } from '@/components/icons/icon-button';
import { revealFolder } from '@/lib/desktop';

/**
 * Where the music lives, said out loud.
 *
 * # Why this exists
 *
 * The folder was named but never located. The library page showed the folder's
 * *name* as its title — "Music", or "D", or "New folder (2)" — and offered a
 * bare refresh icon to change it. Neither told the user which directory on
 * which disk they were looking at, and the icon did not look like a control for
 * choosing one.
 *
 * That matters more here than in most players, because this one folder is two
 * things at once: it is what gets scanned into the library, *and* it is where
 * downloads are written. Somebody who cannot see the path cannot answer "where
 * did my download go", which is the question the row exists to pre-empt.
 *
 * # The path, when it is long
 *
 * Truncated at the start rather than the end. The end of a path is the part
 * that identifies it — `…\Users\Sam\Music` says everything, `C:\Users\Sam\Do…`
 * says nothing — so the ellipsis goes on the left and the tail is what
 * survives. The full path is in the tooltip and in the accessible name either
 * way.
 */
export function FolderBar({
  name,
  path,
  located,
  picking,
  onChoose,
  onOpenDownloads,
}: {
  name: string;
  /** The absolute path, when there is one. */
  path: string;
  /**
   * Whether that path is a real location.
   *
   * Decided by the *source*, not by the shell: the File System Access API in a
   * browser hands back a handle and a folder name with no location behind it,
   * so there is nothing to show and nothing to open. Showing the name where the
   * path goes would just say the folder's name twice.
   */
  located: boolean;
  picking: boolean;
  onChoose: () => void;
  /**
   * Opens the download activity, when there is any to open.
   *
   * Given only on the desktop. Downloads are written *into* this folder rather
   * than into a second one of their own, so the link belongs on the row that
   * names the folder — that is what makes the two one thing rather than two
   * places that happen to agree.
   */
  onOpenDownloads?: () => void;
}) {
  const hasPath = located && path !== '' && path !== name;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded bg-accent/40 text-muted-foreground">
        <Folder className="size-4" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted-foreground">
          Music folder
          {onOpenDownloads ? (
            <>
              {' · '}
              <button
                type="button"
                onClick={onOpenDownloads}
                className="underline underline-offset-2 transition-colors duration-fast hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                downloads are saved here
              </button>
            </>
          ) : (
            ' · downloads are saved here'
          )}
        </span>

        {hasPath ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                // `direction: rtl` puts the browser's own ellipsis at the
                // start, so a long path keeps its tail — the part that
                // identifies it. The isolate keeps the text itself reading
                // left to right so a Windows path is not shown backwards.
                //
                // `text-left` is not redundant: `rtl` also moves the line box
                // to the right edge, which parked the path against the buttons
                // with the label stranded on the other side of the row.
                dir="rtl"
                className="block truncate text-left font-mono text-sm font-medium"
                // No `title`. The tooltip below already says this, and leaving
                // the native one on shows both, a second apart, saying the
                // same path.
              >
                <bdi>{path}</bdi>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-md break-all">
              {path}
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className="block truncate text-sm font-medium">{name}</span>
        )}
      </span>

      {hasPath && (
        <IconButton
          label="Show this folder on the desktop"
          size="sm"
          onClick={() => void revealFolder(path)}
        >
          <FolderOpen className="size-4" />
        </IconButton>
      )}

      {/* A labelled button, not an icon. Choosing where the library reads from
          is the one action this row has, and the icon it used to be was
          indistinguishable from a rescan. */}
      <Button
        animate
        size="sm"
        variant="outline"
        disabled={picking}
        onClick={onChoose}
      >
        {picking ? (
          <Spinner className="size-4" />
        ) : (
          <Folder className="size-4" />
        )}
        {picking ? 'Choosing…' : 'Change'}
      </Button>
    </div>
  );
}
