import { useState } from 'react';
import { RoomShell, mountRoomPage } from '../RoomShell';
import { RoomPanel } from '../RoomPanel';
import { useRoom, type RoomIdentity } from '../useRoom';
import { useWizard } from '../wizard/useWizard';
import { Lobby } from '../wizard/Lobby';
import { GamePanel, SheetModal } from '../wizard/GamePanel';
import { useAppStore } from '../../store/app';

function WizardRoom({ identity }: { identity: RoomIdentity }) {
  const room = useRoom({ kind: 'wizard', title: "The Wizard's Table", identity });
  const wiz = useWizard(room);
  const activeGuildId = useAppStore((s) => s.activeGuildId);
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const status = room.room?.status ?? 'lobby';

  const header = (
    <>
      <div className="px-3 py-1.5 border-b border-[#1f1f2e] flex items-center gap-2 text-xs">
        <span className="text-[#8b8fa3]">
          {wiz.capabilities.inference ? `AI via ${wiz.capabilities.via ?? 'deployment'}` : 'No AI key yet — masks play on a simple policy'}
        </span>
        <a className="ml-auto underline text-sky-300" href={`/wizardmap.html${window.location.search}`} target="_blank" rel="noreferrer">Open map screen ↗</a>
        {wiz.mySeatKey && <button className="px-2 py-0.5 rounded bg-[#2a2a3e] hover:bg-[#3a3a5e]" onClick={() => setSheetFor(identity.key)}>My sheet</button>}
        {wiz.phase !== 'lobby' && status === 'running' && <button className="px-2 py-0.5 rounded bg-[#2a2a3e] hover:bg-[#3a3a5e]" onClick={() => wiz.pause('looking at a character sheet')}>Pause</button>}
        {status === 'paused' && <button className="px-2 py-0.5 rounded bg-emerald-700 hover:bg-emerald-600" onClick={() => wiz.resume()}>Resume</button>}
      </div>
      {wiz.phase === 'lobby' ? <Lobby room={room} wiz={{ ...wiz, start: () => wiz.start(activeGuildId ?? undefined) }} uid={identity.key} /> : <GamePanel room={room} wiz={wiz} />}
    </>
  );

  return (
    <>
      <RoomPanel
        room={room}
        header={header}
        placeholder={wiz.phase === 'lobby' ? 'Talk to the table…' : 'Ask the DM, or say something in character…'}
        memberExtra={(m) =>
          m.kind !== 'host' && Object.values(wiz.seats).some((s) => s?.ownerKey === m.memberKey) ? (
            <button className="text-[10px] hover:text-amber-300" title="Character sheet" onClick={() => setSheetFor(m.memberKey)}>📜</button>
          ) : null
        }
        onSay={wiz.phase === 'lobby' ? undefined : (text) => wiz.askDm(text)}
      />
      {sheetFor && <SheetModal wiz={wiz} memberKey={sheetFor} onClose={() => setSheetFor(null)} />}
    </>
  );
}

mountRoomPage(<RoomShell width="w-[480px]" render={(identity) => <WizardRoom identity={identity} />} />);
