import { useState } from 'react';
import { CAMPAIGNS } from '../../../../../www/convex/wizard/campaigns';
import type { WizardHandle } from './useWizard';

/**
 * The `ruleset` phase: what the table can play, one card per campaign. A person
 * picks with the button, or says so in chat and the host picks for them.
 */
export function CampaignPick({ wiz }: { wiz: WizardHandle }) {
  const [error, setError] = useState<string | null>(null);
  const pick = (id: string) => {
    setError(null);
    wiz.pickCampaign(id).catch((e) => setError((e as Error).message.replace(/^.*Uncaught Error: /, '').split('\n')[0]));
  };

  return (
    <div className="flex-1 min-h-0 scrollable p-3 space-y-3">
      <div className="text-xs text-[#8b8fa3]">Choose what the table plays. Then everyone picks a character sheet, then we play.</div>
      {Object.values(CAMPAIGNS).map((c) => (
        <div key={c.id} className="kf-sheet rounded-lg border border-[#3b3b52] p-3 space-y-2 shadow-lg" style={{ background: '#f3ead7', color: '#1b1710' }}>
          <div className="text-[10px] uppercase tracking-wide text-[#5a4f3a]">{c.ruleset}</div>
          <div className="font-display font-bold text-base leading-tight">{c.title}</div>
          <p className="text-xs leading-relaxed">{c.blurb}</p>
          <button className="text-xs px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white" onClick={() => pick(c.id)}>
            Play this
          </button>
        </div>
      ))}
      <div className="text-[11px] text-[#8b8fa3]">Or just say so in the chat. The host is listening.</div>
      {error && <div className="text-[11px] text-red-300">{error}</div>}
    </div>
  );
}
