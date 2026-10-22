/**
 * engine/memory.ts — §1.4: the twin is a graph of typed, provenanced
 * MemoryObjects, not a profile blob. Learning rules enforced here:
 *  (1) owner corrections are sync and supreme — the object versions,
 *      the old one is superseded, the new fact is live in the turn;
 *  (2) observations enter observed_weak and promote to
 *      observed_strong after 3 consistent observations — NEVER to
 *      owner_confirmed by repetition;
 *  (3) conflicting observations both stay disputed — drafting may
 *      not silently rely on either;
 *  (4) voice is learned from the owner and owner-approved sends ONLY
 *      — customer text can never enter the voice store.
 * Fabrication guard: a BusinessFact with no provenance chain can
 * never be stated to a customer — reads here only return objects
 * that carry provenance, and facts without it do not exist as rows.
 */
import type {MemoryObject} from './types';
import {insertMemoryObject,listMemoryObjects,supersedeMemoryObject} from './store';

type DB = D1Database;

export async function rememberBusinessFact(db: DB, input: { tenantId: string; key: string; value: string; tier: MemoryObject['confidenceTier']; sourceKind: MemoryObject['provenance']['sourceKind']; quote?: string; stimulusId?: string }): Promise<MemoryObject> {
 return insertMemoryObject(db, {
  tenantId: input.tenantId, type: 'BusinessFact', status: 'active',
  payload: { key: input.key, value: input.value }, confidenceTier: input.tier,
  provenance: { sourceKind: input.sourceKind, quote: input.quote, sourceStimulusId: input.stimulusId },
  decayClass: 'permanent',
 });
}

export async function getBusinessFact(db: DB, tenantId: string, key: string): Promise<MemoryObject | null> {
 const facts = await listMemoryObjects(db, tenantId, 'BusinessFact');
 return facts.filter(f => f.payload.key === key).sort((a, b) => b.version - a.version)[0] ?? null;
}

/** A correction: supersede the live fact for `key` and write the new
 * one as owner_confirmed, in the same call (same turn). */
export async function applyOwnerCorrection(db: DB, input: { tenantId: string; key: string; value: string; quote: string; stimulusId?: string }): Promise<MemoryObject> {
 const existing = await getBusinessFact(db, input.tenantId, input.key);
 if (existing) await supersedeMemoryObject(db, input.tenantId, existing.id);
 return insertMemoryObject(db, {
  tenantId: input.tenantId, type: 'BusinessFact', status: 'active',
  payload: { key: input.key, value: input.value }, confidenceTier: 'owner_confirmed',
  provenance: { sourceKind: 'owner_correction', quote: input.quote, sourceStimulusId: input.stimulusId },
  decayClass: 'permanent', version: (existing?.version ?? 0) + 1, supersedesId: existing?.id,
 });
}

/** Normal-use observation: weak on entry; 3 consistent sightings
 * promote to strong; a conflicting sighting disputes both. */
export async function recordObservation(db: DB, input: { tenantId: string; key: string; value: string; stimulusId?: string }): Promise<MemoryObject> {
 const facts = await listMemoryObjects(db, input.tenantId, 'BusinessFact');
 const same = facts.find(f => f.payload.key === input.key && f.confidenceTier !== 'owner_confirmed');
 if (same && same.payload.value === input.value) {
  const seen = (same.payload.seen as number | undefined) ?? 1;
  if (seen + 1 >= 3 && same.confidenceTier === 'observed_weak') {
   await supersedeMemoryObject(db, input.tenantId, same.id);
   return insertMemoryObject(db, {
    tenantId: input.tenantId, type: 'BusinessFact', status: 'active',
    payload: { key: input.key, value: input.value, seen: seen + 1 }, confidenceTier: 'observed_strong',
    provenance: { sourceKind: 'conversation_observed', sourceStimulusId: input.stimulusId }, decayClass: 'permanent',
    version: same.version + 1, supersedesId: same.id,
   });
  }
  await supersedeMemoryObject(db, input.tenantId, same.id);
  return insertMemoryObject(db, {
   tenantId: input.tenantId, type: 'BusinessFact', status: 'active',
   payload: { key: input.key, value: input.value, seen: seen + 1 }, confidenceTier: same.confidenceTier,
   provenance: same.provenance, decayClass: 'permanent', version: same.version + 1, supersedesId: same.id,
  });
 }
 if (same && same.payload.value !== input.value) {
  await supersedeMemoryObject(db, input.tenantId, same.id);
  await insertMemoryObject(db, {
   tenantId: input.tenantId, type: 'BusinessFact', status: 'disputed',
   payload: { key: input.key, value: same.payload.value as string }, confidenceTier: same.confidenceTier,
   provenance: same.provenance, decayClass: 'permanent', version: same.version + 1, supersedesId: same.id,
  });
  return insertMemoryObject(db, {
   tenantId: input.tenantId, type: 'BusinessFact', status: 'disputed',
   payload: { key: input.key, value: input.value }, confidenceTier: 'observed_weak',
   provenance: { sourceKind: 'conversation_observed', sourceStimulusId: input.stimulusId }, decayClass: 'permanent',
  });
 }
 return insertMemoryObject(db, {
  tenantId: input.tenantId, type: 'BusinessFact', status: 'active',
  payload: { key: input.key, value: input.value, seen: 1 }, confidenceTier: 'observed_weak',
  provenance: { sourceKind: 'conversation_observed', sourceStimulusId: input.stimulusId }, decayClass: 'permanent',
 });
}

/* ---------------- people ---------------- */

export async function upsertPerson(db: DB, input: { tenantId: string; name: string; stimulusId?: string; visits?: number }): Promise<MemoryObject> {
 const people = await listMemoryObjects(db, input.tenantId, 'Person');
 const existing = people.find(p => (p.payload.name as string)?.toLowerCase() === input.name.toLowerCase());
 if (existing) return existing;
 return insertMemoryObject(db, {
  tenantId: input.tenantId, type: 'Person', status: 'active',
  payload: { name: input.name, visits: input.visits ?? 1 }, confidenceTier: 'observed_strong',
  provenance: { sourceKind: 'conversation_observed', sourceStimulusId: input.stimulusId }, decayClass: 'permanent',
 });
}

export async function findPerson(db: DB, tenantId: string, name: string): Promise<MemoryObject | null> {
 const people = await listMemoryObjects(db, tenantId, 'Person');
 return people.find(p => (p.payload.name as string)?.toLowerCase() === name.toLowerCase()) ?? null;
}

export async function listPeopleNames(db: DB, tenantId: string): Promise<string[]> {
 const people = await listMemoryObjects(db, tenantId, 'Person');
 return people.map(p => p.payload.name as string).filter(Boolean);
}

/* ---------------- voice (§1.4.1) ---------------- */

export type VoiceSource = 'owner' | 'owner_approved' | 'customer' | 'observed';
const VOICE_EXEMPLAR_CAP = 20;

/** The ONLY door into the voice store. Customer text is refused —
 * the twin never learns the owner's voice from customers' messages. */
export async function addVoiceExemplar(db: DB, input: { tenantId: string; audience: 'customers' | 'staff' | 'public'; text: string; source: VoiceSource; stimulusId?: string }): Promise<{ accepted: boolean; reason?: string }> {
 if (input.source !== 'owner' && input.source !== 'owner_approved') {
  return { accepted: false, reason: 'voice is learned from the owner and owner-approved sends only' };
 }
 const traits = await listMemoryObjects(db, input.tenantId, 'VoiceTrait');
 const existing = traits.find(t => t.payload.audience === input.audience);
 const exemplars = [...((existing?.payload.exemplars as Array<{ text: string; at: string; source: string }> | undefined) ?? []), { text: input.text, at: new Date().toISOString(), source: input.source }];
 const capped = exemplars.slice(-VOICE_EXEMPLAR_CAP);
 if (existing) await supersedeMemoryObject(db, input.tenantId, existing.id);
 await insertMemoryObject(db, {
  tenantId: input.tenantId, type: 'VoiceTrait', status: 'active',
  payload: { audience: input.audience, exemplars: capped }, confidenceTier: 'owner_confirmed',
  provenance: { sourceKind: 'owner_statement', sourceStimulusId: input.stimulusId }, decayClass: 'permanent',
  version: (existing?.version ?? 0) + 1, supersedesId: existing?.id,
 });
 return { accepted: true };
}

export async function getVoiceExemplars(db: DB, tenantId: string, audience: 'customers' | 'staff' | 'public'): Promise<string[]> {
 const traits = await listMemoryObjects(db, tenantId, 'VoiceTrait');
 const trait = traits.find(t => t.payload.audience === audience);
 return ((trait?.payload.exemplars as Array<{ text: string }> | undefined) ?? []).map(e => e.text);
}

/** Conversational inspection: "What do you remember about Dana?" —
 * objects narrated with provenance in human form (§1.4.2). */
export async function inspectMemory(db: DB, tenantId: string, query: string): Promise<Array<{ summary: string; provenanceLine: string }>> {
 const all = await listMemoryObjects(db, tenantId);
 const q = query.toLowerCase();
 const hits = all.filter(o => JSON.stringify(o.payload).toLowerCase().includes(q));
 return hits.map(o => ({
  summary: o.type === 'BusinessFact' ? `${o.payload.key}: ${o.payload.value}` : o.type === 'Person' ? `${o.payload.name} — a customer (${(o.payload.visits as number) ?? 1} visits)` : `${o.type}: ${JSON.stringify(o.payload)}`,
  provenanceLine: o.provenance.sourceKind === 'owner_correction' || o.provenance.sourceKind === 'owner_statement' ? 'You told me.' : o.provenance.sourceKind === 'connector_sync' ? 'Came in from a connected account.' : 'I noticed it from your conversations.',
 }));
}
