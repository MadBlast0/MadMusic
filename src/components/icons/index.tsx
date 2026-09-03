/**
 * The app's icon set.
 *
 * Vendored rather than imported from `lucide-react` at every call site, for
 * three reasons that only became clear after surveying what is available:
 *
 * 1. **The animated sets do not cover a music player.** The canonical
 *    Motion-based collection (lucide-animated, 466 icons) has Play, Pause and
 *    Volume but no Shuffle, Repeat, SkipBack, SkipForward, Music2 or
 *    ListMusic — precisely the transport controls. Owning the set is the only
 *    way to have a complete and consistent one.
 * 2. **Their generated components fight the codebase.** They render a wrapping
 *    `<div>` rather than an `<svg>`, which breaks `button.tsx`'s
 *    `[&_svg:not([class*='size-'])]:size-4` sizing; they take `size` as a
 *    number rather than a Tailwind class; and they set `fill="none"`, which
 *    would turn the filled play triangle used in eight places into an outline.
 * 3. **Animation belongs to the parent, not the icon.** Motion propagates
 *    variants down the tree, so a button declaring `whileHover="hover"` drives
 *    every animated part inside it. That is far cheaper than giving each icon
 *    its own `useAnimation` controller and its own hover listeners, and it
 *    means the whole *button* is the hover target rather than the 16px glyph.
 *
 * Geometry is Lucide's, which keeps the visual language the app already has.
 *
 * **Where these may be used:** chrome only — title bar, sidebar, transport,
 * toolbars, empty states. List rows and grid cells use the `Static*` exports,
 * because a virtualised 1,000-row list would otherwise mount 1,000 Motion
 * components to draw the same paths.
 */

import type { SVGProps } from 'react';
import { m, type Variants } from 'motion/react';

import { duration, ease } from '@/lib/motion';
import { cn } from '@/lib/utils';

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

/**
 * Shared frame. `size-4` is a default the caller can override, matching how
 * every existing call site already sizes its icons.
 */
function Frame({ className, children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn('size-4', className)}
      {...props}
    >
      {children}
    </svg>
  );
}

/** Solid glyphs — play, pause, skip. A filled triangle reads at 14px; an
 *  outlined one does not. */
function Solid({ className, children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      focusable="false"
      className={cn('size-4', className)}
      {...props}
    >
      {children}
    </svg>
  );
}

const t = { duration: duration.base, ease: ease.enter } as const;

/* ═════════════════════════ transport ═════════════════════════ */

export function Play({ className, ...props }: IconProps) {
  return (
    <Solid className={className} {...props}>
      {/* Nudged right because a triangle's optical centre sits left of its
          bounding box. Baked into the path so no call site has to remember
          `translate-x-px`. */}
      <path d="M8.5 5.2v13.6L19.5 12z" />
    </Solid>
  );
}

export function Pause({ className, ...props }: IconProps) {
  return (
    <Solid className={className} {...props}>
      <path d="M6.5 4.8h3.6v14.4H6.5zM13.9 4.8h3.6v14.4h-3.6z" />
    </Solid>
  );
}

/** Play and pause as one glyph, so the transport morphs rather than swapping. */
export function PlayPause({
  playing,
  className,
  ...props
}: IconProps & { playing: boolean }) {
  return (
    <m.svg
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      focusable="false"
      className={cn('size-4', className)}
      {...(props as object)}
    >
      {/* Two paths that morph between the pause bars and the two halves of the
          play triangle, so each keeps four points and the tween stays smooth.

          Both used to animate to the *same* narrow triangle spanning x 8.5-14,
          which drew the play glyph twice at half the width of the pause bars
          and put its centroid at x=10.3 against a viewBox centre of 12 — small,
          and visibly shifted left inside a round button.

          Now they are the left trapezoid and the right tip of one triangle
          spanning 8.7-18.7. A right-pointing triangle carries its mass on the
          flat side, so it is placed by centroid rather than by bounding box:
          (8.7 + 8.7 + 18.7) / 3 = 12.03, which is the centre. */}
      <m.path
        initial={false}
        animate={{
          d: playing
            ? 'M6.5 4.8L10.1 4.8L10.1 19.2L6.5 19.2Z'
            : 'M8.7 4.8L12 7.2L12 16.8L8.7 19.2Z',
        }}
        transition={t}
      />
      <m.path
        initial={false}
        animate={{
          d: playing
            ? 'M13.9 4.8L17.5 4.8L17.5 19.2L13.9 19.2Z'
            : 'M12 7.2L18.7 12L18.7 12L12 16.8Z',
        }}
        transition={t}
      />
    </m.svg>
  );
}

const skipBar: Variants = {
  hover: { x: 1.5, transition: { duration: duration.fast, ease: ease.move } },
};
const skipBarBack: Variants = {
  hover: { x: -1.5, transition: { duration: duration.fast, ease: ease.move } },
};

export function SkipForward({ className, ...props }: IconProps) {
  return (
    <Solid className={className} {...props}>
      <m.path variants={skipBar} d="M16.5 5h2.2v14h-2.2z" />
      <m.path variants={skipBar} d="M5.3 5.4 15 12l-9.7 6.6z" />
    </Solid>
  );
}

export function SkipBack({ className, ...props }: IconProps) {
  return (
    <Solid className={className} {...props}>
      <m.path variants={skipBarBack} d="M5.3 5h2.2v14H5.3z" />
      <m.path variants={skipBarBack} d="M18.7 5.4 9 12l9.7 6.6z" />
    </Solid>
  );
}

/** The crossing arrows swap on hover — the gesture the icon describes. */
export function Shuffle({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <m.g
        variants={{
          hover: { x: 1, transition: { duration: duration.fast } },
        }}
      >
        <path d="M16 3h5v5" />
        <path d="M21 16v5h-5" />
      </m.g>
      <path d="M4 20 21 3" />
      <path d="m15 15 6 6" />
      <path d="M4 4l5 5" />
    </Frame>
  );
}

export function Repeat({
  className,
  one = false,
  ...props
}: IconProps & { one?: boolean }) {
  return (
    <Frame className={className} {...props}>
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
      {/* A numeral rather than a second colour: repeat-one and repeat-all must
          be distinguishable without relying on hue. */}
      {one && (
        <text
          x="12"
          y="15.4"
          textAnchor="middle"
          fontSize="9"
          fontWeight="700"
          fill="currentColor"
          stroke="none"
        >
          1
        </text>
      )}
    </Frame>
  );
}

export function Volume({
  level,
  className,
  ...props
}: IconProps & { level: 'muted' | 'low' | 'high' }) {
  return (
    <Frame className={className} {...props}>
      <path d="M11 5 6 9H2v6h4l5 4z" />
      {level === 'muted' ? (
        <>
          <path d="m22 9-6 6" />
          <path d="m16 9 6 6" />
        </>
      ) : (
        <>
          <m.path
            d="M15.5 8.5a5 5 0 0 1 0 7"
            variants={{
              hover: { opacity: [1, 0.35, 1], transition: { duration: 0.5 } },
            }}
          />
          {level === 'high' && (
            <m.path
              d="M19 5a9 9 0 0 1 0 14"
              variants={{
                hover: {
                  opacity: [1, 0.35, 1],
                  transition: { duration: 0.5, delay: 0.08 },
                },
              }}
            />
          )}
        </>
      )}
    </Frame>
  );
}

export function Queue({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <path d="M3 6h13" />
      <path d="M3 12h9" />
      <path d="M3 18h9" />
      <m.path
        d="m16 12 5 3-5 3z"
        fill="currentColor"
        stroke="none"
        variants={{
          hover: { x: 1.5, transition: { duration: duration.fast } },
        }}
      />
    </Frame>
  );
}

export function Heart({
  filled = false,
  className,
  ...props
}: IconProps & { filled?: boolean }) {
  return (
    <m.svg
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn('size-4', className)}
      variants={{ hover: { scale: 1.14 }, tap: { scale: 0.88 } }}
      {...(props as object)}
    >
      <path d="M12 21s-7.5-4.6-9.3-9A5.2 5.2 0 0 1 12 6.6 5.2 5.2 0 0 1 21.3 12c-1.8 4.4-9.3 9-9.3 9Z" />
    </m.svg>
  );
}

/* ═════════════════════════ navigation / chrome ═════════════════════════ */

export function PanelLeft({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <m.path
        d="M9 3v18"
        variants={{
          hover: { x: -1.5, transition: { duration: duration.fast } },
        }}
      />
    </Frame>
  );
}

/**
 * A microphone. Podcasts in the destinations list, and lyrics in the player.
 *
 * The capsule lifts slightly on hover rather than pulsing: a microphone that
 * animates like it is listening while it is not is a small lie about what the
 * app is doing.
 */
export function Mic({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <m.rect
        x="9"
        y="2"
        width="6"
        height="11"
        rx="3"
        variants={{ hover: { y: -1, transition: t } }}
      />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
      <path d="M12 18v4" />
      <path d="M8 22h8" />
    </Frame>
  );
}

export function Search({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <m.circle
        cx="11"
        cy="11"
        r="8"
        variants={{ hover: { scale: 0.92, transition: t } }}
        style={{ transformOrigin: '11px 11px' }}
      />
      <m.path
        d="m21 21-4.3-4.3"
        variants={{ hover: { x: 1, y: 1, transition: t } }}
      />
    </Frame>
  );
}

export function ArrowLeft({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <m.g
        variants={{ hover: { x: -2, transition: { duration: duration.fast } } }}
      >
        <path d="m12 19-7-7 7-7" />
        <path d="M19 12H5" />
      </m.g>
    </Frame>
  );
}

export function ArrowRight({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <m.g
        variants={{ hover: { x: 2, transition: { duration: duration.fast } } }}
      >
        <path d="M5 12h14" />
        <path d="m12 5 7 7-7 7" />
      </m.g>
    </Frame>
  );
}

/**
 * A single continuous outline rather than a roof drawn over a box.
 *
 * The previous version split the shape into two paths that met at the eaves,
 * so the join showed as a nick at small sizes and the two halves picked up
 * their stroke caps separately.
 */
export function Home({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <m.g variants={{ hover: { y: -1, transition: t } }}>
        <path d="M4 10.6 12 3.6l8 7v8.6a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 19.2z" />
        <path d="M9.6 21v-6.2h4.8V21" />
      </m.g>
    </Frame>
  );
}

/**
 * Records on a shelf, leaning.
 *
 * The old icon was Lucide's generic "library" — a box with a note in it, which
 * reads as a media *player* rather than a collection, and is nearly
 * indistinguishable from the album placeholder used elsewhere. Sleeves at an
 * angle say "a lot of music, filed" at 16px, which is the actual meaning of
 * this destination.
 */
export function Library({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <m.g variants={{ hover: { x: 1, transition: t } }}>
        <path d="M4 4.5v15" />
        <path d="M8.4 4.5v15" />
        <path d="m12.8 4.9 4.6 14.3" />
      </m.g>
      <path d="M2.6 20.4h18.8" />
    </Frame>
  );
}

export function Users({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </Frame>
  );
}

export function Disc({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6.5 8.5h.01" />
      <path d="M17.5 15.5h.01" />
    </Frame>
  );
}

export function Plus({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <m.g
        variants={{ hover: { rotate: 90, transition: t } }}
        style={{ transformOrigin: '12px 12px' }}
      >
        <path d="M5 12h14" />
        <path d="M12 5v14" />
      </m.g>
    </Frame>
  );
}

export function X({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <m.g
        variants={{ hover: { rotate: 90, transition: t } }}
        style={{ transformOrigin: '12px 12px' }}
      >
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </m.g>
    </Frame>
  );
}

export function Minimise({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <path d="M5 12h14" />
    </Frame>
  );
}

export function Maximise({ className, ...props }: IconProps) {
  return (
    <Frame className={className} strokeWidth={2.2} {...props}>
      <rect x="4.5" y="4.5" width="15" height="15" rx="1.5" />
    </Frame>
  );
}

export function Restore({ className, ...props }: IconProps) {
  return (
    <Frame className={className} strokeWidth={2} {...props}>
      <rect x="3.5" y="7.5" width="12" height="12" rx="1.5" />
      <path d="M7.5 7.5v-2a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
    </Frame>
  );
}

export function Settings({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <m.g
        variants={{
          hover: {
            rotate: 60,
            transition: { duration: duration.slow, ease: ease.move },
          },
        }}
        style={{ transformOrigin: '12px 12px' }}
      >
        <path d="M12 2.5a2 2 0 0 1 1.9 1.36l.2.6a1.4 1.4 0 0 0 2 .83l.55-.3a2 2 0 0 1 2.68 2.68l-.3.56a1.4 1.4 0 0 0 .82 2l.6.19a2 2 0 0 1 0 3.8l-.6.2a1.4 1.4 0 0 0-.83 2l.3.55a2 2 0 0 1-2.67 2.68l-.56-.3a1.4 1.4 0 0 0-2 .82l-.19.6a2 2 0 0 1-3.8 0l-.2-.6a1.4 1.4 0 0 0-2-.83l-.55.3a2 2 0 0 1-2.68-2.67l.3-.56a1.4 1.4 0 0 0-.82-2l-.6-.19a2 2 0 0 1 0-3.8l.6-.2a1.4 1.4 0 0 0 .83-2l-.3-.55a2 2 0 0 1 2.67-2.68l.56.3a1.4 1.4 0 0 0 2-.82l.19-.6A2 2 0 0 1 12 2.5Z" />
      </m.g>
      <circle cx="12" cy="12" r="3" />
    </Frame>
  );
}

export function Sun({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <circle cx="12" cy="12" r="4" />
      <m.g
        variants={{
          hover: {
            rotate: 45,
            transition: { duration: duration.slow, ease: ease.move },
          },
        }}
        style={{ transformOrigin: '12px 12px' }}
      >
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </m.g>
    </Frame>
  );
}

export function Moon({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <m.path
        d="M12 3a6.4 6.4 0 0 0 9 9 9 9 0 1 1-9-9Z"
        variants={{ hover: { rotate: -18, transition: t } }}
        style={{ transformOrigin: '12px 12px' }}
      />
    </Frame>
  );
}

export function Monitor({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </Frame>
  );
}

export function Contrast({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none" />
    </Frame>
  );
}

export function FolderOpen({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <m.path
        d="m6 14 1.5-3.5A2 2 0 0 1 9.3 9H21a1 1 0 0 1 .9 1.4l-2.1 5.2a2 2 0 0 1-1.9 1.4H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.7.9l.8 1.2a2 2 0 0 0 1.7.9H18a2 2 0 0 1 2 2v2"
        variants={{ hover: { y: -1, transition: t } }}
      />
    </Frame>
  );
}

/**
 * Download. The arrow dips on hover, which is the whole gesture.
 *
 * Animated, so it belongs in chrome — a settings row, a track menu — and not in
 * a virtualised list row. `StaticDownload` is there for that.
 */
export function Download({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <m.g variants={{ hover: { y: 2, transition: t } }}>
        <path d="M7 10l5 5 5-5" />
        <path d="M12 15V3" />
      </m.g>
    </Frame>
  );
}

export function Folder({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
    </Frame>
  );
}

export function Refresh({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <m.g
        variants={{
          hover: {
            rotate: 180,
            transition: { duration: duration.slow, ease: ease.move },
          },
        }}
        style={{ transformOrigin: '12px 12px' }}
      >
        <path d="M3 12a9 9 0 0 1 9-9 9.7 9.7 0 0 1 6.7 2.7L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-9 9 9.7 9.7 0 0 1-6.7-2.7L3 16" />
        <path d="M3 21v-5h5" />
      </m.g>
    </Frame>
  );
}

export function SortAsc({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <path d="M11 5h10M11 12h7M11 19h4" />
      <path d="m3 8 3-3 3 3" />
      <path d="M6 5v14" />
    </Frame>
  );
}

export function Check({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <path d="M20 6 9 17l-5-5" />
    </Frame>
  );
}

/* ═════════════════════════ static — for list rows ═════════════════════════
   No Motion, no variants, no controller. Identical geometry, so a row and the
   chrome above it draw the same glyph.
   ═══════════════════════════════════════════════════════════════════════════ */

export function StaticPlay({ className, ...props }: IconProps) {
  return (
    <Solid className={className} {...props}>
      <path d="M8.5 5.2v13.6L19.5 12z" />
    </Solid>
  );
}

export function StaticMusic({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </Frame>
  );
}

export function StaticClock({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6.5V12l3.5 2" />
    </Frame>
  );
}

export function StaticChevron({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <path d="m9 18 6-6-6-6" />
    </Frame>
  );
}

/** The one animated icon allowed anywhere: a spinner has to move to mean
 *  anything, and it only ever appears one at a time. */
export function Spinner({ className, ...props }: IconProps) {
  return (
    <Frame className={cn('animate-spin', className)} {...props}>
      <path d="M21 12a9 9 0 1 1-6.2-8.6" />
    </Frame>
  );
}

/* ═════════════════════════ added for the shelves and settings ═════════════ */

export function Sparkle({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <m.path
        d="M12 3.2 13.9 9l5.8 1.9-5.8 1.9L12 18.6l-1.9-5.8L4.3 10.9 10.1 9z"
        variants={{ hover: { rotate: 18, scale: 1.06, transition: t } }}
        style={{ transformOrigin: '12px 11px' }}
      />
      <path d="M18.6 3.4v3M20.1 4.9h-3" />
    </Frame>
  );
}

export function Palette({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <path d="M12 21a9 9 0 1 1 9-9c0 1.7-1.3 3-3 3h-1.5a2.5 2.5 0 0 0-1.8 4.2A1.9 1.9 0 0 1 12 21Z" />
      <circle cx="7.6" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="9.9" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="14.4" cy="7.8" r="1.1" fill="currentColor" stroke="none" />
    </Frame>
  );
}

export function Sliders({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <path d="M5 21v-7M5 10V3M12 21v-9M12 8V3M19 21v-5M19 12V3" />
      <m.g variants={{ hover: { y: -1.5, transition: t } }}>
        <path d="M2.6 14h4.8M9.6 12h4.8M16.6 16h4.8" />
      </m.g>
    </Frame>
  );
}

export function Globe({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.2 9.5h17.6M3.2 14.5h17.6" />
      <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z" />
    </Frame>
  );
}

export function Shield({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <path d="M12 21.4c4.3-1.8 7-5.6 7-10V5.9l-7-2.6-7 2.6v5.5c0 4.4 2.7 8.2 7 10Z" />
    </Frame>
  );
}

export function Keyboard({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8" />
    </Frame>
  );
}

export function Info({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 7.8h.01" />
    </Frame>
  );
}

export function StaticChevronLeft({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <path d="m15 18-6-6 6-6" />
    </Frame>
  );
}

/* ── destinations that only exist in the sidebar's nav ─────────────────── */

export function Radio({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <circle cx="12" cy="12" r="2" />
      <path d="M8.5 8.5a5 5 0 0 0 0 7" />
      <path d="M15.5 15.5a5 5 0 0 0 0-7" />
      <path d="M5.6 5.6a9 9 0 0 0 0 12.8" />
      <path d="M18.4 18.4a9 9 0 0 0 0-12.8" />
    </Frame>
  );
}

export function Chart({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M22 20H2" />
    </Frame>
  );
}

export function Upload({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 8l5-5 5 5" />
      <path d="M12 3v12" />
    </Frame>
  );
}

/** Picture-in-picture: a frame with a smaller frame in its corner. */
export function PictureInPicture({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <path d="M21 11V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h5" />
      <rect x="12" y="13" width="9" height="7" rx="1.5" />
    </Frame>
  );
}

/**
 * Four corners pointing out: the full-screen player.
 *
 * Not `Maximise`, which is the window control and a plain square — the two sit
 * within a few pixels of each other in the transport bar, and a reader has to
 * be able to tell "make this window bigger" from "let this song take over the
 * screen" at a glance.
 */
export function Fullscreen({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9" />
      <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9" />
      <path d="M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15" />
      <path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
    </Frame>
  );
}

/** A drag handle: two columns of dots. Used on reorderable rows. */
/**
 * Three dots: "there is more here".
 *
 * Added because `Sliders` was standing in for it, and in a music player that
 * icon means one thing — the equaliser. Somebody pressed it expecting an
 * equaliser and got a menu of unrelated controls, which is the icon's fault
 * rather than theirs. `Sliders` now opens the equaliser, and this is the
 * overflow.
 *
 * Filled circles rather than the outline the rest of the set uses: at 16px an
 * outlined dot is a smudge.
 */
export function More({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </Frame>
  );
}

export function Grip({ className, ...props }: IconProps) {
  return (
    <Frame className={className} {...props}>
      <circle cx="9" cy="6" r=".8" />
      <circle cx="9" cy="12" r=".8" />
      <circle cx="9" cy="18" r=".8" />
      <circle cx="15" cy="6" r=".8" />
      <circle cx="15" cy="12" r=".8" />
      <circle cx="15" cy="18" r=".8" />
    </Frame>
  );
}
