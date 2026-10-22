/**
 * engine/onboarding.ts — §2: onboarding is the loop's first run.
 * State lives in mayor_engine_state.onboarding_json; every fact the
 * session "believes" is a MemoryObject with a source — the Belief
 * Card shows confirmed facts and LABELED guesses, never a blend.
 * The assistant invents nothing before the owner speaks: no listing
 * is scraped unclaimed, no profile is pre-filled from an IP guess.
 */
import type {EngineState} from './store';

export interface OnboardingState {
 stage: 'canvas' | 'belief' | 'preview' | 'style' | 'connect' | 'grant' | 'review' | 'done';
 shopName?: string;
 trade?: string;
 town?: string;
 url?: string;
 beliefConfirmed?: boolean;
 previewShown?: boolean;
 calendarConnected?: boolean;
 calendarDetail?: string;
 evidenceMode?: 'listen' | 'read' | 'thumb';
 grantDeclined?: boolean;
 grantId?: string;
 /** An assistant-proposed rule is on the table (§1.3.2 step 1):
  * proposed at most once, a "no" suppresses the class for 30 days. */
 proposalPendingClass?: string;
 currentProbeSetId?: string;
 currentScenarioId?: string;
 queuedProbeGrantIds?: string[];
 voiceConsentGiven?: boolean;
}

export const ob = (s: EngineState): OnboardingState => (s.onboarding as unknown as OnboardingState) ?? { stage: 'canvas' };

const TRADES: Array<{ pattern: RegExp; trade: string; defaultHours: string }> = [
 { pattern: /\bbarber/i, trade: 'barbershop', defaultHours: '9–7' },
 { pattern: /\bsalon|hair|nails?\b/i, trade: 'salon', defaultHours: '9–6' },
 { pattern: /\bdental|dentist\b/i, trade: 'dental practice', defaultHours: '8–5' },
 { pattern: /\bplumb/i, trade: 'plumbing', defaultHours: '8–6' },
 { pattern: /\brestaurant|cafe|coffee|bakery|food truck\b/i, trade: 'restaurant', defaultHours: '11–10' },
 { pattern: /\bauto|mechanic|car repair\b/i, trade: 'auto repair', defaultHours: '8–6' },
 { pattern: /\bgroom|pet\b/i, trade: 'pet grooming', defaultHours: '9–5' },
 { pattern: /\bspa|massage|med ?spa\b/i, trade: 'spa', defaultHours: '9–7' },
 { pattern: /\bgym|fitness\b/i, trade: 'gym', defaultHours: '6–9' },
 { pattern: /\bflorist|flowers\b/i, trade: 'florist', defaultHours: '9–6' },
];

export function tradeDefaults(tradeText: string | undefined): { trade: string; defaultHours: string } | null {
 if (!tradeText) return null;
 return TRADES.find(t => t.pattern.test(tradeText)) ?? null;
}

/** "Fresh Fade, barbershop, Bay Ridge" → name / trade / town. A
 * pasted link is an accelerant, never a parallel track. */
export function parseIntroLine(text: string): { name?: string; trade?: string; town?: string; url?: string } {
 const url = text.match(/https?:\/\/[^\s]+|www\.[^\s]+/)?.[0];
 const cleaned = url ? text.replace(url, '').replace(/[, ]+$/, '') : text;
 const parts = cleaned.split(',').map(p => p.trim()).filter(Boolean);
 if (parts.length >= 3) return { name: parts[0], trade: parts[1], town: parts.slice(2).join(', '), ...(url ? { url } : {}) };
 if (parts.length === 2) return { name: parts[0], trade: parts[1], ...(url ? { url } : {}) };
 const tradeHit = TRADES.find(t => t.pattern.test(cleaned));
 if (tradeHit) return { trade: tradeHit.trade, ...(url ? { url } : {}) };
 return { name: cleaned || undefined, ...(url ? { url } : {}) };
}

export interface BeliefRow { field: string; label: string; value: string; source: 'you' | 'a guess'; }

/** The Belief Card's rows: what the owner said is 'you'; trade
 * defaults are guesses, labeled as such — usable for drafts, never
 * stated to a customer as certain (§2.4). */
export function beliefRows(state: OnboardingState, facts: Record<string, string>): BeliefRow[] {
 const rows: BeliefRow[] = [];
 if (state.shopName) rows.push({ field: 'name', label: 'Shop', value: state.shopName, source: 'you' });
 if (state.trade) rows.push({ field: 'trade', label: 'What you do', value: state.trade, source: 'you' });
 if (state.town) rows.push({ field: 'town', label: 'Town', value: state.town, source: 'you' });
 const hours = facts['hours.text'];
 if (hours) rows.push({ field: 'hours.text', label: 'Hours', value: hours, source: facts['hours.source'] === 'owner' ? 'you' : 'a guess' });
 else {
  const dflt = tradeDefaults(state.trade);
  if (dflt) rows.push({ field: 'hours.text', label: 'Hours', value: dflt.defaultHours, source: 'a guess' });
 }
 return rows;
}

/** Stage 1 — the 60-second preview (§2.3): one draft in the owner's
 * approximate voice, honestly labeled, built ONLY from confirmed
 * facts + labeled defaults — and it SHOWS its gaps instead of
 * filling them with invention. */
export function stage1Preview(state: OnboardingState, facts: Record<string, string>, voice: { learned: boolean }): { draft: string; gaps: string[]; voiceLabel: string } {
 const gaps: string[] = [];
 const name = state.shopName ?? 'your shop';
 const hours = facts['hours.text'];
 if (!hours) gaps.push("I don't have your hours yet, so I left them out.");
 const hoursLine = hours ? `we're open ${hours} today` : 'thanks for reaching out';
 const draft = `Hey, thanks for calling ${name} — ${hoursLine}. Want me to find you a time tomorrow?`;
 return {
  draft,
  gaps,
  voiceLabel: voice.learned ? 'In roughly your voice, from what you\'ve sent before.' : 'Generic shop voice — I haven\'t learned yours yet.',
 };
}

/** Supervised-mode completion (§2.5 activation, redefined): a
 * witnessed setup — belief confirmed + preview seen + (a probed
 * rule in shadow OR the owner's explicit "everything needs my OK")
 * + an evidence mode picked. OAuth alone never counts. */
export function onboardingComplete(state: OnboardingState, grantShadowed: boolean): boolean {
 return !!state.beliefConfirmed && !!state.previewShown && (grantShadowed || !!state.grantDeclined) && !!state.evidenceMode;
}
