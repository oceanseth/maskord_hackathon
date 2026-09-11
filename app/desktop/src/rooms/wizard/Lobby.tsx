import { useState } from 'react';
import { PREGENS, SHEET_KEYS } from '../../../../../www/convex/wizard/pregens';
import { HOUSE_MASKS } from '../../../../../www/convex/cast';
import type { SheetKey } from '../../../../../www/convex/wizard/types';
import { useMaskyAvatars } from '../../hooks/useMaskyAvatars';
import { SheetCard } from './SheetCard';
import type { RoomHandle } from '../useRoom';
import type { WizardHandle } from './useWizard';

/**
 * Before the game: the five sheets fanned out, overlapping. Pick one to read
 * it, flip it, minimise it to see who else is at the table, then confirm.
 * The game starts when every human present has confirmed.
 */
export function Lobby({ room, wiz, uid }: { room: RoomHandle; wiz: WizardHandle; uid: string }) {
  const [selected, setSelected] = useState<SheetKey | null>(null);
  const [minimised, setMinimised] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { avatarGroups } = useMaskyAvatars(uid);

  const shown = selected ?? wiz.mySeatKey;
  const mySeat = wiz.mySeatKey ? wiz.seats[wiz.mySeatKey] : undefined;
  const humans = room.humans.filter((h) => h.present);
  const notReady = humans.filter((h) => !SHEET_KEYS.some((k) => wiz.seats[k]?.ownerKey === h.memberKey && wiz.seats[k]?.confirmed));
  const seatedMasks = room.masks;
  const freeSheets = SHEET_KEYS.filter((k) => !wiz.seats[k]);

  const run = (p: Promise<unknown>) => {
    setError(null);
    p.catch((e) => setError((e as Error).message.replace(/^.*Uncaught Error: /, '').split('\n')[0]));
  };

  return (
    <div className="flex-1 min-h-0 scrollable p-3 space-y-3">
      <div className="text-xs text-[#8b8fa3]">
        Dragons of Stormwreck Isle · a 5e beginner adventure. Choose a character sheet, then confirm. The game begins when everyone at the table has.
      </div>

      {/* The fan */}
      <div className="relative h-40 overflow-visible">
        {SHEET_KEYS.map((key, i) => {
          const sheet = PREGENS[key];
          const seat = wiz.seats[key];
          const mine = seat?.ownerKey === room.me?.memberKey;
          const taken = seat && !mine;
          return (
            <button
              key={key}
              disabled={!!taken && (seat!.confirmed || seat!.ownerKind === 'mask')}
              onClick={() => { setSelected(key); setMinimised(false); }}
              className={`kf-fan-card ${shown === key ? 'is-shown' : ''} absolute top-0 w-32 h-36 rounded-lg border text-left p-2 transition-transform shadow-lg ${
                shown === key ? 'z-20 -translate-y-2 border-amber-400' : 'border-[#3b3b52] hover:-translate-y-1'
              } ${taken ? 'opacity-60' : ''}`}
              style={{ left: `${i * 60}px`, background: '#f3ead7', color: '#1b1710', zIndex: shown === key ? 20 : i }}
              title={taken ? `${seat!.ownerName} has this sheet` : sheet.className}
            >
              <div className="text-2xl">{sheet.glyph}</div>
              <div className="font-display font-bold text-sm leading-tight">{sheet.className}</div>
              <div className="text-[10px]">{sheet.race}</div>
              <div className="text-[10px] text-[#5a4f3a]">{sheet.background}</div>
              {seat && <div className={`mt-1 text-[10px] font-semibold ${mine ? 'text-emerald-700' : 'text-[#7f1d1d]'}`}>{mine ? (seat.confirmed ? 'yours ✓' : 'yours') : seat.ownerName}</div>}
            </button>
          );
        })}
      </div>

      {shown && !minimised && (
        <div className="space-y-2">
          <SheetCard sheet={PREGENS[shown]} characterName={wiz.seats[shown]?.name || name || undefined} ownerName={wiz.seats[shown]?.ownerName} compact />
          <div className="flex flex-wrap items-center gap-2">
            <button className="text-xs px-2 py-1 rounded bg-[#2a2a3e] hover:bg-[#3a3a5e]" onClick={() => setMinimised(true)}>Minimise</button>
            {wiz.mySeatKey !== shown && !wiz.seats[shown] && (
              <button className="text-xs px-2 py-1 rounded bg-sky-600 hover:bg-sky-500" onClick={() => run(wiz.chooseSeat(shown))}>Take this sheet</button>
            )}
            {wiz.mySeatKey === shown && !mySeat?.confirmed && (
              <>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Character name (optional)" className="text-xs bg-[#14141f] border border-[#2a2a3e] rounded px-2 py-1 w-44" />
                <button className="text-xs px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600" onClick={() => run(wiz.confirmSeat(name))}>Confirm</button>
                <button className="text-xs px-2 py-1 rounded bg-[#2a2a3e] hover:bg-[#3a3a5e]" onClick={() => run(wiz.releaseSeat())}>Put back</button>
              </>
            )}
            {wiz.mySeatKey === shown && mySeat?.confirmed && (
              <>
                <span className="text-xs text-emerald-300">Confirmed as {mySeat.name}</span>
                <button className="text-xs px-2 py-1 rounded bg-[#2a2a3e] hover:bg-[#3a3a5e]" onClick={() => run(wiz.releaseSeat())}>Change</button>
              </>
            )}
          </div>
        </div>
      )}
      {shown && minimised && (
        <button className="text-xs px-2 py-1 rounded bg-[#2a2a3e] hover:bg-[#3a3a5e]" onClick={() => setMinimised(false)}>Show {PREGENS[shown].className} sheet</button>
      )}

      {/* Masks */}
      <div className="rounded border border-[#1f1f2e] p-2 space-y-2">
        <div className="text-xs font-semibold">Masks at the table ({seatedMasks.length})</div>
        {seatedMasks.length > 0 && (
          <ul className="text-xs space-y-1">
            {seatedMasks.map((m) => {
              const key = SHEET_KEYS.find((k) => wiz.seats[k]?.ownerKey === m.memberKey);
              return (
                <li key={m._id} className="flex items-center gap-2">
                  <span className="font-semibold">{m.name}</span>
                  <span className="text-[#8b8fa3]">{key ? `${PREGENS[key].race} ${PREGENS[key].className}` : ''}</span>
                  <button className="ml-auto text-[10px] text-[#8b8fa3] hover:text-red-300" onClick={() => run(wiz.unseatMask(m.memberKey))}>remove</button>
                </li>
              );
            })}
          </ul>
        )}
        {freeSheets.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {avatarGroups.filter((g) => !seatedMasks.some((m) => m.memberKey === `mask:${g.id}`)).map((g) => (
              <button key={g.id} className="text-xs px-2 py-1 rounded bg-fuchsia-900/50 hover:bg-fuchsia-800/60 border border-fuchsia-700/50 flex items-center gap-1" onClick={() => run(wiz.seatMask({ key: `mask:${g.id}`, name: g.displayName, persona: g.personalityPrompt ?? '', avatarUrl: g.thumbnailUrl }))}>
                {g.thumbnailUrl && <img src={g.thumbnailUrl} alt="" className="w-4 h-4 rounded-full object-cover" />}
                Bring {g.displayName}
              </button>
            ))}
            {HOUSE_MASKS.filter((h) => !seatedMasks.some((m) => m.memberKey === h.key)).map((h) => (
              <button key={h.key} className="text-xs px-2 py-1 rounded bg-[#2a2a3e] hover:bg-[#3a3a5e]" onClick={() => run(wiz.seatMask(h))}>Seat {h.name}</button>
            ))}
          </div>
        )}
        {freeSheets.length === 0 && <div className="text-[10px] text-[#8b8fa3]">All five sheets are taken.</div>}
      </div>

      {/* Start */}
      <div className="rounded border border-[#1f1f2e] p-2 space-y-1">
        <div className="text-xs">
          {notReady.length === 0
            ? `Everyone is ready.`
            : `Waiting for ${notReady.map((h) => h.name).join(', ')} to choose and confirm a sheet.`}
        </div>
        <button
          disabled={notReady.length > 0 || !SHEET_KEYS.some((k) => wiz.seats[k])}
          className="text-sm px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-40 font-semibold"
          onClick={() => run(wiz.start())}
        >
          Start the adventure
        </button>
        {!wiz.capabilities.inference && (
          <div className="text-[10px] text-amber-300/80">No AI key on this deployment yet: masks will play on a simple policy and Masky will use scripted narration until it is set.</div>
        )}
      </div>

      {error && <div className="text-xs text-red-300">{error}</div>}
    </div>
  );
}
