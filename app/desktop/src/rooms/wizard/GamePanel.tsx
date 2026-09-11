import { useMemo, useState, type ReactNode } from 'react';
import { PREGENS } from '../../../../../www/convex/wizard/pregens';
import { SPELLS } from '../../../../../www/convex/wizard/scenario';
import { reachable } from '../../../../../www/convex/wizard/engine';
import { feet, type Position } from '../../../../../www/convex/wizard/types';
import { TileMap } from './TileMap';
import { SheetCard } from './SheetCard';
import type { RoomHandle } from '../useRoom';
import type { WizardHandle, WizardAction } from './useWizard';

/**
 * In play: the board in miniature, whose turn it is, and — on your turn — the
 * controls that map onto the 5e action economy. Every button sends intent;
 * the engine rolls and narrates into the log.
 */
export function GamePanel({ room, wiz }: { room: RoomHandle; wiz: WizardHandle }) {
  const [mode, setMode] = useState<'idle' | 'move' | 'attack' | 'cast' | 'help' | 'layOnHands'>('idle');
  const [pick, setPick] = useState<string | null>(null); // attackKey or spell name
  const [error, setError] = useState<string | null>(null);
  const me = wiz.myCharacter;
  const sheet = me ? PREGENS[me.sheetKey] : null;
  const active = wiz.activeCombatant;
  const paused = room.room?.status === 'paused';

  const speedSquares = me ? Math.floor(((me.conditions.includes('slowed') ? Math.max(0, sheet!.speed - 10) : sheet!.speed) * (wiz.turn.dashed ? 2 : 1)) / 5) - wiz.turn.moved : 0;
  const reach = useMemo(() => {
    if (!me || mode !== 'move' || speedSquares <= 0) return undefined;
    const occ = [...wiz.characters.filter((c) => c !== me && c.hp > 0).map((c) => c.pos), ...wiz.creatures.filter((c) => !c.conditions.includes('dead')).map((c) => c.pos)];
    const r = reachable(wiz.map, me.pos, speedSquares, occ);
    r.delete(`${me.pos.x},${me.pos.y}`);
    return new Set(r.keys());
  }, [me, mode, speedSquares, wiz.characters, wiz.creatures, wiz.map]);

  const run = (p: Promise<unknown>) => {
    setError(null);
    p.then(() => { setMode('idle'); setPick(null); }).catch((e) => setError((e as Error).message.replace(/^.*Uncaught Error: /, '').split('\n')[0]));
  };
  const act = (a: WizardAction) => run(wiz.act(a));
  const enemies = wiz.creatures.filter((c) => !c.conditions.includes('dead'));
  const allies = wiz.characters.filter((c) => c !== me);

  const onSquare = (p: Position) => {
    if (mode === 'move' && reach?.has(`${p.x},${p.y}`)) act({ type: 'move', to: p });
  };

  return (
    <div className="border-b border-[#1f1f2e]">
      <div className="p-2 flex gap-2">
        <div className="shrink-0 overflow-auto rounded border border-[#1f1f2e]" style={{ maxWidth: 260 }}>
          <TileMap map={wiz.map} characters={wiz.characters} creatures={wiz.creatures} fires={wiz.fires} activeId={active?.id} highlight={reach} onSquare={onSquare} cell={10} labels={false} />
        </div>
        <div className="flex-1 min-w-0 text-xs space-y-1">
          <div className="font-display font-semibold">
            {wiz.phase === 'scene' && 'On the beach…'}
            {wiz.phase === 'combat' && `Round ${wiz.round} · ${active?.name}${wiz.isMyTurn ? ' — your turn' : ''}`}
            {wiz.phase === 'victory' && 'Victory'}
            {wiz.phase === 'defeat' && 'The party has fallen'}
          </div>
          {wiz.phase === 'combat' && (
            <ol className="space-y-0.5">
              {wiz.combatants.map((c) => {
                const pc = c.id.startsWith('pc:') ? wiz.characters.find((x) => `pc:${x.sheetKey}` === c.id) : null;
                const npc = c.id.startsWith('npc:') ? wiz.creatures.find((x) => `npc:${x.key}` === c.id) : null;
                const hp = pc ? `${pc.hp}/${PREGENS[pc.sheetKey].hpMax}` : npc ? (npc.conditions.includes('dead') ? 'dead' : `${npc.hp}/${npc.hpMax}`) : '';
                return (
                  <li key={c.id} className={`flex gap-1 ${active?.id === c.id ? 'text-amber-300' : c.side === 'enemy' ? 'text-fuchsia-200/80' : ''} ${npc?.conditions.includes('dead') || (pc && pc.hp <= 0) ? 'line-through opacity-60' : ''}`}>
                    <span className="w-4 text-right tabular-nums">{c.initiative}</span>
                    <span className="truncate">{c.name}</span>
                    <span className="ml-auto tabular-nums">{hp}</span>
                  </li>
                );
              })}
            </ol>
          )}
          {me && (
            <div className="text-[#8b8fa3]">
              You: {me.name} · {me.hp}/{sheet!.hpMax} HP{me.conditions.length ? ` · ${me.conditions.join(', ')}` : ''}
              {wiz.phase === 'combat' && wiz.isMyTurn && ` · ${speedSquares * 5} ft left`}
            </div>
          )}
        </div>
      </div>

      {wiz.isMyTurn && me && sheet && !paused && (
        <div className="px-2 pb-2 space-y-1.5">
          <div className="flex flex-wrap gap-1">
            <Btn on={mode === 'move'} disabled={speedSquares <= 0} onClick={() => setMode(mode === 'move' ? 'idle' : 'move')}>Move</Btn>
            <Btn on={mode === 'attack'} disabled={wiz.turn.actionUsed} onClick={() => setMode(mode === 'attack' ? 'idle' : 'attack')}>Attack</Btn>
            {sheet.spellcasting && <Btn on={mode === 'cast'} onClick={() => setMode(mode === 'cast' ? 'idle' : 'cast')}>Cast</Btn>}
            <Btn disabled={wiz.turn.actionUsed} onClick={() => act({ type: 'dodge' })}>Dodge</Btn>
            <Btn disabled={wiz.turn.actionUsed} onClick={() => act({ type: 'dash' })}>Dash</Btn>
            <Btn disabled={wiz.turn.actionUsed} onClick={() => act({ type: 'disengage' })}>Disengage</Btn>
            <Btn on={mode === 'help'} disabled={wiz.turn.actionUsed} onClick={() => setMode(mode === 'help' ? 'idle' : 'help')}>Help</Btn>
            <Btn disabled={wiz.turn.actionUsed} onClick={() => act({ type: 'hide' })}>Hide</Btn>
            <Btn disabled={wiz.turn.actionUsed} onClick={() => act({ type: 'search' })}>Search</Btn>
            {(me.consumables.torch ?? 0) > 0 && !me.resources.torchLit && <Btn disabled={wiz.turn.actionUsed} onClick={() => act({ type: 'useObject', item: 'torch' })}>Light torch</Btn>}
            {sheet.key === 'fighter' && <Btn disabled={wiz.turn.bonusUsed || !me.resources.secondWind} onClick={() => act({ type: 'secondWind' })}>Second Wind</Btn>}
            {sheet.key === 'paladin' && <Btn on={mode === 'layOnHands'} disabled={wiz.turn.actionUsed || !me.resources.layOnHands} onClick={() => setMode(mode === 'layOnHands' ? 'idle' : 'layOnHands')}>Lay on Hands ({me.resources.layOnHands})</Btn>}
            <Btn accent onClick={() => act({ type: 'endTurn' })}>End turn</Btn>
          </div>

          {mode === 'move' && <div className="text-[10px] text-sky-300">Click a highlighted square on the map ({speedSquares * 5} ft left).</div>}

          {mode === 'attack' && (
            <Picker
              label="With"
              options={[
                ...sheet.attacks.filter((a) => !a.ammo || (me.consumables[a.ammo] ?? 0) > 0).map((a) => ({ id: a.key, label: `${a.name} (+${a.toHit}, ${a.damage})` })),
                ...(me.resources.torchLit ? [{ id: 'torch', label: 'Burning torch (1 fire)' }] : []),
              ]}
              value={pick}
              onPick={setPick}
              targets={enemies.map((z) => ({ id: `npc:${z.key}`, label: `${z.name} · ${feet(me.pos, z.pos)} ft · ${z.hp}/${z.hpMax}` }))}
              onTarget={(t) => pick && act({ type: 'attack', attackKey: pick, targetId: t })}
            />
          )}

          {mode === 'cast' && sheet.spellcasting && (
            <Picker
              label="Spell"
              options={[
                ...sheet.spellcasting.cantrips.map((s) => ({ id: s, label: `${SPELLS[s]?.name ?? s} (cantrip)` })),
                ...sheet.spellcasting.prepared.map((s) => ({ id: s, label: `${SPELLS[s]?.name ?? s} (L${SPELLS[s]?.level})`, disabled: (me.slotsUsed[1] ?? 0) >= (sheet.spellcasting!.slots[1] ?? 0) })),
              ]}
              value={pick}
              onPick={setPick}
              targets={
                pick && SPELLS[pick]
                  ? spellTargets(pick, enemies.map((z) => ({ id: `npc:${z.key}`, label: `${z.name} · ${feet(me.pos, z.pos)} ft` })), [{ id: `pc:${me.sheetKey}`, label: 'yourself' }, ...allies.map((a) => ({ id: `pc:${a.sheetKey}`, label: `${a.name} · ${a.hp}/${PREGENS[a.sheetKey].hpMax} HP · ${feet(me.pos, a.pos)} ft` }))])
                  : []
              }
              onTarget={(t) => pick && act({ type: 'cast', spell: pick, targetId: t })}
              noTargetLabel={pick && SPELLS[pick] && ['flavor', 'buff', 'sleep'].includes(SPELLS[pick].effect.kind) || (pick && SPELLS[pick]?.effect.kind === 'save' && 'area' in SPELLS[pick].effect) ? 'Cast' : undefined}
              onNoTarget={() => pick && act({ type: 'cast', spell: pick })}
            />
          )}

          {mode === 'help' && (
            <Picker label="Help" options={[]} value={null} onPick={() => {}} targets={allies.filter((a) => feet(me.pos, a.pos) <= 5).map((a) => ({ id: `pc:${a.sheetKey}`, label: a.name }))} onTarget={(t) => act({ type: 'help', targetId: t })} />
          )}
          {mode === 'layOnHands' && (
            <Picker label="Lay on Hands" options={[]} value={null} onPick={() => {}} targets={[{ id: `pc:${me.sheetKey}`, label: 'yourself' }, ...allies.filter((a) => feet(me.pos, a.pos) <= 5).map((a) => ({ id: `pc:${a.sheetKey}`, label: `${a.name} · ${a.hp}/${PREGENS[a.sheetKey].hpMax}` }))]} onTarget={(t) => act({ type: 'layOnHands', targetId: t })} />
          )}
          {error && <div className="text-[11px] text-red-300">{error}</div>}
        </div>
      )}
      {wiz.phase === 'combat' && !wiz.isMyTurn && me && !paused && (
        <div className="px-2 pb-2 text-[11px] text-[#8b8fa3]">Waiting on {active?.name}. You can talk to the table below, or pause to read a sheet.</div>
      )}
      {wiz.phase === 'scene' && (
        <div className="px-2 pb-2 text-[11px] text-[#8b8fa3]">Something is about to happen. Talk to the DM below.</div>
      )}
    </div>
  );
}

function spellTargets(spell: string, enemies: { id: string; label: string }[], allies: { id: string; label: string }[]) {
  const eff = SPELLS[spell]?.effect;
  if (!eff) return [];
  if (eff.kind === 'heal') return allies;
  if (eff.kind === 'buff') return eff.condition === 'mageArmor' ? allies : [];
  if (eff.kind === 'attack' || eff.kind === 'missiles') return enemies;
  if (eff.kind === 'save') return eff.area ? [] : enemies;
  return [];
}

function Btn({ children, onClick, disabled, on, accent }: { children: ReactNode; onClick: () => void; disabled?: boolean; on?: boolean; accent?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-[11px] px-2 py-1 rounded border ${accent ? 'bg-amber-700/70 border-amber-500/60 hover:bg-amber-600/70' : on ? 'bg-sky-700/60 border-sky-400/70' : 'bg-[#1a1a28] border-[#2a2a3e] hover:bg-[#2a2a3e]'} disabled:opacity-35`}
    >
      {children}
    </button>
  );
}

function Picker({ label, options, value, onPick, targets, onTarget, noTargetLabel, onNoTarget }: {
  label: string;
  options: { id: string; label: string; disabled?: boolean }[];
  value: string | null;
  onPick: (id: string) => void;
  targets: { id: string; label: string }[];
  onTarget: (id: string) => void;
  noTargetLabel?: string;
  onNoTarget?: () => void;
}) {
  return (
    <div className="rounded border border-[#2a2a3e] p-1.5 space-y-1 text-[11px]">
      {options.length > 0 && (
        <div className="flex flex-wrap gap-1 items-center">
          <span className="text-[#8b8fa3]">{label}:</span>
          {options.map((o) => (
            <button key={o.id} disabled={o.disabled} onClick={() => onPick(o.id)} className={`px-1.5 py-0.5 rounded border ${value === o.id ? 'border-sky-400 bg-sky-800/50' : 'border-[#2a2a3e] hover:bg-[#2a2a3e]'} disabled:opacity-35`}>{o.label}</button>
          ))}
        </div>
      )}
      {(options.length === 0 || value) && (
        <div className="flex flex-wrap gap-1 items-center">
          {targets.length > 0 && <span className="text-[#8b8fa3]">{options.length ? 'Target' : label}:</span>}
          {targets.map((t) => (
            <button key={t.id} onClick={() => onTarget(t.id)} className="px-1.5 py-0.5 rounded border border-fuchsia-700/60 hover:bg-fuchsia-900/50">{t.label}</button>
          ))}
          {noTargetLabel && <button onClick={onNoTarget} className="px-1.5 py-0.5 rounded border border-emerald-700/60 hover:bg-emerald-900/50">{noTargetLabel}</button>}
          {targets.length === 0 && !noTargetLabel && <span className="text-[#8b8fa3]">nothing in range</span>}
        </div>
      )}
    </div>
  );
}

/** Any member's sheet, live. Opened from the member strip or the "my sheet" button. */
export function SheetModal({ wiz, memberKey, onClose }: { wiz: WizardHandle; memberKey: string; onClose: () => void }) {
  const key = (Object.keys(wiz.seats) as (keyof typeof wiz.seats)[]).find((k) => wiz.seats[k]?.ownerKey === memberKey);
  const seat = key ? wiz.seats[key] : undefined;
  const state = key ? wiz.characters.find((c) => c.sheetKey === key) ?? null : null;
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="max-h-full overflow-auto" onClick={(e) => e.stopPropagation()}>
        {key && seat ? (
          <SheetCard sheet={PREGENS[key]} state={state} ownerName={seat.ownerName} characterName={seat.name} />
        ) : (
          <div className="rounded bg-[#14141f] border border-[#2a2a3e] p-4 text-sm">No character sheet yet.</div>
        )}
        <div className="text-center mt-2"><button className="text-xs px-2 py-1 rounded bg-[#2a2a3e]" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
