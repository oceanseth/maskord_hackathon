import { SKILLS } from './_generated';

/**
 * The orchestrator's system prompt for a channel in `<kind>/<phase>`: the
 * markdown at `skills/<kind>/<phase>.md`, with `{{host}}` filled in. The
 * caller appends a `## State` section; see README.md.
 *
 * A missing file degrades rather than stops the room: the host keeps talking
 * on a generic prompt and the gap is logged, the same way `hasInference` and
 * `callNebius` report and carry on.
 */
export function skillFor(kind: string, phase: string, vars: { host: string }): string {
  const text = SKILLS[kind]?.[phase] ?? fallback(kind, phase);
  return text.replace(/\{\{host\}\}/g, vars.host).trim();
}

function fallback(kind: string, phase: string): string {
  console.warn(`skillFor: no skillfile for ${kind}/${phase}; using the generic prompt`);
  return [
    `You are {{host}}, the orchestrator of a ${kind} channel currently in its "${phase}" phase.`,
    'No phase-specific instructions were found for this state. Stay in character, be brief,',
    'help the people in the channel with what the phase name suggests, and use the state below.',
    'Do not invent rules or outcomes you cannot see in the state.',
  ].join('\n');
}
