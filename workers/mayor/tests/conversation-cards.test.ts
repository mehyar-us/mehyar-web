import { it, expect, vi } from 'vitest';
import { createConversationCardRegistry } from '../web/conversation-cards';

/** UX audit Tier 0 — DEF-006: cards mounted around #transcript by
 * harness events (connector cards with live credential forms) must not
 * survive a conversation reset. main.ts registers every mounted card
 * and clears this registry in startNewChat / loadConversation. */

it('clear() removes every registered card exactly once', () => {
  const registry = createConversationCardRegistry();
  const a = { remove: vi.fn() };
  const b = { remove: vi.fn() };
  registry.register(a);
  registry.register(b);
  registry.register(a); // same node twice — still one removal
  expect(registry.size).toBe(2);
  registry.clear();
  expect(a.remove).toHaveBeenCalledTimes(1);
  expect(b.remove).toHaveBeenCalledTimes(1);
  expect(registry.size).toBe(0);
  registry.clear(); // idempotent
  expect(a.remove).toHaveBeenCalledTimes(1);
});

it('a card whose remove() throws does not strand the others', () => {
  const registry = createConversationCardRegistry();
  const bad = {
    remove: () => {
      throw new Error('already detached');
    },
  };
  const good = { remove: vi.fn() };
  registry.register(bad);
  registry.register(good);
  expect(() => registry.clear()).not.toThrow();
  expect(good.remove).toHaveBeenCalledTimes(1);
  expect(registry.size).toBe(0);
});
