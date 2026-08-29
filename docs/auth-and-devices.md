# Sign-in from the browser, and playback across devices

Two features that look separate and are not. Both need the app to know *who you
are* on more than one machine, and both are built on the same backend session.

This document is the design. It is written before the code so the trade-offs are
arguable rather than implied.

---

## Where things stand

| Piece                | State                                                    |
| -------------------- | -------------------------------------------------------- |
| Web build            | **Works today.** Same bundle; `isNative()` reads Tauri's injected globals at runtime, `store/web.ts` backs the library with `localStorage`, and every backend screen degrades when there is no Convex. |
| Clerk                | Configured — development instance, publishable key in `.env.local`. |
| Convex               | **Written, not deployed.** 349-line schema and eight function files, but no `VITE_CONVEX_URL`, so `backendAvailable` is `false` and none of it runs. |
| Server-side secrets  | **None.** `.env.local` says so outright: "There is no MadMusic server, so the secret key has nothing to sign or verify." |

That last row is the blocker. Both features below need something holding
`CLERK_SECRET_KEY`, and Convex is the natural home for it.

---

## 1. Signing in through the browser

### Why bother

Signing in *inside* the app means authenticating with Google again, in a webview
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
first and will only ever mint a token for *the caller's own* user.

**A ticket, not a session (7).** Clerk sessions are bound to an origin's cookie
jar. The browser's jar and the webview's are different, and there is no
supported way to copy one into the other. A sign-in token is the supported
bridge: single-use, short-lived, and exchanged for a *new* session that belongs
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

### What already exists and is *not* this

`convex/sessions.ts` is **listen together** — several *people* following one
host, each resolving and playing their own copy of the track. Superficially
similar, fundamentally different:

|                | Listen together        | Connect                          |
| -------------- | ---------------------- | -------------------------------- |
| Who            | several users          | one user, several devices        |
| Audio plays on | every follower         | exactly one device               |
| Direction      | host broadcasts        | remotes command the active device |

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

Commands are separate from `playback` because they are *events*, and events
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

Choosing an *output* device — headphones versus speakers on the same machine —
is unrelated and already exists: `engine.rs` enumerates outputs and
`audio-settings` selects one.

---

## What has to happen outside this repository

These are yours; none can be done from the codebase.

1. **Deploy Convex.** `npx convex dev` — creates the project, writes
   `VITE_CONVEX_URL` into `.env.local`, and turns `backendAvailable` true.
   Nothing in section 2 runs until this is done.
2. **Set the Clerk JWT issuer** so Convex trusts Clerk:
   `npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<instance>.clerk.accounts.dev`,
   and create a JWT template named exactly `convex` in the Clerk dashboard.
3. **Set the Clerk secret key on Convex**, for minting tickets:
   `npx convex env set CLERK_SECRET_KEY sk_test_…`. It belongs to the
   deployment's environment and must never enter this repository.
4. **Allow the desktop origin** in Clerk — `http://tauri.localhost` — or the
   in-app fallback sign-in keeps failing the way it already does.
5. **Enable email verification codes** in the Clerk dashboard if you want OTP.
6. **Host the web build** somewhere the browser can reach for step 1 of the
   sign-in flow. Any static host serves `dist/`.
