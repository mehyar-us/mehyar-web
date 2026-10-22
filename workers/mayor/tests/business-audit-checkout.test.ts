import { it, expect, vi, afterEach } from 'vitest';

/** UX audit Tier 0 — CHG-093: the /business-audit checkout button.
 * The offer endpoint is healthy but slow, and the availability check
 * used to resolve only if its fetch settled: a wedged fetch stranded
 * the button on "Checking checkout…" indefinitely, and the failure
 * path offered no retry but "please refresh". These tests mount the
 * real audit-main module against a minimal DOM and pin: every path
 * resolves the button, failure shows explicit copy WITH a working
 * retry, a wedged fetch resolves on the UI deadline, and the success
 * state is exactly what it was. */

vi.mock('lucide', () => ({
  createIcons: () => {},
  ArrowUpRight: {}, ArrowRight: {}, NotebookTabs: {}, MonitorSmartphone: {},
  CalendarCheck: {}, UsersRound: {}, MapPin: {}, ListTodo: {}, Route: {},
  Check: {}, LockKeyhole: {}, RefreshCw: {}, FileText: {},
}));
vi.mock('../web/audit-report', () => ({ mountAuditReport: vi.fn(async () => {}) }));
vi.mock('../web/audit-receipt-loader', () => ({ loadAuditReceipt: vi.fn() }));

class StubElement {
  textContent = '';
  hidden = false;
  disabled = false;
  type = '';
  className = '';
  removed = false;
  children: StubElement[] = [];
  private classes = new Set<string>();
  private listeners = new Map<string, Array<() => void>>();
  classList = {
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
    contains: (name: string) => this.classes.has(name),
  };
  addEventListener(type: string, fn: () => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  click() {
    for (const fn of this.listeners.get('click') ?? []) fn();
  }
  append(...nodes: StubElement[]) {
    this.children.push(...nodes);
  }
  remove() {
    this.removed = true;
  }
  scrollIntoView() {}
  reportValidity() {
    return true;
  }
}

const OFFER_OK = {
  offer: { name: 'Business Audit', priceCents: 33000, currency: 'USD', payment: 'one_time' },
  available: true,
  mode: 'live',
  message: null,
};

async function mount(fetchImpl: (path: string) => Promise<unknown>) {
  const elements = new Map<string, StubElement>();
  for (const id of ['audit-intake-form', 'audit-checkout-button', 'audit-availability', 'audit-test-notice', 'audit-form-status', 'audit-receipt'])
    elements.set(id, new StubElement());
  const checkout = elements.get('audit-checkout-button')!;
  checkout.textContent = 'Checking checkout…';
  const availability = elements.get('audit-availability')!;
  availability.textContent = 'Checking checkout availability…';
  vi.stubGlobal('document', {
    getElementById: (id: string) => elements.get(id) ?? null,
    createElement: () => new StubElement(),
  });
  vi.stubGlobal('window', {
    location: { href: 'https://mayor.mehyar.us/business-audit', pathname: '/business-audit' },
    history: { replaceState: () => {} },
  });
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {} });
  vi.stubGlobal('fetch', vi.fn(fetchImpl));
  vi.resetModules();
  await import('../web/audit-main');
  return { checkout, availability };
}

const flush = async () => {
  for (let i = 0; i < 25; i++) await Promise.resolve();
};

it('a failed availability check resolves the button with explicit copy and a WORKING retry', async () => {
  let behavior: (path: string) => Promise<unknown> = async () => {
    throw new Error('network down');
  };
  const { checkout, availability } = await mount((path) => behavior(path));
  await flush();
  expect(checkout.textContent).toBe('Checkout unavailable');
  expect(checkout.disabled).toBe(true);
  expect(checkout.classList.contains('is-checking')).toBe(false);
  expect(availability.textContent).toContain('Checkout availability could not be verified.');
  const retry = availability.children.find((child) => child.textContent === 'Try again');
  expect(retry).toBeDefined();
  // The retry actually re-runs the check — and the success state is
  // byte-identical to the direct success path.
  behavior = async () => ({ ok: true, json: async () => OFFER_OK });
  retry!.click();
  await flush();
  expect(checkout.textContent).toBe('Continue to checkout · $330');
  expect(checkout.disabled).toBe(false);
  expect(availability.textContent).toBe('Secure checkout is available. Review the scope and price before paying.');
});

it('the checking state carries a visible progress treatment while the check is in flight', async () => {
  let release: (value: unknown) => void = () => {};
  const { checkout } = await mount(() => new Promise((resolve) => { release = resolve; }));
  // In flight (mount starts the check synchronously): spinner class on,
  // button disabled, label unchanged.
  expect(checkout.classList.contains('is-checking')).toBe(true);
  expect(checkout.disabled).toBe(true);
  expect(checkout.textContent).toBe('Checking checkout…');
  release({ ok: true, json: async () => OFFER_OK });
  await flush();
  expect(checkout.classList.contains('is-checking')).toBe(false);
  expect(checkout.textContent).toBe('Continue to checkout · $330');
  expect(checkout.disabled).toBe(false);
});

it('a wedged fetch (never settles) still resolves the button on the UI deadline', async () => {
  vi.useFakeTimers();
  try {
    const { checkout, availability } = await mount(() => new Promise(() => {}));
    expect(checkout.textContent).toBe('Checking checkout…');
    await vi.advanceTimersByTimeAsync(16000);
    expect(checkout.textContent).toBe('Checkout unavailable');
    expect(checkout.disabled).toBe(true);
    expect(availability.textContent).toContain('Checkout availability could not be verified.');
    expect(availability.children.some((child) => child.textContent === 'Try again')).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
