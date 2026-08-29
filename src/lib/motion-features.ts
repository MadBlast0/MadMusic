import { domMax } from 'motion/react';

/**
 * Motion's feature bundle, in its own module so it can be code-split.
 *
 * This file exists purely to be the target of a dynamic `import()`. Naming
 * `domMax` directly in `providers.tsx` would put it in the main chunk, which
 * defeats `LazyMotion` entirely — measured: doing that made the bundle 2.5 kB
 * *larger* than not using `LazyMotion` at all, because the wrapper was added
 * and nothing was removed.
 *
 * See `providers.tsx` for why `domMax` rather than `domAnimation`.
 */
export default domMax;
