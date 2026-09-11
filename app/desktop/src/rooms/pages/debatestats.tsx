import { useQuery } from 'convex/react';
import { api } from '@maskord/convex';
import { RoomScreen, mountRoomPage } from '../RoomShell';
import { EventLog, MemberStrip, StatusPill } from '../RoomPanel';
import { useRoom } from '../useRoom';
import { CRITERIA, ScoreTable, renderDebateEvent, type Score } from './debate';

/**
 * The second screen. Read-only on purpose: it joins no room and posts nothing,
 * so it can be thrown on a projector next to the debate without a stray click
 * pausing the table. Everything here is derived from the same Convex state the
 * debate page reads.
 */
function DebateStats() {
  const room = useRoom({ kind: 'debate', title: 'The Debate', identity: null });
  const debate = useQuery(api.debate.state, room.slug ? { slug: room.slug } : 'skip');
  const research = useQuery(
    api.research.forRoom,
    room.roomId ? { roomId: room.roomId } : 'skip',
  );

  const chains = groupByClaim(research ?? []);
  const verdict = debate?.verdict ?? null;

  return (
    <div className="flex flex-col h-full min-h-0 p-4 gap-3 font-body text-[#e2e8f0]">
      <div className="flex items-baseline gap-3">
        <h1 className="font-display text-2xl font-semibold">{room.room?.title ?? 'The Debate'}</h1>
        <StatusPill status={room.room?.status ?? 'lobby'} />
        {debate && debate.round > 0 && (
          <span className="text-xs text-[#6b7280]">
            Round {Math.min(debate.round, debate.maxRounds)} of {debate.maxRounds}
          </span>
        )}
      </div>

      {debate?.topic && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-[#6b7280]">The motion</div>
          <div className="font-display text-xl leading-snug">{debate.topic}</div>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {debate.rules.map((r) => (
              <span
                key={r.id}
                className="text-[11px] px-2 py-0.5 rounded-full bg-violet-900/40 border border-violet-700/40 text-violet-200"
                title={r.instruction}
              >
                {r.label}
              </span>
            ))}
          </div>
        </div>
      )}

      <MemberStrip members={room.members} />

      {verdict && (
        <div className="rounded border border-amber-700/40 bg-amber-950/20 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-amber-300/80">
            Called for {verdict.winner}
          </div>
          <div className="text-sm mt-1">{verdict.summary}</div>
          <ScoreTable scores={verdict.scores as Score[]} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 flex-1 min-h-0">
        <EventLog events={room.events} renderEvent={renderDebateEvent} />

        <div className="min-h-0 overflow-y-auto rounded border border-[#1f1f2e] p-3 space-y-3">
          <div className="text-[10px] uppercase tracking-wide text-[#6b7280]">
            Research · {research?.length ?? 0} passes over {chains.length} claims
          </div>
          {chains.length === 0 && (
            <div className="text-xs text-[#6b7280]">
              Nothing checked yet. A debater can call for it, or anyone can challenge a claim.
            </div>
          )}
          {chains.map((chain) => (
            <div key={chain.claim} className="text-sm">
              <div className="italic text-[#94a3b8]">“{chain.claim}”</div>
              <ol className="mt-1 space-y-1.5">
                {chain.passes.map((p) => (
                  <li key={p._id} className="pl-3 border-l border-sky-800/50">
                    <div className="text-[11px] text-sky-300/70">
                      searched “{p.query}” · confidence {Math.round(p.confidence * 100)}%
                      {p.stopReason ? ` · stopped: ${p.stopReason}` : ''}
                    </div>
                    <div className="text-xs">{p.finding}</div>
                    {/* The gap that produced the next search — the loop, made visible. */}
                    {p.nextQuery && (
                      <div className="text-[11px] text-[#6b7280]">↳ next: {p.nextQuery}</div>
                    )}
                    {p.sources.length > 0 && (
                      <ul className="mt-0.5">
                        {p.sources.map((s, i) => (
                          <li key={`${s.url}-${i}`} className="text-[11px] truncate">
                            <a
                              href={s.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sky-300 hover:underline"
                            >
                              {s.title || s.url}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </div>

      <div className="text-[10px] text-[#4b5563]">
        Scored on {CRITERIA.map((c) => c.label.toLowerCase()).join(' · ')}
      </div>
    </div>
  );
}

type Pass = {
  _id: string;
  claim: string;
  query: string;
  finding: string;
  confidence: number;
  nextQuery: string | null;
  stopReason?: string;
  sources: Array<{ title: string; url: string }>;
};

/** Passes arrive flat and already ordered; group them so each claim reads as a chain. */
function groupByClaim(rows: Pass[]): Array<{ claim: string; passes: Pass[] }> {
  const out: Array<{ claim: string; passes: Pass[] }> = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last && last.claim === row.claim) last.passes.push(row);
    else out.push({ claim: row.claim, passes: [row] });
  }
  return out;
}

mountRoomPage(<RoomScreen render={() => <DebateStats />} />);
