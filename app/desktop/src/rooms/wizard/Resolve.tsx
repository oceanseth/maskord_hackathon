import { useState } from 'react';
import { PREGENS } from '../../../../../www/convex/wizard/pregens';
import type { WizardHandle } from './useWizard';

/**
 * The `resolve` phase: the session is over, by defeat or by choice. The host's
 * recap lands in the feed; this plate holds the numbers and the two ways on.
 */
export function Resolve({ wiz }: { wiz: WizardHandle }) {
  const [error, setError] = useState<string | null>(null);
  const run = (p: Promise<unknown>) => {
    setError(null);
    p.catch((e) => setError((e as Error).message.replace(/^.*Uncaught Error: /, '').split('\n')[0]));
  };
  const fell = wiz.phase === 'defeat';

  return (
    <div className="flex-1 min-h-0 scrollable p-3 space-y-3">
      <div className="font-display font-semibold text-sm">{fell ? 'The party has fallen' : 'Session over'}</div>
      <div className="text-xs text-[#8b8fa3]">
        {wiz.campaign?.title ?? 'No campaign'} · {wiz.xp} XP earned
      </div>
      {wiz.characters.length > 0 && (
        <ul className="text-xs space-y-0.5">
          {wiz.characters.map((c) => (
            <li key={c.sheetKey} className="flex gap-2">
              <span className="font-semibold">{c.name}</span>
              <span className="text-[#8b8fa3]">
                {PREGENS[c.sheetKey].race} {PREGENS[c.sheetKey].className}
              </span>
              <span className="ml-auto tabular-nums">{c.hp <= 0 ? 'down' : `${c.hp}/${PREGENS[c.sheetKey].hpMax} HP`}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-1.5">
        <button className="text-xs px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600" onClick={() => run(wiz.playAgain())}>
          Play again, same sheets
        </button>
        <button className="text-xs px-2 py-1 rounded bg-[#2a2a3e] hover:bg-[#3a3a5e]" onClick={() => run(wiz.newCampaign())}>
          New campaign
        </button>
      </div>
      <div className="text-[11px] text-[#8b8fa3]">The host's recap lands in the feed.</div>
      {error && <div className="text-[11px] text-red-300">{error}</div>}
    </div>
  );
}
