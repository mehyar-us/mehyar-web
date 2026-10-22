/**
 * Workstream 7f — Ad Studio frontend for The Mayor.
 *
 * Exposes mountAdStudio(root, api). Offer input -> generated package
 * (hooks/headlines/primary text/CTA) -> editable -> validation flags shown
 * inline -> save draft -> export (copy-paste-ready for Ads Manager).
 *
 * Drafts only, always: the notice banner says nothing here spends money.
 * The integrator mounts this from web/main.ts (mountAdStudio is exported;
 * main.ts wiring is not touched by this workstream).
 */

export interface AdStudioFlag {
 rule: string;
 severity: 'error' | 'warn';
 field: 'hooks' | 'primaryTexts' | 'headlines' | 'description';
 index: number;
 match: string;
 message: string;
 fix: string;
}
export interface AdStudioPackage {
 hooks: string[];
 primaryTexts: string[];
 headlines: string[];
 description: string;
 cta: string;
}
export interface AdStudioCreativeRef { kind: 'image' | 'video'; id: string; label?: string; url?: string }
export interface AdStudioDraftSummary {
 id: string; offer: string; goal: string; language: string; status: 'draft' | 'approved';
 createdAt: string; updatedAt: string;
 flagCounts: { error: number; warn: number };
 blocked: boolean;
}
export interface AdStudioDraft extends AdStudioDraftSummary {
 pkg: AdStudioPackage;
 creativeRefs: AdStudioCreativeRef[];
 flags: AdStudioFlag[];
}
export interface AdStudioApi {
 generate(body: {
  businessName: string; vertical?: string | null; offer: string; goal: string;
  language?: string; services?: string[]; location?: string;
  verifiedUrgency?: boolean; verifiedTestimonials?: boolean;
  creativeRefs?: AdStudioCreativeRef[]; cta?: string;
 }): Promise<{ package: AdStudioPackage; flags: AdStudioFlag[]; blocked: boolean; notice: string; exportText: string }>;
 listDrafts(): Promise<{ drafts: AdStudioDraftSummary[]; notice: string }>;
 getDraft(id: string): Promise<{ draft: AdStudioDraft; notice: string }>;
 saveDraft(body: { offer: string; goal: string; language?: string; package: AdStudioPackage; creativeRefs?: AdStudioCreativeRef[] }): Promise<{ draft: AdStudioDraft }>;
 updateDraft(id: string, body: { offer?: string; package?: AdStudioPackage; creativeRefs?: AdStudioCreativeRef[] }): Promise<{ draft: AdStudioDraft }>;
 deleteDraft(id: string): Promise<{ deleted: boolean }>;
 approveDraft(id: string): Promise<{ draft: AdStudioDraft }>;
 validate(pkg: AdStudioPackage): Promise<{ flags: AdStudioFlag[]; blocked: boolean }>;
}

export const META_CTA_LABELS = [
 'Shop Now','Book Now','Learn More','Sign Up','Call Now','Get Offer','Get Quote',
 'Send Message','Contact Us','Apply Now','Subscribe','Watch More','Order Now',
 'See Menu','Request Time','Download','Get Directions',
];
export const AD_GOALS = ['bookings','sales','leads','awareness'] as const;
export const AD_LANGUAGES = [['en','English'],['es','Español'],['ar','العربية']] as const;
export const SPEND_NOTICE = 'Drafts only — nothing here spends money. You\u2019ll launch this yourself in Meta Ads Manager; nothing is published, budgeted, or created on Meta from this page.';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
 const node = document.createElement(tag);
 if (className) node.className = className;
 if (text) node.textContent = text;
 return node;
}

function parseCreativeRefs(raw: string): AdStudioCreativeRef[] {
 return raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 8).map(entry => {
  const m = entry.match(/^(image|video)\s*:\s*(.+)$/i);
  return m ? { kind: m[1].toLowerCase() as 'image' | 'video', id: m[2].trim() } : { kind: 'image' as const, id: entry };
 });
}

export function mountAdStudio(root: HTMLElement, api: AdStudioApi, opts: { businessName?: string; vertical?: string } = {}): void {
 root.innerHTML = '';
 const wrap = el('section', 'adstudio');
 wrap.setAttribute('aria-label', 'Ad studio');

 const title = el('h2', 'adstudio-title', 'Ad Studio');
 wrap.appendChild(title);
 const notice = el('p', 'adstudio-notice', SPEND_NOTICE);
 notice.setAttribute('role', 'note');
 wrap.appendChild(notice);

 /* ---------- offer form ---------- */
 const form = el('form', 'adstudio-form');
 form.noValidate = true;

 const offerLabel = el('label', 'adstudio-label', 'What are you promoting?');
 const offer = el('textarea', 'adstudio-input') as HTMLTextAreaElement;
 offer.rows = 3; offer.required = true; offer.maxLength = 500;
 offer.placeholder = 'e.g. 20% off first balayage this month';
 offerLabel.appendChild(offer); form.appendChild(offerLabel);

 const row1 = el('div', 'adstudio-row');
 const goalLabel = el('label', 'adstudio-label', 'Goal');
 const goal = el('select', 'adstudio-input') as HTMLSelectElement;
 for (const g of AD_GOALS) goal.appendChild(new Option(g[0].toUpperCase() + g.slice(1), g));
 goalLabel.appendChild(goal); row1.appendChild(goalLabel);
 const langLabel = el('label', 'adstudio-label', 'Language');
 const lang = el('select', 'adstudio-input') as HTMLSelectElement;
 for (const [code, name] of AD_LANGUAGES) lang.appendChild(new Option(name, code));
 langLabel.appendChild(lang); row1.appendChild(langLabel);
 form.appendChild(row1);

 const row2 = el('div', 'adstudio-row');
 const servicesLabel = el('label', 'adstudio-label', 'Services (comma-separated, optional)');
 const services = el('input', 'adstudio-input') as HTMLInputElement;
 services.placeholder = 'balayage, cuts, color';
 servicesLabel.appendChild(services); row2.appendChild(servicesLabel);
 const locLabel = el('label', 'adstudio-label', 'Location (optional)');
 const location = el('input', 'adstudio-input') as HTMLInputElement;
 location.placeholder = 'Brooklyn, NY';
 locLabel.appendChild(location); row2.appendChild(locLabel);
 form.appendChild(row2);

 const creativeLabel = el('label', 'adstudio-label', 'Creative (optional — image:ID or video:ID, comma-separated)');
 const creative = el('input', 'adstudio-input') as HTMLInputElement;
 creative.placeholder = 'image:hero_123, video:cut_9';
 creativeLabel.appendChild(creative); form.appendChild(creativeLabel);

 const checks = el('div', 'adstudio-checks');
 const urgencyWrap = el('label', 'adstudio-check', 'The offer has real urgency/scarcity — I confirm it is true');
 const urgency = el('input') as HTMLInputElement; urgency.type = 'checkbox';
 urgencyWrap.prepend(urgency); checks.appendChild(urgencyWrap);
 const testiWrap = el('label', 'adstudio-check', 'Any testimonials/ratings used are real and attributable — I confirm');
 const testi = el('input') as HTMLInputElement; testi.type = 'checkbox';
 testiWrap.prepend(testi); checks.appendChild(testiWrap);
 form.appendChild(checks);

 const generateBtn = el('button', 'adstudio-btn adstudio-btn-primary', 'Generate ad package') as HTMLButtonElement;
 generateBtn.type = 'submit';
 form.appendChild(generateBtn);
 const formError = el('p', 'adstudio-error', '');
 formError.setAttribute('role', 'alert'); formError.hidden = true;
 form.appendChild(formError);
 wrap.appendChild(form);

 /* ---------- package editor ---------- */
 const result = el('div', 'adstudio-result'); result.hidden = true;
 wrap.appendChild(result);

 let currentPkg: AdStudioPackage | null = null;
 let currentFlags: AdStudioFlag[] = [];
 let editingDraftId: string | null = null;

 function flagBadge(flag: AdStudioFlag): HTMLElement {
  const badge = el('span', `adstudio-flag adstudio-flag-${flag.severity}`);
  badge.textContent = `${flag.severity === 'error' ? 'Blocked' : 'Review'}: ${flag.message} Fix: ${flag.fix}`;
  badge.title = `Matched: ${flag.match}`;
  return badge;
 }

 function renderPackage(pkg: AdStudioPackage, flags: AdStudioFlag[], blocked: boolean): void {
  result.innerHTML = ''; result.hidden = false;
  currentPkg = JSON.parse(JSON.stringify(pkg)) as AdStudioPackage;
  currentFlags = flags;

  const head = el('h3', 'adstudio-sub', editingDraftId ? 'Editing draft' : 'Generated package');
  result.appendChild(head);
  if (blocked) {
   const banner = el('p', 'adstudio-blocked', 'This copy has blocking issues. Fix them before approving — the draft stays a draft.');
   banner.setAttribute('role', 'alert');
   result.appendChild(banner);
  }

  const sections: Array<{ key: 'hooks' | 'primaryTexts' | 'headlines'; title: string; hint: string }> = [
   { key: 'hooks', title: 'Hooks', hint: 'Scroll-stopping first lines' },
   { key: 'primaryTexts', title: 'Primary text', hint: 'Pick one per ad' },
   { key: 'headlines', title: 'Headlines', hint: 'Short and punchy' },
  ];
  for (const section of sections) {
   result.appendChild(el('h4', 'adstudio-sec', `${section.title} — ${section.hint}`));
   pkg[section.key].forEach((text, i) => {
    const label = el('label', 'adstudio-label', `${section.title} ${i + 1}`);
    const area = el('textarea', 'adstudio-input') as HTMLTextAreaElement;
    area.rows = 2; area.value = text;
    area.dataset.field = section.key; area.dataset.index = String(i);
    label.appendChild(area); result.appendChild(label);
    flags.filter(f => f.field === section.key && f.index === i).forEach(f => result.appendChild(flagBadge(f)));
   });
  }

  result.appendChild(el('h4', 'adstudio-sec', 'Description'));
  const descLabel = el('label', 'adstudio-label', 'Supporting line');
  const desc = el('textarea', 'adstudio-input') as HTMLTextAreaElement;
  desc.rows = 2; desc.value = pkg.description;
  desc.dataset.field = 'description'; desc.dataset.index = '0';
  descLabel.appendChild(desc); result.appendChild(descLabel);
  flags.filter(f => f.field === 'description').forEach(f => result.appendChild(flagBadge(f)));

  const ctaLabel = el('label', 'adstudio-label', 'Call to action');
  const cta = el('select', 'adstudio-input') as HTMLSelectElement;
  for (const c of META_CTA_LABELS) cta.appendChild(new Option(c, c));
  cta.value = META_CTA_LABELS.includes(pkg.cta) ? pkg.cta : META_CTA_LABELS[0];
  ctaLabel.appendChild(cta); result.appendChild(ctaLabel);

  const actions = el('div', 'adstudio-actions');
  const revalidateBtn = el('button', 'adstudio-btn', 'Re-check copy') as HTMLButtonElement;
  revalidateBtn.type = 'button';
  const saveBtn = el('button', 'adstudio-btn adstudio-btn-primary', editingDraftId ? 'Save changes' : 'Save draft') as HTMLButtonElement;
  saveBtn.type = 'button';
  const exportBtn = el('button', 'adstudio-btn', 'Export for Ads Manager') as HTMLButtonElement;
  exportBtn.type = 'button';
  actions.append(revalidateBtn, saveBtn, exportBtn);
  result.appendChild(actions);

  const exportOut = el('pre', 'adstudio-export'); exportOut.hidden = true;
  result.appendChild(exportOut);

  const readEdits = (): AdStudioPackage => {
   const areas = Array.from(result.querySelectorAll<HTMLTextAreaElement>('textarea[data-field]'));
   const edited: AdStudioPackage = { hooks: [], primaryTexts: [], headlines: [], description: '', cta: '' };
   for (const area of areas) {
    const field = area.dataset.field as 'hooks' | 'primaryTexts' | 'headlines' | 'description';
    if (field === 'description') edited.description = area.value;
    else edited[field].push(area.value);
   }
   edited.cta = cta.value;
   return edited;
  };

  revalidateBtn.addEventListener('click', async () => {
   revalidateBtn.disabled = true;
   try {
    const { flags: fresh, blocked: isBlocked } = await api.validate(readEdits());
    renderPackage(readEdits(), fresh, isBlocked);
   } finally { revalidateBtn.disabled = false; }
  });

  saveBtn.addEventListener('click', async () => {
   saveBtn.disabled = true;
   try {
    const edited = readEdits();
    const refs = parseCreativeRefs(creative.value);
    const saved = editingDraftId
     ? await api.updateDraft(editingDraftId, { offer: offer.value.trim(), package: edited, creativeRefs: refs })
     : await api.saveDraft({ offer: offer.value.trim(), goal: goal.value, language: lang.value, package: edited, creativeRefs: refs });
    editingDraftId = saved.draft.id;
    renderPackage(saved.draft.pkg, saved.draft.flags, saved.draft.blocked);
    await refreshDrafts();
   } finally { saveBtn.disabled = false; }
  });

  exportBtn.addEventListener('click', () => {
   const edited = readEdits();
   const lines = [
    'AD COPY — paste into Meta Ads Manager', '',
    'HOOKS (use as first line or video text overlay)',
    ...edited.hooks.map((h, i) => `${i + 1}. ${h}`), '',
    'PRIMARY TEXT (pick one)',
    ...edited.primaryTexts.flatMap((p, i) => [`--- Option ${i + 1} ---`, p, '']), '',
    'HEADLINES',
    ...edited.headlines.map((h, i) => `${i + 1}. ${h}`), '',
    'DESCRIPTION', edited.description, '',
    'CALL TO ACTION', edited.cta, '',
    SPEND_NOTICE,
   ];
   exportOut.textContent = lines.join('\n');
   exportOut.hidden = false;
   try { void navigator.clipboard.writeText(exportOut.textContent ?? '').then(() => { exportBtn.textContent = 'Copied to clipboard'; }); }
   catch { exportBtn.textContent = 'Export ready (copy manually)'; }
   setTimeout(() => { exportBtn.textContent = 'Export for Ads Manager'; }, 2500);
  });
 }

 /* ---------- drafts list ---------- */
 const draftsSec = el('div', 'adstudio-drafts');
 draftsSec.appendChild(el('h3', 'adstudio-sub', 'Saved drafts'));
 const draftsList = el('ul', 'adstudio-draft-list');
 draftsSec.appendChild(draftsList);
 wrap.appendChild(draftsSec);

 async function refreshDrafts(): Promise<void> {
  draftsList.innerHTML = '';
  let summaries: AdStudioDraftSummary[] = [];
  try { summaries = (await api.listDrafts()).drafts; } catch { /* offline-safe */ }
  if (!summaries.length) {
   const empty = el('li', 'adstudio-empty', 'No drafts yet. Generate a package above to start.');
   draftsList.appendChild(empty);
   return;
  }
  for (const d of summaries) {
   const item = el('li', 'adstudio-draft');
   const meta = el('div', 'adstudio-draft-meta');
   meta.appendChild(el('strong', '', d.offer));
   const sub = el('span', 'adstudio-draft-sub', `${d.goal} · ${d.language} · ${d.status}${d.blocked ? ' · blocked' : ''}${d.flagCounts.warn ? ` · ${d.flagCounts.warn} to review` : ''}`);
   meta.appendChild(sub);
   item.appendChild(meta);
   const btns = el('div', 'adstudio-draft-btns');
   const editBtn = el('button', 'adstudio-btn adstudio-btn-small', 'Edit') as HTMLButtonElement;
   editBtn.type = 'button';
   editBtn.addEventListener('click', async () => {
    const { draft } = await api.getDraft(d.id);
    editingDraftId = draft.id;
    offer.value = draft.offer;
    goal.value = draft.goal;
    lang.value = draft.language;
    creative.value = draft.creativeRefs.map(r => `${r.kind}:${r.id}`).join(', ');
    renderPackage(draft.pkg, draft.flags, draft.blocked);
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });
   });
   btns.appendChild(editBtn);
   if (!d.blocked && d.status === 'draft') {
    const approveBtn = el('button', 'adstudio-btn adstudio-btn-small', 'Approve') as HTMLButtonElement;
    approveBtn.type = 'button';
    approveBtn.addEventListener('click', async () => {
     await api.approveDraft(d.id);
     await refreshDrafts();
    });
    btns.appendChild(approveBtn);
   }
   const delBtn = el('button', 'adstudio-btn adstudio-btn-small adstudio-btn-danger', 'Delete') as HTMLButtonElement;
   delBtn.type = 'button';
   delBtn.addEventListener('click', async () => {
    if (!window.confirm('Delete this ad draft?')) return;
    await api.deleteDraft(d.id);
    if (editingDraftId === d.id) { editingDraftId = null; result.hidden = true; }
    await refreshDrafts();
   });
   btns.appendChild(delBtn);
   item.appendChild(btns);
   draftsList.appendChild(item);
  }
 }

 /* ---------- generate submit ---------- */
 form.addEventListener('submit', async (event) => {
  event.preventDefault();
  formError.hidden = true;
  if (!offer.value.trim()) {
   formError.textContent = 'Describe the offer first.';
   formError.hidden = false;
   return;
  }
  generateBtn.disabled = true;
  try {
   const res = await api.generate({
    businessName: opts.businessName ?? 'Your business',
    vertical: opts.vertical ?? null,
    offer: offer.value.trim(),
    goal: goal.value,
    language: lang.value,
    services: services.value.split(',').map(s => s.trim()).filter(Boolean),
    location: location.value.trim() || undefined,
    verifiedUrgency: urgency.checked,
    verifiedTestimonials: testi.checked,
    creativeRefs: parseCreativeRefs(creative.value),
   });
   editingDraftId = null;
   renderPackage(res.package, res.flags, res.blocked);
   result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
   formError.textContent = error instanceof Error ? error.message : 'Generation failed. Try again.';
   formError.hidden = false;
  } finally { generateBtn.disabled = false; }
 });

 root.appendChild(wrap);
 void refreshDrafts();
}
