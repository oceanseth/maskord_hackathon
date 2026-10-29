/**
 * The D&D table's scene list, read from `skills/dndcampaign/playbook.md`.
 * Combat scenes wait for someone at the table to fight; the engine will not
 * start dice on a timer. Tests parse the markdown so an edited list is the
 * source of truth, not this fallback.
 */

export interface PlaybookScene {
  id: string;
  combat: boolean;
}

/** Used only if the skillfile is missing or the fence cannot be read. */
export const STORMWRECK_SCENES: PlaybookScene[] = [
  { id: 'voyage', combat: false },
  { id: 'arrival', combat: false },
  { id: 'look', combat: false },
  { id: 'drowned-sailors', combat: true },
  { id: 'victory', combat: false },
  { id: 'cloister', combat: false },
];

export function parsePlaybookScenes(markdown: string): PlaybookScene[] {
  const block = /```scenes\s*\n([\s\S]*?)```/.exec(markdown);
  if (!block) return [...STORMWRECK_SCENES];
  const scenes = block[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const combat = /\s+combat$/.test(line);
      const id = line.replace(/\s+combat$/, '').trim();
      return { id, combat };
    })
    .filter((s) => s.id.length > 0);
  return scenes.length ? scenes : [...STORMWRECK_SCENES];
}

export type PartyKind = 'human' | 'mask' | 'enemy';

/**
 * The table's combat order: people first, then masks, then enemies; initiative
 * only breaks ties inside a kind. A D&D table is a story the players start —
 * an agent should not swing before anyone at the table has heard the DM.
 */
export function orderCombatants<T extends { initiative: number; side: 'party' | 'enemy' }>(
  combatants: T[],
  kindOf: (c: T) => PartyKind,
): T[] {
  const rank = (k: PartyKind) => (k === 'human' ? 0 : k === 'mask' ? 1 : 2);
  return [...combatants].sort((a, b) => {
    const rk = rank(kindOf(a)) - rank(kindOf(b));
    if (rk) return rk;
    if (b.initiative !== a.initiative) return b.initiative - a.initiative;
    if (a.side !== b.side) return a.side === 'party' ? -1 : 1;
    return 0;
  });
}

export function wantsFight(text: string): boolean {
  return /\b(attack|fight|charge|kill|shoot|stab|swing|draw(?:\s+(?:my|our|the))?\s+weapons?|roll(?:\s+for)?\s+initiative|we\s+fight|i\s+hit|cast\s+(?:a\s+)?(?:fire\s*bolt|sacred\s+flame|guiding\s+bolt|magic\s+missile|thunderwave))\b/i.test(
    text,
  );
}

export function wantsLook(text: string): boolean {
  return /\b(look(?:\s+around|\s+at)|take a look|search|listen|scan|survey|inspect|investigate|rocks?|crags?|surf|beach|harbor|dock|what(?:'s| is) (?:that|there)|i (?:check|watch|peer))\b/i.test(
    text,
  );
}
