import { useState } from 'react';
import { useAction, useQuery } from 'convex/react';
import { api } from '@maskord/convex';

interface Props {
  /** The room the mask would join. */
  slug: string;
  /** True when the client's own entitlement read says `maskord_pro` is live. */
  pro: boolean;
  /** The RevenueCat customer, which the server re-checks. Null before Purchases configures. */
  appUserId: string | null;
  /** Member keys already seated, so a mask is not offered twice. */
  seated: Set<string>;
  /** Called instead of seating when the visitor has no entitlement. */
  onLocked: (maskName: string) => void;
}

/** What the server said when it would not seat the mask. */
const REFUSALS: Record<string, string> = {
  lapsed: 'Pro has expired — renew to seat guest stars again.',
  no_pro: 'Maskord Pro is needed to seat somebody else’s mask.',
  unverifiable: 'This deployment cannot verify subscriptions yet (REVENUECAT_SECRET_KEY is unset).',
  gone: 'That mask was withdrawn from the shelf.',
};

/**
 * Masks other members have published for rent — the Maskord Pro feature.
 *
 * Locked rather than hidden on purpose: a paid feature nobody can see is a
 * feature nobody buys, and a judge needs to watch the same avatar go from
 * padlocked to arguing. The rental count is the owner's earnings surface.
 *
 * The click calls `rentable.seatRented`, which checks the entitlement against
 * RevenueCat before seating. `pro` below only decides whether to show a paywall
 * first — the server can still refuse, and says why.
 */
export default function GuestStarShelf({ slug, pro, appUserId, seated, onLocked }: Props) {
  const rentable = useQuery(api.rentable.list, {});
  const seatRented = useAction(api.rentable.seatRented);
  const [refused, setRefused] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const available = (rentable ?? []).filter((m) => !seated.has(m.memberKey));
  if (available.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-[#6b7280] mr-1">
        Guest stars {pro ? '' : '· Pro'}
      </span>

      {available.map((mask) => (
        <button
          key={mask.memberKey}
          disabled={pending === mask.memberKey}
          title={
            pro
              ? `${mask.name} — published by ${mask.ownerName}. Seated ${mask.rentals}×`
              : `${mask.name} belongs to ${mask.ownerName}. Maskord Pro lets you seat it.`
          }
          onClick={async () => {
            if (!pro || !appUserId) {
              onLocked(mask.name);
              return;
            }
            setRefused(null);
            setPending(mask.memberKey);
            try {
              const result = await seatRented({ slug, id: mask.id, appUserId });
              // The server disagreeing with the client is the case worth showing:
              // an expired subscription still reads as Pro until the cache refreshes.
              if (!result.seated) setRefused(REFUSALS[result.reason ?? ''] ?? 'Could not seat that mask.');
            } catch (err) {
              setRefused((err as Error).message);
            } finally {
              setPending(null);
            }
          }}
          className={
            pro
              ? 'text-[11px] px-2 py-0.5 rounded-full bg-emerald-900/40 border border-emerald-700/50 hover:bg-emerald-800/50 disabled:opacity-50 text-emerald-100'
              : 'text-[11px] px-2 py-0.5 rounded-full bg-[#1e1e2e] border border-[#2a2a3e] hover:border-violet-700/60 text-[#6b7280]'
          }
        >
          {pro ? '+ ' : '🔒 '}
          {mask.name}
          {mask.rentals > 0 && <span className="ml-1 opacity-60">{mask.rentals}×</span>}
        </button>
      ))}

      {refused && <span className="text-[10px] text-amber-300/80 w-full">{refused}</span>}
    </div>
  );
}
