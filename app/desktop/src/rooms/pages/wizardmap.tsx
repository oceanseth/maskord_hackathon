import { RoomScreen, mountRoomPage } from '../RoomShell';
import { StatusPill } from '../RoomPanel';
import { useRoom } from '../useRoom';
import { useWizard } from '../wizard/useWizard';
import { TileMap } from '../wizard/TileMap';
import { PREGENS } from '../../../../../www/convex/wizard/pregens';
import '../wizard/theme.css';

/**
 * The second screen: the board, big, plus initiative and the DM's last words.
 * It joins nothing and posts nothing, so it is safe on a projector.
 */
function WizardMap() {
  const room = useRoom({ kind: 'wizard', title: "The Wizard's Table", identity: null });
  const wiz = useWizard(room);
  const hostLines = room.events.filter((e) => e.type === 'host' || e.type === 'dice').slice(-8);
  const cell = Math.max(16, Math.min(44, Math.floor((window.innerWidth - 360) / wiz.map.width)));

  return (
    <div className="kf flex h-full min-h-0 text-[#e2e8f0]">
      <div className="flex-1 min-w-0 flex flex-col items-center justify-center p-4 gap-3">
        <div className="flex items-center gap-3">
          <h1 className="kf-title">{wiz.map.name}</h1>
          <StatusPill status={room.room?.status ?? 'lobby'} />
          {wiz.phase === 'combat' && <span className="kf-turn text-sm">Round {wiz.round}, {wiz.activeCombatant?.name} acts</span>}
          {wiz.phase === 'lobby' && <span className="kf-sub text-sm">The party gathers</span>}
        </div>
        <div className="kf-board overflow-auto rounded border border-[#1f1f2e] shadow-2xl">
          <TileMap map={wiz.map} characters={wiz.characters} creatures={wiz.creatures} fires={wiz.fires} activeId={wiz.activeCombatant?.id} cell={cell} theme="kf" />
        </div>
        <div className="kf-sub text-[12px]">One square is five feet. North is the sea. The lit token acts now.</div>
      </div>
      <aside className="kf-plate w-[320px] shrink-0 border-l border-[#1f1f2e] p-3 flex flex-col gap-3 min-h-0">
        <div>
          <div className="kf-sub text-sm mb-1">The party</div>
          <ul className="space-y-1 text-sm">
            {wiz.characters.map((c) => (
              <li key={c.sheetKey} className={`flex items-center gap-2 ${wiz.activeCombatant?.id === `pc:${c.sheetKey}` ? 'text-amber-300' : ''}`}>
                <span>{PREGENS[c.sheetKey].glyph}</span>
                <span className="truncate">{c.name}</span>
                <span className="text-[#8b8fa3] text-xs">{PREGENS[c.sheetKey].className}</span>
                <span className="kf-hp ml-auto">{c.hp}/{PREGENS[c.sheetKey].hpMax}</span>
              </li>
            ))}
          </ul>
        </div>
        {wiz.creatures.length > 0 && (
          <div>
            <div className="kf-sub text-sm mb-1">Against them</div>
            <ul className="space-y-1 text-sm">
              {wiz.creatures.map((z) => (
                <li key={z.key} className={`flex items-center gap-2 ${z.conditions.includes('dead') ? 'line-through opacity-50' : ''} ${wiz.activeCombatant?.id === `npc:${z.key}` ? 'text-amber-300' : ''}`}>
                  <span>Z</span>
                  <span className="truncate">{z.name}</span>
                  <span className={`ml-auto ${z.conditions.includes('dead') ? 'kf-dead text-xs' : 'kf-hp'}`}>{z.conditions.includes('dead') ? 'fallen' : `${z.hp}/${z.hpMax}`}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="kf-sub text-sm mb-1">{room.room?.hostName ?? 'The DM'} says</div>
          <div className="space-y-1.5 text-sm">
            {hostLines.map((e) => (
              <div key={e._id} className={e.type === 'dice' ? 'rp-event-dice px-2 py-1' : 'rp-event-host'}>{e.type === 'dice' ? `${e.actorName}: ${e.body}` : e.body}</div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

mountRoomPage(<RoomScreen render={() => <WizardMap />} />);
