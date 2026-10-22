/** English-first copy for social connectors. `language` is threaded through every
 * user-facing string so a Spanish bundle can land later; unknown languages fall
 * back to English. Keep every string honest: no follower-growth claims, no
 * "guaranteed viral", no fake engagement promises (compliance items 11-12). */
export type SocialLanguage = 'en' | 'es';

const en = {
  connectors_title: 'Social connectors',
  connectors_subtitle: 'See your social profiles and recent posts inside The Mayor.',
  publish_test_badge: 'Test mode — nothing is posted to the public channel',
  instagram_enables: 'View your Instagram profile and recent posts inside The Mayor.',
  instagram_permissions: 'Needs: Instagram profile and media read access.',
  instagram_publish_note: 'Posting stays in test mode until Meta approves the MehyarSoft app. Nothing is published meanwhile.',
  facebook_enables: 'View your Facebook Page profile and recent posts inside The Mayor.',
  facebook_permissions: 'Needs: Facebook Page profile and posts read access.',
  facebook_publish_note: 'Posting stays in test mode until Meta approves the MehyarSoft app. Nothing is published meanwhile.',
  tiktok_enables: 'View your TikTok profile and recent videos inside The Mayor.',
  tiktok_permissions: 'Needs: TikTok profile and video-list read access.',
  tiktok_publish_note: 'TikTok posting stays in test mode. Nothing is published meanwhile.',
  x_enables: 'View your X profile and recent posts inside The Mayor.',
  x_permissions: 'Needs: X profile and posts read access.',
  x_publish_note: 'X posting stays in test mode. Nothing is published meanwhile.',
  status_connected: 'Connected',
  status_pending: 'Connection pending',
  status_error: 'Needs attention',
  status_disconnected: 'Disconnected',
  status_never_connected: 'Not connected',
  reconnect_title: 'Reconnect this account',
  reconnect_body: 'The last check failed, so this connection is paused. Reconnect to resume reading your profile and posts.',
  publish_test_gated: 'Test-gated: publish is disabled until the MehyarSoft app review is approved, so this post was simulated and nothing was sent to the public channel.',
  publish_simulated_title: 'Simulated post — not published',
  publish_sent_title: 'Post sent',
  publish_failed_title: 'Post failed',
  publish_recorded: 'This attempt was recorded in the publish history with an honest status.',
  action_connect: 'Connect',
  action_reconnect: 'Reconnect',
  action_disconnect: 'Disconnect',
  action_check: 'Check connection',
  action_read_profile: 'Read profile',
  action_read_posts: 'Read recent posts',
  action_test_publish: 'Simulate publish',
  publish_caption_label: 'Caption to test',
  publish_caption_placeholder: 'Type a caption to see what a test publish would record…',
} as const;

/** Spanish bundle lands separately; falls back to English until then. */
const es: Partial<Record<keyof typeof en, string>> = {};

export type SocialCopyKey = keyof typeof en;

export function socialLanguage(value: unknown): SocialLanguage {
  return value === 'es' ? 'es' : 'en';
}

export function tSocial(language: SocialLanguage, key: SocialCopyKey, vars?: Record<string, string>): string {
  const table = language === 'es' ? { ...en, ...es } : en;
  let text: string = (table as Record<string, string>)[key] ?? en[key];
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(v);
  return text;
}
