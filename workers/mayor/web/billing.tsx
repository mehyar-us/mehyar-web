import { useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/** Plan & usage (React migration S1): the billing view's loaded state as a
 * React 19 component over the SAME billing API and data the vanilla workday
 * renderer used — identical structure, classes, and copy. Data loading,
 * versioning, and the Stripe checkout dialogs stay in workday.ts; this
 * panel only renders and reports clicks through callbacks. */

export interface CreditPack {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
  replyAttempts: number;
  voiceMinutes: number;
  available?: boolean;
}
export interface BillingPlan {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
  replyLimit: number;
  voiceMinuteLimit: number;
}
export interface BillingModuleCashText {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
  interval: string;
  ready: boolean;
  subscribed: boolean;
  status: string;
  cancelAtPeriodEnd: boolean;
  connect: { status: string; chargesEnabled: boolean; payoutsEnabled?: boolean; accountLinked?: boolean; onboardingOpen?: boolean };
  checkout: { pending?: boolean; requestId?: string };
}
export interface BillingModuleLeadProof {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
  interval: string;
  leadTarget: number;
  ready: boolean;
  creditsHeld: number;
  packs: { id: string; icpText: string; status: string; leadCount: number | null; shortfallReason: string | null; createdAt: string; readyAt: string | null; exportedAt: string | null }[];
  checkout: { pending?: boolean; requestId?: string };
}
export interface BillingData {
  modules?: { cashtext: BillingModuleCashText; leadproof?: BillingModuleLeadProof };
  plan: { id: string; name: string; status: string; cancelAtPeriodEnd?: boolean };
  usage: {
    resetAt: string;
    replies: { used: number; limit: number; remaining: number };
    voiceMinutes: { used: number; limit: number; remaining: number };
  };
  credits?: {
    replyAttempts: number;
    voiceMinutes: number;
    expiresAt: string;
    periodKey: string;
    checkout?: { pending?: boolean; packId?: string; requestId?: string };
    purchases?: { packId: string; status: string; paidAt?: string | null }[];
  } | null;
  creditPacks?: CreditPack[];
  founding?: { available: boolean; seats_total: number; seats_taken: number | null; seats_remaining: number | null };
  foundingPriceCents?: number;
  plans: BillingPlan[];
  checkout: { pending?: boolean; requestId?: string };
  readiness: { checkout: boolean; creditPacks: boolean; portal: boolean; mode?: string; message?: string };
  permissions: { canManage: boolean };
}
export interface BillingPanelProps {
  data: BillingData;
  formatTime: (value: string) => string;
  onPaint: () => void;
  onRefresh: () => void;
  onUpgrade: () => void;
  onCreditCheckout: (pack: CreditPack) => void;
  onModuleCheckout: () => void;
  onLeadProofCheckout: () => void;
  onLeadProofRequest: () => void;
  onModuleCancelToggle: (cancel: boolean) => void;
  onConnectOnboard: () => void;
  onPortal: () => void;
}

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 0 }).format(cents / 100);
const moneyExact = (cents: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
const approxConversations = (attempts: number) => Math.max(1, Math.round(attempts / 10));

export function BillingPanel({ data, formatTime, onPaint, onRefresh, onUpgrade, onCreditCheckout, onModuleCheckout, onLeadProofCheckout, onLeadProofRequest, onModuleCancelToggle, onConnectOnboard, onPortal }: BillingPanelProps) {
  // Lucide placeholders render as <i data-lucide>; the host swaps them for
  // SVGs after each commit, exactly as the vanilla renderer did.
  useEffect(() => { onPaint(); });

  const canManage = data.permissions.canManage;
  const credits = data.credits && Array.isArray(data.creditPacks) ? data.credits : null;
  const pending = credits?.checkout?.pending;

  return (
    <>
      <div className="view-toolbar">
        <p className="subtle">{data.plan.name} · {data.plan.status}</p>
        <div className="toolbar-actions">
          <button type="button" className="secondary" onClick={onRefresh}>Refresh payment status</button>
        </div>
      </div>

      <section className="usage-panel">
        <h2>Your business allowance</h2>
        <p className="subtle">Shared across this business. Usage resets {formatTime(data.usage.resetAt)}.</p>
        {([['Assistant replies', data.usage.replies], ['Microphone minutes', data.usage.voiceMinutes]] as [string, { used: number; limit: number }][]).map(([label, item]) => (
          <div className="usage-row" key={label}>
            <strong>{label}</strong>
            <span>{Math.round(item.used * 10) / 10} / {item.limit}</span>
            <progress max={item.limit} value={item.used} aria-label={label} />
          </div>
        ))}
      </section>

      {credits && (
        <section className="credit-packs">
          <span className="eyebrow">A LITTLE EXTRA, WHEN YOU NEED IT</span>
          <h2>One-time usage packs</h2>
          <p className="subtle">Add to this business’s current allowance until {formatTime(credits.expiresAt)}. Unused packs expire when this usage period ends or you change between Free and Pro. They do not roll over.</p>
          {(credits.replyAttempts || credits.voiceMinutes) ? (
            <p className="inline-note">Verified packs in this period add {credits.replyAttempts.toLocaleString()} reply attempts and {credits.voiceMinutes} microphone minutes. These are included in the allowance above.</p>
          ) : null}
          {pending ? (
            <p className="inline-note">A pack checkout is pending. No allowance is added until Stripe verifies payment. Resume it below or refresh payment status after returning.</p>
          ) : null}
          <div className="credit-pack-grid">
            {data.creditPacks!.map((pack) => {
              const resume = Boolean(pending && credits.checkout?.packId === pack.id);
              return (
                <article className="credit-pack-card" key={pack.id}>
                  <h3>{pack.name}</h3>
                  <p className="credit-pack-price">{money(pack.priceCents, pack.currency)} once</p>
                  <p>+{pack.replyAttempts.toLocaleString()} reply attempts (≈{approxConversations(pack.replyAttempts)} conversations) · +{pack.voiceMinutes} microphone minutes</p>
                  <button
                    type="button"
                    className="secondary"
                    disabled={!canManage || !data.readiness.creditPacks || pack.available !== true || Boolean(pending && !resume)}
                    onClick={() => onCreditCheckout(pack)}
                  >
                    {resume ? 'Resume pack checkout' : `Choose ${pack.name}`}
                  </button>
                </article>
              );
            })}
          </div>
          <p className="source-note">Optional on either plan. No subscription, automatic purchase, or overage charge. A refund or dispute removes that pack’s allowance; usage already consumed remains counted.</p>
          {credits.purchases?.length ? (
            <details className="credit-pack-history">
              <summary>Pack purchases this period</summary>
              <ul>
                {credits.purchases.map((purchase, index) => {
                  const pack = data.creditPacks!.find((item) => item.id === purchase.packId);
                  return (
                    <li key={index}>
                      {pack?.name ?? 'Usage pack'} · {String(purchase.status).replaceAll('_', ' ')}{purchase.paidAt ? ' · ' + formatTime(purchase.paidAt) : ''}
                    </li>
                  );
                })}
              </ul>
            </details>
          ) : null}
        </section>
      )}

      {data.modules?.cashtext && (() => {
        const cashtext = data.modules.cashtext;
        const modulePending = Boolean(cashtext.checkout.pending);
        return (
          <section className="credit-packs">
            <span className="eyebrow">MODULES</span>
            <h2>CashText</h2>
            <p className="subtle">Invoice customers by conversation: The Mayor drafts each invoice and payment reminder, you approve every send, and your customers pay your own Stripe account.</p>
            {cashtext.subscribed ? (
              <>
                <p className="inline-note">CashText is active for this business{cashtext.cancelAtPeriodEnd ? ' — it ends at the close of this paid period' : ''}.</p>
                <button type="button" className="secondary" disabled={!canManage} onClick={() => onModuleCancelToggle(!cashtext.cancelAtPeriodEnd)}>
                  {cashtext.cancelAtPeriodEnd ? 'Keep CashText' : 'Cancel CashText at period end'}
                </button>
              </>
            ) : cashtext.status !== 'not_subscribed' ? (
              <p className="inline-note">CashText is not active right now ({cashtext.status.replaceAll('_', ' ')}). No invoices can be sent until its payment is in good standing.</p>
            ) : (
              <>
                {/* Display conversion (2026-10-23, Phase 8 gate item
                    pulled forward): NO price figure on this card while
                    the launch price is unruled (D5 HOLD) — launch
                    language only, exactly as the public surfaces carry.
                    The figure lives in plans.ts + Stripe checkout. */}
                <p className="inline-note">Arrives with the module launch — pricing is announced at launch, and checkout opens then.</p>
                <p className="subtle">Bills as its own subscription, separate from your Mayor plan. Cancel ends it at period end. Payments are final and non-refundable — see <a href="/terms">Terms</a>.</p>
                {modulePending ? (
                  <p className="inline-note">A CashText checkout is pending. Nothing is active until Stripe verifies payment.</p>
                ) : null}
                <button type="button" className="secondary" disabled={!canManage || !cashtext.ready} onClick={onModuleCheckout}>
                  {modulePending ? 'Resume CashText checkout' : 'Add CashText'}
                </button>
                {!cashtext.ready ? (
                  <p className="subtle">CashText is being prepared. You can keep using your plan.</p>
                ) : null}
              </>
            )}
            <p className="source-note">Stripe connection: {cashtext.connect.status === 'active' ? `connected — your customers pay your own Stripe account${cashtext.connect.chargesEnabled ? ' · charges enabled' : ''}${cashtext.connect.payoutsEnabled ? ' · payouts enabled' : ''}.` : cashtext.connect.status === 'restricted' ? 'connected, but Stripe needs more from your business before payments can flow — finish the open items on Stripe.' : cashtext.connect.accountLinked ? 'setup started on Stripe — finish it to connect your account.' : 'not connected yet.'}</p>
            <p className="source-note">When you connect, Stripe collects your business&rsquo;s own KYC, tax, and bank details on Stripe&rsquo;s pages; The Mayor never sees or stores them.</p>
            <p className="source-note">Stripe&rsquo;s standard fees apply to payments you receive — charged by Stripe, not by us.</p>
            {!cashtext.connect.onboardingOpen ? (
              <p className="subtle">Connecting opens once our Terms name your business as the merchant of record for your invoices. That update is in flight — connecting is not open yet.</p>
            ) : cashtext.connect.status !== 'active' ? (
              <button type="button" className="secondary" disabled={!canManage} onClick={onConnectOnboard}>
                {cashtext.connect.status === 'restricted' ? 'Resolve on Stripe' : cashtext.connect.accountLinked ? 'Continue Stripe setup' : 'Connect your Stripe account'}
              </button>
            ) : null}
          </section>
        );
      })()}

      {data.modules?.leadproof && (() => {
        const leadproof = data.modules.leadproof;
        const packPending = Boolean(leadproof.checkout.pending);
        return (
          <section className="credit-packs">
            <span className="eyebrow">MODULES</span>
            <h2>LeadProof</h2>
            <p className="subtle">Evidence-backed business leads: describe who you want to reach and get a pack of up to {leadproof.leadTarget} local businesses that match — every lead with the source behind it, ready to download. Export only: The Mayor never contacts them for you.</p>
            {/* No price figure on this card either (the same display
                conversion as CashText's): the pack price is a plans.ts
                constant shown at Stripe checkout, not a page figure,
                until a launch price is ruled. */}
            <p className="inline-note">Arrives with the module launch — pricing is announced at launch, and checkout opens then.</p>
            <p className="subtle">One pack, one credit. If fewer than 15 leads qualify, the pack credit comes back automatically. Payments are final and non-refundable — see <a href="/terms">Terms</a>.</p>
            {leadproof.creditsHeld ? (
              <>
                <p className="inline-note">You hold {leadproof.creditsHeld} pack credit{leadproof.creditsHeld === 1 ? '' : 's'} — spend one when you request a pack.</p>
                {/* The pack request (§4.1): who + where, in the tenant's
                    own words. The confirm is a read-back dialog in
                    workday.ts; the spend happens only on confirm. */}
                <div className="leadproof-request">
                  <label>Kind of business <input id="leadproof-category" type="text" maxLength={120} placeholder="property managers" /></label>
                  <label>Where <input id="leadproof-geography" type="text" maxLength={120} placeholder="Brooklyn, NY" /></label>
                  <label>Describe who you want to reach <input id="leadproof-icp" type="text" maxLength={500} placeholder="Property managers in Brooklyn who look busy" /></label>
                  <button type="button" className="secondary" disabled={!canManage} onClick={onLeadProofRequest}>Request a pack</button>
                </div>
              </>
            ) : null}
            {packPending ? (
              <p className="inline-note">A LeadProof checkout is pending. No credit lands until Stripe verifies payment.</p>
            ) : null}
            <button type="button" className="secondary" disabled={!canManage || !leadproof.ready} onClick={onLeadProofCheckout}>
              {packPending ? 'Resume LeadProof checkout' : 'Buy a LeadProof pack'}
            </button>
            {!leadproof.ready ? (
              <p className="subtle">LeadProof is being prepared. You can keep using your plan.</p>
            ) : null}
            {leadproof.packs.length ? (
              <details>
                <summary>Your packs</summary>
                <ul className="purchase-list">
                  {leadproof.packs.map((pack) => (
                    <li key={pack.id}>
                      {pack.icpText} · {pack.status.replaceAll('_', ' ')}{pack.leadCount != null ? ` · ${pack.leadCount} leads` : ''}{pack.shortfallReason ? ` · ${pack.shortfallReason}` : ''}
                      {pack.status === 'ready' || pack.status === 'exported' ? (
                        <> · <a href={`/api/billing/leadproof/packs/${pack.id}/export?format=csv`}>Download CSV</a> · <a href={`/api/billing/leadproof/packs/${pack.id}/export?format=json`}>JSON</a></>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        );
      })()}

      {data.plan.cancelAtPeriodEnd ? (
        <p className="inline-note">Pro ends at the close of this paid period. Your saved business records remain available on Free.</p>
      ) : null}

      <div className="plan-grid">
        {data.plans.map((plan) => {
          const features = [
            `${plan.replyLimit.toLocaleString()} reply attempts (≈${approxConversations(plan.replyLimit)} conversations a month)`,
            `${plan.voiceMinuteLimit} microphone minutes`,
            'Customers, appointments, and tasks',
            'Calendar connection and saved business profile',
          ];
          return (
            <section className={'plan-card' + (plan.id === 'pro' ? ' recommended' : '')} key={plan.id}>
              <span className="eyebrow">{plan.id === 'pro' ? 'FOR A BUSIER BUSINESS' : 'A GOOD PLACE TO START'}</span>
              <h2>{plan.name}</h2>
              <p className="plan-price">
                <strong>{money(plan.priceCents, plan.currency)}</strong>
                <span>{plan.priceCents ? ' / month' : ' / month, always'}</span>
              </p>
              <ul className="plan-features">
                {features.map((label) => (
                  <li key={label}>
                    <i data-lucide="check" aria-hidden="true" />
                    <span>{label}</span>
                  </li>
                ))}
              </ul>
              {plan.id === 'pro' && data.founding?.available && (data.founding.seats_remaining ?? 0) > 0 && data.foundingPriceCents ? (
                <p className="inline-note">Founding cohort: {moneyExact(data.foundingPriceCents, plan.currency)}/month, locked at that rate for as long as your founding subscription stays active — {data.founding.seats_remaining} of {data.founding.seats_total} seats left. Choose Founding in the upgrade dialog.</p>
              ) : null}
              {plan.id === data.plan.id ? (
                <p className="current-plan">Your current plan</p>
              ) : plan.id === 'pro' ? (
                <button type="button" className="primary" disabled={!canManage || !data.readiness.checkout} onClick={onUpgrade}>
                  {data.checkout.pending ? 'Resume checkout' : 'Upgrade to Pro'}
                </button>
              ) : (
                <p className="subtle">Manage a paid subscription below to return to Free.</p>
              )}
            </section>
          );
        })}
      </div>

      <p className="subtle">{data.readiness.message ?? ''}</p>
      {data.readiness.mode === 'test' ? (
        <p className="inline-note">Payment testing is enabled. Checkout uses Stripe test mode; no real payment is taken.</p>
      ) : null}
      {canManage && data.readiness.portal ? (
        <button type="button" className="secondary" onClick={onPortal}>Manage subscription &amp; invoices</button>
      ) : null}
      {!canManage ? (
        <p className="subtle">A business owner or a person with the billing role can manage the subscription.</p>
      ) : null}
      <p className="source-note">No automatic overage charges. Paid periods begin after Stripe verifies payment. Carrier charges for a connected business phone are separate.</p>
    </>
  );
}

let root: Root | null = null;
let rootElement: HTMLElement | null = null;

export function mountBilling(element: HTMLElement, props: BillingPanelProps, isCurrent: () => boolean): void {
  if (!isCurrent()) return;
  if (rootElement !== element) {
    root?.unmount();
    root = createRoot(element);
    rootElement = element;
  }
  root.render(<BillingPanel {...props} />);
}
