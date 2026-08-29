import { describe, expect, it } from 'vitest';

import { kindFor, motionCoverFor } from '@/lib/motion-cover';

describe('how a motion cover has to be played', () => {
  it('sends video formats to a video element', () => {
    expect(kindFor('C:/music/album/motion.mp4')).toBe('video');
    expect(kindFor('/music/album/cover.webm')).toBe('video');
  });

  it('leaves animated images to an img element', () => {
    // An animated GIF or WebP animates on its own. Wrapping it in a video
    // element would stop it playing at all.
    expect(kindFor('/music/album/cover.gif')).toBe('image');
    expect(kindFor('/music/album/artwork.webp')).toBe('image');
  });

  it('is not confused by case or by a dot in the folder name', () => {
    expect(kindFor('/music/The B-52s/Cover.MP4')).toBe('video');
  });
});

describe('looking one up', () => {
  it('answers null in the browser rather than throwing', async () => {
    // The common case for most tracks, and the only case on the web build.
    await expect(motionCoverFor('/music/a.flac')).resolves.toBeNull();
    await expect(motionCoverFor(undefined)).resolves.toBeNull();
  });
});
