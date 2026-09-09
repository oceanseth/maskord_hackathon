/**
 * Burning Token challenge plans for Maskord.
 *
 * `requirement` quotes the official entry requirement from the Burning Token
 * brief (app.burningtoken.dev). Eligibility is checked before scoring, so each
 * plan below is written to satisfy the requirement literally, not thematically.
 */

export type Challenge = {
  key: string;
  track: string;
  sponsor: string;
  accent: string;
  prize: string;
  prizeNote?: string;
  /** Official entry requirement, from the sponsor brief. */
  requirement: string;
  /** One line: what this sponsor becomes inside Maskord. */
  headline: string;
  /** How the integration actually works. */
  plan: string[];
  /** What the judges see in the demo video, in order. */
  demo: string[];
  /** Where the original idea fell short of the brief, and what changed. */
  adjustment: string;
};

export const challenges: Challenge[] = [
  {
    key: 'nebius',
    track: 'Applied AI',
    sponsor: 'Nebius',
    accent: '#60a5fa',
    prize: 'USD 500',
    requirement:
      'Use Nebius Token Factory for inference in the main product flow. Evaluate the output on a small set of representative inputs and measure at least one of: accuracy, time to complete the task, or cost per task.',
    headline: 'Every mask thinks on Token Factory — and we publish the scoreboard for which personalities actually finish the job.',
    plan: [
      'All agent inference in Maskord runs through Nebius Token Factory. A mask is a persona (system prompt + voice + avatar) bound to a Token Factory model, so swapping a personality is a first-class product action, not a config edit.',
      'A fixed suite of ~10 representative goals with checkable success criteria — "turn this thread into a decision doc", "find the bug in this stack trace", "build a launch checklist" — is dropped into a fresh channel.',
      'Each goal is run against several rosters: one generalist mask, a specialist trio, and a chaotic celebrity roster. Same goal, same tools, different personalities.',
      'We measure goal-completion rate against a rubric, wall-clock time to goal, and tokens + USD per task, and we run the suite across two Token Factory model sizes to show the quality/cost curve.',
      'The eval table ships in-product — a public /evals page any judge can read without a login.',
    ],
    demo: [
      'Drop a goal into a live channel; the roster works it and produces the deliverable.',
      'Open the eval table: completion rate, time to goal, and cost per task per roster and per model size.',
      'Show the failure case honestly — the celebrity roster that argues past the token budget and never converges.',
    ],
    adjustment:
      'The original idea ("multi-agent evals to see which personalities solve the task best") already matched this brief better than any of the others — it just was not measured. Added the fixed task suite, the rubric, the cost/latency columns, and the two-model comparison, because the brief asks us to name what a good result looks like and to show a case the product struggles with.',
  },
  {
    key: 'render',
    track: 'Workflows',
    sponsor: 'Render',
    accent: '#34d399',
    prize: 'USD 900 in credits',
    prizeNote: '3 placements — 500 / 300 / 100',
    requirement:
      'Use Render Workflows to execute the process. Include a way to recover from a failed step. If retrying a step could create duplicate records or actions, handle that in your application.',
    headline: 'Masky, the orchestrator mask, is a Render Workflow — a goal survives a crashed agent instead of starting over.',
    plan: [
      'A goal posted in a channel starts a Render Workflow run: plan → fan out subagent turns → gather → research step → critique → publish result.',
      'Each agent turn is its own Workflow step with retries. When an agent hangs or its container dies, the run resumes from the last completed step; the goal is never restarted from zero.',
      'Idempotency is handled in the app: every step upserts into Convex keyed by (runId, stepId), so a retried step rewrites its own record instead of posting a second message into the channel.',
      'Run state is visible where the work is — the Workflow step states stream into the channel as a live checklist, with failed steps and unresolved errors shown in place rather than buried in a log.',
    ],
    demo: [
      'Start a goal; the channel shows the plan and the step checklist filling in.',
      'Kill an agent mid-run to force a step failure. The run retries that step and continues.',
      'Scroll the channel: the completed result is there once, with no duplicate posts from the retried step.',
    ],
    adjustment:
      'The original plan — Render watching agent activity and restarting subagents or VMs — is monitoring, not a Workflow, and would have been ruled ineligible before scoring. Rewritten so Render Workflows executes the orchestration itself. The supervision idea survives as the recovery path. Worth prioritising: this is the only challenge with three placements, so it has the best odds of the five, though it pays in credits rather than cash.',
  },
  {
    key: 'convex',
    track: 'Multiplayer',
    sponsor: 'Convex',
    accent: '#fbbf24',
    prize: 'USD 500',
    requirement:
      'Use Convex to store and sync the product’s shared data. Realtime updates must support a core feature. Deploy the frontend on Convex Static Hosting (convex.site).',
    headline: 'Convex is the channel itself — humans and agents subscribe to exactly the same live state.',
    plan: [
      'Messages, presence, artifacts, and agent turns all live in Convex. Agents read the channel through the same Convex queries the human client uses, so there is no separate agent backend to drift out of sync.',
      'Realtime carries the core feature, not a side channel: typing indicators, token-by-token agent replies, uploaded documents, images and video, and Link’s research notes all land in every open session without a refresh.',
      'Simultaneous actions are resolved by a Convex mutation that claims the next turn. Two agents racing to answer cannot both take the turn, and the losing agent sees the winner’s claim immediately.',
      'The hackathon build of the Maskord web client is deployed on Convex Static Hosting at the project’s convex.site address, and that is the build judges are pointed at — the requirement is met by the product, not by a side page.',
    ],
    demo: [
      'Two browser sessions side by side, one human and one agent-facing.',
      'Drop an image in the left session; it appears in the right with no refresh, and the agent references it in its next turn.',
      'Fire two agents at the same prompt to show the turn claim resolving cleanly instead of double-answering.',
    ],
    adjustment:
      'The original scope — Convex sharing assets between agents and the group chat — is a fine feature but would not have carried the brief on its own, and it missed the hard hosting requirement entirely. Convex is now the shared data layer for the whole channel, and the frontend deploy moves to Convex Static Hosting. That hosting move is the single largest piece of work on this page; it is scheduled first because Linkup and Render both store their state in the same tables.',
  },
  {
    key: 'linkup',
    track: 'Deep Research',
    sponsor: 'Linkup',
    accent: '#22d3ee',
    prize: 'USD 500',
    requirement:
      'Use Linkup to search and retrieve information. Your research flow must store findings and use them to decide what to investigate next.',
    headline: 'One mask does the reading. "Link" researches once, and the whole room inherits the sources.',
    plan: [
      'Link is a mask like any other, but it owns the room’s research loop: query Linkup, extract claims with their sources, store each finding (claim, URL, snippet, confidence, retrieved-at) and each open gap.',
      'The next search is chosen from stored state — unanswered gaps and contradictions between findings become the follow-up queries. The loop stops on a budget or when no new gaps remain, so the depth is visible rather than fixed.',
      'Findings render in-chat as citation chips. Where sources disagree, the claim is flagged as contested instead of silently picking a winner.',
      'The other masks do not each run their own search. They wait one turn for Link and read the shared findings — which is the token and latency argument we can actually measure, using the same instrumentation as the Nebius evals.',
    ],
    demo: [
      'Ask the room a question that needs current information; watch Link claim the research turn.',
      'Open the research trail: first-pass sources, the gap it found, and the follow-up query that gap produced.',
      'Show a contested claim flagged with both conflicting sources, then the room using the findings to finish the task.',
    ],
    adjustment:
      'The original description was a single-pass web lookup shared with the team. The brief specifically requires findings to be stored and to drive the next search, so Link gained a persisted findings/gaps store and an iterative loop with a stop condition. The "everyone waits for Link instead of searching in parallel" idea is kept and turned into a measured cost saving rather than a claim.',
  },
  {
    key: 'revenuecat',
    track: 'Subscriptions',
    sponsor: 'RevenueCat',
    accent: '#fb7185',
    prize: 'USD 500',
    requirement:
      'Integrate a RevenueCat SDK into the product. Configure an offer and use entitlements to control access to a useful feature. A sandbox or test purchase is accepted; real revenue is not required.',
    headline: 'Mask Passes — subscribe to somebody else’s mask, and it walks into your channel.',
    plan: [
      'Creators publish masks: a persona, a voice, an avatar, and the model behind it. Anyone can try a mask free for a few turns; keeping it requires a pass.',
      'A RevenueCat offering is configured per mask tier, and a RevenueCat entitlement gates the things that cost us money — using the mask in a channel, its larger Token Factory model, and private DMs with it.',
      'The purchase is wired through the RevenueCat SDK end to end, so entitlement state, not local UI state, decides what the user can do.',
      'Entitlement changes are live: unlocking a mask makes it available in an open channel immediately, through the same Convex sync that carries messages.',
    ],
    demo: [
      'Show the locked mask and the offer, then complete a sandbox purchase — clearly labelled as a test transaction.',
      'The mask unlocks in a channel that is already open, mid-conversation, and starts answering.',
      'Force a declined purchase to show access correctly withheld with a clear error, then expire the entitlement and watch the mask drop back to trial limits while the conversation is still running.',
    ],
    adjustment:
      'The original plan — subscribing to other people’s masks and agents — needed no conceptual change; it is a natural fit for the brief. Added what the brief explicitly asks to see and teams routinely forget: the failed purchase and the expired entitlement. Making the expiry happen mid-conversation is the memorable version of that requirement. This track is self-contained enough to be built in parallel with the rest.',
  },
  {
    key: 'nerdconf',
    track: 'Fun Build',
    sponsor: 'NERDCONF',
    accent: '#e879f9',
    prize: 'USD 500',
    prizeNote: 'No sponsor integration required',
    requirement:
      'Ship a working version that someone outside your team can try. No specific sponsor integration, AI feature, or business model is required.',
    headline: 'Build your next hackathon with Batman. Watch Dario and Musk argue about whether your project ends the world.',
    plan: [
      'Masks are characters, and characters have opinions. Put a project in front of a roster of famous personalities and let them fight about it in your channel.',
      'The Green Room: a public, no-login channel. A visitor types one line about what they are building and watches the argument start — no signup, no onboarding, no explanation needed.',
      'The joke has to land in under thirty seconds, so the Green Room is tuned for the opening exchange rather than a long session.',
      'This track needs none of the sponsor technology, which makes it the safety net: it stays shippable even if an integration slips.',
    ],
    demo: [
      'Open the Green Room link cold, the way a judge would.',
      'Type one line about a project and let the room react.',
      'Show the same roster being genuinely useful on a real task, so the joke has a point.',
    ],
    adjustment:
      'The original idea needed a way in. Fun Build is judged on whether someone outside the team can open it and try the main interaction, so the characters get a public no-login entry point instead of living behind the Maskord signup. The reference the brief gives is SlapMac — one interaction, immediately understood — so the Green Room is scoped to the first laugh, not to a full session.',
  },
];

export const architecture = [
  { label: 'Goal posted in a channel', tag: 'Maskord', accent: '#a855f7' },
  { label: 'Masky plans and fans out the run', tag: 'Render Workflows', accent: '#34d399' },
  { label: 'Link researches once for the room', tag: 'Linkup', accent: '#22d3ee' },
  { label: 'Masks think in character', tag: 'Nebius Token Factory', accent: '#60a5fa' },
  { label: 'Everything syncs live to every session', tag: 'Convex', accent: '#fbbf24' },
  { label: 'Premium masks unlocked by entitlement', tag: 'RevenueCat', accent: '#fb7185' },
];

export const priorities = [
  {
    order: 1,
    challenge: 'Nebius',
    accent: '#60a5fa',
    lift: 'Low',
    why: 'The idea already matches the rubric. The eval suite is the differentiator most teams will skip.',
  },
  {
    order: 2,
    challenge: 'Render',
    accent: '#34d399',
    lift: 'Medium',
    why: 'Three placements, so the best odds on the board. The workflow rewrite is real work but bounded.',
  },
  {
    order: 3,
    challenge: 'Convex',
    accent: '#fbbf24',
    lift: 'High',
    why: 'The convex.site hosting requirement moves the frontend, and Linkup and Render both store state here. Do it first in calendar order even though it is third in value.',
  },
  {
    order: 4,
    challenge: 'Linkup',
    accent: '#22d3ee',
    lift: 'Low',
    why: 'Cheap once the Convex tables exist. The findings loop is about a day.',
  },
  {
    order: 5,
    challenge: 'RevenueCat',
    accent: '#fb7185',
    lift: 'Medium',
    why: 'Self-contained and parallelisable — one person can own it end to end without blocking anyone.',
  },
  {
    order: 6,
    challenge: 'Fun Build',
    accent: '#e879f9',
    lift: 'Free',
    why: 'A byproduct of the personas we are building anyway. Ship the public entry point and it is done.',
  },
];

export const submission = [
  { done: true, label: 'Project registered on app.burningtoken.dev', note: 'Maskord — team of 3' },
  { done: true, label: 'Public project URL', note: 'maskord.com' },
  { done: false, label: 'Challenges selected in the submission form', note: 'Not yet chosen' },
  { done: false, label: 'X post with a demo video of up to 2 minutes', note: 'Must tag @nerdconf_ar — LinkedIn does not count' },
  { done: false, label: 'Integration evidence per challenge', note: 'Demo timestamp, link, or test steps judges can verify' },
  { done: false, label: 'Submit (saving a draft does not submit)', note: 'Editable until the deadline' },
];

/** Global submission close: 2026-09-13 23:59 ART (UTC-3). */
export const DEADLINE_UTC = '2026-09-14T02:59:00Z';
