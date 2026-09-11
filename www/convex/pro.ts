import { v } from 'convex/values';
import { action } from './_generated/server';

/**
 * `maskord_pro`, checked against RevenueCat rather than taken on trust.
 *
 * The client already reads the entitlement through `@revenuecat/purchases-js`,
 * which is what draws the paywall and the padlocks. That answer cannot be the
 * gate: it lives in the browser, so seating a rented mask was one Convex call
 * away for anyone who skipped the UI. This module is the server's own answer,
 * fetched with the RevenueCat **secret** key — the one surface where a secret
 * key belongs, and the reason the key is in the deployment's environment rather
 * than the bundle.
 *
 * API **v2** specifically. An `sk_` secret key is rejected by v1 with code 7723
 * ("incompatible with RevenueCat API V1"), so the familiar `/v1/subscribers/{id}`
 * shape is not available to us at all — v2 is project-scoped, which is why
 * `REVENUECAT_PROJECT_ID` has to be set alongside the key.
 *
 * What this does not fix: Convex has no Firebase identity here, so the caller
 * still names the customer it wants checked. Verification means you must know a
 * real Pro customer's app user id to get in, instead of flipping a boolean in
 * devtools. Binding the app user id to an authenticated session is the next step
 * and is the same missing piece that makes `rentable.publish` trust `ownerUid`.
 */

const RC_V2 = 'https://api.revenuecat.com/v2';
export const MASKORD_PRO = 'maskord_pro';

/** False when the deployment cannot ask RevenueCat, which the gate reports rather than ignores. */
export function hasProVerification(): boolean {
  return Boolean(process.env.REVENUECAT_SECRET_KEY && process.env.REVENUECAT_PROJECT_ID);
}

export interface ProCheck {
  /** The entitlement is live for this customer right now. */
  pro: boolean;
  /** The deployment was able to ask RevenueCat at all. */
  verified: boolean;
  /** Millis, or null for a lifetime grant and for customers who never bought. */
  expiresAt: number | null;
  /** Bought at some point, live or not — an expired customer, not a new one. */
  everSubscribed: boolean;
}

const UNVERIFIED: ProCheck = { pro: false, verified: false, expiresAt: null, everSubscribed: false };
const NEVER: ProCheck = { pro: false, verified: true, expiresAt: null, everSubscribed: false };

async function rcGet(path: string): Promise<unknown | null> {
  const res = await fetch(`${RC_V2}/projects/${process.env.REVENUECAT_PROJECT_ID}/${path}`, {
    headers: { authorization: `Bearer ${process.env.REVENUECAT_SECRET_KEY}`, accept: 'application/json' },
  });

  // A customer RevenueCat has never seen is a 404, which means exactly "never
  // bought anything" — a clean negative, not a failure.
  if (res.status === 404) return null;
  if (!res.ok) {
    // Anything else throws: answering "not Pro" on a bad key or an outage would
    // look identical to denying a subscriber the thing they paid for.
    throw new Error(`RevenueCat ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return await res.json();
}

/**
 * Entitlement ids, not lookup keys, are what a customer's entitlements come back
 * as, so the id behind `maskord_pro` has to be looked up once. Cached for the
 * life of the isolate because it only changes if somebody renames the entitlement
 * in the dashboard.
 */
let entitlementIdCache: string | null = null;

async function proEntitlementId(): Promise<string | null> {
  if (entitlementIdCache) return entitlementIdCache;
  const body = (await rcGet('entitlements')) as {
    items?: Array<{ id: string; lookup_key: string }>;
  } | null;
  const match = (body?.items ?? []).find((e) => e.lookup_key === MASKORD_PRO);
  entitlementIdCache = match?.id ?? null;
  return entitlementIdCache;
}

/** Products attached to `maskord_pro`, cached like the entitlement id and for the same reason. */
let proProductsCache: Set<string> | null = null;

async function proProductIds(entitlementId: string): Promise<Set<string>> {
  if (proProductsCache) return proProductsCache;
  const body = (await rcGet(`entitlements/${entitlementId}/products`)) as {
    items?: Array<{ id: string }>;
  } | null;
  proProductsCache = new Set((body?.items ?? []).map((p) => p.id));
  return proProductsCache;
}

interface HistoryRow {
  product_id?: string | null;
  entitlements?: { items?: Array<{ lookup_key?: string }> };
}

/**
 * Has this customer ever held Pro, whether or not they do now?
 *
 * Only asked when they do not, because it is purely what separates "expired"
 * from "never bought" — the state the RevenueCat challenge wants demonstrated and
 * the one the active-entitlements list cannot show by construction. Subscriptions
 * and one-time purchases are separate collections, so a lapsed monthly and a
 * lifetime both have to be looked for.
 *
 * Two signals, because neither alone survives every history: an expired row still
 * carries the product it was for, while a *revoked promotional* grant keeps the
 * row but has its entitlement link stripped and no product at all. Matching the
 * product against the entitlement's product list is what recognises a subscription
 * that simply ran out.
 */
async function everHeldPro(customerId: string, entitlementId: string): Promise<boolean> {
  const [products, subs, purchases] = await Promise.all([
    proProductIds(entitlementId),
    rcGet(`customers/${encodeURIComponent(customerId)}/subscriptions`),
    rcGet(`customers/${encodeURIComponent(customerId)}/purchases`),
  ]);

  const grantedPro = (row: HistoryRow) =>
    (row.product_id ? products.has(row.product_id) : false) ||
    (row.entitlements?.items ?? []).some((e) => e.lookup_key === MASKORD_PRO);

  type Rows = { items?: HistoryRow[] } | null;
  return (
    ((subs as Rows)?.items ?? []).some(grantedPro) ||
    ((purchases as Rows)?.items ?? []).some(grantedPro)
  );
}

/** Ask RevenueCat whether this customer holds the entitlement. */
export async function checkPro(customerId: string): Promise<ProCheck> {
  if (!hasProVerification()) return UNVERIFIED;

  const entitlementId = await proEntitlementId();
  // No such entitlement in the project means nobody can hold it, and a silent
  // "not Pro" would hide a misconfigured dashboard.
  if (!entitlementId) throw new Error(`RevenueCat project has no '${MASKORD_PRO}' entitlement`);

  const body = (await rcGet(
    `customers/${encodeURIComponent(customerId)}/active_entitlements`,
  )) as { items?: Array<{ entitlement_id: string; expires_at: number | null }> } | null;

  if (body === null) return NEVER;

  const active = (body.items ?? []).find((e) => e.entitlement_id === entitlementId);
  if (!active) {
    return { ...NEVER, everSubscribed: await everHeldPro(customerId, entitlementId) };
  }

  // RevenueCat only lists an entitlement here while it is live, so no expiry
  // comparison is needed — a null `expires_at` is the Lifetime package.
  return { pro: true, verified: true, expiresAt: active.expires_at ?? null, everSubscribed: true };
}

/**
 * The server's verdict, readable by the UI.
 *
 * Worth surfacing rather than keeping internal: it is what distinguishes a demo
 * that claims an entitlement from one that can show where the claim was checked,
 * and it is the same call the seating gate makes.
 */
export const status = action({
  args: { appUserId: v.string() },
  handler: async (_ctx, { appUserId }): Promise<ProCheck> => checkPro(appUserId),
});
