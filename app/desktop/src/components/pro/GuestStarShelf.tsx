import { useMutation, useQuery } from 'convex/react';
import { api } from '@maskord/convex';

export interface SeatRequest {
  memberKey: string;
  name: string;
  persona: string;
  avatarUrl?: string;
}

interface Props {
  /** True when `maskord_pro` is live. False renders the shelf locked, not hidden. */
  pro: boolean;
  /** Member keys already seated, so a mask is not offered twice. */
  seated: Set<string>;
  onSeat: (mask: SeatRequest) => void;
  /** Called instead of `onSeat` when the visitor has no entitlement. */
  onLocked: (maskName: string) => void;
}

/**
 * Masks other members have published for rent — the Maskord Pro feature.
 *
 * Locked rather than hidden on purpose: a paid feature nobody can see is a
 * feature nobody buys, and a judge needs to watch the same avatar go from
 * padlocked to arguing. The rental count is the owner's earnings surface.
 */
export default function GuestStarShelf({ pro, seated, onSeat, onLocked }: Props) {
  const rentable = useQuery(api.rentable.list, {});
  const recordRental = useMutation(api.rentable.recordRental);

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
          title={
            pro
              ? `${mask.name} — published by ${mask.ownerName}. Seated ${mask.rentals}×`
              : `${mask.name} belongs to ${mask.ownerName}. Maskord Pro lets you seat it.`
          }
          onClick={() => {
            if (!pro) {
              onLocked(mask.name);
              return;
            }
            onSeat({
              memberKey: mask.memberKey,
              name: mask.name,
              persona: mask.persona,
              avatarUrl: mask.thumbnailUrl,
            });
            // Fire-and-forget: a missed count must never block a seating.
            void recordRental({ id: mask.id }).catch(() => {});
          }}
          className={
            pro
              ? 'text-[11px] px-2 py-0.5 rounded-full bg-emerald-900/40 border border-emerald-700/50 hover:bg-emerald-800/50 text-emerald-100'
              : 'text-[11px] px-2 py-0.5 rounded-full bg-[#1e1e2e] border border-[#2a2a3e] hover:border-violet-700/60 text-[#6b7280]'
          }
        >
          {pro ? '+ ' : '🔒 '}
          {mask.name}
          {mask.rentals > 0 && <span className="ml-1 opacity-60">{mask.rentals}×</span>}
        </button>
      ))}
    </div>
  );
}
