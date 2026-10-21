/** Registry for the foreign cards harness events mount around the
 * transcript (UX audit Tier 0 — DEF-006).
 *
 * Connector cards are plain DOM nodes inserted as siblings of the
 * React-owned <ol> inside the conversation section. They carry live
 * closures (api, tenant, credential-capture forms), so a conversation
 * reset must remove them — a card from an archived thread must never
 * sit, still submittable, inside a fresh conversation. main.ts
 * registers every mounted card here and clears the registry on
 * conversation reset (New chat, history reload). */
export interface RemovableNode {
  remove(): void;
}

export function createConversationCardRegistry() {
  const nodes = new Set<RemovableNode>();
  return {
    register(node: RemovableNode): void {
      nodes.add(node);
    },
    clear(): void {
      for (const node of nodes) {
        try {
          node.remove();
        } catch {
          /* a node already detached by a re-render is gone either way */
        }
      }
      nodes.clear();
    },
    get size(): number {
      return nodes.size;
    },
  };
}

export type ConversationCardRegistry = ReturnType<typeof createConversationCardRegistry>;
