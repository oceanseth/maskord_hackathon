import assert from 'node:assert/strict';
import {
  LABELS,
  defenseChat,
  defenseSystem,
  fallbackLine,
  hostLine,
  isServerOwnedMask,
  orderSlots,
  revealSpeech,
} from '../convex/marrymatemurderShow.ts';

assert.equal(isServerOwnedMask('mask:alpha', 'alpha'), true);
assert.equal(isServerOwnedMask('mask:alpha', 'beta'), false);
assert.equal(isServerOwnedMask('rent:alpha', 'alpha'), false);
assert.equal(isServerOwnedMask('mask:rent:alpha', 'rent:alpha'), false);
assert.equal(isServerOwnedMask('human:ada', 'ada'), false);
assert.equal(isServerOwnedMask('mask:alpha beta', 'alpha beta'), false);

const ordered = orderSlots([
  { label: 'C', name: 'Cee' },
  { label: 'A', name: 'Ay' },
  { label: 'B', name: 'Bee' },
  { label: 'A', name: 'ignored' },
]);
assert.deepEqual(
  ordered.map((slot) => slot.name),
  ['Ay', 'Bee', 'Cee'],
);
assert.equal(ordered.length, LABELS.length);

const system = defenseSystem('Ada', 'says everything twice', ['Bee', 'Cee']);
assert.match(system, /MARRY, MATE, MURDER/);
assert.match(system, /live audience votes/);
assert.match(system, /Twitch chat/);
assert.match(system, /On stage with you: Bee and Cee/);
assert.match(system, /says everything twice/);
assert.match(defenseSystem('Ada', '   ', []), /something to prove/);
assert.match(fallbackLine('Ada'), /Marry Ada/);

// The chat prompt sets the stage but never carries a persona — the mask's own
// masky.ai personality is the one that reasons.
const chat = defenseChat(['Bee', 'Cee']);
assert.match(chat, /on stage with Bee and Cee/);
assert.match(chat, /MARRY, MATE, MURDER/);
assert.match(chat, /Twitch chat/);
assert.match(chat, /tell the audience/);
assert.doesNotMatch(chat, /Who you are/);
assert.match(defenseChat([]), /two other contestants/);

const opening = hostLine(2, [
  { label: 'A', name: 'Ada' },
  { label: 'B', name: 'Bee' },
  { label: 'C', name: 'Cee' },
]);
assert.match(opening, /Round 2/);
assert.match(opening, /A, Ada; B, Bee; C, Cee/);
assert.match(opening, /!marry A, !mate B, !murder C/);

const tallies = {
  A: { marry: 4, mate: 0, murder: 1 },
  B: { marry: 1, mate: 3, murder: 1 },
  C: { marry: 0, mate: 2, murder: 3 },
};
const spoken = revealSpeech(
  {
    voters: 5,
    tallies,
    majority: { marry: 'A', mate: 'B', murder: 'C' },
    byChance: [],
    scorers: 3,
  },
  [
    { label: 'A', name: 'Ada' },
    { label: 'B', name: 'Bee' },
    { label: 'C', name: 'Cee' },
  ],
);
assert.match(spoken, /4 votes to marry Ada/);
assert.match(spoken, /3 votes to mate Bee/);
assert.match(spoken, /3 votes to murder Cee/);
assert.match(spoken, /3 voters scored/);

const tied = revealSpeech(
  {
    voters: 2,
    tallies: {
      A: { marry: 1, mate: 0, murder: 1 },
      B: { marry: 1, mate: 1, murder: 1 },
      C: { marry: 0, mate: 1, murder: 0 },
    },
    majority: { marry: 'B', mate: 'C', murder: 'A' },
    byChance: ['marry', 'mate'],
    scorers: 0,
  },
  [
    { label: 'A', name: 'Ada' },
    { label: 'B', name: 'Bee' },
    { label: 'C', name: 'Cee' },
  ],
);
assert.match(tied, /marry was a tie, so it lands on Bee/);
assert.match(tied, /mate was a tie, so it lands on Cee/);
assert.match(tied, /1 vote to murder Ada/);
assert.match(tied, /0 voters scored/);

const silent = revealSpeech(
  {
    voters: 0,
    tallies: {
      A: { marry: 0, mate: 0, murder: 0 },
      B: { marry: 0, mate: 0, murder: 0 },
      C: { marry: 0, mate: 0, murder: 0 },
    },
    majority: { marry: 'C', mate: 'A', murder: 'B' },
    byChance: ['marry', 'mate', 'murder'],
    scorers: 0,
  },
  [
    { label: 'A', name: 'Ada' },
    { label: 'B', name: 'Bee' },
    { label: 'C', name: 'Cee' },
  ],
);
assert.match(silent, /nobody voted, so marry lands on Cee/);
assert.match(silent, /nobody voted, so murder lands on Bee/);

console.log('marrymatemurder show ok');
