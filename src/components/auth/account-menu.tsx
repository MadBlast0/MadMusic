import { useAccount } from '@/components/auth/auth-context';
import { Info, Settings, Users } from '@/components/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/**
 * The avatar in the top bar, and what sits behind it.
 *
 * # Why it renders even with no account
 *
 * It used to render nothing when auth was unconfigured, and a bare "Sign in"
 * button when signed out — fine while the menu held account actions and
 * nothing else. Settings now lives in here, and settings belong to the app
 * rather than to the session: a fresh clone with no Clerk key still has a
 * theme to change and a library folder to pick. So the menu is always there,
 * and the *contents* vary:
 *
 * - **Not configured** — the menu holds settings, and says nothing about
 *   accounts. A dead sign-in row is still worse than an absent one.
 * - **Loading** — holds the space with a placeholder. Flashing "Sign in" at
 *   somebody who is already signed in is a worse first frame than a blank
 *   circle for 200ms.
 * - **Signed out** — the app rows, then sign in.
 * - **Signed in** — who you are, the app rows, then the account actions.
 */
export function AccountMenu({
  onOpenSettings,
  onOpenDiagnostics,
  settingsCurrent = false,
  diagnosticsCurrent = false,
}: {
  /** Opens the settings screen. This is the only click-path to it. */
  onOpenSettings: () => void;
  /**
   * Opens the diagnostics screen.
   *
   * Also the only click-path to it, and it has to exist: the error boundary
   * tells people the details are on that page, and a page nothing can reach
   * makes that sentence a lie.
   */
  onOpenDiagnostics: () => void;
  /** True while the settings screen is the page you are on. */
  settingsCurrent?: boolean;
  diagnosticsCurrent?: boolean;
}) {
  const {
    configured,
    loading,
    signedIn,
    account,
    signIn,
    signOut,
    manageAccount,
  } = useAccount();

  // Only while auth might still resolve to a session. With no key configured
  // there is nothing to wait for, and the menu should be usable immediately.
  if (configured && loading) {
    return (
      <div
        className="size-9 shrink-0 animate-pulse rounded-full bg-muted"
        aria-hidden="true"
      />
    );
  }

  const initial = (account?.name ?? '?').trim().charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account"
          className={cn(
            'flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full',
            'transition-transform duration-fast hover:scale-105',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            // Signed in, the avatar is the identity and fills the circle.
            // Signed out there is no identity to show, so the trigger reads as
            // the chrome button it is rather than as an empty portrait.
            signedIn
              ? 'bg-accent text-xs font-semibold text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
          )}
        >
          {signedIn ? (
            account?.imageUrl ? (
              <img
                decoding="async"
                src={account.imageUrl}
                alt=""
                className="size-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              initial
            )
          ) : (
            <Users className="size-[1.125rem]" />
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        {signedIn && (
          <>
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="truncate text-sm font-medium">
                {account?.name}
              </span>
              {account?.email && (
                <span className="truncate text-xs font-normal text-muted-foreground">
                  {account.email}
                </span>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}

        {/* First, and above the account actions: it is the row people come
            here for on most openings, and the one that works in every state. */}
        <DropdownMenuItem
          onSelect={onOpenSettings}
          aria-current={settingsCurrent ? 'page' : undefined}
          className="gap-2"
        >
          <Settings className="size-4 shrink-0" />
          Settings
        </DropdownMenuItem>

        <DropdownMenuItem
          onSelect={onOpenDiagnostics}
          aria-current={diagnosticsCurrent ? 'page' : undefined}
          className="gap-2"
        >
          <Info className="size-4 shrink-0" />
          Diagnostics
        </DropdownMenuItem>

        {configured && <DropdownMenuSeparator />}

        {configured &&
          (signedIn ? (
            <>
              <DropdownMenuItem onSelect={manageAccount}>
                Manage account
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={signOut}>Sign out</DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onSelect={signIn}>Sign in</DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
