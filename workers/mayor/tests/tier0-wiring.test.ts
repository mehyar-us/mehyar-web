import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/** UX audit Tier 0 — wiring pins for the fixes that live in the
 * imperative shell (web/main.ts) where no DOM harness exists, in the
 * repo's established source-pin style (see the served-sentence pin in
 * text-chat-streaming.test.ts). The behavioral halves of these fixes
 * are pinned by voice-merge.test.ts, conversation-cards.test.ts and
 * text-chat-streaming.test.ts; these pins prove main.ts actually
 * calls them. */

const main = readFileSync(new URL('../web/main.ts', import.meta.url), 'utf8');

it('DEF-024: renderVoiceState writes the mute label from the actual mute state', () => {
  const render = main.slice(main.indexOf('function renderVoiceState()'), main.indexOf('type VoiceProbe'));
  expect(render).toContain("$('mute').textContent=voice?.isMuted?'Unmute':'Mute';");
});

it('DEF-014: settleTextOutcome commits stopped outcomes and retires the overlay', () => {
  const settle = main.slice(main.indexOf('async function settleTextOutcome'), main.indexOf('async function sendTextMessage'));
  expect(settle).toContain('applyTextOutcome(savedTranscript,outcome)');
  expect(settle).toContain('textChat.commitStopped()');
});

it('DEF-021/022: main.ts delegates the voice merge — no inline cursor remains', () => {
  expect(main).toContain('voiceMerge.merge(savedTranscript,live)');
  expect(main).toContain('voiceMerge.reconnected()');
  expect(main).toContain('voiceMerge.replacedByServer(voice?.transcript.length??0)');
  expect(main).not.toContain('voiceSeen');
  expect(main).not.toContain('voiceRows');
});

it('DEF-006: connector cards register, and both conversation resets clear the cards', () => {
  expect(main).toContain('conversationCards.register(card)');
  const newChatAt = main.indexOf('async function startNewChat');
  expect(main.slice(newChatAt, newChatAt + 4000)).toContain('clearConversationCards()');
  const loadAt = main.indexOf('async function loadConversation');
  expect(main.slice(loadAt, loadAt + 1200)).toContain('clearConversationCards()');
});
