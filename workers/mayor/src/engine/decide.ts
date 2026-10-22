/**
 * engine/decide.ts — Stage 5 (blueprint §1.2). decide() is consulted
 * ONLY for: ambiguous intent, marginal grant-language detection,
 * proactive ranking, genuine conversation-path choices, and
 * commitment-risk scoring — never for anything a deterministic rule
 * already settles. Threshold profiles are named, in this one
 * registry. Every consultation writes a DecisionLog row carrying the
 * state HASH (never state text). decide() unavailable ⇒ band
 * 'unavailable' ⇒ everything non-deterministic falls back to
 * prepare-and-ask (fail toward the owner, never toward autonomy).
 */
import {hashState,writeDecisionLog} from './store';

export const THRESHOLD_PROFILES = {
 mayor_intent: { auto: 0.80, review: 0.55 },
 mayor_urgency: { auto: 0.80, review: 0.55 },
 mayor_commitment_risk: { auto: 0.85, review: 0.60 },
 mayor_proactive_rank: { auto: 0.75, review: 0.50 },
} as const;
export type ThresholdProfileName = keyof typeof THRESHOLD_PROFILES;

export interface DecideQuestion { id: string; kind: string; prompt: string; }
export interface DecideProviderResult { answers: Record<string, unknown>; confidences: Record<string, number>; model: string; costMicrocents: number; }
export interface DecideProvider {
 consult(input: { state: unknown; questions: DecideQuestion[] }): Promise<DecideProviderResult | null>;
}

/** The default provider: no endpoint configured ⇒ unavailable. The
 * engine treats that as a designed state, not an error. */
export const unavailableDecideProvider: DecideProvider = { consult: async () => null };

export function decideProviderFromEnv(env: { ENGINE_DECIDE_URL?: string }): DecideProvider {
 const url = env.ENGINE_DECIDE_URL;
 if (!url) return unavailableDecideProvider;
 return {
  async consult(input) {
   try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    if (!res.ok) return null;
    const data = await res.json() as Partial<DecideProviderResult>;
    if (!data.answers || !data.confidences) return null;
    return { answers: data.answers, confidences: data.confidences, model: data.model ?? 'decide-endpoint', costMicrocents: data.costMicrocents ?? 0 };
   } catch { return null; }
  },
 };
}

export interface DecisionOutcome {
 decisionId: string;
 band: 'auto' | 'review' | 'hold' | 'unavailable';
 answers: Record<string, unknown>;
 confidences: Record<string, number>;
 costMicrocents: number;
}

export async function consultDecision(db: D1Database, input: {
 tenantId: string; runId: string; profile: ThresholdProfileName; state: unknown;
 questions: DecideQuestion[]; provider: DecideProvider;
}): Promise<DecisionOutcome> {
 const started = Date.now();
 let result: DecideProviderResult | null = null;
 try { result = await input.provider.consult({ state: input.state, questions: input.questions }); } catch { result = null; }
 const latencyMs = Date.now() - started;
 const profile = THRESHOLD_PROFILES[input.profile];
 let band: DecisionOutcome['band'] = 'unavailable';
 if (result) {
  const confs = input.questions.map(q => result!.confidences[q.id]).filter((c): c is number => typeof c === 'number');
  const weakest = confs.length === input.questions.length && confs.length > 0 ? Math.min(...confs) : 0;
  band = weakest >= profile.auto ? 'auto' : weakest >= profile.review ? 'review' : 'hold';
 }
 const decisionId = await writeDecisionLog(db, {
  tenantId: input.tenantId, runId: input.runId, questionIds: input.questions.map(q => q.id),
  answers: result?.answers ?? {}, confidences: result?.confidences ?? {}, bandOutcome: band,
  thresholdProfile: input.profile, model: result?.model ?? null, latencyMs,
  costMicrocents: result?.costMicrocents ?? null, stateHash: await hashState(input.state),
 });
 return { decisionId, band, answers: result?.answers ?? {}, confidences: result?.confidences ?? {}, costMicrocents: result?.costMicrocents ?? 0 };
}
