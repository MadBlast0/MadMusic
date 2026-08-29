import { describe, expect, it } from 'vitest';

import {
  DESTINATIONS,
  cardFileName,
  drawShareCard,
  postUrl,
} from '@/lib/share-card';

describe('the post link', () => {
  it('carries the track and the link', () => {
    const url = new URL(
      postUrl('Marrow', 'Violet Static', 'madmusic://track/1'),
    );
    expect(url.searchParams.get('text')).toBe('Marrow — Violet Static');
    expect(url.searchParams.get('url')).toBe('madmusic://track/1');
  });

  it('encodes a title that would otherwise truncate the post', () => {
    // The classic failure: an ampersand ends the query parameter and the post
    // silently loses everything after it.
    const url = postUrl('Rock & Roll', 'Someone', 'madmusic://track/1');
    expect(url).not.toContain('Rock & Roll');
    expect(new URL(url).searchParams.get('text')).toBe('Rock & Roll — Someone');
  });

  it('copes with a track that has no artist', () => {
    expect(new URL(postUrl('Marrow', '', '')).searchParams.get('text')).toBe(
      'Marrow',
    );
  });

  it('leaves the link out rather than sending an empty one', () => {
    expect(new URL(postUrl('Marrow', 'A', '')).searchParams.has('url')).toBe(
      false,
    );
  });
});

describe('the file name', () => {
  it('reads as artist and title', () => {
    expect(cardFileName('Marrow', 'Violet Static')).toBe(
      'Violet Static - Marrow.png',
    );
  });

  it('strips what a filesystem will not accept', () => {
    expect(cardFileName('AC/DC: Live?', 'Someone*')).not.toMatch(
      /[\\/:*?"<>|]/,
    );
  });

  it('never produces a nameless file', () => {
    // A title of nothing but punctuation would otherwise give ".png".
    expect(cardFileName('///', '')).toBe('MadMusic.png');
    expect(cardFileName('', '')).toBe('MadMusic.png');
  });

  it('keeps a very long title to something a filesystem accepts', () => {
    const name = cardFileName('a'.repeat(500), 'b'.repeat(500));
    expect(name.length).toBeLessThanOrEqual(84);
  });
});

describe('the destinations', () => {
  it('explain the three that do not work the way they look', () => {
    // X, Discord and Instagram look like three of the same thing and are
    // three different mechanisms — one intent URL, one clipboard, one "save
    // it and use your phone". Three buttons that look alike and behave
    // differently is how somebody concludes the app is broken, so each of
    // those has to say what it will do first.
    //
    // "Save the image" and "Copy the link" need no such explanation: they do
    // exactly what they say.
    for (const id of ['x', 'discord', 'instagram'] as const) {
      const entry = DESTINATIONS.find((option) => option.id === id);
      expect(entry, `${id} is missing`).toBeDefined();
      expect(entry!.hint.length, `${id} explains too little`).toBeGreaterThan(
        60,
      );
    }
  });

  it('gives every destination a label', () => {
    for (const entry of DESTINATIONS) {
      expect(entry.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('are distinct', () => {
    const ids = DESTINATIONS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('drawing the card', () => {
  it('answers null rather than throwing where there is no canvas', () => {
    // jsdom has no 2D context. Every caller treats this as "sharing is
    // unavailable" rather than as an error, because it is not one the user
    // could do anything about.
    expect(
      drawShareCard({
        title: 'Marrow',
        artist: 'Violet Static',
        from: '#111',
        to: '#222',
      }),
    ).toBeNull();
  });
});
