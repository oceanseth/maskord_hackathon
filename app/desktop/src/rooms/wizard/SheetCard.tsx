import { useState } from 'react';
import { ABILITIES, ABILITY_NAMES, SKILLS, fmtMod, mod, type CharacterState, type Sheet } from '../../../../../www/convex/wizard/types';

/**
 * A character sheet laid out the way the official 5e sheet is: abilities and
 * modifiers down the left, saves and skills, then combat numbers, attacks and
 * spellcasting, equipment, features. The back of the card carries the
 * background story and the Personal Goal, which is where the printed Starter
 * Set sheets put them. Live values (HP, slots, conditions) come from `state`.
 */
export function SheetCard({
  sheet,
  state,
  ownerName,
  characterName,
  flipped: flippedProp,
  onFlip,
  compact = false,
}: {
  sheet: Sheet;
  state?: CharacterState | null;
  ownerName?: string;
  characterName?: string;
  flipped?: boolean;
  onFlip?: (f: boolean) => void;
  compact?: boolean;
}) {
  const [flippedLocal, setFlippedLocal] = useState(false);
  const flipped = flippedProp ?? flippedLocal;
  const setFlipped = (f: boolean) => (onFlip ? onFlip(f) : setFlippedLocal(f));
  const name = state?.name || characterName || '—';
  const prof = sheet.proficiencyBonus;
  const saveBonus = (a: (typeof ABILITIES)[number]) => mod(sheet.abilities[a]) + (sheet.saveProficiencies.includes(a) ? prof : 0);
  const skillBonus = (k: (typeof SKILLS)[number]) => mod(sheet.abilities[k.ability]) + (sheet.skills[k.key] === 'expertise' ? prof * 2 : sheet.skills[k.key] ? prof : 0);
  const passive = 10 + skillBonus(SKILLS.find((s) => s.key === 'perception')!);
  const ac = state?.conditions.includes('mageArmor') && sheet.key === 'wizard' ? 13 + mod(sheet.abilities.dex) : sheet.ac;

  return (
    <div className={`rounded-lg border border-[#3b3b52] bg-[#f3ead7] text-[#1b1710] shadow-xl ${compact ? 'text-[11px]' : 'text-xs'} font-body selectable`} style={{ minWidth: compact ? 260 : 340 }}>
      <div className="flex items-start justify-between gap-2 px-3 pt-2 pb-1 border-b border-[#b9ab8c]">
        <div>
          <div className="font-display text-base font-bold leading-tight">{name}</div>
          <div className="text-[10px] uppercase tracking-wide text-[#5a4f3a]">
            {sheet.race} {sheet.className} {sheet.level} · {sheet.background} · {sheet.alignment}
          </div>
          {ownerName && <div className="text-[10px] text-[#5a4f3a]">played by {ownerName}</div>}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-2xl" title={sheet.className}>{sheet.glyph}</span>
          <button className="text-[10px] px-1.5 py-0.5 rounded border border-[#b9ab8c] hover:bg-[#e6dcc3]" onClick={() => setFlipped(!flipped)}>
            {flipped ? 'front' : 'back'}
          </button>
        </div>
      </div>

      {flipped ? (
        <div className="p-3 space-y-2">
          <Section title="Background">
            <p>{sheet.backstory}</p>
          </Section>
          <Section title="Personal Goal">
            <p className="font-semibold">{sheet.personalGoal}</p>
            <p>{sheet.personalGoalText}</p>
          </Section>
          <Section title="Equipment">
            <p>{sheet.gear.join(', ')}. {sheet.gold} gp.</p>
          </Section>
          <Section title="Languages">
            <p>{sheet.languages.join(', ')}</p>
          </Section>
          <Section title="Racial traits">
            <ul className="list-disc pl-4">{sheet.racialTraits.map((t) => <li key={t}>{t}</li>)}</ul>
          </Section>
        </div>
      ) : (
        <div className="p-3 grid grid-cols-[auto_1fr] gap-3">
          {/* Abilities column */}
          <div className="flex flex-col gap-1">
            {ABILITIES.map((a) => (
              <div key={a} className="w-14 rounded border border-[#b9ab8c] bg-[#fbf6ea] text-center py-0.5">
                <div className="text-[9px] uppercase text-[#5a4f3a]">{ABILITY_NAMES[a].slice(0, 3)}</div>
                <div className="font-display text-base font-bold leading-none">{fmtMod(mod(sheet.abilities[a]))}</div>
                <div className="text-[9px]">{sheet.abilities[a]}</div>
              </div>
            ))}
            <div className="rounded border border-[#b9ab8c] bg-[#fbf6ea] text-center py-0.5 mt-1">
              <div className="text-[9px] uppercase text-[#5a4f3a]">Prof</div>
              <div className="font-bold">+{prof}</div>
            </div>
            <div className="rounded border border-[#b9ab8c] bg-[#fbf6ea] text-center py-0.5">
              <div className="text-[9px] uppercase text-[#5a4f3a]">Passive Perc.</div>
              <div className="font-bold">{passive}</div>
            </div>
          </div>

          <div className="space-y-2 min-w-0">
            {/* Combat row */}
            <div className="grid grid-cols-4 gap-1 text-center">
              <Stat label="AC" value={String(ac)} sub={sheet.acNote} />
              <Stat label="Init" value={fmtMod(mod(sheet.abilities.dex))} />
              <Stat label="Speed" value={`${sheet.speed}`} sub="ft" />
              <Stat label="Hit dice" value={sheet.hitDie} />
            </div>
            <div className="rounded border border-[#b9ab8c] bg-[#fbf6ea] p-1.5">
              <div className="flex items-baseline justify-between">
                <span className="text-[9px] uppercase text-[#5a4f3a]">Hit points</span>
                <span className="font-display font-bold text-base">
                  {state ? state.hp : sheet.hpMax}
                  <span className="text-[10px] font-normal"> / {sheet.hpMax}</span>
                  {state && state.tempHp > 0 && <span className="text-[10px] font-normal"> (+{state.tempHp} temp)</span>}
                </span>
              </div>
              <div className="h-1.5 bg-[#d8ccb0] rounded mt-1">
                <div className="h-full rounded" style={{ width: `${((state?.hp ?? sheet.hpMax) / sheet.hpMax) * 100}%`, background: '#7f1d1d' }} />
              </div>
              {state && (state.hp <= 0 || state.deathSaves.successes || state.deathSaves.failures) ? (
                <div className="text-[10px] mt-1">
                  Death saves — successes {'●'.repeat(state.deathSaves.successes)}{'○'.repeat(3 - state.deathSaves.successes)} · failures {'●'.repeat(Math.min(3, state.deathSaves.failures))}{'○'.repeat(Math.max(0, 3 - state.deathSaves.failures))}
                </div>
              ) : null}
              {state && state.conditions.length > 0 && (
                <div className="text-[10px] mt-1">Conditions: {state.conditions.join(', ')}</div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Section title="Saving throws">
                {ABILITIES.map((a) => (
                  <Row key={a} dot={sheet.saveProficiencies.includes(a)} label={ABILITY_NAMES[a]} value={fmtMod(saveBonus(a))} />
                ))}
              </Section>
              <Section title="Skills">
                {SKILLS.map((k) => (
                  <Row key={k.key} dot={!!sheet.skills[k.key]} star={sheet.skills[k.key] === 'expertise'} label={`${k.name} (${k.ability.toUpperCase()})`} value={fmtMod(skillBonus(k))} />
                ))}
              </Section>
            </div>

            <Section title="Attacks">
              <table className="w-full">
                <tbody>
                  {sheet.attacks.map((a) => (
                    <tr key={a.key}>
                      <td className="pr-2 font-semibold">{a.name}</td>
                      <td className="pr-2">{fmtMod(a.toHit)}</td>
                      <td className="pr-2">{a.damage} {a.damageType}</td>
                      <td className="text-[#5a4f3a]">{a.range ? `${a.range.normal}/${a.range.long} ft` : `reach ${a.reach ?? 5} ft`}{a.ammo && state ? ` · ${state.consumables[a.ammo] ?? 0} left` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            {sheet.spellcasting && (
              <Section title={`Spellcasting (${ABILITY_NAMES[sheet.spellcasting.ability]}) · DC ${sheet.spellcasting.saveDC} · attack ${fmtMod(sheet.spellcasting.attackBonus)}`}>
                <p><span className="font-semibold">Cantrips:</span> {sheet.spellcasting.cantrips.join(', ')}</p>
                <p><span className="font-semibold">Prepared:</span> {sheet.spellcasting.prepared.join(', ')}</p>
                <p>
                  <span className="font-semibold">1st-level slots:</span>{' '}
                  {Array.from({ length: sheet.spellcasting.slots[1] ?? 0 }).map((_, i) => (
                    <span key={i}>{i < (state?.slotsUsed[1] ?? 0) ? '○' : '●'}</span>
                  ))}
                </p>
                {sheet.spellcasting.note && <p className="text-[#5a4f3a]">{sheet.spellcasting.note}</p>}
              </Section>
            )}

            <Section title="Features & traits">
              <ul className="list-disc pl-4">
                {sheet.features.map((f) => <li key={f}>{f}</li>)}
              </ul>
              {state && Object.keys(state.resources).length > 0 && (
                <p className="mt-1 text-[#5a4f3a]">
                  {Object.entries(state.resources).filter(([k]) => k !== 'lucky' && k !== 'torchLit').map(([k, v]) => `${k}: ${v}`).join(' · ')}
                </p>
              )}
            </Section>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-[#b9ab8c] bg-[#fbf6ea] p-1.5">
      <div className="text-[9px] uppercase tracking-wide text-[#5a4f3a] mb-0.5">{title}</div>
      {children}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-[#b9ab8c] bg-[#fbf6ea] py-0.5" title={sub}>
      <div className="text-[9px] uppercase text-[#5a4f3a]">{label}</div>
      <div className="font-display font-bold text-sm leading-none">{value}</div>
    </div>
  );
}

function Row({ dot, star, label, value }: { dot: boolean; star?: boolean; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1 leading-tight">
      <span className="w-2 text-center">{star ? '◆' : dot ? '●' : '○'}</span>
      <span className="flex-1 truncate">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}
