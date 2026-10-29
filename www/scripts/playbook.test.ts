import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { orderCombatants, parsePlaybookScenes, STORMWRECK_SCENES, wantsFight, wantsLook } from '../convex/wizard/playbook.ts';

const here = dirname(fileURLToPath(import.meta.url));

describe('playbook.md', () => {
  it('lists Stormwreck scenes in narrator-then-dice order', () => {
    const md = readFileSync(join(here, '..', 'convex', 'skills', 'dndcampaign', 'playbook.md'), 'utf8');
    assert.deepEqual(parsePlaybookScenes(md), STORMWRECK_SCENES);
    assert.equal(STORMWRECK_SCENES.find((s) => s.combat)?.id, 'drowned-sailors');
    assert.equal(STORMWRECK_SCENES[0].id, 'voyage');
  });
});

describe('wantsFight / wantsLook', () => {
  it('starts a fight only when someone commits', () => {
    assert.equal(wantsFight('we fight'), true);
    assert.equal(wantsFight('I draw my weapon'), true);
    assert.equal(wantsFight('roll for initiative'), true);
    assert.equal(wantsFight('look around the dock'), false);
    assert.equal(wantsLook('I look around'), true);
    assert.equal(wantsLook('look around the dock'), true);
    assert.equal(wantsLook('what is that in the surf'), true);
    assert.equal(wantsLook('we wait and listen'), true);
  });
});

describe('orderCombatants', () => {
  it('puts people first, then masks, then enemies, and only then initiative', () => {
    const ordered = orderCombatants(
      [
        { id: 'npc:z', name: 'Zombie', initiative: 20, side: 'enemy' as const },
        { id: 'pc:fighter', name: 'Batman', initiative: 18, side: 'party' as const },
        { id: 'pc:cleric', name: 'Seth', initiative: 4, side: 'party' as const },
      ],
      (c) => (c.id === 'pc:cleric' ? 'human' : c.id === 'pc:fighter' ? 'mask' : 'enemy'),
    );
    assert.deepEqual(ordered.map((c) => c.name), ['Seth', 'Batman', 'Zombie']);
  });
});
