import { v } from 'convex/values';
import { makeFunctionReference } from 'convex/server';
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from './_generated/server';
import { internal } from './_generated/api';
import { appendEvent } from './rooms';

/**
 * Shared inference for both game modes. The debate's moderator and the D&D DM
 * are the same code path with a different system prompt; so is a mask taking a
 * debate turn versus a mask deciding to swing a sword.
 *
 * This runs as a Convex action rather than in the turn-holder's browser for
 * three reasons: the key is a server secret, the room has to keep moving when
 * the last human closes their tab, and the existing Firestore-triggered agent
 * in firebase/functions cannot see Convex state without bridging two databases
 * every turn.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Debaters and players speak often and cheaply; the host's verdict is one call
 * and wants the better judgement. Both are overridable so a model swap does not
 * need a deploy — and so the Nebius comparison can point the same loop at a
 * different backend without touching this file.
 */
const SPEAK_MODEL = () => process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';
const JUDGE_MODEL = () => process.env.ANTHROPIC_JUDGE_MODEL ?? 'claude-opus-5';

const MAX_TOKENS = 1024;

export type ToolSpec = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type ModelReply = {
  text: string;
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
};

export function hasBridge(): boolean {
  return Boolean(process.env.ROOM_BRIDGE_URL && process.env.ROOM_BRIDGE_SECRET);
}

/**
 * True when a turn can be produced at all. A room with a `guildId` can speak
 * through the bridge even with no key on this deployment, so the answer depends
 * on the room.
 */
export function hasInference(guildId?: string): boolean {
  if (process.env.ANTHROPIC_API_KEY) return true;
  return Boolean(guildId) && hasBridge();
}

/**
 * Hand the prompt to firebase/functions/src/roomTurn.ts, which reads the guild's
 * key with admin credentials. Deliberately the only path by which a room touches
 * a server's key, and it is one-way: the key never comes back.
 */
async function callBridge(opts: {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  tools?: ToolSpec[];
  model?: string;
  maxTokens?: number;
  guildId?: string;
  onBehalfOf?: string;
}): Promise<ModelReply> {
  const res = await fetch(process.env.ROOM_BRIDGE_URL as string, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-room-bridge-secret': process.env.ROOM_BRIDGE_SECRET as string,
    },
    body: JSON.stringify({
      guildId: opts.guildId,
      memberUid: opts.onBehalfOf,
      system: opts.system,
      messages: opts.messages,
      tools: opts.tools,
      model: opts.model,
      maxTokens: opts.maxTokens,
    }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    // These three are the ones a room can actually fix, so say which it is.
    throw new Error(body.message ?? body.error ?? `bridge ${res.status}`);
  }

  return (await res.json()) as ModelReply;
}

/**
 * One model call. Returns prose and any tool calls separately so the caller
 * decides what a tool call *means* — this module deliberately never rolls a
 * die or scores an argument.
 *
 * Throws when there is no key. Callers that run inside a room should use
 * `runTurn`, which turns that into a visible system event instead.
 */
export async function callModel(opts: {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  tools?: ToolSpec[];
  model?: string;
  maxTokens?: number;
  /** Spend this server's key through the bridge when the deployment has none. */
  guildId?: string;
  /** Firebase uid the spend is attributed to; the bridge checks membership. */
  onBehalfOf?: string;
}): Promise<ModelReply> {
  const key = process.env.ANTHROPIC_API_KEY;

  // No deployment key: borrow the server's, the same one index.html has always
  // used. The key itself stays in Firebase — we send the prompt, not fetch the
  // secret.
  if (!key) {
    if (opts.guildId && hasBridge()) return await callBridge(opts);
    throw new Error('ANTHROPIC_API_KEY is not set on this Convex deployment');
  }

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: opts.model ?? SPEAK_MODEL(),
      max_tokens: opts.maxTokens ?? MAX_TOKENS,
      system: opts.system,
      messages: opts.messages,
      ...(opts.tools?.length ? { tools: opts.tools } : {}),
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }

  const body = (await res.json()) as {
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'tool_use'; name: string; input: Record<string, unknown> }
    >;
  };

  const text = body.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  const toolCalls = body.content
    .filter(
      (b): b is { type: 'tool_use'; name: string; input: Record<string, unknown> } =>
        b.type === 'tool_use',
    )
    .map((b) => ({ name: b.name, input: b.input }));

  return { text, toolCalls };
}

/** What the room can actually do right now, so both UIs can say so out loud. */
export const capabilities = query({
  args: { guildId: v.optional(v.string()) },
  handler: async (_ctx, { guildId }) => ({
    inference: hasInference(guildId),
    research: Boolean(process.env.LINKUP_API_KEY),
    /** How a turn would be paid for, so a UI can explain itself. */
    via: process.env.ANTHROPIC_API_KEY ? 'deployment' : hasBridge() ? 'server' : 'none',
  }),
});

// ─── Writers, so actions can touch the room ───────────────────────────────────

export const emitEvent = internalMutation({
  args: {
    roomId: v.id('rooms'),
    type: v.union(
      v.literal('say'),
      v.literal('action'),
      v.literal('host'),
      v.literal('dice'),
      v.literal('research'),
      v.literal('system'),
    ),
    actorKey: v.optional(v.string()),
    actorName: v.string(),
    body: v.string(),
    data: v.optional(v.any()),
  },
  handler: async (ctx, { roomId, ...event }) => {
    await appendEvent(ctx, roomId, event);
  },
});

/**
 * The transcript the model sees. Room events are already the single ordered
 * log both modes write to, so a debate turn and a D&D turn read identically.
 */
export const recentTranscript = internalQuery({
  args: { roomId: v.id('rooms'), limit: v.optional(v.number()) },
  handler: async (ctx, { roomId, limit }) => {
    const rows = await ctx.db
      .query('roomEvents')
      .withIndex('by_room_seq', (q) => q.eq('roomId', roomId))
      .order('desc')
      .take(limit ?? 40);
    rows.reverse();
    return rows.map((r) => ({ type: r.type, actorName: r.actorName, body: r.body }));
  },
});

/**
 * Where a room's turn gets paid for. `config.guildId` is set when a human starts
 * a game from inside a server; `config.startedBy` is their uid, which the bridge
 * checks against that server's membership.
 */
export const roomCredentials = internalQuery({
  args: { roomId: v.id('rooms') },
  handler: async (ctx, { roomId }) => {
    const room = await ctx.db.get(roomId);
    const cfg = (room?.config ?? {}) as { guildId?: string; startedBy?: string };
    return { guildId: cfg.guildId, startedBy: cfg.startedBy };
  },
});

// ─── The turn loop ────────────────────────────────────────────────────────────

/**
 * Produce one member's next contribution and write it to the room.
 *
 * `resolver` is the name of a mutation in the *calling* mode's module — the
 * D&D engine stays the thing that rolls dice, the debate engine stays the thing
 * that scores arguments. When the model calls a tool, that mutation is handed
 * the call verbatim; when it just talks, the prose is appended as `say`.
 *
 * `turnToken` is passed straight through to the resolver so a mode can drop a
 * reply whose turn claim has already expired, rather than letting a slow model
 * call speak out of order.
 */
export const runTurn = internalAction({
  args: {
    roomId: v.id('rooms'),
    memberKey: v.string(),
    actorName: v.string(),
    system: v.string(),
    /** Extra instruction for this turn only — "you have the floor", "you are being fact-checked". */
    prompt: v.optional(v.string()),
    tools: v.optional(v.array(v.any())),
    /** `module:export` of a mutation taking { roomId, memberKey, turnToken, call }. */
    resolver: v.optional(v.string()),
    turnToken: v.optional(v.number()),
    model: v.optional(v.string()),
    eventType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const creds = await ctx.runQuery(internal.agent.roomCredentials, { roomId: args.roomId });
    if (!hasInference(creds.guildId)) {
      // Visible, once per attempt, and identical in both UIs: a silent room
      // reads as a bug, and this is a missing credential.
      await ctx.runMutation(internal.agent.emitEvent, {
        roomId: args.roomId,
        type: 'system',
        actorName: 'room',
        body:
          `${args.actorName} cannot speak: no AI key is reachable. Either set ` +
          `ANTHROPIC_API_KEY on this deployment, or start the room from a server ` +
          `whose owner has filled in Server Settings → AI Assistance.`,
        data: { kind: 'missing-capability', capability: 'inference' },
      });
      return { spoke: false, reason: 'no-inference' as const };
    }

    const transcript = await ctx.runQuery(internal.agent.recentTranscript, {
      roomId: args.roomId,
    });

    const rendered = transcript
      .map((e) => (e.type === 'system' ? `[${e.body}]` : `${e.actorName}: ${e.body}`))
      .join('\n');

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      {
        role: 'user',
        content: `${rendered || '(the room is empty so far)'}\n\n---\n${
          args.prompt ?? 'It is your turn. Stay in character.'
        }`,
      },
    ];

    let reply: ModelReply;
    try {
      reply = await callModel({
        system: args.system,
        messages,
        tools: args.tools as ToolSpec[] | undefined,
        model: args.model,
        guildId: creds.guildId,
        onBehalfOf: creds.startedBy,
      });
    } catch (err) {
      await ctx.runMutation(internal.agent.emitEvent, {
        roomId: args.roomId,
        type: 'system',
        actorName: 'room',
        body: `${args.actorName} could not answer: ${(err as Error).message}`,
        data: { kind: 'inference-error' },
      });
      return { spoke: false, reason: 'error' as const };
    }

    if (reply.text) {
      await ctx.runMutation(internal.agent.emitEvent, {
        roomId: args.roomId,
        type: (args.eventType as 'say' | 'host' | 'action') ?? 'say',
        actorKey: args.memberKey,
        actorName: args.actorName,
        body: reply.text,
      });
    }

    // Tool calls belong to the mode, not to this module.
    if (reply.toolCalls.length && args.resolver) {
      const ref = makeFunctionReference<'mutation'>(args.resolver);
      for (const call of reply.toolCalls) {
        await ctx.runMutation(ref, {
          roomId: args.roomId,
          memberKey: args.memberKey,
          turnToken: args.turnToken,
          call,
        } as never);
      }
    }

    return { spoke: Boolean(reply.text), toolCalls: reply.toolCalls.length };
  },
});

/** Exported for the debate's verdict and any other one-shot judgement call. */
export function judgeModel(): string {
  return JUDGE_MODEL();
}
