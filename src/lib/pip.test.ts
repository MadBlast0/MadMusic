import { describe, expect, it, vi } from 'vitest';

import { copyStyles, openPip, pipAvailable, pipOpen } from '@/lib/pip';

/**
 * The picture-in-picture window.
 *
 * The tests that matter are the ones about *not being available*: this API
 * exists in one engine, and a caller that assumed otherwise would throw on
 * every other one.
 */

describe('availability', () => {
  it('reports absence rather than throwing', () => {
    // jsdom has no `documentPictureInPicture`, which is the point.
    expect(pipAvailable()).toBe(false);
    expect(pipOpen()).toBe(false);
  });

  it('opens nothing where there is no API', async () => {
    await expect(openPip()).resolves.toBeNull();
  });
});

describe('carrying the styles across', () => {
  function blankDocument(): Document {
    return document.implementation.createHTMLDocument('pip');
  }

  it('clones an inline stylesheet', () => {
    const style = document.createElement('style');
    style.textContent = '.from-the-app { color: rebeccapurple; }';
    document.head.append(style);

    const to = blankDocument();
    copyStyles(document, to);

    const text = [...to.querySelectorAll('style')]
      .map((node) => node.textContent)
      .join('');
    expect(text).toContain('rebeccapurple');

    style.remove();
  });

  it('re-links an external stylesheet rather than inlining it', () => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.example/one.css';
    document.head.append(link);

    const to = blankDocument();
    copyStyles(document, to);

    const copied = to.querySelector('link[rel="stylesheet"]');
    expect(copied?.getAttribute('href')).toContain('fonts.example');

    link.remove();
  });

  it('survives a sheet it is not allowed to read', () => {
    // A cross-origin sheet throws on `cssRules`. One of those must not take
    // down every other style in the window.
    const style = document.createElement('style');
    style.textContent = '.guarded { color: red; }';
    document.head.append(style);
    vi.spyOn(style, 'sheet', 'get').mockImplementation(() => {
      throw new Error('cross-origin');
    });

    const to = blankDocument();
    expect(() => copyStyles(document, to)).not.toThrow();
    expect(to.querySelectorAll('style')).toHaveLength(1);

    style.remove();
    vi.restoreAllMocks();
  });
});
