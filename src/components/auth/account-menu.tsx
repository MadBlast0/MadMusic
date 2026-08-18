import { SignInButton, UserButton, useUser } from '@clerk/react';
import { UserRound } from 'lucide-react';

import { authConfigured } from '@/lib/auth-config';

/**
 * Sign-in affordance for the sidebar.
 *
 * Renders nothing when Clerk has no key, rather than a button that cannot
 * work — a dead control is worse than an absent one.
 *
 * Branching on `useUser` rather than Clerk's `<Show>` component: Core 3
 * replaced the old `<SignedIn>`/`<SignedOut>` pair, and the hook is the part
 * of the surface least likely to be renamed again.
 */
export function AccountMenu() {
  if (!authConfigured) return null;
  return <AccountMenuInner />;
}

function AccountMenuInner() {
  const { isLoaded, isSignedIn } = useUser();

  // Hold the space rather than flashing a sign-in button at someone who is
  // already signed in.
  if (!isLoaded) {
    return <div className="h-11" aria-hidden="true" />;
  }

  if (isSignedIn) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5">
        <UserButton
          showName
          appearance={{
            elements: {
              rootBox: 'w-full',
              userButtonTrigger: 'w-full justify-start rounded-md px-2 py-1.5',
            },
          }}
        />
      </div>
    );
  }

  return (
    <div className="px-2 py-1.5">
      <SignInButton mode="modal">
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/40 hover:text-sidebar-accent-foreground"
        >
          <UserRound className="size-4" />
          Sign in to sync
        </button>
      </SignInButton>
    </div>
  );
}
