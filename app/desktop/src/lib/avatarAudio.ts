/**
 * A single, gesture-unlocked <audio> element for avatar speech.
 *
 * Avatar voices never travel over WebRTC — every client fetches the rendered
 * audio and plays it locally. That playback used to create a fresh `new Audio()`
 * per chunk, which desktop tolerates and mobile does not: iOS only allows
 * playback on elements a user gesture has already started, so every chunk was
 * blocked and skipped, and the avatar was simply silent for mobile listeners
 * while human voices came through fine.
 *
 * Reusing one element, primed on the first touch or click anywhere in the app,
 * is the portable fix.
 */

let el: HTMLAudioElement | null = null;
let unlocked = false;

/** The shared element, created on first use. */
export function avatarAudioEl(): HTMLAudioElement {
  if (!el) {
    el = new Audio();
    el.setAttribute('data-voice', 'agent');
    el.preload = 'auto';
    primeOnFirstGesture();
  }
  return el;
}

/**
 * Start and immediately pause the element inside the user's first gesture. That
 * marks it as user-initiated for the rest of the session, so later programmatic
 * `play()` calls are allowed.
 */
function primeOnFirstGesture() {
  if (typeof window === 'undefined' || unlocked) return;

  const prime = () => {
    if (unlocked || !el) return;
    unlocked = true;
    // A silent one-sample wav: enough to satisfy the gesture requirement
    // without making a noise.
    el.src =
      'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    el.play().then(() => el?.pause()).catch(() => { unlocked = false; });
    detach();
  };

  const detach = () => {
    window.removeEventListener('pointerdown', prime);
    window.removeEventListener('touchend', prime);
    window.removeEventListener('keydown', prime);
  };

  window.addEventListener('pointerdown', prime, { once: false });
  window.addEventListener('touchend', prime, { once: false });
  window.addEventListener('keydown', prime, { once: false });
}
