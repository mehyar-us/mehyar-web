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
  connect: { status: string; chargesEnabled: boolean };
  checkout: { pending?: boolean; requestId?: string };
}
export interface BillingData {
  modules?: { cashtext: BillingModuleCashText };
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
  onModuleCancelToggle: (cancel: boolean) => void;
  onPortal: () => void;
}

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 0 }).format(cents / 100);
const moneyExact = (cents: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
const approxConversations = (attempts: number) => Math.max(1, Math.round(attempts / 10));

export function BillingPanel({ data, formatTime, onPaint, onRefresh, onUpgrade, onCreditCheckout, onModuleCheckout, onModuleCancelToggle, onPortal }: BillingPanelProps) {
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
                <p className="credit-pack-price">{money(cashtext.priceCents, cashtext.currency)} / month</p>
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
            <p className="source-note">Stripe connection: {cashtext.connect.status === 'not_connected' ? 'not connected yet — you connect your own Stripe account in the CashText setup, and Stripe collects your business details on its own pages.' : `${cashtext.connect.status.replaceAll('_', ' ')}${cashtext.connect.chargesEnabled ? ' · charges enabled' : ''}.`}</p>
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
                <p className="inline-note">Founding cohort: {moneyExact(data.foundingPriceCents, plan.currency)}/month locked for life — {data.founding.seats_remaining} of {data.founding.seats_total} seats left. Choose Founding in the upgrade dialog.</p>
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
