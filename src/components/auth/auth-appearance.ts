/**
 * Maps Clerk's UI onto MadMusic's design tokens.
 *
 * Clerk renders its own sign-in surfaces, and out of the box they look like
 * Clerk rather than like this app — a white card with its own blue, its own
 * radii and its own type. Handing it CSS variables instead of hex values means
 * it follows the mode and the accent the user chose, including AMOLED and a
 * custom colour, without a second palette to keep in sync.
 *
 * Kept out of the provider component so that file exports only components and
 * Fast Refresh keeps working.
 */

/** Clerk's `appearance` prop is loosely typed; this is the shape we pass. */
export const clerkAppearance = {
  layout: {
    // Clerk's own wordmark under our dialog reads as a third-party embed.
    logoPlacement: 'none',
    socialButtonsPlacement: 'top',
    socialButtonsVariant: 'blockButton',
    showOptionalFields: false,
    // Their defaults link to Clerk's pages, which do not exist for this app.
    termsPageUrl: undefined,
    privacyPageUrl: undefined,
  },
  variables: {
    colorPrimary: 'var(--primary)',
    colorBackground: 'var(--popover)',
    colorText: 'var(--popover-foreground)',
    colorTextSecondary: 'var(--muted-foreground)',
    colorInputBackground: 'var(--input)',
    colorInputText: 'var(--foreground)',
    colorDanger: 'var(--destructive)',
    colorSuccess: 'var(--primary)',
    borderRadius: 'var(--radius)',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.875rem',
  },
  elements: {
    // The dialog already supplies the surface, the shadow and the padding.
    rootBox: 'w-full',
    cardBox: 'w-full shadow-none border-0',
    card: 'bg-transparent shadow-none p-0 gap-5',
    header: 'gap-1',
    headerTitle: 'text-lg font-semibold tracking-tight',
    headerSubtitle: 'text-sm text-muted-foreground',
    socialButtonsBlockButton:
      'border border-border bg-card hover:bg-accent/40 text-foreground normal-case font-medium',
    socialButtonsBlockButtonText: 'font-medium',
    dividerLine: 'bg-border',
    dividerText: 'text-muted-foreground text-xs',
    formFieldLabel: 'text-sm font-medium text-foreground',
    formFieldInput:
      'bg-input border-border text-foreground placeholder:text-muted-foreground',
    formButtonPrimary:
      'bg-primary text-primary-foreground hover:brightness-110 normal-case font-semibold shadow-none',
    footerActionText: 'text-muted-foreground text-sm',
    footerActionLink: 'text-primary font-medium hover:underline',
    identityPreviewEditButton: 'text-primary',
    // Clerk's "Secured by Clerk" strip. Removing it is permitted on paid
    // plans only; on the free tier it stays and this is a no-op.
    footer: 'bg-transparent',
  },
} as const;
