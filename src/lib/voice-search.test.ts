import { describe, expect, it } from 'vitest';

import { describeSpeechError, voiceSearchAvailable } from '@/lib/voice-search';

/**
 * Voice search.
 *
 * The recognition itself belongs to the browser engine and is not worth
 * mocking; what is worth testing is the part this app is responsible for —
 * saying something useful when it does not work.
 */

describe('availability', () => {
  it('reports honestly when the engine is absent', () => {
    // jsdom has no speech API, which is the same answer a Linux WebKit build
    // gives. The caller hides the button rather than offering one that fails.
    expect(voiceSearchAvailable()).toBe(false);
  });
});

describe('explaining a failure', () => {
  it('turns a refused permission into an instruction', () => {
    const message = describeSpeechError('not-allowed');
    expect(message).toContain('Microphone access');
    // "not-allowed" is accurate and tells the reader nothing about what to do.
    expect(message).not.toBe('not-allowed');
  });

  it('covers the codes an engine actually emits', () => {
    for (const code of [
      'no-speech',
      'audio-capture',
      'network',
      'aborted',
      'service-not-allowed',
    ]) {
      expect(describeSpeechError(code).length).toBeGreaterThan(0);
      expect(describeSpeechError(code)).not.toBe(code);
    }
  });

  it('has something to say about a code nobody has seen', () => {
    // Engines add codes. An empty string here would be a blank error toast.
    expect(describeSpeechError('some-future-code')).toBe(
      'Could not listen just now.',
    );
  });

  it('never returns a bare code', () => {
    expect(describeSpeechError('')).not.toBe('');
  });
});
