import {
  Purchases,
  ErrorCode,
  PurchasesError,
  type CustomerInfo,
  type Offering,
  type Package,
} from '@revenuecat/purchases-js';

/**
 * RevenueCat, the web way.
 *
 * Maskord is React + Vite (shipped as a web build and wrapped by Electron), so
 * the mobile SDKs do not apply: `@revenuecat/purchases-js` is the one that runs
 * here, and it is also the one the Test Store supports (>= 1.15.0).
 */

/** The one permission that matters: renting somebody else's mask. */
export const MASKORD_PRO = 'maskord_pro';

/**
 * A *public* Test Store key. RevenueCat public SDK keys are designed to ship in
 * clients, and a `test_` key can only ever make test purchases — no card, no
 * money. Swap it for a live Web Billing key (and set it through CI rather than
 * here) before anyone is charged for real.
 */
const TEST_STORE_KEY = 'test_mgwdytcmpNoWKNvReyLoWOJrgDs';
const API_KEY = (import.meta.env.VITE_REVENUECAT_API_KEY as string | undefined) || TEST_STORE_KEY;

/** True while we are spending nobody's money, which the paywall says out loud. */
export const IS_TEST_STORE = API_KEY.startsWith('test_');

/**
 * Signed-out visitors still get a Purchases instance so the paywall can show
 * prices before they commit to an account. Keeping the generated id in
 * localStorage means a guest who signs in later is the same RevenueCat customer.
 */
const ANON_KEY = 'maskord_rc_anonymous_app_user_id';

function anonymousAppUserId(): string {
  try {
    const stored = localStorage.getItem(ANON_KEY);
    if (stored) return stored;
    const fresh = Purchases.generateRevenueCatAnonymousAppUserId();
    localStorage.setItem(ANON_KEY, fresh);
    return fresh;
  } catch {
    return Purchases.generateRevenueCatAnonymousAppUserId();
  }
}

/**
 * Configure once, then follow the Firebase uid.
 *
 * `configure` throws if called twice, and the uid arrives after first render
 * (auth resolves asynchronously), so the second and later calls switch the
 * customer with `changeUser` instead. Without that, a user who signs in would
 * keep purchasing as their anonymous self and lose the entitlement on reload.
 */
export async function configurePurchases(uid: string | null): Promise<Purchases> {
  const appUserId = uid ?? anonymousAppUserId();

  if (!Purchases.isConfigured()) {
    return Purchases.configure({ apiKey: API_KEY, appUserId });
  }

  const purchases = Purchases.getSharedInstance();
  if (purchases.getAppUserId() !== appUserId) await purchases.changeUser(appUserId);
  return purchases;
}

export function isPro(info: CustomerInfo | null): boolean {
  return Boolean(info?.entitlements.active[MASKORD_PRO]);
}

/** When Pro runs out, or null for lifetime and for customers who never bought. */
export function proExpiresAt(info: CustomerInfo | null): Date | null {
  return info?.entitlements.active[MASKORD_PRO]?.expirationDate ?? null;
}

/**
 * The most recent `maskord_pro` grant whether or not it is still live, so the
 * UI can distinguish "never subscribed" from "expired" — which is the state the
 * RevenueCat challenge asks us to demonstrate, and the one a naive
 * `entitlements.active` check cannot see at all.
 */
export function lapsedPro(info: CustomerInfo | null): { expiredAt: Date } | null {
  const ent = info?.entitlements.all[MASKORD_PRO];
  if (!ent || ent.isActive || !ent.expirationDate) return null;
  return { expiredAt: ent.expirationDate };
}

export async function getOffering(): Promise<Offering | null> {
  const { current } = await Purchases.getSharedInstance().getOfferings();
  return current ?? null;
}

/** Monthly before yearly before lifetime, so the paywall reads cheapest-first. */
export function sortedPackages(offering: Offering | null): Package[] {
  const order = ['monthly', 'yearly', 'lifetime'];
  return [...(offering?.availablePackages ?? [])].sort(
    (a, b) => order.indexOf(a.identifier) - order.indexOf(b.identifier),
  );
}

export type PurchaseOutcome =
  | { ok: true; info: CustomerInfo }
  | { ok: false; cancelled: boolean; message: string };

/**
 * Buy, and turn every failure into something a human can read.
 *
 * A cancelled checkout is not an error worth shouting about, and it is by far
 * the most common "failed purchase" — which the challenge wants demonstrated —
 * so it comes back flagged rather than thrown.
 */
export async function purchasePackage(rcPackage: Package): Promise<PurchaseOutcome> {
  try {
    const { customerInfo } = await Purchases.getSharedInstance().purchase({ rcPackage });
    return { ok: true, info: customerInfo };
  } catch (err) {
    if (err instanceof PurchasesError) {
      return {
        ok: false,
        cancelled: err.errorCode === ErrorCode.UserCancelledError,
        message: purchaseErrorMessage(err),
      };
    }
    return { ok: false, cancelled: false, message: (err as Error).message };
  }
}

function purchaseErrorMessage(err: PurchasesError): string {
  switch (err.errorCode) {
    case ErrorCode.UserCancelledError:
      return 'Checkout closed — nothing was charged.';
    case ErrorCode.PaymentPendingError:
      return 'The payment is still processing. Pro unlocks as soon as it clears.';
    case ErrorCode.ProductAlreadyPurchasedError:
      return 'You already own this. Try restoring instead.';
    case ErrorCode.NetworkError:
      return 'Could not reach RevenueCat. Check your connection and try again.';
    case ErrorCode.StoreProblemError:
      return 'The store rejected the purchase. Nothing was charged.';
    default:
      return err.message || 'The purchase did not complete.';
  }
}

export type { CustomerInfo, Offering, Package };
