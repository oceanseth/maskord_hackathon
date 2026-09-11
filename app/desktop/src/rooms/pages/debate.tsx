import { useEffect, useState } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '@maskord/convex';
import { RoomShell, mountRoomPage } from '../RoomShell';
import { RoomPanel } from '../RoomPanel';
import { useRoom, type RoomEvent, type RoomIdentity } from '../useRoom';
import { useMaskyAvatars } from '../../hooks/useMaskyAvatars';
import { useMaskordPro } from '../../hooks/useMaskordPro';
import PaywallModal from '../../components/pro/PaywallModal';
import GuestStarShelf from '../../components/pro/GuestStarShelf';
import ProPanelModal from '../../components/pro/ProPanelModal';

/**
 * The debate table. Masks argue the motion in character, fact-check each other
 * through Linkup, and the host calls it at the end.
 *
 * The page holds no debate state of its own — motion, house rules, round and
 * verdict all live on the room in Convex, which is what lets a spectator join
 * halfway through and see the same debate as everyone else, and what lets
 * /debatestats.html be a pure reader.
 */

/**
 * How often a tab asks the room for the next turn.
 *
 * The real pace is the server's, not this: `debate.takeTurn` holds a turn lease
 * for `TURN_CLAIM_TTL_MS` (20s) and drops ticks that arrive while it is held, so
 * turns land about every 20 seconds however many tabs are open. Measured, not
 * assumed — five `advance` calls in a row produced two turns, not five.
 */
const ADVANCE_MS = 12_000;

function DebateRoom({ identity }: { identity: RoomIdentity }) {
  const room = useRoom({ kind: 'debate', title: 'The Debate', identity });
  const debate = useQuery(api.debate.state, room.slug ? { slug: room.slug } : 'skip');
  const caps = useQuery(api.agent.capabilities, {});

  const start = useAction(api.debate.start);
  const advance = useMutation(api.debate.advance);
  const factCheck = useMutation(api.debate.factCheck);
  const seatMask = useMutation(api.debate.seatMask);
  const unseatMask = useMutation(api.debate.unseatMask);
  const seatHouseCast = useMutation(api.debate.seatHouseCast);
  const takeFloor = useMutation(api.debate.takeFloor);
  const leaveFloor = useMutation(api.debate.leaveFloor);

  // Your own masks, so the panel is your characters rather than ours. Same
  // source the Maskord client uses for its AI assistance tab.
  const { avatarGroups } = useMaskyAvatars(identity.key);
  const seated = new Set(room.masks.map((m) => m.memberKey));
  const onTheFloor = (debate?.order ?? []).includes(identity.key);

  // Maskord Pro: seating a mask somebody *else* published is the paid feature.
  // Your own masks and the house panel stay free, so a judge with no account
  // still gets a debate.
  const pro = useMaskordPro(identity.key);
  const [paywallFor, setPaywallFor] = useState<string | null>(null);
  const [proPanelOpen, setProPanelOpen] = useState(false);

  const [topic, setTopic] = useState('');
  const [claim, setClaim] = useState('');
  const [starting, setStarting] = useState(false);

  const status = room.room?.status ?? 'lobby';

  // A running debate advances on a timer, and every open tab runs it. That is
  // deliberate — no tab is special, so closing one does not stall the room —
  // but it means the server has to be the thing that refuses a second speaker:
  // `debate.takeTurn` leases the room's turn and drops any tick that arrives
  // while a turn is already in flight. This interval is a nudge, not a schedule.
  useEffect(() => {
    if (status !== 'running' || !room.slug) return;
    const id = setInterval(() => {
      void advance({ slug: room.slug }).catch(() => {});
    }, ADVANCE_MS);
    return () => clearInterval(id);
  }, [status, room.slug, advance]);

  return (
    <>
    <RoomPanel
      room={room}
      placeholder="Make your point…"
      renderEvent={renderDebateEvent}
      header={
        <div className="px-4 py-3 border-b border-[#1f1f2e] space-y-2">
          {/* Status and the rent-out shelf. Shown to everyone: an unsubscribed
              visitor needs somewhere to see what Pro is before the padlock. */}
          <div className="flex justify-end">
            <button
              onClick={() => setProPanelOpen(true)}
              className={
                pro.pro
                  ? 'text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-violet-900/50 border border-violet-700/50 text-violet-200'
                  : 'text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-[#1e1e2e] border border-[#2a2a3e] text-[#6b7280] hover:text-[#cbd5e1]'
              }
            >
              {pro.pro ? 'Pro' : 'Maskord Pro'}
            </button>
          </div>

          {caps && (!caps.inference || !caps.research) && (
            <div className="text-xs rounded border border-amber-700/40 bg-amber-900/20 text-amber-200 px-3 py-2">
              {!caps.inference
                ? 'No ANTHROPIC_API_KEY on this deployment — the masks cannot speak yet. Humans still can.'
                : 'No LINKUP_API_KEY on this deployment — fact-checks are unavailable.'}
            </div>
          )}

          {debate?.topic ? (
            <>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[#6b7280]">The motion</div>
                <div className="font-display text-lg leading-snug">{debate.topic}</div>
              </div>
              {debate.rules.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {debate.rules.map((r) => (
                    <span
                      key={r.id}
                      title={r.instruction}
                      className="text-[11px] px-2 py-0.5 rounded-full bg-violet-900/40 border border-violet-700/40 text-violet-200"
                    >
                      {r.label}
                    </span>
                  ))}
                </div>
              )}
              <div className="text-xs text-[#6b7280]">
                Round {Math.min(debate.round, debate.maxRounds)} of {debate.maxRounds}
                {status === 'finished' && debate.verdict
                  ? ` · won by ${debate.verdict.winner}`
                  : ''}
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <div className="text-sm text-[#94a3b8]">
                No motion yet. Leave it blank and the host will write one for tonight's panel.
              </div>
              {/* Who is on the floor. Empty means `start` seats the house panel,
                  so the button always produces a debate. */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wide text-[#6b7280] mr-1">Panel</span>
                {room.masks.map((m) => (
                  <button
                    key={m.memberKey}
                    onClick={() => unseatMask({ slug: room.slug, memberKey: m.memberKey })}
                    title="Remove from the panel"
                    className="text-[11px] px-2 py-0.5 rounded-full bg-[#1e1e2e] border border-[#2a2a3e] hover:border-red-700/60 text-[#cbd5e1]"
                  >
                    {m.name} ×
                  </button>
                ))}
                {room.masks.length === 0 && (
                  <button
                    onClick={() => seatHouseCast({ slug: room.slug })}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-[#1e1e2e] border border-[#2a2a3e] hover:border-violet-700/60 text-[#94a3b8]"
                  >
                    Seat the house panel
                  </button>
                )}
                {avatarGroups
                  .filter((g) => !seated.has(`mask:${g.id}`))
                  .map((g) => (
                    <button
                      key={g.id}
                      onClick={() =>
                        seatMask({
                          slug: room.slug,
                          memberKey: `mask:${g.id}`,
                          name: g.displayName,
                          persona: g.personalityPrompt ?? '',
                          avatarUrl: g.thumbnailUrl,
                        })
                      }
                      className="text-[11px] px-2 py-0.5 rounded-full bg-fuchsia-900/40 border border-fuchsia-700/50 hover:bg-fuchsia-800/50 text-fuchsia-100"
                    >
                      + {g.displayName}
                    </button>
                  ))}
              </div>

              <GuestStarShelf
                pro={pro.pro}
                seated={seated}
                onSeat={(mask) =>
                  seatMask({
                    slug: room.slug,
                    memberKey: mask.memberKey,
                    name: mask.name,
                    persona: mask.persona,
                    avatarUrl: mask.avatarUrl,
                  })
                }
                onLocked={setPaywallFor}
              />

              <div className="flex gap-2">
                <input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Be it resolved: …"
                  className="flex-1 px-3 py-2 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] focus:border-violet-600 text-sm outline-none"
                />
                <button
                  disabled={starting || !room.slug}
                  onClick={async () => {
                    setStarting(true);
                    try {
                      await start({ slug: room.slug, topic: topic.trim() || undefined });
                    } finally {
                      setStarting(false);
                    }
                  }}
                  className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-sm font-semibold"
                >
                  {starting ? 'Opening…' : 'Open the debate'}
                </button>
              </div>
            </div>
          )}
        </div>
      }
      footer={
        status !== 'lobby' && (
          <div className="px-4 py-2 border-t border-[#1f1f2e] flex gap-2">
            <input
              value={claim}
              onChange={(e) => setClaim(e.target.value)}
              placeholder="Challenge a claim — the room will go and check it"
              className="flex-1 px-3 py-1.5 rounded bg-[#0a0a0f] border border-[#1e1e2e] focus:border-violet-600 text-xs outline-none"
            />
            {/* Spectating is the default; this is the opt-in to being judged. */}
            <button
              onClick={() =>
                onTheFloor
                  ? leaveFloor({ slug: room.slug, memberKey: identity.key })
                  : takeFloor({ slug: room.slug, memberKey: identity.key })
              }
              className={`text-xs px-3 py-1.5 rounded shrink-0 ${
                onTheFloor
                  ? 'bg-violet-700 hover:bg-violet-600 text-white'
                  : 'bg-[#2a2a3e] hover:bg-[#3a3a5e] text-[#cbd5e1]'
              }`}
              title={
                onTheFloor
                  ? 'Leave the speaking order — you can still watch and fact-check'
                  : 'Join the speaking order and be scored alongside the masks'
              }
            >
              {onTheFloor ? 'On the floor' : 'Take the floor'}
            </button>
            {/*
              A fact-check is a search *and* a reading of what it found, so it
              needs both keys: `research.investigate` refuses up front when
              either is missing. Gating on `research` alone offered a button
              that could only ever answer "cannot research" — which is exactly
              what LINKUP_API_KEY arriving before an AI key would have shown.
            */}
            <button
              disabled={!claim.trim() || !caps?.research || !caps?.inference}
              title={
                caps?.research
                  ? caps?.inference
                    ? undefined
                    : 'Needs an AI key — the sources still have to be weighed'
                  : 'Needs LINKUP_API_KEY'
              }
              onClick={async () => {
                await factCheck({ slug: room.slug, claim: claim.trim() });
                setClaim('');
              }}
              className="text-xs px-3 py-1.5 rounded bg-[#2a2a3e] hover:bg-[#3a3a5e] disabled:opacity-40"
            >
              Fact-check
            </button>
          </div>
        )
      }
    />
    {proPanelOpen && (
      <ProPanelModal
        uid={identity.key}
        displayName={identity.name}
        pro={pro}
        onUpgrade={() => {
          setProPanelOpen(false);
          setPaywallFor('');
        }}
        onClose={() => setProPanelOpen(false)}
      />
    )}
    {paywallFor !== null && (
      <PaywallModal
        offering={pro.offering}
        blockedBy={paywallFor}
        lapsed={pro.lapsed}
        onPurchased={() => {
          void pro.refresh();
          setPaywallFor(null);
        }}
        onClose={() => setPaywallFor(null)}
      />
    )}
    </>
  );
}

/**
 * Research and verdict events carry structure worth showing — sources you can
 * click, and the score breakdown the host actually used. Everything else falls
 * through to the shared renderer.
 */
export function renderDebateEvent(e: RoomEvent) {
  if (e.type === 'research') {
    const d = (e.data ?? {}) as {
      claim?: string;
      iteration?: number;
      confidence?: number;
      sources?: Array<{ title: string; url: string }>;
      stopReason?: string;
    };
    return (
      <div className="text-sm rounded border border-sky-800/40 bg-sky-950/30 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wide text-sky-300/70">
          Research · pass {(d.iteration ?? 0) + 1}
          {typeof d.confidence === 'number' ? ` · confidence ${Math.round(d.confidence * 100)}%` : ''}
          {d.stopReason ? ` · stopped: ${d.stopReason}` : ''}
        </div>
        {d.claim && <div className="text-xs text-[#94a3b8] italic mt-0.5">“{d.claim}”</div>}
        <div className="mt-1 whitespace-pre-wrap">{e.body}</div>
        {!!d.sources?.length && (
          <ul className="mt-1.5 space-y-0.5">
            {d.sources.map((s, i) => (
              <li key={`${s.url}-${i}`} className="text-xs truncate">
                <a href={s.url} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">
                  {s.title || s.url}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const data = (e.data ?? {}) as { kind?: string; winner?: string; scores?: Score[] };
  if (e.type === 'host' && data.kind === 'verdict') {
    return (
      <div className="text-sm rounded border border-amber-700/40 bg-amber-950/20 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wide text-amber-300/80">Verdict</div>
        <div className="mt-1 whitespace-pre-wrap">{e.body}</div>
        {!!data.scores?.length && <ScoreTable scores={data.scores} />}
      </div>
    );
  }

  return undefined;
}

export type Score = {
  name: string;
  total: number;
  byCriterion: Record<string, number>;
  note: string;
};

export const CRITERIA: Array<{ id: string; label: string }> = [
  { id: 'entertainment', label: 'Entertainment' },
  { id: 'argument', label: 'Argument' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'character', label: 'In character' },
];

export function ScoreTable({ scores }: { scores: Score[] }) {
  const ranked = [...scores].sort((a, b) => b.total - a.total);
  return (
    <table className="mt-2 w-full text-xs">
      <thead className="text-[#6b7280]">
        <tr>
          <th className="text-left font-normal py-1">Debater</th>
          {CRITERIA.map((c) => (
            <th key={c.id} className="text-right font-normal px-1">
              {c.label}
            </th>
          ))}
          <th className="text-right font-normal pl-2">Total</th>
        </tr>
      </thead>
      <tbody>
        {ranked.map((s) => (
          <tr key={s.name} className="border-t border-[#1f1f2e]/60">
            <td className="py-1 pr-2 truncate" title={s.note}>
              {s.name}
            </td>
            {CRITERIA.map((c) => (
              <td key={c.id} className="text-right px-1 tabular-nums text-[#94a3b8]">
                {s.byCriterion?.[c.id] ?? '—'}
              </td>
            ))}
            <td className="text-right pl-2 tabular-nums font-semibold">{s.total}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

mountRoomPage(<RoomShell render={(identity) => <DebateRoom identity={identity} />} />);
