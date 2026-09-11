import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { RoomEvent, RoomHandle, RoomMember } from './useRoom';

/**
 * The generic room UI every kind shares: status header with pause/resume,
 * member strip, the event log, and a say/act input. Kind-specific pages put
 * their own controls in `header` and `footer`, and can override how an event
 * renders through `renderEvent`.
 */
export function RoomPanel({
  room,
  header,
  footer,
  renderEvent,
  memberExtra,
  placeholder = 'Say something…',
  onSay,
  hidePause,
}: {
  room: RoomHandle;
  header?: ReactNode;
  footer?: ReactNode;
  renderEvent?: (e: RoomEvent) => ReactNode | undefined;
  memberExtra?: (m: RoomMember) => ReactNode;
  placeholder?: string;
  /** Override where plain text goes (the D&D page sends it to the DM). */
  onSay?: (text: string) => Promise<unknown>;
  /** Pages with their own pause semantics (the D&D engine) render their own controls. */
  hidePause?: boolean;
}) {
  const { room: doc, members, events, me, post, setStatus } = room;
  const status = doc?.status ?? 'lobby';

  return (
    <div className="flex flex-col h-full min-h-0 font-body text-[#e2e8f0]">
      <div className="px-4 py-3 border-b border-[#1f1f2e] flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-display font-semibold truncate">{doc?.title ?? '…'}</div>
          <div className="text-xs text-[#8b8fa3] flex items-center gap-2">
            <StatusPill status={status} />
            {doc?.status === 'paused' && doc.pause && (
              <span className="truncate">
                by {doc.pause.byName}
                {doc.pause.reason ? ` — ${doc.pause.reason}` : ''}
              </span>
            )}
          </div>
        </div>
        {me && !hidePause && status === 'running' && (
          <button
            className="text-xs px-2 py-1 rounded bg-[#2a2a3e] hover:bg-[#3a3a5e]"
            onClick={() => setStatus('paused', 'checking a character sheet')}
            title="Everyone at the table pauses until someone resumes"
          >
            Pause
          </button>
        )}
        {me && !hidePause && status === 'paused' && (
          <button
            className="text-xs px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600"
            onClick={() => setStatus('running')}
          >
            Resume
          </button>
        )}
      </div>

      {header}

      <MemberStrip members={members} meKey={me?.memberKey} extra={memberExtra} />

      <EventLog events={events} renderEvent={renderEvent} />

      {footer}

      {me && <SayBox onSend={(type, body) => (onSay && type === 'say' ? onSay(body) : post(type, body))} placeholder={placeholder} />}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const color =
    status === 'running'
      ? 'bg-emerald-600/30 text-emerald-300'
      : status === 'paused'
        ? 'bg-amber-600/30 text-amber-300'
        : status === 'finished'
          ? 'bg-[#2a2a3e] text-[#8b8fa3]'
          : 'bg-sky-600/30 text-sky-300';
  return <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide ${color}`}>{status}</span>;
}

export function MemberStrip({
  members,
  meKey,
  extra,
}: {
  members: RoomMember[];
  meKey?: string;
  extra?: (m: RoomMember) => ReactNode;
}) {
  const ordered = [...members].sort((a, b) => {
    const rank = (m: RoomMember) => (m.kind === 'host' ? 0 : m.kind === 'human' ? 1 : 2);
    return rank(a) - rank(b) || a.name.localeCompare(b.name);
  });
  return (
    <div className="px-3 py-2 border-b border-[#1f1f2e] flex flex-wrap gap-1.5">
      {ordered.map((m) => (
        <div
          key={m._id}
          className={`flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full text-xs border ${
            m.memberKey === meKey ? 'border-sky-500/60' : 'border-[#2a2a3e]'
          } ${m.present ? '' : 'opacity-50'}`}
          title={`${m.kind}${m.present ? '' : ' (away)'}`}
        >
          <Avatar member={m} />
          <span className="truncate max-w-[9rem]">{m.name}</span>
          {m.kind === 'host' && <span className="text-[10px] text-amber-300">host</span>}
          {m.kind === 'mask' && <span className="text-[10px] text-fuchsia-300">mask</span>}
          {m.kind === 'human' && !m.ready && <span className="text-[10px] text-[#8b8fa3]">not ready</span>}
          {extra?.(m)}
        </div>
      ))}
    </div>
  );
}

export function Avatar({ member, size = 18 }: { member: Pick<RoomMember, 'name' | 'avatarUrl' | 'kind'>; size?: number }) {
  if (member.avatarUrl) {
    return <img src={member.avatarUrl} alt="" width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  const bg = member.kind === 'host' ? '#b45309' : member.kind === 'mask' ? '#86198f' : '#1d4ed8';
  return (
    <span
      className="rounded-full inline-flex items-center justify-center text-[10px] font-semibold text-white"
      style={{ width: size, height: size, background: bg }}
    >
      {member.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function EventLog({
  events,
  renderEvent,
}: {
  events: RoomEvent[];
  renderEvent?: (e: RoomEvent) => ReactNode | undefined;
}) {
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [events.length]);

  return (
    <div className="flex-1 min-h-0 scrollable px-4 py-3 space-y-2 selectable">
      {events.map((e) => {
        const custom = renderEvent?.(e);
        if (custom !== undefined) return <div key={e._id}>{custom}</div>;
        return <DefaultEvent key={e._id} e={e} />;
      })}
      <div ref={bottom} />
    </div>
  );
}

export function DefaultEvent({ e }: { e: RoomEvent }) {
  if (e.type === 'system') {
    return <div className="text-xs text-[#8b8fa3] italic">{e.body}</div>;
  }
  if (e.type === 'dice') {
    return (
      <div className="text-xs font-mono text-amber-200 bg-amber-900/20 rounded px-2 py-1">
        🎲 <span className="text-[#e2e8f0]">{e.actorName}</span> {e.body}
      </div>
    );
  }
  if (e.type === 'research') {
    return (
      <div className="text-xs text-sky-200 bg-sky-900/20 rounded px-2 py-1 whitespace-pre-wrap">
        🔎 {e.body}
      </div>
    );
  }
  if (e.type === 'host') {
    return (
      <div className="text-sm">
        <span className="font-semibold text-amber-300">{e.actorName}</span>{' '}
        <span className="whitespace-pre-wrap">{e.body}</span>
      </div>
    );
  }
  if (e.type === 'action') {
    return (
      <div className="text-sm italic text-[#c7cbe0]">
        <span className="font-semibold not-italic">{e.actorName}</span> {e.body}
      </div>
    );
  }
  return (
    <div className="text-sm">
      <span className="font-semibold">{e.actorName}</span>{' '}
      <span className="whitespace-pre-wrap">{e.body}</span>
    </div>
  );
}

export function SayBox({
  onSend,
  placeholder,
}: {
  onSend: (type: 'say' | 'action', body: string) => Promise<unknown>;
  placeholder: string;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const raw = text.trim();
    if (!raw || busy) return;
    // "/me draws a sword" posts as an action, like every chat since IRC.
    const isAction = /^\/me\s+/i.test(raw);
    const body = isAction ? raw.replace(/^\/me\s+/i, '') : raw;
    setBusy(true);
    try {
      await onSend(isAction ? 'action' : 'say', body);
      setText('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="p-3 border-t border-[#1f1f2e] flex gap-2">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-[#14141f] border border-[#2a2a3e] rounded px-3 py-2 text-sm outline-none focus:border-sky-500/60"
      />
      <button
        type="submit"
        disabled={busy || !text.trim()}
        className="px-3 py-2 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-sm"
      >
        Send
      </button>
    </form>
  );
}
