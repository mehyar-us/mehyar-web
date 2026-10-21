/** Voice transcript merge (UX audit Tier 0 — DEF-021/DEF-022).
 *
 * main.ts renders ONE saved transcript; the voice client's live
 * transcript is merged into it by index. The merge state is exactly:
 *  - `rows`: live-index → the row object that sits in the saved array
 *    (by reference, so in-place text updates render), and
 *  - `seen`: how many live entries have been merged so far.
 *
 * The old inline version never advanced `seen`, and its call sites
 * cleared the map while replacing (or keeping) the saved array
 * inconsistently — orphaned rows on history replacement, duplicates
 * on reconnect. The contract here:
 *  - merge() pushes only genuinely new live entries, updates known
 *    rows in place, and ADVANCES `seen` to the live length.
 *  - When the saved array is replaced by server history
 *    (loadConversation, conversation_history hydration, New chat),
 *    replacedByServer() drops the map and seeds `seen` at the live
 *    length: the server's rows are the record for everything so far.
 *  - When a new voice client connects while the saved array stays
 *    (reconnect), reconnected() keeps the map and re-runs the merge
 *    from 0: known indices reconcile in place instead of duplicating.
 *  - clear() is the full teardown (access end). */
export interface VoiceMergeRow {
  role: string;
  text: string;
}

export function createVoiceTranscriptMerge() {
  let seen = 0;
  const rows = new Map<number, VoiceMergeRow>();
  return {
    merge(saved: VoiceMergeRow[], live: readonly VoiceMergeRow[]): void {
      for (let i = seen; i < live.length; i++) {
        const existing = rows.get(i);
        if (existing) {
          existing.text = live[i].text;
        } else {
          const row: VoiceMergeRow = { role: live[i].role, text: live[i].text };
          rows.set(i, row);
          saved.push(row);
        }
      }
      seen = live.length;
    },
    replacedByServer(liveLength: number): void {
      rows.clear();
      seen = liveLength;
    },
    reconnected(): void {
      seen = 0;
    },
    clear(): void {
      rows.clear();
      seen = 0;
    },
    get seen(): number {
      return seen;
    },
    get tracked(): number {
      return rows.size;
    },
  };
}

export type VoiceTranscriptMerge = ReturnType<typeof createVoiceTranscriptMerge>;
