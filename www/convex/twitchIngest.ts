'use node';

import * as tls from 'node:tls';
import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';

/**
 * The connection half of the Twitch bridge: an anonymous IRC session on
 * irc.chat.twitch.tv, read-only, no credentials — Twitch allows `justinfan*`
 * nicks to read any channel's chat. Convex actions are bounded, so one
 * invocation holds the socket for a few minutes and then schedules its
 * successor; `twitch.ts` owns when the chain starts and the generation check
 * that ends it.
 *
 * Raw TLS rather than a websocket client on purpose: the IRC line protocol is
 * ten lines of parsing, and a dependency-free file is one the bundler can never
 * break.
 */

/** Under Convex's action time limit with room to finish writes and reschedule. */
const SESSION_MS = 4 * 60_000;
const ALIVE_MS = 45_000;
/** A chat busier than this is beyond what one room can read anyway. */
const MAX_PER_SESSION = 1500;

export const ingestLoop = internalAction({
  args: { slug: v.string(), generation: v.number() },
  handler: async (ctx, { slug, generation }) => {
    const state = await ctx.runQuery(internal.twitch.state, { slug });
    if (!state || !state.enabled || !state.channel || state.generation !== generation) return;

    // Writes are chained, not awaited inline: the socket callback must never
    // block, and one failed mutation should not kill the session.
    let chain: Promise<unknown> = Promise.resolve();
    const push = (work: () => Promise<unknown>) => {
      chain = chain.then(work).catch((err) => console.error('twitch ingest write failed', err));
    };

    const outcome = await new Promise<'session-over' | 'closed' | 'error'>((resolve) => {
      let buf = '';
      let processed = 0;
      let settled = false;

      const socket = tls.connect(6697, 'irc.chat.twitch.tv', {}, () => {
        // Tags carry user-id and display-name; the anonymous nick is the
        // documented read-only login.
        const nick = `justinfan${Math.floor(10_000 + Math.random() * 80_000)}`;
        socket.write(`CAP REQ :twitch.tv/tags\r\nNICK ${nick}\r\nJOIN #${state.channel}\r\n`);
      });

      const sessionTimer = setTimeout(() => done('session-over'), SESSION_MS);
      const aliveTimer = setInterval(() => {
        push(() => ctx.runMutation(internal.twitch.alive, { slug, generation }));
      }, ALIVE_MS);

      function done(result: 'session-over' | 'closed' | 'error') {
        if (settled) return;
        settled = true;
        clearTimeout(sessionTimer);
        clearInterval(aliveTimer);
        socket.destroy();
        resolve(result);
      }

      socket.setEncoding('utf8');
      socket.on('data', (data: string) => {
        buf += data;
        let nl: number;
        while ((nl = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 2);
          if (line.startsWith('PING')) {
            socket.write(`PONG${line.slice(4)}\r\n`);
            continue;
          }
          const msg = parsePrivmsg(line);
          if (!msg) continue;
          if (++processed > MAX_PER_SESSION) {
            done('session-over');
            return;
          }
          push(() => ctx.runMutation(internal.twitch.ingest, { slug, generation, ...msg }));
        }
      });
      socket.on('error', () => done('error'));
      socket.on('close', () => done('closed'));
    });

    await chain;

    // Reschedule only while this generation is still the configured one; a
    // disable or re-point bumped it, and this chain ends here.
    const after = await ctx.runQuery(internal.twitch.state, { slug });
    if (after && after.enabled && after.generation === generation) {
      await ctx.scheduler.runAfter(
        outcome === 'session-over' ? 1_000 : 15_000,
        internal.twitchIngest.ingestLoop,
        { slug, generation },
      );
    }
  },
});

/**
 * One tagged IRC line → who said what, or null for anything that is not a chat
 * message. `@tags :login!login@login.tmi.twitch.tv PRIVMSG #channel :text`.
 */
function parsePrivmsg(
  line: string,
): { login: string; userId: string; name: string; text: string } | null {
  if (!line.startsWith('@')) return null;
  const sp = line.indexOf(' ');
  if (sp < 0) return null;

  const rest = line.slice(sp + 1);
  const m = /^:([^!\s]+)!\S+ PRIVMSG #\S+ :(.*)$/.exec(rest);
  if (!m) return null;

  const tags: Record<string, string> = {};
  for (const kv of line.slice(1, sp).split(';')) {
    const eq = kv.indexOf('=');
    if (eq > 0) tags[kv.slice(0, eq)] = kv.slice(eq + 1);
  }
  const userId = tags['user-id'];
  if (!userId) return null;

  // IRC tag values escape space, semicolon and backslash.
  const name = (tags['display-name'] || m[1])
    .replace(/\\s/g, ' ')
    .replace(/\\:/g, ';')
    .replace(/\\\\/g, '\\');

  return { login: m[1], userId, name, text: m[2] };
}
