import { useAccount } from '@/components/auth/auth-context';
import { Users } from '@/components/icons';
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
 * Three states, each rendered rather than approximated:
 *
 * - **Not configured** — renders nothing. A dead control is worse than an
 *   absent one, and the app is fully usable without an account.
 * - **Loading** — holds the space with a placeholder. Flashing "Sign in" at
 *   somebody who is already signed in is a worse first frame than a blank
 *   circle for 200ms.
 * - **Signed in / out** — an avatar menu, or a button.
 */
export function AccountMenu() {
  const {
    configured,
    loading,
    signedIn,
    account,
    signIn,
    signOut,
    manageAccount,
  } = useAccount();

  if (!configured) return null;

  if (loading) {
    return (
      <div
        className="size-8 shrink-0 animate-pulse rounded-full bg-muted"
        aria-hidden="true"
      />
    );
  }

  if (!signedIn) {
    return (
      <button
        type="button"
        onClick={signIn}
        className="flex h-8 shrink-0 items-center gap-2 rounded-full border border-border bg-card px-3 text-xs font-medium transition-colors duration-fast hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Users className="size-3.5" />
        Sign in
      </button>
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
            'flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full',
            'bg-accent text-xs font-semibold text-accent-foreground',
            'transition-transform duration-fast hover:scale-105',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          )}
        >
          {account?.imageUrl ? (
            <img
              decoding="async"
              src={account.imageUrl}
              alt=""
              className="size-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            initial
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{account?.name}</span>
          {account?.email && (
            <span className="truncate text-xs font-normal text-muted-foreground">
              {account.email}
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={manageAccount}>
          Manage account
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={signOut}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
