/**
 * Workstream 7c — Post composer UI.
 *
 * DRAFTS ONLY. This composer generates editable drafts and hands them to the
 * calendar layer for scheduling — it never publishes anything. The "draft"
 * framing is explicit in the UI: every generated post is labeled a draft and
 * nothing posts itself.
 *
 * mountPostComposer(hooks) returns the composer root element. The host page
 * mounts it wherever the composer tab lives (it does NOT touch web/main.ts).
 */
export type PostType = 'offer' | 'event' | 'seasonal' | 'review_response' | 'hiring' | 'educational';
export type PostgenLanguage = 'en' | 'es';
export type ComplianceFlag = 'guarantee_claim' | 'scarcity_claim' | 'unverified_price' | 'unverified_testimonial';

export interface PostDraftLike {
  id: string; type: PostType; topic: string; language: PostgenLanguage;
  bodyText: string; reviewText: string | null; status: 'draft';
  complianceFlags: ComplianceFlag[]; createdAt: string; updatedAt: string;
}

export interface PostComposerHooks {
  /** Tenant-scoped API: api('/postgen/generate', body) → POST, api('/postgen/drafts') → GET, etc. */
  api: (path: string, body?: unknown, method?: string) => Promise<any>;
  onNotice: (message: string) => void;
  /** Hands the finished draft to the calendar layer. If absent, scheduling
   * shows an honest "not connected" note instead of failing silently. */
  onSchedule?: (draft: PostDraftLike) => void;
}

const TYPE_LABELS: Record<PostType, string> = {
  offer: 'Offer / promo', event: 'Event announcement', seasonal: 'Seasonal post',
  review_response: 'Review response', hiring: 'Hiring post', educational: 'Tips / educational',
};
const TYPE_ORDER: PostType[] = ['offer', 'event', 'seasonal', 'review_response', 'hiring', 'educational'];
const FLAG_LABELS: Record<ComplianceFlag, string> = {
  guarantee_claim: 'Check for a guarantee claim — the draft uses "guaranteed". Only keep it if you can truly back it.',
  scarcity_claim: 'Check scarcity — the draft says "only N left". Only keep it if it is real.',
  unverified_price: 'Check the price — the draft shows a price you did not supply. Confirm it is real.',
  unverified_testimonial: 'Check the quote — the draft looks like it quotes someone. Only keep real, attributable quotes.',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}
function field(label: string, control: HTMLElement): HTMLElement {
  const wrap = el('div', '', 'pg-field');
  const lab = el('label', label); wrap.append(lab, control); return wrap;
}
function textarea(rows: number, placeholder = ''): HTMLTextAreaElement {
  const node = el('textarea', '', 'pg-input'); node.rows = rows; node.placeholder = placeholder; return node;
}
function textInput(placeholder = ''): HTMLInputElement {
  const node = el('input', '', 'pg-input'); node.type = 'text'; node.placeholder = placeholder; return node;
}
function button(label: string, action: () => void, className = 'pg-btn'): HTMLButtonElement {
  const node = el('button', label, className); node.type = 'button'; node.onclick = action; return node;
}

export function mountPostComposer(hooks: PostComposerHooks): HTMLElement {
  const root = el('div', '', 'pg-composer');
  root.append(el('div', 'Drafts only — nothing posts automatically.', 'pg-draft-banner'));

  // ---- state -----------------------------------------------------------
  let selectedType: PostType = 'offer';
  let currentDraft: PostDraftLike | null = null;
  let busy = false;

  // ---- type picker -----------------------------------------------------
  const typeBar = el('div', '', 'pg-typebar');
  const typeButtons = new Map<PostType, HTMLButtonElement>();
  for (const type of TYPE_ORDER) {
    const btn = button(TYPE_LABELS[type], () => selectType(type), 'pg-type' + (type === selectedType ? ' pg-active' : ''));
    typeButtons.set(type, btn); typeBar.append(btn);
  }
  function selectType(type: PostType) {
    selectedType = type;
    for (const [t, btn] of typeButtons) btn.classList.toggle('pg-active', t === type);
    reviewWrap.style.display = type === 'review_response' ? '' : 'none';
    hint.textContent = type === 'review_response'
      ? 'Paste the real review below — the reply is drafted to that review only. The review is never invented.'
      : 'Describe the subject. Prices, dates, and offers come only from the fields you fill in — the draft never invents them.';
  }

  // ---- inputs ----------------------------------------------------------
  const topicInput = textarea(3, 'e.g. 20% off balayage this week, our new Saturday hours, the Halloween party…');
  const languageSelect = el('select', '', 'pg-input') as HTMLSelectElement;
  for (const [value, label] of [['en', 'English'], ['es', 'Español']] as [PostgenLanguage, string][]) {
    const opt = document.createElement('option'); opt.value = value; opt.textContent = label; languageSelect.append(opt);
  }
  const offerInput = textInput('Real offer facts — e.g. 20% off color, ends Sunday (optional)');
  const scarcityInput = textInput('Real scarcity only — e.g. 3 chairs left Saturday (optional)');
  const ctaInput = textInput('Call to action — e.g. Book online (optional)');
  const reviewInput = textarea(4, 'Paste the exact review text here…');
  const reviewerInput = textInput('Reviewer name (optional — never invented by the draft)');
  const reviewWrap = el('div', '', 'pg-review-wrap');
  reviewWrap.append(field('Review text (required for a review response)', reviewInput), field('Reviewer name', reviewerInput));
  reviewWrap.style.display = 'none';
  const hint = el('p', '', 'pg-hint');

  const generateBtn = button('Generate draft', generate, 'pg-btn pg-primary');

  // ---- draft editor ----------------------------------------------------
  const draftSection = el('div', '', 'pg-draft');
  draftSection.style.display = 'none';
  const flagsList = el('ul', '', 'pg-flags');
  const bodyEdit = textarea(6, '');
  const saveBtn = button('Save edits', saveEdits);
  const scheduleBtn = button('Schedule…', schedule, 'pg-btn pg-primary');
  const discardBtn = button('Discard', () => { currentDraft = null; renderDraft(); });
  const actionsRow = el('div', '', 'pg-actions');
  actionsRow.append(saveBtn, scheduleBtn, discardBtn);
  draftSection.append(
    el('h3', 'Your draft'), flagsList,
    field('Edit before anything goes anywhere', bodyEdit),
    actionsRow,
  );

  function renderFlags(flags: ComplianceFlag[]) {
    flagsList.replaceChildren();
    if (!flags.length) { flagsList.append(el('li', 'No compliance flags — still give it a read before it goes anywhere.', 'pg-flag-ok')); return; }
    for (const flag of flags) flagsList.append(el('li', FLAG_LABELS[flag] ?? flag, 'pg-flag'));
  }
  function renderDraft() {
    const show = currentDraft !== null;
    draftSection.style.display = show ? '' : 'none';
    if (currentDraft) { bodyEdit.value = currentDraft.bodyText; renderFlags(currentDraft.complianceFlags); }
  }

  async function generate() {
    if (busy) return;
    const topic = topicInput.value.trim();
    if (!topic) { hooks.onNotice('Give the post a subject first.'); return; }
    if (selectedType === 'review_response' && !reviewInput.value.trim()) {
      hooks.onNotice('Paste the real review — a review response is never written to an invented review.'); return;
    }
    busy = true; generateBtn.disabled = true; generateBtn.textContent = 'Writing…';
    try {
      const res = await hooks.api('/postgen/generate', {
        type: selectedType, topic, language: languageSelect.value as PostgenLanguage,
        offerDetails: offerInput.value.trim() || undefined,
        scarcity: scarcityInput.value.trim() || undefined,
        cta: ctaInput.value.trim() || undefined,
        reviewText: selectedType === 'review_response' ? reviewInput.value.trim() : undefined,
        reviewerName: selectedType === 'review_response' ? reviewerInput.value.trim() || undefined : undefined,
      }, 'POST');
      currentDraft = res.draft as PostDraftLike;
      renderDraft();
      hooks.onNotice(currentDraft.complianceFlags.length
        ? 'Draft ready — it has compliance flags. Review them before it goes anywhere.'
        : 'Draft ready. Edit it, then save or schedule.');
    } catch (error) {
      hooks.onNotice(error instanceof Error ? error.message : 'Could not generate the draft. Try again.');
    } finally {
      busy = false; generateBtn.disabled = false; generateBtn.textContent = 'Generate draft';
    }
  }

  async function saveEdits() {
    if (!currentDraft || busy) return;
    const bodyText = bodyEdit.value.trim();
    if (!bodyText) { hooks.onNotice('The draft is empty — write something first.'); return; }
    busy = true; saveBtn.disabled = true;
    try {
      const res = await hooks.api(`/postgen/drafts/${currentDraft.id}/edit`, { bodyText }, 'POST');
      currentDraft = res.draft as PostDraftLike;
      renderDraft();
      hooks.onNotice(currentDraft.complianceFlags.length
        ? 'Saved — compliance flags updated. Review them.'
        : 'Saved.');
    } catch (error) {
      hooks.onNotice(error instanceof Error ? error.message : 'Could not save. Try again.');
    } finally { busy = false; saveBtn.disabled = false; }
  }

  function schedule() {
    if (!currentDraft) return;
    currentDraft = { ...currentDraft, bodyText: bodyEdit.value.trim() };
    if (hooks.onSchedule) { hooks.onSchedule(currentDraft); return; }
    hooks.onNotice('Calendar scheduling is not connected yet — the draft is saved and waiting.');
  }

  // ---- drafts list -----------------------------------------------------
  const draftsList = el('div', '', 'pg-drafts');
  const refreshBtn = button('Refresh drafts', loadDrafts);
  async function loadDrafts() {
    draftsList.replaceChildren(el('p', 'Loading…', 'pg-hint'));
    try {
      const res = await hooks.api('/postgen/drafts');
      const drafts = (res.drafts ?? []) as PostDraftLike[];
      draftsList.replaceChildren();
      if (!drafts.length) { draftsList.append(el('p', 'No drafts yet. Generate one above.', 'pg-hint')); return; }
      for (const draft of drafts) {
        const card = el('div', '', 'pg-draft-card');
        const head = el('div', '', 'pg-card-head');
        head.append(el('strong', TYPE_LABELS[draft.type] ?? draft.type), el('span', ` · ${new Date(draft.updatedAt).toLocaleDateString()}`, 'pg-hint'));
        card.append(head, el('p', draft.bodyText.length > 140 ? draft.bodyText.slice(0, 140) + '…' : draft.bodyText, 'pg-card-body'));
        if (draft.complianceFlags.length) card.append(el('p', `${draft.complianceFlags.length} compliance flag${draft.complianceFlags.length === 1 ? '' : 's'} — review before use.`, 'pg-flag'));
        const actions = el('div', '', 'pg-actions');
        actions.append(
          button('Edit', () => { currentDraft = draft; renderDraft(); bodyEdit.focus(); }),
          button('Delete', async () => {
            if (!window.confirm('Delete this draft?')) return;
            try {
              await hooks.api(`/postgen/drafts/${draft.id}`, undefined, 'DELETE');
              if (currentDraft?.id === draft.id) { currentDraft = null; renderDraft(); }
              await loadDrafts();
            } catch (error) { hooks.onNotice(error instanceof Error ? error.message : 'Could not delete. Try again.'); }
          }),
        );
        card.append(actions);
        draftsList.append(card);
      }
    } catch (error) {
      draftsList.replaceChildren(el('p', error instanceof Error ? error.message : 'Could not load drafts.', 'pg-flag'));
    }
  }

  root.append(
    el('h2', 'Post composer'),
    typeBar, hint,
    field('Subject', topicInput),
    field('Language', languageSelect),
    field('Offer details (only real ones — the draft never invents prices or dates)', offerInput),
    field('Scarcity (only if real)', scarcityInput),
    field('Call to action', ctaInput),
    reviewWrap,
    generateBtn,
    draftSection,
    el('h3', 'Saved drafts'), refreshBtn, draftsList,
  );
  selectType('offer');
  void loadDrafts();
  return root;
}
