import { useState } from 'react';
import Modal from '../ui/Modal';
import { IS_TEST_STORE, purchasePackage, sortedPackages, type Offering, type Package } from '../../lib/purchases';

interface Props {
  offering: Offering | null;
  /** What the user was trying to do when they hit the wall, e.g. a mask's name. */
  blockedBy?: string;
  /** True when they used to have Pro — a different sentence than a first visit. */
  lapsed?: { expiredAt: Date } | null;
  onPurchased: () => void;
  onClose: () => void;
}

/**
 * The paywall.
 *
 * Built from the Offering rather than RevenueCat's hosted paywall: the mobile
 * `react-native-purchases-ui` component has no web equivalent, and a Web
 * Purchase Link would send a judge out of the app mid-demo. Prices, durations
 * and the package list all come from the dashboard, so adding a product there
 * changes this screen without a deploy.
 */
export default function PaywallModal({ offering, blockedBy, lapsed, onPurchased, onClose }: Props) {
  const packages = sortedPackages(offering);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function buy(pkg: Package) {
    setBusy(pkg.identifier);
    setError(null);
    const outcome = await purchasePackage(pkg);
    setBusy(null);

    if (outcome.ok) {
      onPurchased();
      return;
    }
    // A closed checkout is a decision, not a failure — say so quietly.
    setError(outcome.message);
  }

  return (
    <Modal title="Maskord Pro" onClose={onClose} width="max-w-lg">
      <div className="px-6 pb-6 space-y-4">
        <p className="text-sm text-[#94a3b8]">
          {lapsed
            ? `Your Pro ran out on ${lapsed.expiredAt.toLocaleDateString()}. Renew to seat guest masks again.`
            : blockedBy
              ? `${blockedBy} belongs to another member. Pro lets you seat any published mask — and its owner earns from every appearance.`
              : 'Seat any published mask, not just your own. Owners earn from every appearance.'}
        </p>

        {IS_TEST_STORE && (
          <div className="text-xs rounded border border-amber-700/40 bg-amber-900/20 text-amber-200 px-3 py-2">
            <strong>Test Store.</strong> Purchases here are simulated — no card, no charge.
          </div>
        )}

        {packages.length === 0 ? (
          <div className="text-sm text-[#6b7280] border border-[#1e1e2e] rounded-lg px-3 py-6 text-center">
            No plans are published yet. Add products to the current offering in RevenueCat
            and they appear here without a deploy.
          </div>
        ) : (
          <div className="space-y-2">
            {packages.map((pkg) => (
              <button
                key={pkg.identifier}
                disabled={busy !== null}
                onClick={() => buy(pkg)}
                className="w-full flex items-center justify-between gap-4 px-4 py-3 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] hover:border-violet-600 disabled:opacity-50 text-left transition-colors"
              >
                <span>
                  <span className="block text-sm font-semibold text-white">
                    {pkg.webBillingProduct.title || pkg.identifier}
                  </span>
                  <span className="block text-xs text-[#6b7280]">
                    {pkg.webBillingProduct.description || pkg.identifier}
                  </span>
                </span>
                <span className="text-sm font-semibold text-violet-300 shrink-0">
                  {busy === pkg.identifier
                    ? '…'
                    : pkg.webBillingProduct.price.formattedPrice}
                </span>
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="text-xs rounded border border-red-800/50 bg-red-950/30 text-red-200 px-3 py-2">
            {error}
          </div>
        )}

        <p className="text-[11px] text-[#4b5563]">
          Billing is handled by RevenueCat. Manage or cancel any time in Settings → Maskord Pro.
        </p>
      </div>
    </Modal>
  );
}
