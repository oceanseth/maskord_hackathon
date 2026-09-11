import { SKILLS } from './_generated';

/**
 * The orchestrator's system prompt for a channel in `<kind>/<phase>`: the
 * markdown at `skills/<kind>/<phase>.md`, with `{{host}}` filled in. The
 * caller appends a `## State` section; see README.md.
 */
export function skillFor(kind: string, phase: string, vars: { host: string }): string {
  const text = SKILLS[kind]?.[phase];
  if (!text) throw new Error(`No skillfile for ${kind}/${phase}`);
  return text.replace(/\{\{host\}\}/g, vars.host).trim();
}
