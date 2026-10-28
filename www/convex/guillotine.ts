import { v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { appendEvent, getRoomBySlug, joinMember, setPhase } from './rooms';
import { closeStage, hostSay, openRound, resetStage, stageOf, type StageEntrant, type StageReveal } from './stage';

/**
 * Guillotine: billionaires on the stage, an audience with an Execute button.
 *
 * A double-elimination tournament. Every heat puts three billionaires up (two
 * in the endgame); each gets one line in their own defence; the room and
 * Twitch vote; the one with the most Execute votes takes a strike. Two strikes
 * and you are out. The last billionaire with a head wins.
 *
 * Heats are drawn inside a bracket where one exists — unbeaten against
 * unbeaten, once-struck against once-struck — and fall back to whoever is left
 * when a bracket is too small to fill a heat. Within a bracket, whoever has
 * been on stage least goes up first, so nobody sits out the whole night.
 *
 * The stage (convex/stage.ts) runs each heat. This module only decides who is
 * up and what an execution means.
 */

export const LABELS = ['A', 'B', 'C'] as const;
const STRIKES_OUT = 2;
/** How long the reveal sits on screen before the next heat is called. */
const REVEAL_PAUSE_MS = 9_000;
const DEFAULT_SIZE = 8;
const MIN_SIZE = 4;

type Billionaire = {
  key: string;
  name: string;
  emoji: string;
  color: string;
  persona: string;
  fallbackLine: string;
  pitch?: number;
  rate?: number;
};

/**
 * The pool. Public personas, played for satire: the prompt forbids inventing
 * wrongdoing, so the jokes have to come from what everyone already knows.
 */
export const BILLIONAIRES: Billionaire[] = [
  { key: 'musk', name: 'Elon Musk', emoji: '🚀', color: '#60a5fa', persona: 'Rockets, electric cars, a social network he bought, Mars as plan B, posts at 3am, thinks everything is a meme and a mission at once.', fallbackLine: 'Execute me and who takes you to Mars? Exactly. Nobody. Vote for the guy with the most followers instead.', pitch: 1.05 },
  { key: 'bezos', name: 'Jeff Bezos', emoji: '📦', color: '#f59e0b', persona: 'Built Amazon from a garage, now a yacht and a rocket company; obsessed with customers, two-day delivery, and looking very fit.', fallbackLine: 'I can have a replacement head delivered by tomorrow, but I would rather not. Execute someone without Prime.', pitch: 0.9 },
  { key: 'zuckerberg', name: 'Mark Zuckerberg', emoji: '🥽', color: '#3b82f6', persona: 'Facebook, Instagram, the metaverse, jiu-jitsu, smoking meats; earnest, slightly robotic, very into building the future in a headset.', fallbackLine: 'In the metaverse I have legs and a head. Please let me keep at least the head out here.', rate: 1.1 },
  { key: 'gates', name: 'Bill Gates', emoji: '🪟', color: '#22d3ee', persona: 'Microsoft co-founder turned philanthropist; vaccines, toilets, climate, reads a lot of books, gently nerdy.', fallbackLine: 'I have given away billions and I will happily explain why in a very long blog post. Spare me.', pitch: 1.1 },
  { key: 'buffett', name: 'Warren Buffett', emoji: '🍔', color: '#84cc16', persona: 'The Oracle of Omaha; folksy, lives in the same house since 1958, cherry Coke and McDonald\'s breakfast, value investing aphorisms.', fallbackLine: 'Be fearful when others are greedy. Right now this audience looks very greedy. I am very fearful.', pitch: 0.8, rate: 0.9 },
  { key: 'arnault', name: 'Bernard Arnault', emoji: '👜', color: '#e879f9', persona: 'French luxury emperor of LVMH; impeccably dressed, calm, collects maisons the way others collect stamps.', fallbackLine: 'You cannot execute a man wearing this suit. It would be a crime against fashion.', pitch: 0.95 },
  { key: 'ellison', name: 'Larry Ellison', emoji: '⛵', color: '#ef4444', persona: 'Oracle founder, owns most of a Hawaiian island, sails, competitive to the bone, tirelessly confident.', fallbackLine: 'I own an island. Execute me and you will never be invited. Think carefully.', pitch: 0.85 },
  { key: 'page', name: 'Larry Page', emoji: '🔎', color: '#4ade80', persona: 'Google co-founder; quiet, avoids the spotlight, flying cars, very long-term thinking.', fallbackLine: 'Search your feelings. You will find zero results for executing me.', rate: 1.05 },
  { key: 'brin', name: 'Sergey Brin', emoji: '🎈', color: '#facc15', persona: 'Google co-founder; airships, moonshots, back in the office coding AI, playful engineer energy.', fallbackLine: 'I am building an airship. You cannot execute a man who can simply float away.' },
  { key: 'bloomberg', name: 'Michael Bloomberg', emoji: '📈', color: '#94a3b8', persona: 'Financial data terminal magnate, former New York mayor, ran for president, very short speeches, very big data.', fallbackLine: 'I have a terminal that tells me I survive this round with ninety percent confidence.', pitch: 0.95 },
  { key: 'huang', name: 'Jensen Huang', emoji: '🧥', color: '#76b900', persona: 'Nvidia founder in the signature black leather jacket; GPUs, AI, keynotes with spectacular hand gestures.', fallbackLine: 'The more you vote for someone else, the more you save. That is the Jensen discount.', rate: 1.05 },
  { key: 'dell', name: 'Michael Dell', emoji: '💻', color: '#0ea5e9', persona: 'Started selling PCs from a college dorm; Texan, steady, quietly enormous.', fallbackLine: 'Nobody has ever been angry at a Dell. Mildly bored, maybe. Never angry.' },
  { key: 'swift', name: 'Taylor Swift', emoji: '🎤', color: '#f472b6', persona: 'The only pop star billionaire by her own songs; eras, re-recordings, Easter eggs, an army of fans.', fallbackLine: 'Execute me and the Swifties will find you. They decode Easter eggs. They will decode you.', pitch: 1.2 },
  { key: 'oprah', name: 'Oprah Winfrey', emoji: '🎁', color: '#fb923c', persona: 'Talk show legend and media mogul; generous, warm, legendary giveaways, speaks to the audience like old friends.', fallbackLine: 'You get a head! And you get a head! Everybody keeps their head! Especially me.', pitch: 1.1 },
  { key: 'rihanna', name: 'Rihanna', emoji: '💄', color: '#f43f5e', persona: 'Pop icon turned beauty and lingerie mogul with Fenty; unbothered, effortlessly cool.', fallbackLine: 'Shine bright like a diamond, not like a guillotine blade. Vote somebody else, babe.', pitch: 1.15 },
  { key: 'kardashian', name: 'Kim Kardashian', emoji: '🤳', color: '#d946ef', persona: 'Reality TV star turned shapewear billionaire and law student; savvy, camera-ready, always on brand.', fallbackLine: 'Executing me is not a good look, and looks are literally my business.', pitch: 1.15 },
  { key: 'branson', name: 'Richard Branson', emoji: '🏝️', color: '#dc2626', persona: 'Virgin founder, adventurer, balloons and spaceplanes, owns a private island, grinning showman.', fallbackLine: 'I have crashed balloons and survived. A guillotine is just a balloon with poor manners.' },
  { key: 'cuban', name: 'Mark Cuban', emoji: '🏀', color: '#2563eb', persona: 'Shark Tank investor, basketball team owner, cost-plus pharmacy, loud, combative, loves a deal.', fallbackLine: 'Here is my offer: you spare me, I give you ten percent of nothing. That is a great deal.' },
  { key: 'jordan', name: 'Michael Jordan', emoji: '👟', color: '#b91c1c', persona: 'Basketball greatest, sneaker empire, notoriously competitive, takes everything personally.', fallbackLine: 'They told me I could not survive this round. And I took that personally.', pitch: 0.85 },
  { key: 'jayz', name: 'Jay-Z', emoji: '🎧', color: '#a3a3a3', persona: 'Rapper turned mogul; champagne, art, streaming, business man, not a business, man.', fallbackLine: 'I got ninety nine problems, but the blade ain\'t one. Execute somebody else.', pitch: 0.85 },
  { key: 'altman', name: 'Sam Altman', emoji: '🤖', color: '#10b981', persona: 'AI lab chief; calm, measured, talks about AGI and abundance, lowercase energy.', fallbackLine: 'we are going to make an extremely good future. i would like to be in it, with a head.', rate: 0.95 },
  { key: 'thiel', name: 'Peter Thiel', emoji: '♟️', color: '#64748b', persona: 'Contrarian investor; zero to one, secrets, asks what important truth few people agree with.', fallbackLine: 'Here is a contrarian truth: executing the most interesting person on stage is a mistake.', pitch: 0.9 },
  { key: 'son', name: 'Masayoshi Son', emoji: '🌐', color: '#eab308', persona: 'SoftBank founder with a 300-year plan; huge bets, visionary pitches, unshakeable optimism.', fallbackLine: 'I have a three hundred year plan. Please do not end it in round one.' },
  { key: 'cook', name: 'Tim Cook', emoji: '🍏', color: '#e5e7eb', persona: 'Apple CEO; calm, precise, supply-chain genius, says "we think you\'re going to love it".', fallbackLine: 'This is the best head I have ever had. We think you are going to love it.', rate: 0.95 },
];

type Seat = {
  key: string;
  strikes: number;
  heats: number;
  /** Heat number this billionaire went out in. */
  outAt?: number;
};

type HeatRecord = {
  heat: number;
  round: number;
  bracket: Bracket;
  keys: string[];
  executed: string;
  byChance: boolean;
};

type Bracket = 'winners' | 'losers' | 'mixed' | 'final';

export type GuillotineConfig = {
  size: number;
  seats: Seat[];
  heat: number;
  /** The heat the stage is running now; `onReveal` ignores any other. */
  liveHeat?: { heat: number; round: number; bracket: Bracket; keys: string[] };
  history: HeatRecord[];
  champion?: string;
  startedAt?: number;
};

function memberKeyFor(key: string) {
  return `billionaire:${key}`;
}

function billionaire(key: string): Billionaire {
  return BILLIONAIRES.find((b) => b.key === key) ?? BILLIONAIRES[0];
}

function gameOf(room: Doc<'rooms'>): GuillotineConfig | undefined {
  return (room.config as { guillotine?: GuillotineConfig } | undefined)?.guillotine;
}

async function writeGame(ctx: MutationCtx, roomId: Id<'rooms'>, game: GuillotineConfig | undefined) {
  const room = await ctx.db.get(roomId);
  if (!room) return;
  await ctx.db.patch(roomId, { config: { ...(room.config ?? {}), guillotine: game } });
}

function shuffle<T>(xs: T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Least-seen first, random among equals. */
function pickFrom(pool: Seat[], n: number): Seat[] {
  return shuffle(pool)
    .sort((a, b) => a.heats - b.heats)
    .slice(0, n);
}

/**
 * Who goes up next. Brackets first, so the unbeaten meet the unbeaten; when
 * neither bracket can fill a heat of three, everyone left shares the stage;
 * with two left it is the final, run until one of them has two strikes.
 */
export function drawHeat(seats: Seat[]): { bracket: Bracket; seats: Seat[] } | null {
  const alive = seats.filter((s) => s.strikes < STRIKES_OUT);
  if (alive.length <= 1) return null;
  if (alive.length === 2) return { bracket: 'final', seats: shuffle(alive) };
  const winners = alive.filter((s) => s.strikes === 0);
  const losers = alive.filter((s) => s.strikes > 0);
  // The bigger bracket goes next, which keeps the two from drifting apart.
  const order: Array<[Bracket, Seat[]]> =
    winners.length >= losers.length
      ? [['winners', winners], ['losers', losers]]
      : [['losers', losers], ['winners', winners]];
  for (const [bracket, pool] of order) {
    if (pool.length >= 3) return { bracket, seats: shuffle(pickFrom(pool, 3)) };
  }
  return { bracket: 'mixed', seats: shuffle(pickFrom(alive, 3)) };
}

function entrantSystem(b: Billionaire, seat: Seat, rivals: string[], bracket: Bracket): string {
  const record =
    seat.strikes === 0
      ? 'You have no strikes yet.'
      : `You already have ${seat.strikes} strike — one more execution and you are out of the game.`;
  return [
    `You are ${b.name}, playing yourself on GUILLOTINE — a live, comedic elimination game show hosted by Masky.`,
    `Who you are: ${b.persona}`,
    '',
    'How the game works: billionaires share the stage a few at a time. Each gets exactly ONE line to defend',
    'themselves. Then a live audience — the people in this voice room and viewers voting from Twitch chat —',
    'votes on which of you to EXECUTE. Whoever gets the most votes goes to the (cartoon) guillotine and takes',
    'a strike. Two strikes and you are out. The last billionaire standing wins the whole show.',
    '',
    `This round${bracket === 'final' ? ' is the FINAL and' : ''} you are on stage with: ${rivals.join(' and ')}.`,
    record,
    'The audience votes the moment the last line is spoken, so this line is your entire defence.',
    '',
    'Speak as yourself, in your own voice and cadence. Be funny and self-aware; win the crowd. You may',
    'throw a rival under the bus. It is satire of a public persona: never invent crimes or real wrongdoing.',
    'One line, spoken aloud, under 45 words. No stage directions, no emoji, no hashtags, no quotation marks.',
  ].join('\n');
}

function strikeWord(n: number) {
  return n === 1 ? 'one strike' : `${n} strikes`;
}

/** Call the next heat, or crown the champion. */
async function nextHeat(ctx: MutationCtx, roomId: Id<'rooms'>) {
  const room = await ctx.db.get(roomId);
  if (!room || room.status !== 'running') return;
  const game = gameOf(room);
  if (!game || game.champion) return;

  const drawn = drawHeat(game.seats);
  if (!drawn) {
    const champ = game.seats.find((s) => s.strikes < STRIKES_OUT) ?? game.seats[0];
    const b = billionaire(champ.key);
    await writeGame(ctx, roomId, { ...game, champion: champ.key, liveHeat: undefined });
    await hostSay(
      ctx,
      roomId,
      `And that is the show! After ${game.heat} heats, the last billionaire with a head is ${b.name}! ` +
        `Check the leaderboard to see who read this crowd best.`,
    );
    await closeStage(ctx, roomId);
    await setPhase(ctx, roomId, 'finished', { byName: room.hostName });
    await ctx.db.patch(roomId, { status: 'finished' });
    return;
  }

  const heat = game.heat + 1;
  const names = drawn.seats.map((s) => billionaire(s.key).name);
  const entrants: StageEntrant[] = drawn.seats.map((seat, i) => {
    const b = billionaire(seat.key);
    return {
      label: LABELS[i],
      memberKey: memberKeyFor(b.key),
      name: b.name,
      emoji: b.emoji,
      color: b.color,
      system: entrantSystem(
        b,
        seat,
        names.filter((n) => n !== b.name),
        drawn.bracket,
      ),
      fallbackLine: b.fallbackLine,
      voice: { pitch: b.pitch, rate: b.rate },
    };
  });

  const bracketName =
    drawn.bracket === 'winners'
      ? "the unbeaten bracket"
      : drawn.bracket === 'losers'
        ? 'the one-strike bracket'
        : drawn.bracket === 'final'
          ? 'the FINAL'
          : 'a mixed heat';
  const hostLine =
    drawn.bracket === 'final'
      ? `It's the final! ${names.join(' versus ')}. One line each, then you decide who loses their head.`
      : `Heat ${heat}, ${bracketName}: ${entrants.map((e) => `${e.label}, ${e.name}`).join('; ')}. One line each, then vote!`;

  const seats = game.seats.map((s) =>
    drawn.seats.some((d) => d.key === s.key) ? { ...s, heats: s.heats + 1 } : s,
  );
  const round = await openRound(ctx, roomId, {
    entrants,
    verbs: ['execute'],
    onReveal: 'guillotine:onReveal',
    hostLine,
    caption: drawn.bracket === 'final' ? 'The final' : `Heat ${heat} · ${bracketName}`,
  });
  await writeGame(ctx, roomId, {
    ...game,
    seats,
    heat,
    liveHeat: { heat, round, bracket: drawn.bracket, keys: drawn.seats.map((s) => s.key) },
  });
}

// ─── Public ───────────────────────────────────────────────────────────────────

/**
 * Start a game: draw `size` billionaires at random, seat them, open heat 1.
 * Starting again while a game is running does nothing; use `reset` first.
 */
export const start = mutation({
  args: { slug: v.string(), size: v.optional(v.number()), startedBy: v.optional(v.string()) },
  handler: async (ctx, { slug, size, startedBy }) => {
    const room = await getRoomBySlug(ctx, slug);
    if (!room) throw new Error(`No guillotine room "${slug}"`);
    const existing = gameOf(room);
    if (existing && !existing.champion && room.status === 'running') return { started: false };

    const n = Math.max(MIN_SIZE, Math.min(BILLIONAIRES.length, Math.round(size ?? DEFAULT_SIZE)));
    const picked = shuffle(BILLIONAIRES).slice(0, n);

    await resetStage(ctx, room._id);
    for (const b of picked) {
      await joinMember(ctx, room._id, {
        memberKey: memberKeyFor(b.key),
        kind: 'mask',
        name: b.name,
        persona: b.persona,
      });
    }
    await writeGame(ctx, room._id, {
      size: n,
      seats: picked.map((b) => ({ key: b.key, strikes: 0, heats: 0 })),
      heat: 0,
      history: [],
      startedAt: Date.now(),
    });
    const fresh = await ctx.db.get(room._id);
    await ctx.db.patch(room._id, {
      status: 'running',
      config: { ...(fresh?.config ?? {}), ...(startedBy ? { startedBy } : {}) },
    });
    await setPhase(ctx, room._id, 'playing', { byName: room.hostName });
    await appendEvent(ctx, room._id, {
      type: 'host',
      actorKey: 'host',
      actorName: room.hostName,
      body:
        `Welcome to GUILLOTINE! ${n} billionaires, one blade. Each heat, they plead their case — ` +
        `then you vote who gets executed. Two strikes and you're out; last head standing wins. ` +
        `Vote with the Execute buttons, or type !execute A, B or C in Twitch chat. ` +
        `Vote with the crowd to score points.`,
      data: { kind: 'guillotine-open', roster: picked.map((b) => b.key) },
    });
    await nextHeat(ctx, room._id);
    return { started: true, size: n };
  },
});

/** Clear the game so the room can start another. */
export const reset = mutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const room = await getRoomBySlug(ctx, slug);
    if (!room) return;
    await resetStage(ctx, room._id);
    await writeGame(ctx, room._id, undefined);
    await ctx.db.patch(room._id, { status: 'lobby' });
    await setPhase(ctx, room._id, 'setup', { byName: room.hostName });
  },
});

/** The stage's `onReveal`: the audience has picked; apply the strike. */
export const onReveal = internalMutation({
  args: { roomId: v.id('rooms'), round: v.number(), reveal: v.any() },
  handler: async (ctx, { roomId, round, reveal }) => {
    const room = await ctx.db.get(roomId);
    if (!room) return;
    const game = gameOf(room);
    const live = game?.liveHeat;
    if (!game || !live || live.round !== round) return;
    const r = reveal as StageReveal;
    const stage = stageOf(room);
    const label = r.majority.execute;
    const entrant = stage.entrants.find((e) => e.label === label);
    const key = entrant?.memberKey.replace(/^billionaire:/, '');
    if (!key) return;

    const seats = game.seats.map((s) =>
      s.key === key
        ? { ...s, strikes: s.strikes + 1, outAt: s.strikes + 1 >= STRIKES_OUT ? live.heat : s.outAt }
        : s,
    );
    const struck = seats.find((s) => s.key === key)!;
    const byChance = r.byChance.includes('execute');
    const history: HeatRecord[] = [
      ...game.history,
      { heat: live.heat, round, bracket: live.bracket, keys: live.keys, executed: key, byChance },
    ];
    await writeGame(ctx, roomId, { ...game, seats, history, liveHeat: undefined });

    const name = billionaire(key).name;
    const share = r.voters
      ? Math.round(((r.tallies[label]?.execute ?? 0) / Math.max(1, r.voters)) * 100)
      : 0;
    const how = byChance
      ? r.voters
        ? "It's a tie — the blade decides"
        : 'Nobody voted, so the blade picks at random'
      : `${share}% of you said execute`;
    const fate =
      struck.strikes >= STRIKES_OUT
        ? `${name} is OUT of the game!`
        : `That's ${strikeWord(struck.strikes)} for ${name} — one more and they're done.`;
    await hostSay(ctx, roomId, `${how}: off with ${name}'s head! ${fate}`);

    await ctx.scheduler.runAfter(REVEAL_PAUSE_MS, internal.guillotine.next, {
      roomId,
      afterHeat: live.heat,
    });
  },
});

export const next = internalMutation({
  args: { roomId: v.id('rooms'), afterHeat: v.number() },
  handler: async (ctx, { roomId, afterHeat }) => {
    const room = await ctx.db.get(roomId);
    if (!room) return;
    const game = gameOf(room);
    // Stale: a reset, or another `next` already called the heat after this one.
    if (!game || game.heat !== afterHeat || game.liveHeat) return;
    await nextHeat(ctx, roomId);
  },
});

/**
 * Resume after a pause. A heat interrupted mid-round is picked up by the
 * stage's own watchdog; a pause that landed in the gap between heats needs
 * the next one called.
 */
export const resume = mutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const room = await getRoomBySlug(ctx, slug);
    if (!room) return;
    const game = gameOf(room);
    if (!game || game.champion) return;
    await ctx.db.patch(room._id, { status: 'running' });
    const stage = stageOf(room);
    if (!game.liveHeat && (stage.phase === 'revealed' || stage.phase === 'idle')) {
      await nextHeat(ctx, room._id);
    }
  },
});

/** The bracket board. */
export const state = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const room = await getRoomBySlug(ctx, slug);
    if (!room) return null;
    const game = gameOf(room);
    const roster = (game?.seats ?? []).map((s) => {
      const b = billionaire(s.key);
      return {
        key: s.key,
        name: b.name,
        emoji: b.emoji,
        color: b.color,
        strikes: s.strikes,
        heats: s.heats,
        out: s.strikes >= STRIKES_OUT,
        outAt: s.outAt,
      };
    });
    return {
      status: room.status,
      started: Boolean(game),
      size: game?.size ?? DEFAULT_SIZE,
      heat: game?.heat ?? 0,
      liveHeat: game?.liveHeat ?? null,
      champion: game?.champion ? billionaire(game.champion).name : null,
      championKey: game?.champion ?? null,
      roster,
      history: (game?.history ?? []).map((h) => ({
        ...h,
        executedName: billionaire(h.executed).name,
        names: h.keys.map((k) => billionaire(k).name),
      })),
      strikesOut: STRIKES_OUT,
      poolSize: BILLIONAIRES.length,
    };
  },
});
