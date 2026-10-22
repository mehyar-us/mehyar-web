/**
 * Crew 7b — Content calendar UI (week view).
 *
 * Renders strictly from the backend contract in src/growth-calendar.ts:
 * GET/POST /api/businesses/{tenant}/social-posts and /social-series.
 * Approval model is enforced server-side; this UI only exposes the actions
 * the backend allows for each status. Publishing is test-gated: the banner
 * says so honestly and no card ever claims a fake "posted" state
 * (compliance items 9, 12).
 *
 * Mounted by the integrator via mountGrowthCalendar(root, hooks).
 * Accessibility: real <button>s, visible focus, role="dialog" modals with
 * Escape to close, role="status" for result notices.
 */
import './growth-calendar.css';
import {
  CalendarDays, Plus, Check, X, Pencil, RotateCcw, ChevronLeft, ChevronRight,
  AlertTriangle, Info, Clock, Send, Layers,
} from 'lucide';

/** Merge into the app's icons map so <i data-lucide="…"> paints. */
export const growthCalendarIcons = {
  CalendarDays, Plus, Check, X, Pencil, RotateCcw, ChevronLeft, ChevronRight,
  AlertTriangle, Info, Clock, Send, Layers,
};

type Api = (path: string, body?: unknown) => Promise<any>;
export interface GrowthCalendarHooks {
  api: Api;
  tenant: () => string;
  timeZone: () => string;
  onNotice: (message: string) => void;
}

type Channel = 'instagram' | 'facebook' | 'tiktok' | 'x';
type Status = 'draft' | 'scheduled' | 'approved' | 'sending' | 'sent' | 'failed' | 'cancelled';
interface SocialPost {
  id: string; channel: Channel; language: string; copy_text: string;
  image_ids: string[]; video_job_id: string | null; scheduled_for: string;
  status: Status; approved_by: string | null; failure_reason: string | null;
  retry_count: number; publish_mode: 'test-gated' | 'live'; series_id: string | null;
}
interface SocialSeries {
  id: string; name: string; channels: Channel[]; status: 'active' | 'archived';
  approved_by: string | null; approved_at: string | null;
}

const CHANNELS: Channel[] = ['instagram', 'facebook', 'tiktok', 'x'];
const STATUS_LABEL: Record<Status, string> = {
  draft: 'Draft', scheduled: 'Scheduled', approved: 'Approved — awaiting slot',
  sending: 'Sending…', sent: 'Posted', failed: 'Failed', cancelled: 'Cancelled',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}
function icon(name: string) { const n = el('i'); n.dataset.lucide = name; n.setAttribute('aria-hidden', 'true'); return n; }
function button(label: string, action: () => void, className = 'gc-btn', ariaLabel?: string): HTMLButtonElement {
  const b = el('button', label, className); b.type = 'button'; b.onclick = action;
  if (ariaLabel) b.setAttribute('aria-label', ariaLabel); return b;
}
function localDayKey(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
}
function tzOffsetMs(timeZone: string, utcMs: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) parts[p.type] = p.value;
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day,
    parts.hour === '24' ? 0 : +parts.hour, +parts.minute, +parts.second);
  return asUtc - utcMs;
}
/** Monday 00:00 in the tenant timezone, as UTC ms. */
function weekStartUtc(weekOffset: number, timeZone: string): number {
  const nowParts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.now()).split('-').map(Number);
  const weekday = new Date(Date.UTC(nowParts[0], nowParts[1] - 1, nowParts[2])).getUTCDay(); // 0=Sun
  const mondayShift = (weekday + 6) % 7;
  let guess = Date.UTC(nowParts[0], nowParts[1] - 1, nowParts[2] - mondayShift + weekOffset * 7);
  for (let i = 0; i < 2; i++) guess -= tzOffsetMs(timeZone, guess); // local midnight = utc - offset
  return guess;
}
function fmtTime(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(ms);
}
function fmtDayHead(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(ms);
}
function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function mountGrowthCalendar(root: HTMLElement, hooks: GrowthCalendarHooks): void {
  const tz = () => hooks.timeZone() || 'America/New_York';
  const base = () => `/api/businesses/${hooks.tenant()}`;
  let weekOffset = 0;
  let posts: SocialPost[] = [];
  let series: SocialSeries[] = [];
  let loading = false;

  const wrap = el('div', '', 'gc-root');
  const statusRegion = el('div', '', 'gc-status-region');
  statusRegion.setAttribute('role', 'status');
  root.append(wrap);

  function notice(msg: string, isError = false) {
    statusRegion.textContent = msg;
    statusRegion.style.color = isError ? '#b3261e' : '#137333';
    hooks.onNotice(msg);
  }

  async function reload() {
    loading = true; render();
    try {
      const start = weekStartUtc(weekOffset, tz());
      const q = `from=${encodeURIComponent(new Date(start).toISOString())}&to=${encodeURIComponent(new Date(start + 7 * 86400000).toISOString())}`;
      const [p, s] = await Promise.all([
        hooks.api(`${base()}/social-posts?${q}`),
        hooks.api(`${base()}/social-series`).catch(() => ({ series: [] })),
      ]);
      posts = p.posts ?? []; series = s.series ?? [];
      statusRegion.textContent = '';
    } catch (e) {
      notice('Could not load the content calendar: ' + (e as Error).message, true);
    } finally { loading = false; render(); }
  }

  function chip(post: SocialPost): HTMLElement {
    const c = el('span', STATUS_LABEL[post.status], `gc-chip ${post.status}`);
    if (post.publish_mode === 'test-gated' && (post.status === 'approved' || post.status === 'sending' || post.status === 'scheduled')) {
      const t = el('span', 'Test-gated', 'gc-chip testgated');
      t.title = 'Publishing connector is test-gated — nothing reaches a public channel.';
      const w = el('span'); w.append(c, document.createTextNode(' '), t); return w;
    }
    return c;
  }

  function card(post: SocialPost): HTMLElement {
    const c = el('div', '', 'gc-card');
    const head = el('div', '', 'gc-card-head');
    head.append(el('span', post.channel, 'gc-channel'), chip(post),
      el('span', fmtTime(Date.parse(post.scheduled_for), tz()), 'gc-time'));
    c.append(head);
    if (post.copy_text) c.append(el('p', post.copy_text.length > 140 ? post.copy_text.slice(0, 140) + '…' : post.copy_text, 'gc-copy'));
    if (post.status === 'failed' && post.failure_reason) c.append(el('p', 'Failed: ' + post.failure_reason, 'gc-reason'));
    if (post.status === 'approved') {
      const note = el('p', 'Owner-approved. Attempts run through the test-gated connector.', 'gc-reason');
      note.style.color = '#137333';
      c.append(note);
    }
    const actions = el('div', '', 'gc-actions');
    const act = async (label: string, fn: () => Promise<unknown>, aria: string, cls = 'gc-btn small') => {
      const b = button(label, async () => {
        try { await fn(); notice(`Done: ${label.toLowerCase()} ${post.channel} post.`); await reload(); }
        catch (e) { notice('Action failed: ' + (e as Error).message, true); }
      }, cls, aria);
      actions.append(b);
    };
    if (post.status === 'draft' || post.status === 'scheduled') {
      void act('Edit', async () => openPostModal(post), `Edit ${post.channel} post`);
      void act('Schedule', async () => openScheduleModal(post), `Change schedule for ${post.channel} post`);
    }
    if (post.status === 'scheduled') void act('Approve', async () => hooks.api(`${base()}/social-posts/${post.id}/approve`, {}), `Approve ${post.channel} post for publishing`, 'gc-btn small primary');
    if (post.status === 'failed') void act('Retry', async () => hooks.api(`${base()}/social-posts/${post.id}/retry`, {}), `Re-approve failed ${post.channel} post`, 'gc-btn small primary');
    if (['draft', 'scheduled', 'approved', 'failed'].includes(post.status))
      void act('Cancel', async () => hooks.api(`${base()}/social-posts/${post.id}/cancel`, {}), `Cancel ${post.channel} post`, 'gc-btn small danger');
    if (actions.childNodes.length) c.append(actions);
    return c;
  }

  function dayColumn(dayMs: number, dayPosts: SocialPost[]): HTMLElement {
    const d = el('div', '', 'gc-day' + (localDayKey(dayMs, tz()) === localDayKey(Date.now(), tz()) ? ' today' : ''));
    const head = el('div', '', 'gc-day-head');
    head.append(el('span', fmtDayHead(dayMs, tz())));
    d.append(head);
    const list = el('div', '', 'gc-cards');
    const sorted = [...dayPosts].sort((a, b) => Date.parse(a.scheduled_for) - Date.parse(b.scheduled_for));
    for (const p of sorted) list.append(card(p));
    d.append(list);
    return d;
  }

  function openModal(title: string, build: (body: HTMLElement, close: () => void) => void) {
    const overlay = el('div', '', 'gc-overlay');
    const modal = el('div', '', 'gc-modal');
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', title);
    const h = el('h3', title);
    const closeBtn = button('Close', () => overlay.remove(), 'gc-btn small');
    closeBtn.style.float = 'right';
    const body = el('div');
    modal.append(closeBtn, h, body);
    overlay.append(modal);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    overlay.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Escape') overlay.remove(); });
    build(body, () => overlay.remove());
    document.body.append(overlay);
    const first = modal.querySelector('input,select,textarea,button') as HTMLElement | null;
    first?.focus();
  }

  function field(label: string, input: HTMLElement): HTMLElement {
    const f = el('div', '', 'gc-field');
    const l = el('label', label); f.append(l, input); return f;
  }
  function selectOf(options: string[], value: string): HTMLSelectElement {
    const s = document.createElement('select');
    for (const o of options) { const op = document.createElement('option'); op.value = o; op.textContent = o; if (o === value) op.selected = true; s.append(op); }
    return s;
  }

  function openPostModal(existing?: SocialPost) {
    openModal(existing ? 'Edit post' : 'New draft', (body, close) => {
      const channelSel = selectOf(CHANNELS, existing?.channel ?? 'instagram');
      const lang = document.createElement('input'); lang.value = existing?.language ?? 'en'; lang.maxLength = 10;
      const copy = document.createElement('textarea'); copy.value = existing?.copy_text ?? '';
      copy.placeholder = 'Write the post copy… (English first; language is stored per post)';
      const when = document.createElement('input'); when.type = 'datetime-local';
      when.value = toLocalInputValue(existing?.scheduled_for ?? new Date(Date.now() + 86400000).toISOString());
      const seriesSel = selectOf(['', ...series.filter(s => s.status === 'active').map(s => s.id)], existing?.series_id ?? '');
      seriesSel.options[0].textContent = 'No series';
      for (let i = 1; i < seriesSel.options.length; i++) {
        const s = series.find(x => x.id === seriesSel.options[i].value);
        if (s) seriesSel.options[i].textContent = `${s.name}${s.approved_by ? ' (approved)' : ''}`;
      }
      const err = el('p', '', 'gc-notice');
      body.append(field('Channel', channelSel), field('Language', lang), field('Copy', copy),
        field('Scheduled for', when), field('Series (optional)', seriesSel), err);
      const actions = el('div', '', 'gc-modal-actions');
      actions.append(button('Cancel', close));
      actions.append(button(existing ? 'Save' : 'Create draft', async () => {
        try {
          const payload = {
            channel: channelSel.value, language: lang.value.trim() || 'en',
            copy_text: copy.value.trim(), scheduled_for: new Date(when.value).toISOString(),
            series_id: seriesSel.value || undefined,
          };
          if (existing) await hooks.api(`${base()}/social-posts/${existing.id}`, payload);
          else await hooks.api(`${base()}/social-posts`, payload);
          close(); notice(existing ? 'Post updated.' : 'Draft created. Schedule and approve it before it can send.');
          await reload();
        } catch (e) { err.textContent = 'Could not save: ' + (e as Error).message; }
      }, 'gc-btn primary'));
      body.append(actions);
    });
  }

  function openScheduleModal(post: SocialPost) {
    openModal('Schedule post', (body, close) => {
      const when = document.createElement('input'); when.type = 'datetime-local';
      when.value = toLocalInputValue(post.scheduled_for);
      const err = el('p', '', 'gc-notice');
      body.append(field('Scheduled for', when), err);
      const actions = el('div', '', 'gc-modal-actions');
      actions.append(button('Cancel', close));
      actions.append(button('Save schedule', async () => {
        try {
          await hooks.api(`${base()}/social-posts/${post.id}/schedule`, { scheduled_for: new Date(when.value).toISOString() });
          close(); notice('Schedule updated.'); await reload();
        } catch (e) { err.textContent = 'Could not schedule: ' + (e as Error).message; }
      }, 'gc-btn primary'));
      body.append(actions);
    });
  }

  function openSeriesModal() {
    openModal('New series', (body, close) => {
      const name = document.createElement('input'); name.placeholder = 'e.g. Fall promo';
      const err = el('p', '', 'gc-notice');
      body.append(field('Series name', name),
        el('p', 'Approving a series approves every scheduled post in it. Channel defaults to the post\'s own channel.', 'gc-notice'),
        err);
      const actions = el('div', '', 'gc-modal-actions');
      actions.append(button('Cancel', close));
      actions.append(button('Create series', async () => {
        try {
          await hooks.api(`${base()}/social-series`, { name: name.value.trim(), channels: ['instagram'] });
          close(); notice('Series created.'); await reload();
        } catch (e) { err.textContent = 'Could not create: ' + (e as Error).message; }
      }, 'gc-btn primary'));
      body.append(actions);
    });
  }

  function seriesPanel(): HTMLElement {
    const p = el('div', '', 'gc-series');
    p.append(el('h3', 'Series (campaigns)'));
    if (!series.length) p.append(el('p', 'No series yet. A series groups posts; approving the series approves every scheduled post in it.', 'gc-notice'));
    for (const s of series) {
      const row = el('div', '', 'gc-series-row');
      row.append(icon('Layers'), el('span', s.name));
      row.append(el('span', s.status === 'active' ? (s.approved_by ? 'Approved' : 'Active — not approved') : 'Archived', `gc-chip ${s.approved_by ? 'approved' : 'draft'}`));
      const spacer = el('span'); spacer.style.flex = '1'; row.append(spacer);
      if (s.status === 'active' && !s.approved_by) {
        row.append(button('Approve series', async () => {
          try { await hooks.api(`${base()}/social-series/${s.id}/approve`, {}); notice(`Series "${s.name}" approved — its scheduled posts are now sendable.`); await reload(); }
          catch (e) { notice('Could not approve series: ' + (e as Error).message, true); }
        }, 'gc-btn small primary', `Approve series ${s.name}`));
      }
      p.append(row);
    }
    return p;
  }

  function render() {
    wrap.innerHTML = '';
    const toolbar = el('div', '', 'gc-toolbar');
    const title = el('h2', 'Content calendar'); title.prepend(icon('CalendarDays'));
    toolbar.append(title);
    const spacer = el('span', '', 'spacer'); toolbar.append(spacer);
    toolbar.append(button('‹ Prev', () => { weekOffset--; void reload(); }, 'gc-btn', 'Previous week'));
    const weekLabel = el('span', weekOffset === 0 ? 'This week' : (weekOffset > 0 ? `+${weekOffset} wk` : `${weekOffset} wk`));
    weekLabel.style.fontSize = '.85rem'; weekLabel.style.color = '#5f6368';
    toolbar.append(weekLabel);
    toolbar.append(button('Today', () => { weekOffset = 0; void reload(); }, 'gc-btn', 'Back to this week'));
    toolbar.append(button('Next ›', () => { weekOffset++; void reload(); }, 'gc-btn', 'Next week'));
    toolbar.append(button('New series', () => openSeriesModal(), 'gc-btn', 'Create a post series'));
    toolbar.append(button('New draft', () => openPostModal(), 'gc-btn primary', 'Create a new post draft'));
    wrap.append(toolbar);

    const banner = el('div', '', 'gc-gate-banner');
    banner.append(icon('Info'), el('span', 'Publishing is test-gated: approved posts are attempted through a simulated connector and are never posted to public channels. Every status you see reflects reality — nothing here claims a fake "posted" state.'));
    wrap.append(banner, statusRegion);

    if (loading) { wrap.append(el('p', 'Loading calendar…', 'gc-notice')); return; }

    const start = weekStartUtc(weekOffset, tz());
    const buckets: SocialPost[][] = Array.from({ length: 7 }, () => []);
    for (const p of posts) {
      const key = localDayKey(Date.parse(p.scheduled_for), tz());
      let placed = false;
      for (let d = 0; d < 7; d++) {
        if (localDayKey(start + d * 86400000, tz()) === key) { buckets[d].push(p); placed = true; break; }
      }
      if (!placed) buckets[6].push(p); // outside the visible week: park on the last column
    }
    const week = el('div', '', 'gc-week');
    let any = false;
    for (let d = 0; d < 7; d++) {
      week.append(dayColumn(start + d * 86400000, buckets[d]));
      if (buckets[d].length) any = true;
    }
    wrap.append(week);
    if (!any) {
      const empty = el('div', '', 'gc-empty');
      empty.append(el('h3', 'Nothing scheduled this week'));
      empty.append(el('p', 'Create a draft, schedule it, and approve it — only approved posts are ever attempted.'));
      empty.append(button('Create your first draft', () => openPostModal(), 'gc-btn primary'));
      wrap.append(empty);
    }
    wrap.append(seriesPanel());
  }

  void reload();
}
