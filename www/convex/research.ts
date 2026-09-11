import { v } from 'convex/values';
import { internalAction, internalMutation, query } from './_generated/server';
import { internal } from './_generated/api';
import { appendEvent } from './rooms';
import { callModel, hasInference } from './agent';
import type { Id } from './_generated/dataModel';

/**
 * Linkup research, shared by both game modes: the debate fact-checks a
 * contested claim, the D&D table asks whether an oil flask really sets a
 * zombie alight.
 *
 * Deliberately a *loop*, not a lookup. Each pass stores what it found, how
 * sure it is, and what it still does not know; the next search is chosen from
 * those gaps rather than being fixed up front. The stored rows are the thing
 * that decides the next query, which is the whole point — and it means the
 * room can replay how it got somewhere instead of just asserting it.
 */

const LINKUP_URL = 'https://api.linkup.so/v1/search';
const MAX_ITERATIONS = 3;
/** Above this, another search is unlikely to change the answer. */
const CONFIDENT_AT = 0.8;
const MAX_SOURCES = 5;

export function hasResearch(): boolean {
  return Boolean(process.env.LINKUP_API_KEY);
}

type Source = { title: string; url: string; snippet: string };

async function linkupSearch(query: string): Promise<Source[]> {
  const key = process.env.LINKUP_API_KEY;
  if (!key) throw new Error('LINKUP_API_KEY is not set on this Convex deployment');

  const res = await fetch(LINKUP_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ q: query, depth: 'standard', outputType: 'searchResults' }),
  });
  if (!res.ok) {
    throw new Error(`Linkup ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const body = (await res.json()) as {
    results?: Array<{ name?: string; title?: string; url?: string; content?: string; snippet?: string }>;
  };

  return (body.results ?? []).slice(0, MAX_SOURCES).map((r) => ({
    title: (r.name ?? r.title ?? r.url ?? 'untitled').slice(0, 200),
    url: r.url ?? '',
    snippet: (r.content ?? r.snippet ?? '').slice(0, 600),
  }));
}

/**
 * Read the sources and say what they support, how strongly, and what is still
 * missing. Returning gaps is what makes the next iteration meaningful, so the
 * model is asked for them even when it is already confident.
 */
async function assess(
  claim: string,
  query: string,
  sources: Source[],
): Promise<{ finding: string; confidence: number; gaps: string[]; nextQuery: string | null }> {
  const rendered = sources
    .map((s, i) => `[${i + 1}] ${s.title}\n${s.url}\n${s.snippet}`)
    .join('\n\n');

  const reply = await callModel({
    system:
      'You assess evidence for a live game room. Answer only with JSON matching ' +
      '{"finding":string,"confidence":number,"gaps":string[],"nextQuery":string|null}. ' +
      'confidence is 0..1 for how well the sources settle the claim. gaps are specific ' +
      'unanswered questions. nextQuery is the single best search to close the most ' +
      'important gap, or null if further searching would not help.',
    messages: [
      {
        role: 'user',
        content: `Claim under investigation: ${claim}\nThis pass searched: ${query}\n\nSources:\n${
          rendered || '(no results)'
        }`,
      },
    ],
    maxTokens: 700,
  });

  try {
    const json = reply.text.replace(/^```(?:json)?|```$/gm, '').trim();
    const parsed = JSON.parse(json) as {
      finding?: string;
      confidence?: number;
      gaps?: string[];
      nextQuery?: string | null;
    };
    return {
      finding: (parsed.finding ?? '').slice(0, 1000),
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0))),
      gaps: (parsed.gaps ?? []).slice(0, 5).map((g) => String(g).slice(0, 300)),
      nextQuery: parsed.nextQuery ? String(parsed.nextQuery).slice(0, 300) : null,
    };
  } catch {
    // A malformed assessment is still a finding — keep the prose, stop the loop.
    return { finding: reply.text.slice(0, 1000), confidence: 0, gaps: [], nextQuery: null };
  }
}

export const record = internalMutation({
  args: {
    roomId: v.id('rooms'),
    claim: v.string(),
    askedBy: v.string(),
    iteration: v.number(),
    query: v.string(),
    sources: v.array(v.object({ title: v.string(), url: v.string(), snippet: v.string() })),
    finding: v.string(),
    confidence: v.number(),
    gaps: v.array(v.string()),
    nextQuery: v.union(v.string(), v.null()),
    stopReason: v.optional(
      v.union(
        v.literal('confident'),
        v.literal('no-gaps'),
        v.literal('max-iterations'),
        v.literal('error'),
      ),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('research', { ...args, provider: 'linkup' });
    // The room sees research happen, so the moderator can narrate it and the
    // stats screen can show sources arriving live.
    await appendEvent(ctx, args.roomId, {
      type: 'research',
      actorName: args.askedBy,
      body: args.finding || `Searched: ${args.query}`,
      data: {
        claim: args.claim,
        iteration: args.iteration,
        query: args.query,
        confidence: args.confidence,
        sources: args.sources.map((s) => ({ title: s.title, url: s.url })),
        stopReason: args.stopReason,
      },
    });
  },
});

/**
 * Run the loop for one claim. Stops on confidence, on running out of gaps, or
 * on the iteration cap — whichever comes first — and records the reason.
 */
export const investigate = internalAction({
  args: {
    roomId: v.id('rooms'),
    claim: v.string(),
    askedBy: v.string(),
    maxIterations: v.optional(v.number()),
  },
  handler: async (ctx, { roomId, claim, askedBy, maxIterations }) => {
    const missing: string[] = [];
    if (!hasResearch()) missing.push('LINKUP_API_KEY');
    if (!hasInference()) missing.push('ANTHROPIC_API_KEY');
    if (missing.length) {
      await ctx.runMutation(internal.agent.emitEvent, {
        roomId,
        type: 'system',
        actorName: 'room',
        body:
          `Cannot research "${claim.slice(0, 80)}": this deployment has no ` +
          `${missing.join(' and ')}.`,
        data: { kind: 'missing-capability', capability: 'research', missing },
      });
      return { iterations: 0, reason: 'missing-capability' as const };
    }

    const cap = Math.max(1, Math.min(maxIterations ?? MAX_ITERATIONS, MAX_ITERATIONS));
    let query = claim;
    let iteration = 0;

    while (iteration < cap) {
      let sources: Source[];
      try {
        sources = await linkupSearch(query);
      } catch (err) {
        await ctx.runMutation(internal.research.record, {
          roomId, claim, askedBy, iteration, query,
          sources: [],
          finding: `Search failed: ${(err as Error).message}`,
          confidence: 0, gaps: [], nextQuery: null, stopReason: 'error',
        });
        return { iterations: iteration + 1, reason: 'error' as const };
      }

      // `assess` calls the model, so it fails for all the reasons a model call
      // fails. Leaving it outside the try meant a thrown assessment aborted the
      // action with nothing written, and the room just went quiet.
      let assessed;
      try {
        assessed = await assess(claim, query, sources);
      } catch (err) {
        await ctx.runMutation(internal.research.record, {
          roomId, claim, askedBy, iteration, query, sources,
          finding: `Could not weigh the sources: ${(err as Error).message}`,
          confidence: 0, gaps: [], nextQuery: null, stopReason: 'error',
        });
        return { iterations: iteration + 1, reason: 'error' as const };
      }
      const { finding, confidence, gaps, nextQuery } = assessed;
      const last = iteration + 1 >= cap;
      const stopReason =
        confidence >= CONFIDENT_AT ? 'confident'
        : !nextQuery || gaps.length === 0 ? 'no-gaps'
        : last ? 'max-iterations'
        : undefined;

      await ctx.runMutation(internal.research.record, {
        roomId, claim, askedBy, iteration, query, sources,
        finding, confidence, gaps,
        // The stored nextQuery is what the following pass will search, so it is
        // null exactly when this row is the last one.
        nextQuery: stopReason ? null : nextQuery,
        stopReason,
      });

      if (stopReason) return { iterations: iteration + 1, reason: stopReason };

      query = nextQuery as string;
      iteration += 1;
    }

    return { iterations: iteration, reason: 'max-iterations' as const };
  },
});

/** Every pass for a room, oldest first — the stats screen renders the chain. */
export const forRoom = query({
  args: { roomId: v.id('rooms') },
  handler: async (ctx, { roomId }: { roomId: Id<'rooms'> }) => {
    const rows = await ctx.db
      .query('research')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .collect();
    return rows.sort((a, b) =>
      a.claim === b.claim ? a.iteration - b.iteration : a._creationTime - b._creationTime,
    );
  },
});
