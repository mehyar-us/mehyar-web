import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  CreditCard,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { api, ApiError, post, type Catalog } from "./api";
import TextUsagePanel from './TextUsagePanel';
import BillingCheck from './BillingCheck';
import BillingNotices from './BillingNotices';

type PlanId = "business" | "growth" | "operations";
type Interval = "monthly" | "annual";
type Stage = "setup" | "activation";
type Plan = {
  id: PlanId;
  name: string;
  monthlyCents: number;
  annualCents: number;
  setupCents: number;
  includedFeatures?: string[];
};
type Subscription = {
  plan_id: string;
  status: string;
  paid_through: string | null;
  cancel_at_period_end: boolean | number;
  billing_interval: string;
  grace_expires_at: string | null;
  access_state: string;
  pending_plan_id: string | null;
  dispute_state: string | null;
};
type Order = {
  id: string;
  sku: string;
  plan_id: string;
  billing_interval: string;
  amount_cents: number;
  currency: string;
  status: string;
  stage: string;
  created_at: string;
  paid_at: string | null;
  refunded_cents: number;
};
type BillingStatus = {
  reconciliation?:unknown;
  commerceEnabled: boolean;
  readiness?: {
    setup: boolean;
    activation: boolean;
    setupPlanIds?: PlanId[];
    activationPlanId?: PlanId | null;
    reason: string | null;
  };
  portalAvailable?: boolean;
  subscription: Subscription | null;
  orders: Order[];
  currency: string;
};
type Review = { stage: Stage; plan: Plan; interval: Interval };

const label = (value: string) =>
  value.replaceAll("_", " ").replaceAll("-", " ");
const money = (cents: number, currency = "USD") => {
  if (!Number.isSafeInteger(cents) || cents < 0) return "Unavailable";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: cents % 100 ? 2 : 0,
    }).format(cents / 100);
  } catch {
    return "Unavailable";
  }
};
const date = (value: string | null) => {
  if (!value || Number.isNaN(Date.parse(value))) return "Not reported";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(value),
  );
};
function validPlan(
  value: Record<string, unknown>,
): value is Record<string, unknown> & Plan {
  return (
    ["business", "growth", "operations"].includes(String(value.id)) &&
    typeof value.name === "string" &&
    [value.monthlyCents, value.annualCents, value.setupCents].every(
      (amount) =>
        typeof amount === "number" &&
        Number.isSafeInteger(amount) &&
        amount > 0,
    )
  );
}
function stripeDestination(
  value: unknown,
  host: "checkout.stripe.com" | "billing.stripe.com",
): string {
  try {
    if (typeof value !== "string") throw new Error();
    const url = new URL(value);
    if (url.origin !== `https://${host}` || url.username || url.password)
      throw new Error();
    return url.href;
  } catch {
    throw new Error(
      "The billing destination could not be verified. Please refresh and try again.",
    );
  }
}
function BillingDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      aria-labelledby="billing-dialog-title"
    >
      <div className="dialog-top">
        <h2 id="billing-dialog-title">{title}</h2>
        <button
          className="icon-button"
          aria-label="Close billing review"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export default function BillingPanel({
  tenantId,
  role,
  catalog,
  online,
  onUnauthorized,
}: {
  tenantId: string;
  role: string;
  catalog: Catalog | null;
  online: boolean;
  onUnauthorized: (error: unknown) => void;
}) {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [interval, setInterval] = useState<Interval>("monthly");
  const [review, setReview] = useState<Review | null>(null);
  const [cancelReview, setCancelReview] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const mounted = useRef(true);
  const request = useRef<AbortController | null>(null);
  const activeAction = useRef(false);
  const keys = useRef<Record<string, string>>({});
  const permitted = role === "owner" || role === "billing";
  const plans =
    catalog?.currency === "USD" ? catalog.plans.filter(validPlan) : [];
  const endpoint = (path: string) =>
    `/api/agent-billing/${path}?tenantId=${encodeURIComponent(tenantId)}`;
  const report = useCallback(
    (cause: unknown) => {
      if (
        !mounted.current ||
        (cause instanceof DOMException && cause.name === "AbortError")
      )
        return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Billing could not be loaded. Please try again.",
      );
      if (cause instanceof ApiError && cause.status === 401)
        onUnauthorized(cause);
    },
    [onUnauthorized],
  );
  const refresh = useCallback(async () => {
    if (!permitted) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    try {
      const result = await api<BillingStatus>(
        `/api/agent-billing/status?tenantId=${encodeURIComponent(tenantId)}`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted && mounted.current) setStatus(result);
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current) setStatus(null);
      report(cause);
    } finally {
      if (!controller.signal.aborted && mounted.current) setLoading(false);
    }
  }, [tenantId, permitted, report]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, [refresh]);
  function actionKey(action: string) {
    // Persist only random retry keys, never billing responses or credentials.
    const storageKey = `mayor-billing-retry:${tenantId}:${action}`;
    if (!keys.current[action]) {
      try {
        keys.current[action] =
          sessionStorage.getItem(storageKey) || crypto.randomUUID();
        sessionStorage.setItem(storageKey, keys.current[action]);
      } catch {
        keys.current[action] = crypto.randomUUID();
      }
    }
    return keys.current[action];
  }
  function clearKey(action: string) {
    delete keys.current[action];
    try {
      sessionStorage.removeItem(`mayor-billing-retry:${tenantId}:${action}`);
    } catch {
      /* Storage is optional. */
    }
  }
  async function checkout(selected: Review) {
    if (
      activeAction.current ||
      !online ||
      !canBuy(selected.stage, selected.plan.id)
    )
      return;
    activeAction.current = true;
    setBusy("checkout");
    setError("");
    const action = `${selected.stage}:${selected.plan.id}:${selected.interval}`;
    try {
      const result = await post<{ checkoutUrl: string; stage: Stage }>(
        endpoint("checkout"),
        {
          stage: selected.stage,
          planId: selected.plan.id,
          interval: selected.interval,
        },
        { "X-Idempotency-Key": actionKey(action) },
      );
      if (result.stage !== selected.stage)
        throw new Error("The returned billing stage could not be verified.");
      const destination = stripeDestination(
        result.checkoutUrl,
        "checkout.stripe.com",
      );
      if (mounted.current) window.location.assign(destination);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "order_already_resolved")
        clearKey(action);
      report(cause);
    } finally {
      activeAction.current = false;
      if (mounted.current) setBusy("");
    }
  }
  async function openPortal() {
    if (activeAction.current || !online || status?.portalAvailable !== true)
      return;
    activeAction.current = true;
    setBusy("portal");
    setError("");
    try {
      const result = await post<{ url: string }>(
        endpoint("portal"),
        {},
        { "X-Idempotency-Key": actionKey("portal") },
      );
      const destination = stripeDestination(result.url, "billing.stripe.com");
      clearKey("portal");
      if (mounted.current) window.location.assign(destination);
    } catch (cause) {
      report(cause);
    } finally {
      activeAction.current = false;
      if (mounted.current) setBusy("");
    }
  }
  async function requestCancellation() {
    if (activeAction.current || !online || !status?.subscription) return;
    activeAction.current = true;
    setBusy("cancel");
    setError("");
    const sub = status.subscription;
    try {
      const result = await post<{
        requested: boolean;
        status: string;
        paidThroughPreserved: boolean;
      }>(
        endpoint("cancel"),
        {},
        {
          "X-Idempotency-Key": actionKey(
            `cancel:${sub.plan_id}:${sub.paid_through}`,
          ),
        },
      );
      if (
        result.requested !== true ||
        result.status !== "awaiting_verified_webhook" ||
        result.paidThroughPreserved !== true
      )
        throw new Error(
          "Cancellation confirmation is pending. Refresh billing status before retrying.",
        );
      if (mounted.current) {
        setCancelRequested(true);
        setCancelReview(false);
        setNotice(
          "Cancellation requested. Waiting for verified billing confirmation; your paid-through access is preserved.",
        );
        await refresh();
      }
    } catch (cause) {
      report(cause);
    } finally {
      activeAction.current = false;
      if (mounted.current) setBusy("");
    }
  }
  const subscription = status?.subscription;
  const cancelScheduled =
    subscription?.cancel_at_period_end === true ||
    subscription?.cancel_at_period_end === 1;
  useEffect(() => {
    if (cancelRequested && cancelScheduled) {
      setCancelRequested(false);
      setNotice("Cancellation is confirmed for the end of your paid period.");
    }
  }, [cancelRequested, cancelScheduled]);
  const hasSubscription = Boolean(
    subscription &&
      !["canceled", "incomplete_expired"].includes(subscription.status),
  );
  const setupPaid = status?.orders.some(
    (order) =>
      order.stage === "setup" &&
      order.status === "paid" &&
      order.refunded_cents === 0,
  );
  const disabled = !online || loading || Boolean(busy);
  const canBuy = (stage: Stage, planId: PlanId) =>
    status?.commerceEnabled === true &&
    status.readiness?.[stage] === true &&
    (stage === "setup"
      ? status.readiness.setupPlanIds?.includes(planId) === true
      : status.readiness.activationPlanId === planId);
  const planName = (id: string) =>
    plans.find((plan) => plan.id === id)?.name || label(id);
  const reason =
    status?.readiness?.reason ||
    "Subscription checkout is not activated. No charge can be made from this screen.";

  return (
    <div className="page billing-page">
      <div className="page-heading">
        <span className="eyebrow">CLEAR COSTS. NO SURPRISES.</span>
        <h1>Billing &amp; usage.</h1>
        <p>Your setup, subscription, and measured usage in one place.</p>
      </div>
      {!permitted ? (
        <section className="panel billing-access">
          <ShieldCheck size={26} />
          <h2>Billing access is limited</h2>
          <p>
            A workspace owner or billing administrator can view orders and
            manage this workspace's subscription.
          </p>
        </section>
      ) : (
        <>
          <div className="billing-toolbar">
            <span className="small muted">
              {loading
                ? "Checking billing status…"
                : "Status comes from verified billing records."}
            </span>
            <button
              className="button secondary"
              onClick={() => void refresh()}
              disabled={disabled}
            >
              <RefreshCw size={15} />
              Refresh status
            </button>
          </div>
          {error && !review && !cancelReview && (
            <div className="banner error" role="alert">
              <span>{error}</span>
            </div>
          )}
          {notice && (
            <div className="banner success" role="status">
              <Check size={18} />
              <span>{notice}</span>
            </div>
          )}
          {status&&online&&<BillingCheck report={status.reconciliation}/>}
          <BillingNotices key={tenantId} tenantId={tenantId} online={online} onUnauthorized={onUnauthorized}/>
          {status && (
            <>
              <section className="panel current-plan billing-current">
                <div>
                  <span className="eyebrow">VERIFIED BILLING STATE</span>
                  <h2>
                    {subscription
                      ? planName(subscription.plan_id)
                      : "No active paid subscription"}
                  </h2>
                  <p>
                    {subscription
                      ? `Subscription ${label(subscription.status)} · Access ${label(subscription.access_state)}`
                      : "Setup payment and subscription activation are separate steps."}
                  </p>
                </div>
                <CreditCard size={32} />
                {subscription && (
                  <dl className="billing-details">
                    <div>
                      <dt>Billing interval</dt>
                      <dd>{label(subscription.billing_interval)}</dd>
                    </div>
                    <div>
                      <dt>Paid through</dt>
                      <dd>{date(subscription.paid_through)}</dd>
                    </div>
                    {subscription.grace_expires_at && (
                      <div>
                        <dt>Payment grace ends</dt>
                        <dd>{date(subscription.grace_expires_at)}</dd>
                      </div>
                    )}
                    {subscription.pending_plan_id && (
                      <div>
                        <dt>Pending plan</dt>
                        <dd>{planName(subscription.pending_plan_id)}</dd>
                      </div>
                    )}
                    {subscription.dispute_state &&
                      subscription.dispute_state !== "none" && (
                        <div>
                          <dt>Payment review</dt>
                          <dd>{label(subscription.dispute_state)}</dd>
                        </div>
                      )}
                  </dl>
                )}
                {cancelScheduled && (
                  <p className="billing-state-note">
                    Cancellation is scheduled for the end of the paid period.
                    Paid-through date:{" "}
                    {date(subscription?.paid_through || null)}.
                  </p>
                )}
                {(status.portalAvailable || hasSubscription) && (
                  <div className="billing-controls">
                    <button
                      className="button secondary"
                      onClick={() => void openPortal()}
                      disabled={disabled || status.portalAvailable !== true}
                    >
                      {busy === "portal" ? (
                        <LoaderCircle size={16} className="spin" />
                      ) : (
                        <ArrowUpRight size={16} />
                      )}
                      Manage billing in Stripe
                    </button>
                    {hasSubscription && (
                      <button
                        className="button quiet"
                        onClick={() => {
                          setError("");
                          setCancelReview(true);
                        }}
                        disabled={
                          disabled || cancelScheduled || cancelRequested
                        }
                      >
                        {cancelScheduled
                          ? "Cancellation scheduled"
                          : cancelRequested
                            ? "Cancellation pending confirmation"
                            : "Cancel at period end"}
                      </button>
                    )}
                    {hasSubscription && !status.portalAvailable && (
                      <p className="small muted">
                        The billing portal is not available yet. Cancellation
                        remains available.
                      </p>
                    )}
                  </div>
                )}
              </section>
              {!hasSubscription && (
                <section
                  className="billing-offers"
                  aria-labelledby="billing-offers-title"
                >
                  <div className="billing-offer-heading">
                    <div>
                      <h2 id="billing-offers-title">
                        A plan for your next chapter.
                      </h2>
                      <p className="small muted">
                        Setup is paid once. Your subscription starts only after
                        a separate activation checkout.
                      </p>
                    </div>
                    <fieldset className="billing-interval">
                      <legend className="sr-only">
                        Subscription billing interval
                      </legend>
                      {(["monthly", "annual"] as const).map((value) => (
                        <label key={value}>
                          <input
                            type="radio"
                            name="billing-interval"
                            value={value}
                            checked={interval === value}
                            onChange={() => setInterval(value)}
                          />
                          <span>
                            {value === "monthly" ? "Monthly" : "Annual"}
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  </div>
                  {(!status.commerceEnabled ||
                    (!status.readiness?.setup &&
                      !status.readiness?.activation)) && (
                    <div className="notice">
                      <ShieldCheck size={18} />
                      <p>{reason}</p>
                    </div>
                  )}
                  {setupPaid && (
                    <p className="small billing-setup-paid">
                      <Check size={16} /> Setup payment verified. Activation
                      will be available when your business setup is approved.
                    </p>
                  )}
                  {plans.length ? (
                    <div className="billing-plan-grid">
                      {plans.map((plan) => (
                        <article className="panel billing-plan" key={plan.id}>
                          <span className="eyebrow">
                            {plan.id === "business"
                              ? "A STRONG START"
                              : plan.id === "growth"
                                ? "ROOM TO GROW"
                                : "AT YOUR SCALE"}
                          </span>
                          <h3>{plan.name}</h3>
                          <div className="billing-price">
                            {money(
                              interval === "annual"
                                ? plan.annualCents
                                : plan.monthlyCents,
                            )}
                            <span>
                              {" "}
                              / {interval === "annual" ? "year" : "month"}
                            </span>
                          </div>
                          <p className="billing-setup-price">
                            Plus {money(plan.setupCents)} one-time setup
                          </p>
                          <p className="small muted">
                            {interval === "annual"
                              ? "Annual subscription is charged in full at activation."
                              : "Monthly subscription is charged at activation and renews monthly."}
                          </p>
                          <ul>
                            {Array.isArray(plan.includedFeatures) &&
                              plan.includedFeatures
                                .slice(0, 4)
                                .filter(
                                  (feature) => typeof feature === "string",
                                )
                                .map((feature) => (
                                  <li key={feature}>
                                    <Check size={15} />
                                    <span>{label(feature)}</span>
                                  </li>
                                ))}
                          </ul>
                          <div className="billing-plan-actions">
                            <button
                              className="button secondary"
                              onClick={() => {
                                setError("");
                                setReview({ stage: "setup", plan, interval });
                              }}
                              disabled={disabled || !canBuy("setup", plan.id)}
                            >
                              {status.orders.some(
                                (order) =>
                                  order.stage === "setup" &&
                                  order.plan_id === plan.id &&
                                  order.status === "paid" &&
                                  order.refunded_cents === 0,
                              )
                                ? "Setup paid"
                                : "Review setup"}
                            </button>
                            <button
                              className="button primary"
                              onClick={() => {
                                setError("");
                                setReview({
                                  stage: "activation",
                                  plan,
                                  interval,
                                });
                              }}
                              disabled={
                                disabled || !canBuy("activation", plan.id)
                              }
                            >
                              Review activation
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="panel billing-access">
                      <p>
                        Plan prices are unavailable. Refresh the app before
                        starting a purchase.
                      </p>
                    </div>
                  )}
                  <p className="small muted billing-price-note">
                    Prices are in USD. Applicable tax is calculated in Stripe
                    checkout. Payments appear here after Stripe confirms them.
                  </p>
                </section>
              )}
              <section className="panel billing-orders">
                <div className="panel-heading">
                  <h2>Orders</h2>
                  <span className="small muted">Latest 25</span>
                </div>
                {status.orders.length ? (
                  <div className="billing-table-wrap">
                    <table>
                      <caption className="sr-only">
                        Verified workspace billing orders
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Order</th>
                          <th scope="col">Date</th>
                          <th scope="col">Amount</th>
                          <th scope="col">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {status.orders.map((order) => (
                          <tr key={order.id}>
                            <td>
                              <strong>{label(order.stage)}</strong>
                              <small>{order.sku}</small>
                              <small>{order.id}</small>
                            </td>
                            <td>
                              {date(order.created_at)}
                              {order.paid_at && (
                                <small>Paid {date(order.paid_at)}</small>
                              )}
                            </td>
                            <td>
                              {money(order.amount_cents, order.currency)}
                              {order.refunded_cents > 0 && (
                                <small>
                                  {money(order.refunded_cents, order.currency)}{" "}
                                  refunded
                                </small>
                              )}
                            </td>
                            <td>
                              <span className="subtle-pill">
                                {label(order.status)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="inline-empty">
                    <CreditCard size={22} />
                    <p>
                      No billing orders have been recorded for this workspace.
                    </p>
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}
      <TextUsagePanel key={tenantId} tenantId={tenantId} online={online} onUnauthorized={onUnauthorized}/>
      {catalog && (
        <p className="small muted">
          Catalog version {catalog.version}. Existing product purchases are
          separate from your business workspace.
        </p>
      )}
      {review && (
        <BillingDialog
          title={
            review.stage === "setup"
              ? "Review your setup"
              : "Review subscription activation"
          }
          onClose={() => {
            if (!busy) setReview(null);
          }}
        >
          <div className="stack">
            <p>
              <strong>{review.plan.name}</strong> ·{" "}
              {review.interval === "annual" ? "Annual" : "Monthly"} subscription
            </p>
            <dl className="details-list">
              <div>
                <dt>One-time setup</dt>
                <dd>
                  {money(review.plan.setupCents)}
                  {review.stage === "activation"
                    ? " · separate payment"
                    : " · due at checkout"}
                </dd>
              </div>
              <div>
                <dt>Subscription</dt>
                <dd>
                  {money(
                    review.interval === "annual"
                      ? review.plan.annualCents
                      : review.plan.monthlyCents,
                  )}{" "}
                  / {review.interval === "annual" ? "year" : "month"}
                </dd>
              </div>
            </dl>
            <div className="notice">
              <ShieldCheck size={18} />
              <p>
                {review.stage === "setup"
                  ? "This checkout pays for setup only. Recurring billing requires a separate activation checkout after your setup is accepted."
                  : `This checkout starts your ${review.interval} subscription. It renews ${review.interval === "annual" ? "annually" : "monthly"} until canceled. Your setup payment was handled separately.`}{" "}
                Applicable tax is shown in Stripe.
              </p>
            </div>
            {error && (
              <div className="banner error" role="alert">
                <span>{error}</span>
              </div>
            )}
            <div className="dialog-actions">
              <button
                className="button secondary"
                disabled={Boolean(busy)}
                onClick={() => setReview(null)}
              >
                Back
              </button>
              <button
                className="button primary"
                disabled={disabled || !canBuy(review.stage, review.plan.id)}
                onClick={() => void checkout(review)}
              >
                {busy === "checkout" ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <ArrowUpRight size={16} />
                )}
                Continue to Stripe
              </button>
            </div>
          </div>
        </BillingDialog>
      )}
      {cancelReview && (
        <BillingDialog
          title="Cancel at period end?"
          onClose={() => {
            if (!busy) setCancelReview(false);
          }}
        >
          <div className="stack">
            <p>
              Your subscription will stop renewing after the current paid
              period. The recorded paid-through date is{" "}
              <strong>{date(subscription?.paid_through || null)}</strong>.
            </p>
            <p>
              We'll show cancellation as pending until billing confirmation
              arrives. Existing paid-through access is preserved.
            </p>
            {error && (
              <div className="banner error" role="alert">
                <span>{error}</span>
              </div>
            )}
            <div className="dialog-actions">
              <button
                className="button secondary"
                disabled={Boolean(busy)}
                onClick={() => setCancelReview(false)}
              >
                Keep subscription
              </button>
              <button
                className="button danger"
                disabled={disabled}
                onClick={() => void requestCancellation()}
              >
                {busy === "cancel" && (
                  <LoaderCircle size={16} className="spin" />
                )}
                Request cancellation
              </button>
            </div>
          </div>
        </BillingDialog>
      )}
    </div>
  );
}
