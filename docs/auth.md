# Authentication

Status: **live on a development instance.** Sign-in works now — email code,
email + password, Google, passkeys, and TOTP two-factor.

## The instance

|              |                                                 |
| ------------ | ----------------------------------------------- |
| Application  | `MadMusic` — `app_3I8Saa8zBSfOfWJlNcD5R8KstKl`  |
| Instance     | development — `ins_3I8SacBKKfFkiV1Q703OQZ14JB1` |
| Frontend API | `careful-alien-2353.clerk.accounts.dev`         |
| Key          | publishable only, in `.env.local` (gitignored)  |

Created as its **own** Clerk application rather than reusing `Kea` or `Veyl`.
Applications are Clerk's isolation boundary — users, sessions, social
connections and keys all belong to exactly one — so MadMusic's users cannot
touch, and are not touched by, anything else on the account.

## What is enabled

Verified against the live instance's `/v1/environment`:

- **Email** — verification code, and password sign-in.
- **Google** — via Clerk's shared development OAuth credentials.
- **Passkeys** — usable as a primary factor.
- **TOTP two-factor** with **backup codes**.
- Disposable email domains blocked; Google shows its account chooser.

Already on by Clerk's defaults, and left alone because they are correct:
bot protection (smart CAPTCHA), user lockout (10 attempts / 60 min), bulk
enumeration protection, PII protection, and a 15-character password minimum.

Reproduce with:

```bash
npx clerk whoami            # confirms account and linked app
npx clerk config pull       # the full instance configuration
```

## What signing in actually buys

Worth stating precisely, because it is less than most apps imply.

|              |                                                                                                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Does**     | Establish identity, so playlists and likes can follow you between devices.                                                                                                                                          |
| **Does not** | Gate anything. There is no MadMusic server — [music-sources.md](music-sources.md) rules one out by name — so every check runs on the user's own machine, in a webview they control, against a bundle they can edit. |
| **Does not** | See your files. Local folders are read on-device; no path, filename or audio leaves it.                                                                                                                             |

**Clerk here is authentication, not authorization.** If a paid tier, a quota or
a rate limit is ever wanted, the enforcement has to live somewhere the user does
not control — which today means it cannot exist at all. Do not add a feature
that assumes otherwise without first adding a server to enforce it.

## Before shipping

Everything above is a **development** instance. Three things change at
production, and none of them are optional:

1. **Your own Google OAuth client.** The shared development credentials show
   Clerk's name on Google's consent screen and are rate limited. Replace them
   under _Social connections → Google_.
2. **Allowed origins.** Development instances accept any origin — which is
   exactly why development keys must never ship. A production instance does
   not, so the desktop origins have to be registered: `tauri://localhost`
   (macOS, Linux) and `http://tauri.localhost` (Windows). Without this, email
   sign-in works in the desktop app and Google hangs after the consent screen.
3. **A new publishable key.** `pk_live_…` replaces `pk_test_…` in the
   production build's environment. `src/lib/auth-config.ts` reports which
   instance a build points at, and Settings → Account shows a warning while it
   is a test one.

## How it is built

| File                                     | Role                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| `src/lib/auth-config.ts`                 | Reads and validates the key. Throws on a secret key, warns on a malformed one. |
| `src/components/auth/auth-context.ts`    | The app-facing seam — a small `useAccount()` with no Clerk types in it.        |
| `src/components/auth/auth-provider.tsx`  | Mounts Clerk when configured; supplies a no-op context when not.               |
| `src/components/auth/sign-in-dialog.tsx` | `<SignIn />` inside the app's own dialog.                                      |
| `src/components/auth/account-menu.tsx`   | The top-bar avatar and its menu.                                               |
| `src/components/auth/auth-appearance.ts` | Maps Clerk's UI onto the app's design tokens.                                  |

Two deliberate choices:

- **Nothing outside `components/auth/` imports Clerk.** Views use
  `useAccount()`. Auth is not a settled decision, and this keeps swapping it a
  contained change rather than a sweep.
- **The app must work signed out.** `configured: false` is an ordinary state,
  not an error. A fresh clone runs before anyone has set up Clerk.

## Security notes

- **No secret key exists in this repository, by design.** `clerk env pull`
  would write one next to the publishable key; it was not used, because there
  is no server for it to authenticate and a secret key sitting in a repo is a
  liability with no corresponding use.
- `auth-config.ts` **throws at boot** if an `sk_` key ever appears in the
  `VITE_`-prefixed variable. Anything with that prefix is compiled into the
  bundle, and in a shipped desktop binary that is a full compromise of the
  instance — it can mint sessions, read every user, and delete them. The guard
  makes that fail on the developer's machine instead of shipping quietly.
- The publishable key is **not** a secret. It identifies the instance and is
  meant to ship. Rotating it is not a security response.
- `dist/` is checked for `sk_` on every build in practice — the bundle contains
  the publishable key (correct) and no secret (verified).
- The Tauri CSP in `src-tauri/tauri.conf.json` allows exactly Clerk's domains
  plus Cloudflare Turnstile for its bot check, and denies `object-src`,
  `frame-ancestors`, and off-origin `form-action` — the last of which stops
  injected markup posting a password field somewhere else.
- Session tokens live in Clerk's own storage and are short-lived. Nothing here
  reads, stores or forwards one — when a backend exists, fetch a fresh token
  per request via `useAuth().getToken()` rather than holding one.
- Avatar images are proxied through `img.clerk.com`, so signing in with Google
  does not leak a request to Google on every render.
- **Tests are hermetic.** `src/test/setup.ts` clears the key, so the suite
  behaves identically with or without `.env.local`. Without that, tests would
  pass locally and fail on a fresh clone for reasons nothing in the diff
  explains.
