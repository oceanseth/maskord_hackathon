import { useMutation, useQuery } from 'convex/react';
import { api } from '@maskord/convex';
import { useMaskyAvatars } from '../../hooks/useMaskyAvatars';
import { IS_TEST_STORE } from '../../lib/purchases';
import type { MaskordProState } from '../../hooks/useMaskordPro';

interface Props {
  uid: string;
  displayName: string;
  pro: MaskordProState;
  onUpgrade: () => void;
}

/**
 * Subscription status and the rent-out shelf.
 *
 * Our stand-in for RevenueCat's Customer Center, which is iOS/Android only:
 * everything here comes from `CustomerInfo`, including the management URL
 * RevenueCat mints for cancelling. Publishing lives alongside it because both
 * halves of the deal — what you pay for, what you earn — belong on one screen.
 *
 * Bodyless of any chrome so it can be both a modal (from the debate floor, where
 * the paywall interrupted something) and a tab in User Settings, which is where
 * a subscriber looks for their own subscription.
 */
export default function ProPanel({ uid, displayName, pro, onUpgrade }: Props) {
  const { avatarGroups } = useMaskyAvatars(uid);
  const published = useQuery(api.rentable.mine, { ownerUid: uid }) ?? [];
  const publish = useMutation(api.rentable.publish);
  const withdraw = useMutation(api.rentable.withdraw);

  const byAvatarId = new Map(published.map((p) => [p.avatarId, p]));
  const earned = published.reduce((sum, p) => sum + p.rentals, 0);

  return (
    <div className="space-y-5">
      {/* ── What you have ─────────────────────────────────────────────── */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-white">
            {pro.loading
              ? 'Checking your subscription…'
              : pro.pro
                ? 'Pro is active'
                : pro.lapsed
                  ? 'Pro has expired'
                  : 'Not subscribed'}
          </span>
          {!pro.pro && !pro.loading && (
            <button
              onClick={onUpgrade}
              className="text-xs px-3 py-1.5 rounded bg-violet-600 hover:bg-violet-500 font-semibold"
            >
              {pro.lapsed ? 'Renew' : 'See plans'}
            </button>
          )}
        </div>

        <div className="text-xs text-[#94a3b8]">
          {pro.pro
            ? pro.expiresAt
              ? `Renews ${pro.expiresAt.toLocaleDateString()}.`
              : 'Lifetime — nothing to renew.'
            : pro.lapsed
              ? `Ran out on ${pro.lapsed.expiredAt.toLocaleDateString()}. Guest masks are locked again until you renew.`
              : 'Seat masks published by other members. Your own masks and the house panel are always free.'}
        </div>

        {IS_TEST_STORE && (
          <div className="text-xs rounded border border-amber-700/40 bg-amber-900/20 text-amber-200 px-3 py-2">
            <strong>Test Store.</strong> Every purchase and expiry here is simulated.
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => void pro.refresh()}
            className="text-xs px-3 py-1.5 rounded bg-[#2a2a3e] hover:bg-[#3a3a5e]"
          >
            Restore purchases
          </button>
          {pro.info?.managementURL && (
            <a
              href={pro.info.managementURL}
              target="_blank"
              rel="noreferrer"
              className="text-xs px-3 py-1.5 rounded bg-[#2a2a3e] hover:bg-[#3a3a5e]"
            >
              Manage or cancel
            </a>
          )}
        </div>
      </section>

      {/* ── What you earn ─────────────────────────────────────────────── */}
      <section className="space-y-2 border-t border-[#1e1e2e] pt-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-white">Rent out your masks</span>
          <span className="text-xs text-[#6b7280]">{earned} appearance{earned === 1 ? '' : 's'}</span>
        </div>
        <p className="text-xs text-[#6b7280]">
          A published mask can be seated by any Pro member. You are credited every time it takes a
          seat — the count is what a payout would be calculated from.
        </p>

        {avatarGroups.length === 0 ? (
          <div className="text-xs text-[#6b7280] border border-[#1e1e2e] rounded-lg px-3 py-4 text-center">
            No masky.ai avatars on this account yet.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {avatarGroups.map((g) => {
              const live = byAvatarId.get(g.id);
              return (
                <li
                  key={g.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e]"
                >
                  {g.thumbnailUrl && (
                    <img src={g.thumbnailUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
                  )}
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-white truncate">{g.displayName}</span>
                    <span className="block text-[11px] text-[#6b7280]">
                      {live ? `Published · seated ${live.rentals}×` : 'Private'}
                    </span>
                  </span>
                  <button
                    onClick={() =>
                      live
                        ? withdraw({ id: live._id, ownerUid: uid })
                        : publish({
                            ownerUid: uid,
                            ownerName: displayName,
                            avatarId: g.id,
                            name: g.displayName,
                            persona: g.personalityPrompt ?? '',
                            thumbnailUrl: g.thumbnailUrl,
                          })
                    }
                    className={
                      live
                        ? 'text-[11px] px-2.5 py-1 rounded bg-[#2a2a3e] hover:bg-[#3a3a5e] text-[#cbd5e1]'
                        : 'text-[11px] px-2.5 py-1 rounded bg-emerald-800/60 hover:bg-emerald-700/60 text-emerald-100'
                    }
                  >
                    {live ? 'Withdraw' : 'Publish'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
