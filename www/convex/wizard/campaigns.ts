/**
 * What a D&D channel can play. The `ruleset` phase shows this catalogue and a
 * person (or the host, on a clear "yes" in chat) picks one; the pick lives in
 * `room.config.campaign`. One entry today, and the mode's dropdown label names
 * it; a second entry is a new object here plus its engine content.
 */
export interface Campaign {
  id: string;
  /** Which rules govern the table, for the mode label and the DM prompt. */
  ruleset: string;
  title: string;
  /** What the players are told. Nothing here is a spoiler. */
  blurb: string;
  /** What the DM must not reveal until the adventure does. */
  secrets: string[];
  /** Board the engine opens on; a key of `MAPS` in scenario.ts. */
  mapKey: string;
}

export const CAMPAIGNS: Record<string, Campaign> = {
  stormwreck: {
    id: 'stormwreck',
    ruleset: 'D&D 5e (2014)',
    title: 'Dragons of Stormwreck Isle',
    blurb:
      'The 2022 Starter Set adventure. Five level-1 heroes are rowed ashore on a small volcanic island off the Sword Coast, ' +
      'bound for the cliff-top cloister of Dragon’s Rest, and the drowned crew of an old wreck would rather they never reached the stairs. ' +
      'One to five players on the five official pregenerated sheets; open seats can be filled by masks.',
    secrets: [
      'Elder Runara, the old woman who leads the cloister, is an adult bronze dragon in human form.',
      'The undead are raised by a curse from the wreck of the Compass Rose; a cursed locket aboard is its source.',
      'A blue dragon wyrmling, Sparkrender, holds the Clifftop Observatory and plans a ritual to wake the island’s dead dragons.',
    ],
    mapKey: 'beach',
  },
};

export const CAMPAIGN_IDS = Object.keys(CAMPAIGNS);
export const DEFAULT_CAMPAIGN = 'stormwreck';

/** The label the channel-mode dropdown and the header show for the default campaign. */
export function campaignLabel(c: Campaign): string {
  return `${c.ruleset.replace(/ \(.*\)$/, '')} · ${c.title}`;
}
