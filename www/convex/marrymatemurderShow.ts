/**
 * Words and seating rules for Marry, Mate, Murder.
 *
 * The shared stage (convex/stage.ts) owns the round clock, the ballots, and
 * the points. This file is the part that is only this mode: who may stand on
 * the stage, what they are told before their one line, and what Masky says
 * when the vote is in. No Convex imports, so the script under www/scripts can
 * load it directly.
 */

export const MODE = 'marrymatemurder';
export const VERBS = ['marry', 'mate', 'murder'] as const;
export const LABELS = ['A', 'B', 'C'] as const;

export type Verb = (typeof VERBS)[number];
export type Label = (typeof LABELS)[number];

export const FRAME: Record<Label, { color: string; pitch: number; emoji: string }> = {
  A: { color: '#fb7185', pitch: 1.08, emoji: '💍' },
  B: { color: '#e879f9', pitch: 0.94, emoji: '💋' },
  C: { color: '#f43f5e', pitch: 1.16, emoji: '🗡️' },
};

export function isLabel(value: unknown): value is Label {
  return value === 'A' || value === 'B' || value === 'C';
}

/**
 * A mask the server owns. Rented masks ride in as `rent:…` and stay off this
 * stage; the member key has to be the avatar itself.
 */
export function isServerOwnedMask(memberKey: string, avatarGroupId: string): boolean {
  const id = avatarGroupId.trim();
  if (!id || /\s/.test(id)) return false;
  if (memberKey.includes('rent:')) return false;
  return memberKey === `mask:${id}`;
}

export function orderSlots<T extends { label: string }>(slots: T[]): T[] {
  return LABELS.map((label) => slots.find((slot) => slot.label === label)).filter((slot): slot is T => !!slot);
}

/** The system prompt for one mask's one line. The audience is about to vote. */
export function defenseSystem(name: string, persona: string, rivals: string[]): string {
  const who = persona.trim() || 'A mask with a point of view and something to prove.';
  const against = rivals.length ? rivals.join(' and ') : 'two other masks';
  return [
    `You are ${name}, on stage for MARRY, MATE, MURDER, a live game hosted by Masky.`,
    `Who you are: ${who}`,
    '',
    'How the game works: three masks share the stage. Each of you gets exactly one line.',
    'Then a live audience votes. The people in this voice room, and viewers voting from Twitch chat,',
    'each assign marry, mate, and murder — one of each, to three different masks.',
    'You are trying to be the one they marry. Being murdered is the worst result.',
    'The audience scores a point for each verb they matched to the majority, so win the room.',
    '',
    `On stage with you: ${against}.`,
    'The audience votes the moment the last line is spoken. This line is your whole case.',
    '',
    'Speak as yourself. Be funny and specific. You may throw a rival under the bus.',
    'One line, spoken aloud, under 45 words. No stage directions, no emoji, no hashtags, no quotation marks.',
  ].join('\n');
}

export function fallbackLine(name: string): string {
  return `Marry ${name}. The other two are a story you tell once and never call back.`;
}

export function hostLine(round: number, slots: Array<{ label: string; name: string }>): string {
  const cast = slots.map((slot) => `${slot.label}, ${slot.name}`).join('; ');
  return (
    `Round ${round}. ${cast}. One line each, then you assign marry, mate, and murder — one of each. ` +
    `Buttons under the frames, or !marry A, !mate B, !murder C in Twitch. Vote with the room to score.`
  );
}

export interface ShowReveal {
  voters: number;
  tallies: Record<string, Record<string, number>>;
  majority: Record<string, string>;
  byChance: string[];
  scorers: number;
}

/** Masky's line once the stage has tallied. The round ends on this. */
export function revealSpeech(reveal: ShowReveal, entrants: Array<{ label: string; name: string }>): string {
  const nameOf = (label: string | undefined) => entrants.find((entrant) => entrant.label === label)?.name ?? 'someone';
  const parts = VERBS.map((verb) => {
    const label = reveal.majority[verb];
    const name = nameOf(label);
    if (reveal.byChance.includes(verb)) {
      return reveal.voters === 0
        ? `nobody voted, so ${verb} lands on ${name}`
        : `${verb} was a tie, so it lands on ${name}`;
    }
    const n = reveal.tallies[label]?.[verb] ?? 0;
    const votes = n === 1 ? '1 vote' : `${n} votes`;
    return `${votes} to ${verb} ${name}`;
  });
  const scored =
    reveal.scorers === 1 ? '1 voter scored with the majority' : `${reveal.scorers} voters scored with the majority`;
  return `That's the show. ${parts.join('; ')}. ${scored}.`;
}
