import { it, expect } from 'vitest';
import { createVoiceTranscriptMerge, type VoiceMergeRow } from '../web/voice-merge';

/** UX audit Tier 0 — DEF-021/DEF-022: the voice merge contract.
 * The old inline merge in main.ts never advanced its cursor, cleared
 * its row map on history replacement in only SOME paths (orphaning the
 * rows it kept mutating), and cleared it on reconnect (re-pushing the
 * whole live transcript as duplicates). These pins encode the fixed
 * contract main.ts now delegates to. */

const live = (...texts: string[]): VoiceMergeRow[] =>
  texts.map((text, i) => ({ role: i % 2 ? 'assistant' : 'user', text }));

it('merge pushes new entries once and advances the cursor', () => {
  const merge = createVoiceTranscriptMerge();
  const saved: VoiceMergeRow[] = [];
  merge.merge(saved, live('Hi', 'Hello'));
  expect(saved.map((r) => r.text)).toEqual(['Hi', 'Hello']);
  expect(merge.seen).toBe(2);
  // Merging the same live transcript again is a no-op.
  merge.merge(saved, live('Hi', 'Hello'));
  expect(saved).toHaveLength(2);
  // Growth appends only the new tail.
  merge.merge(saved, live('Hi', 'Hello', 'Book me Tuesday'));
  expect(saved.map((r) => r.text)).toEqual(['Hi', 'Hello', 'Book me Tuesday']);
});

it('DEF-022: after a reconnect the same indices reconcile in place — no duplicates', () => {
  const merge = createVoiceTranscriptMerge();
  const saved: VoiceMergeRow[] = [];
  merge.merge(saved, live('Hi', 'Hello'));
  const firstRow = saved[0];
  // A new voice client restarts its transcript indices at 0 with the
  // same utterances. The merge must update the existing rows, not
  // push a second copy of the conversation.
  merge.reconnected();
  merge.merge(saved, live('Hi', 'Hello — updated'));
  expect(saved).toHaveLength(2);
  expect(saved[0]).toBe(firstRow);
  expect(saved.map((r) => r.text)).toEqual(['Hi', 'Hello — updated']);
  merge.merge(saved, live('Hi', 'Hello — updated', 'One more'));
  expect(saved).toHaveLength(3);
});

it('DEF-021: a server history replacement retires the old rows — the merge treats the snapshot as the record', () => {
  const merge = createVoiceTranscriptMerge();
  const saved: VoiceMergeRow[] = [];
  merge.merge(saved, live('Spoken question', 'Spoken answer'));
  expect(merge.tracked).toBe(2);
  // loadConversation / conversation_history replaced the saved array
  // wholesale with the server's rows.
  const serverRows: VoiceMergeRow[] = live('Spoken question', 'Spoken answer');
  merge.replacedByServer(2);
  expect(merge.tracked).toBe(0);
  expect(merge.seen).toBe(2);
  // The live client's already-saved entries are NOT re-pushed…
  merge.merge(serverRows, live('Spoken question', 'Spoken answer'));
  expect(serverRows).toHaveLength(2);
  // …and the orphaned old array is never touched again.
  merge.merge(serverRows, live('Spoken question', 'Spoken answer', 'New utterance'));
  expect(serverRows.map((r) => r.text)).toEqual(['Spoken question', 'Spoken answer', 'New utterance']);
  expect(saved).toHaveLength(2);
});

it('clear() is a full teardown: the next merge starts from nothing', () => {
  const merge = createVoiceTranscriptMerge();
  const saved: VoiceMergeRow[] = [];
  merge.merge(saved, live('Hi'));
  merge.clear();
  expect(merge.seen).toBe(0);
  expect(merge.tracked).toBe(0);
  const fresh: VoiceMergeRow[] = [];
  merge.merge(fresh, live('Hi'));
  expect(fresh).toHaveLength(1);
});
