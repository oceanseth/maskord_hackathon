/**
 * A single shared <audio> element for avatar speech.
 *
 * Avatar voices never travel over WebRTC — every client fetches the rendered
 * audio and plays it locally. That playback used to create a fresh `new Audio()`
 * per chunk, which desktop tolerates and mobile does not: iOS only allows
 * playback on an element a user gesture has already started, so every chunk was
 * blocked and skipped and the avatar was simply silent for mobile listeners.
 *
 * The element is attached to the document and tagged `data-voice`, which is what
 * the existing "voice audio needs your permission" banner looks for: its click
 * handler plays every such element inside the user's gesture, which unlocks this
 * one for the rest of the session. So avatar audio now recovers through exactly
 * the same affordance as remote peer audio, rather than needing its own.
 */

let el: HTMLAudioElement | null = null;

export function avatarAudioEl(): HTMLAudioElement {
  if (el) return el;

  el = document.createElement('audio');
  // The banner's unlock handler selects on this attribute.
  el.setAttribute('data-voice', 'agent');
  el.preload = 'auto';
  el.style.display = 'none';
  document.body.appendChild(el);
  return el;
}
