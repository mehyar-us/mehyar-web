/**
 * engine/types.ts — the new engine's shared types (Reinvention
 * Slice 2, blueprint §1). One loop, typed at every stage boundary:
 * a StimulusEnvelope enters, Understanding classifies it, the Grant
 * Gate judges it, Preparation renders it, and the Owner Surface is
 * the only thing that leaves.
 */

export const ACTION_CLASSES = [
 'schedule_new','reschedule','cancel_booking','send_sms_reply','send_email_reply',
 'answer_call','offer_alternate_slot','send_reminder','send_followup',
 'winback_message','request_review','update_record','create_task',
] as const;
export type ActionClass = typeof ACTION_CLASSES[number];

export type GrantStatus = 'proposed'|'probed'|'shadow'|'live'|'narrowed'|'revoked'|'expired';
export type CapabilityState = 'present'|'pending'|'revoked'|'stale_probe';

export interface GrantScope {
 who: 'any_customer'|'existing_customers_only'|'named'|'not_named';
 whoNames?: string[];
 what: 'any_service'|string[]; // service ids, or any_service
 when: 'any_time'|'business_hours'|{window:string};
 channel: 'sms'|'email'|'phone'|'any';
 limits: { maxMessagesPerPersonPerDay: number; maxSlotGapMinutes?: number; bookingHorizonDays?: number };
}

/** A compiled, machine-checked condition (Stage 4 evaluates these —
 * never prose). `amount_lte_cents` is the "jobs under $500" edge;
 * `caller_visits_gte` the regular edge; `day_not_in` a schedule edge. */
export interface GrantCondition {
 kind: 'amount_lte_cents'|'amount_gt_cents'|'caller_visits_gte'|'day_not_in'|'hour_before'|'hour_after';
 value: number|string;
 /** Human-readable rendering for provenance rows ("Because: …"). */
 label: string;
}

export interface Grant {
 id: string;
 tenantId: string;
 version: number;
 status: GrantStatus;
 actionClass: ActionClass;
 scope: GrantScope;
 conditions: GrantCondition[];
 /** Negations/exceptions — first-class, rendered verbatim, never
  * folded into a paraphrase (§1.3.1). */
 neverLines: string[];
 /** The owner's exact words. Immutable; divergence is adjudicated
  * against this, never against the summary. */
 sourceUtterance: string;
 plainSummary: string;
 origin: 'owner_stated'|'assistant_proposed';
 capabilityState: CapabilityState;
 probeSetId: string|null;
 /** Session-one grants cover the owner's own test bookings only. */
 sessionScope: 'owner_test'|'standard';
 /** Open ambiguities the owner must answer before probing (§1.3.2:
  * ask, don't act). Non-empty ⇒ the grant cannot advance. */
 asks: string[];
 createdAt: string;
 confirmedAt: string|null;
 expiresAt: string|null;
 supersedesId: string|null;
}

export interface ProbeScenario {
 id: string;
 probeSetId: string;
 ordinal: number;
 description: string;
 detail: ScenarioFacts;
 expectedOutcome: 'allowed'|'blocked';
 ownerRuling: 'allowed'|'blocked'|null;
 flipped: boolean;
}

/** The structured facts a scenario (or a real act) is judged on. */
export interface ScenarioFacts {
 personName?: string;
 personKnown?: boolean; // in the customer list
 isOwnerTestBooking?: boolean;
 serviceId?: string;
 channel?: string;
 dayOfWeek?: string; // Mon..Sun
 hourLocal?: number;
 amountCents?: number;
 callerVisits?: number;
}

export interface StimulusEnvelope {
 stimulusId: string;
 tenantId: string;
 channel: 'owner_text'|'owner_voice'|'api';
 actor: { kind: 'owner'|'member'; userId: string };
 idempotencyKey: string;
 text: string;
 at: string;
}

export type IntentClass =
 | 'grant_statement'|'revocation'|'correction'|'audit_query'|'connect_calendar'
 | 'customer_act'|'shop_intro'|'scenario_ruling'|'onboarding_step'|'plain';

export interface Understanding {
 intentClass: IntentClass;
 /** True when deterministic parsers fully determined the turn. False
  * routes the turn to Stage 5 (decide) or to prepare-and-ask. */
 deterministic: boolean;
 /** Ambiguity notes from the parsers (never silently resolved). */
 ambiguities: string[];
 actionClass?: ActionClass;
 targetPerson?: string;
 facts: ScenarioFacts;
 /** The raw grant-language span when intentClass is grant_statement. */
 grantText?: string;
 ruling?: 'allowed'|'blocked';
}

export interface PreparedAction {
 id: string;
 tenantId: string;
 kind: 'ask'|'shadow';
 actionClass: ActionClass;
 targetPerson: string|null;
 channel: string;
 payload: Record<string,unknown>;
 payloadSummary: string;
 grantId: string|null;
 grantVersion: number|null;
 predicateFired: string|null;
 decisionId: string|null;
 nearBoundary: boolean;
 reversibility: { undoWindowMinutes: number; inverse: string }|null;
 expiresAt: string;
 status: 'prepared'|'approved'|'dismissed'|'expired'|'cancelled';
 createdAt: string;
}

/** What Stage 11 hands the surface: prose lines + Desk intents. The
 * intent shapes mirror web/desk/intents.ts (server emits data; the
 * client owns the renderers). */
export interface OwnerSurface {
 lines: string[];
 intents: Array<Record<string,unknown>>;
 /** Visual-only readiness (§1.2): acted | needs-eye | holding.
 * Never a number, on any surface, ever. */
 readiness: 'acted'|'needs-eye'|'holding';
 runId: string;
}

export interface MemoryObject {
 id: string;
 tenantId: string;
 type: 'BusinessFact'|'Person'|'Commitment'|'Preference'|'Rule'|'Episode'|'VoiceTrait';
 version: number;
 status: 'active'|'superseded'|'disputed'|'forgotten';
 payload: Record<string,unknown>;
 confidenceTier: 'owner_confirmed'|'observed_strong'|'observed_weak';
 provenance: { sourceKind: 'owner_statement'|'owner_correction'|'conversation_observed'|'connector_sync'|'document_import'; sourceStimulusId?: string; quote?: string };
 createdAt: string;
 decayClass: string;
}
