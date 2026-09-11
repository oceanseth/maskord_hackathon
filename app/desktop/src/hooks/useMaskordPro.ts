import { useCallback, useEffect, useState } from 'react';
import {
  configurePurchases,
  currentAppUserId,
  getOffering,
  isPro,
  lapsedPro,
  proExpiresAt,
  type CustomerInfo,
  type Offering,
} from '../lib/purchases';
import { Purchases } from '@revenuecat/purchases-js';

export interface MaskordProState {
  /** True only while the entitlement is live. The gate reads this and nothing else. */
  pro: boolean;
  /** Present when Pro was bought and has since run out — an expired customer, not a new one. */
  lapsed: { expiredAt: Date } | null;
  expiresAt: Date | null;
  info: CustomerInfo | null;
  offering: Offering | null;
  /** The RevenueCat customer id, which the server re-checks before seating a rented mask. */
  appUserId: string | null;
  loading: boolean;
  /** Read entitlements again — call after a purchase or when reopening a paywall. */
  refresh: () => Promise<void>;
}

/**
 * The `maskord_pro` entitlement, tied to whoever is signed in.
 *
 * Deliberately re-runs on `uid`: signing in has to move the RevenueCat customer,
 * or a purchase made as a guest would vanish on the next reload.
 */
export function useMaskordPro(uid: string | null): MaskordProState {
  const [info, setInfo] = useState<CustomerInfo | null>(null);
  const [offering, setOffering] = useState<Offering | null>(null);
  const [appUserId, setAppUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!Purchases.isConfigured()) return;
    try {
      setInfo(await Purchases.getSharedInstance().getCustomerInfo());
      setAppUserId(currentAppUserId());
    } catch {
      /* offline or the dashboard is mid-configuration — keep the last answer */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const purchases = await configurePurchases(uid);
        const [customerInfo, current] = await Promise.all([
          purchases.getCustomerInfo(),
          // A project with no offering yet must not take the app down with it.
          getOffering().catch(() => null),
        ]);
        if (cancelled) return;
        setInfo(customerInfo);
        setOffering(current);
        setAppUserId(purchases.getAppUserId());
      } catch {
        if (!cancelled) {
          setInfo(null);
          setOffering(null);
          setAppUserId(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uid]);

  return {
    pro: isPro(info),
    lapsed: lapsedPro(info),
    expiresAt: proExpiresAt(info),
    info,
    offering,
    appUserId,
    loading,
    refresh,
  };
}
