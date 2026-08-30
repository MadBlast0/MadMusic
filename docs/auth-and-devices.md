# Sign-in from the browser, and playback across devices

Two features that look separate and are not. Both need the app to know _who you
are_ on more than one machine, and both are built on the same backend session.

This document is the design. It is written before the code so the trade-offs are
arguable rather than implied.

---

## Where things stand

| Piece               | State                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web build           | **Works today.** Same bundle; `isNative()` reads Tauri's injected globals at runtime, `store/web.ts` backs the library with `localStorage`, and every backend screen degrades when there is no Convex. Verified: no static `@tauri-apps` import exists anywhere in `src`, and of 68 built chunks only the attributions page names one, as licence text. |
| Clerk               | Configured — development instance, publishable key in `.env.local`. Sign-in works. The Convex handshake does not yet exist; those are different things, and the section at the end says why.                                                                                                                                                            |
| Convex              | **Written, compiles, runs under test — not deployed.** No `VITE_CONVEX_URL`, so `backendAvailable` is `false` and none of it runs against a real deployment.                                                                                                                                                                                            |
| Server-side secrets | **None in this repository, deliberately.** `CLERK_SECRET_KEY` belongs to the Convex deployment's environment.                                                                                                                                                                                                                                           |

### What is proven, and how

Worth separating, because "the code exists" and "the code works" are not the
same claim, and this document made the first one for a long time while reading
like the second.

| Claim                                              | Proven by                                                                           |
| -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| The backend compiles against its own schema        | `pnpm typecheck` now covers `convex/`; a bad table, index or field fails            |
| The 40 function names the app calls resolve        | `src/lib/backend-api.test.ts`                                                       |
| Devices list, report, command, transfer, isolation | `convex/devices.test.ts` — the real functions, executed                             |
| The ticket mint refuses and signs correctly        | `convex/desktopAuth.test.ts` — including that it mints only for the verified caller |
| A ticket arriving before the app is running        | `src-tauri/src/cli.rs` tests — held and drained exactly once                        |

| Still unproven                              | Why it cannot be proven here                                     |
| ------------------------------------------- | ---------------------------------------------------------------- |
| Two real machines seeing each other         | Needs a server between them. No in-memory harness is a network.  |
| Clerk's token accepted by Convex            | Needs the JWT template below, and a deployment to verify against |
| The OAuth round trip through a real browser | Needs the hosted page at `VITE_WEB_ORIGIN`                       |

That last table is the blocker, and every row of it is one deployment away.

---

## 1. Signing in through the browser

### Why bother

Signing in _inside_ the app means authenticating with Google again, in a webview
that shares no cookies with the browser where you are already signed in. The
browser route turns that into one click on an account chooser.

This is what Spotify, Slack and Discord do on desktop, and the mechanism is
always the same shape: **the browser holds the session, and hands the app a
short-lived credential to exchange for its own.**

### The flow

```
desktop app                 system browser              Convex                Clerk
     |                            |                       |                     |
 1.  | generate `state`           |                       |                     |
     | open browser ------------->|                       |                     |
     |                            | 2. already signed in? |                     |
     |                            |    if not, sign in ---+-------------------->|
     |                            |                       |                     |
     |                            | 3. mintDesktopTicket ->|                     |
     |                            |                       | 4. POST /v1/        |
     |                            |                       |    sign_in_tokens ->|
     |                            |<-- ticket ------------|<-- token -----------|
     |                            |                       |                     |
     | 5. madmusic://auth?ticket=…&state=…                 |                     |
     |<---------------------------|                       |                     |
     |                            |                       |                     |
 6.  | verify `state`             |                       |                     |
 7.  | signIn.create({ strategy: 'ticket', ticket }) ------+-------------------->|
 8.  | setActive({ session })     |                       |                     |
```

### Why each step is there

**`state` (1, 6).** A random value the app generates, keeps in memory, and
requires back. Without it, any web page — or any local program that registers
the `madmusic://` scheme first — could push a ticket at the app and sign it in
as somebody else. The app must only accept a ticket it asked for.

**The mint happens on the server (3, 4).** Sign-in tokens are minted with
`CLERK_SECRET_KEY`. A secret key in a desktop binary is not a secret; anybody
with the app has it, and with it they can mint a token for **any user id**. So
the mint lives in a Convex action, which checks `ctx.auth.getUserIdentity()`
first and will only ever mint a token for _the caller's own_ user.

**A ticket, not a session (7).** Clerk sessions are bound to an origin's cookie
jar. The browser's jar and the webview's are different, and there is no
supported way to copy one into the other. A sign-in token is the supported
bridge: single-use, short-lived, and exchanged for a _new_ session that belongs
to the webview.

### What is genuinely weak about it, stated plainly

The ticket travels through a custom-scheme URL. On a machine where another
program has also registered `madmusic://`, that program may receive it. The
mitigations are real but not absolute:

- **Single use.** Redeeming it invalidates it.
- **Short TTL.** Minted at 60 seconds, not Clerk's 30-day default.
- **Bound to `state`.** A ticket delivered without the state this app generated
  is discarded.

A stricter design would use a loopback HTTP listener with PKCE (what the OAuth
native app BCP recommends) instead of a custom scheme. That is a larger change —
it needs a local server in the Rust side — and is the obvious next increment if
this ever holds anything more sensitive than a music library.

### Email codes

Clerk's free plan includes **email verification codes** (OTP) as a first-class
strategy. It is a dashboard setting, not code: enabling it makes `<SignIn />`
offer it automatically. Nothing in this app needs to change.

---

## 2. Playback across devices

The Spotify Connect behaviour: every device you are signed in on can see what is
playing, control it, and take it over.

### What already exists and is _not_ this

`convex/sessions.ts` is **listen together** — several _people_ following one
host, each resolving and playing their own copy of the track. Superficially
similar, fundamentally different:

|                | Listen together | Connect                           |
| -------------- | --------------- | --------------------------------- |
| Who            | several users   | one user, several devices         |
| Audio plays on | every follower  | exactly one device                |
| Direction      | host broadcasts | remotes command the active device |

They share a shape — a reactive row holding "what is playing and where" — and
nothing else. Keeping them separate is deliberate; folding them together would
give both features a conditional for every field.

### The data

Three tables.

**`devices`** — one row per installation, per user.

```
userId, deviceId, name, kind ('desktop' | 'web' | 'mobile'),
canPlay, lastSeenAt
```

`deviceId` is generated once per install and persisted locally, so reinstalling
gives you a new device rather than resurrecting an old one. `lastSeenAt` is a
heartbeat: a device that has not checked in for a couple of minutes is shown as
offline rather than deleted, because deleting it would lose its name.

**`playback`** — exactly one row per user. The single source of truth for what
that account is doing.

```
userId, activeDeviceId, trackId, title, artist, artworkUrl,
positionMs, durationMs, isPlaying, volume, updatedAt
```

Title, artist and artwork are **denormalised on purpose**. A phone showing "now
playing on Desktop" must not have to resolve a catalogue handle to render a row;
it may not even have the catalogue available. The cost is a few dozen bytes
written every few seconds; the benefit is that a remote renders instantly and
offline.

**`playbackCommands`** — a queue, not a state.

```
userId, targetDeviceId, kind, payload, createdAt, consumedAt
```

Commands are separate from `playback` because they are _events_, and events
folded into state are lost when two arrive between renders. `consumedAt` rather
than deletion, so the issuing device can tell "obeyed" from "not delivered yet".

### The loop

- Every client **registers** its device on load and heartbeats every 30s.
- The **active device** writes `playback` on every state change, and every ~5s
  while playing so the position stays honest.
- Every client **subscribes** to `playback` and renders "Playing on <name>"
  when the active device is not itself.
- A remote **issues a command** to `playbackCommands` targeting the active
  device. It does not touch `playback` — only the device that owns the audio
  writes that, so there is one writer and no reconciliation.
- The active device **subscribes to its own commands**, executes them, marks
  them consumed, and the resulting state change flows back through `playback`.

**Transfer** is a command like any other: `{ kind: 'transfer', to: deviceId }`.
The named device starts playing at `positionMs` and claims `activeDeviceId`; the
old one pauses when it sees it is no longer active.

### Why one writer matters

Two devices writing `playback` produces a fight: the phone says paused at 1:04,
the desktop says playing at 1:07, and whichever wrote last wins until the other
writes again. Routing every remote action through a command queue means the
device that actually owns the audio is the only thing that ever describes it.

### What this cannot do

**It does not move audio between devices.** Transfer means the new device starts
playing the same track from the same position — it resolves and plays its own
copy, exactly as listen-together does. Streaming audio from one device to
another is a different product with a different licensing problem, and
`stream.rs` already explains why the app does not rebroadcast.

Choosing an _output_ device — headphones versus speakers on the same machine —
is unrelated and already exists: `engine.rs` enumerates outputs and
`audio-settings` selects one.

---

## What has to happen outside this repository

None of this can be done from the codebase — it is all account and dashboard
work. About fifteen minutes.

### First, the confusing part: why Clerk needs a JWT template

Clerk already proves who you are **to the app**. That is the sign-in that works
today, and it is genuinely finished.

It does not prove anything **to Convex**. The app runs on the user's own
machine, in a webview they control, against a bundle they can edit — so when it
tells a server "I am this user", the server has no reason to believe it. A
backend that trusted that claim would let anybody read anybody's data by
editing one line of JavaScript.

A JWT template is how Clerk hands the app a **signed token** that Convex can
verify by itself, against Clerk's public keys, without asking the app anything
at all. Convex then derives the caller's identity from the signature. That is
why every function in `convex/` reads the user from `ctx.auth` and never from an
argument, and why `mintTicket` takes no arguments whatsoever.

It must be named exactly `convex`, lower case. That is not a label — it is the
key the Convex client asks Clerk for by name. A template called `Convex` or
`convex-jwt` is the same as no template at all.

**Symptom if you skip it:** sign-in appears to work, and then every backend call
from a signed-in user fails authentication. Devices never appear, and nothing on
screen says why.

### The steps

1. **Deploy Convex.** `npx convex dev` from the repo root. It creates the
   project, writes `CONVEX_DEPLOYMENT` and `VITE_CONVEX_URL` into `.env.local`,
   generates `convex/_generated`, and turns `backendAvailable` true.

   It creates a **new project** under whichever team you choose, and does not
   touch existing ones.

2. **Create the JWT template.** Clerk dashboard → **Configure** → **JWT
   Templates** → **New template** → choose the **Convex** preset. Name it
   exactly `convex`. Save, and copy the **Issuer** URL it shows — it looks like
   `https://something-here.clerk.accounts.dev`.

3. **Tell Convex which issuer to trust:**

   ```
   npx convex env set CLERK_JWT_ISSUER_DOMAIN https://something-here.clerk.accounts.dev
   ```

   This is what `convex/auth.config.ts` reads. Left unset it defaults to an
   empty string, which fails closed: no token verifies, so nothing is exposed to
   an unauthenticated caller.

4. **Give Convex the Clerk secret key**, which is what mints sign-in tickets:

   ```
   npx convex env set CLERK_SECRET_KEY sk_test_...
   ```

   From Clerk → **API keys** → Secret key.

   **It must never enter this repository.** A secret key inside a desktop binary
   is not a secret: anybody with the app has it, and with it can mint a session
   for _any user in the instance_. It belongs to the deployment's environment
   and nowhere else. `convex/desktopAuth.test.ts` asserts the function fails
   loudly, and by name, when it is missing — rather than producing something
   broken further down.

5. **Allow the desktop origin.** Clerk → **Domains** (allowed origins) → add
   `http://tauri.localhost`. Without it the in-app fallback sign-in fails on the
   OAuth return trip, which looks like a broken account rather than a missing
   setting.

6. **Enable email codes**, if you want OTP. Clerk → **User & Authentication** →
   **Email, Phone, Username** → Email address → turn on **Email verification
   code**. There is nothing to write here: `<SignIn />` renders the entire OTP
   flow once the instance offers it, which is why no code in this repository
   implements one.

7. **Host the web build** and point the app at it:

   ```
   pnpm build
   ```

   Deploy `dist/` to any static host, then set `VITE_WEB_ORIGIN` to that URL.
   This is the page the desktop app opens in the browser (`/desktop-link`), and
   step 1 of the sign-in flow does not exist without it.

### How to tell it worked

- `backendAvailable` becomes true, so the devices control appears in the
  now-playing bar instead of staying hidden.
- Open the app on two machines — or one desktop and one browser tab — signed
  into the same account. Play something on one; the other should name the track
  and show "Playing on _that device_".
- Press pause on the second. The first should stop, and the second should never
  start playing. That is the single-writer rule, and it is exactly what
  `convex/devices.test.ts` checks in memory.
- Sign out, close the app entirely, and sign in from the browser page. The app
  should open already signed in — that is the cold-start path fixed in
  `cli.rs`, and the one that used to drop the ticket silently.
