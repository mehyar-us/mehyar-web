import { HttpError } from '../http';
import type { SocialLanguage } from './i18n';

export const SOCIAL_MESSAGE_CODES = [
  'social_provider_unknown',
  'social_provider_not_configured',
  'social_authentication_required',
  'social_permission_denied',
  'social_connection_not_found',
  'social_connection_changed',
  'social_custody_unavailable',
  'social_oauth_state_invalid',
  'social_oauth_denied',
  'social_token_exchange_failed',
  'social_profile_unavailable',
  'social_posts_unavailable',
  'social_targets_not_found',
  'social_publish_gated',
  'social_publish_unsupported',
  'social_provider_rejected',
  'social_rate_limited',
  'social_route_not_found',
] as const;
export type SocialMessageCode = (typeof SOCIAL_MESSAGE_CODES)[number];

/** English-first. Spanish strings land separately; the `language` param is
 * already threaded so the bundle can slot in without code changes. */
const en: Record<SocialMessageCode, string> = {
  social_provider_unknown: 'Choose one of Instagram, Facebook, TikTok, or X.',
  social_provider_not_configured: 'This social provider is not configured yet. Connect it from the dashboard after the app credentials are set.',
  social_authentication_required: 'Sign in before managing social connections.',
  social_permission_denied: 'Only the business owner can change social connections.',
  social_connection_not_found: 'This social connection is unavailable in your account and business. Refresh Social connectors.',
  social_connection_changed: 'This connection changed. Refresh Social connectors and review the current settings.',
  social_custody_unavailable: 'Secure credential storage is unavailable. Please contact support before reconnecting.',
  social_oauth_state_invalid: 'The sign-in request expired or was changed. Start the connection again from Social connectors.',
  social_oauth_denied: 'The connection was not approved on the provider side. Nothing was stored.',
  social_token_exchange_failed: 'The provider did not return access credentials. Try connecting again.',
  social_profile_unavailable: 'The provider did not return a profile right now. Check the connection and try again.',
  social_posts_unavailable: 'The provider did not return recent posts right now. Check the connection and try again.',
  social_targets_not_found: 'No publishable account was found on this connection (for example, no Instagram business account linked to the Facebook Page). Connect the right account and try again.',
  social_publish_gated: 'Publishing is in test mode until the MehyarSoft app review is approved. Nothing was posted; the attempt was recorded as a simulated test.',
  social_publish_unsupported: 'Publishing to this provider is not supported yet. The attempt was recorded without posting anything.',
  social_provider_rejected: 'The provider rejected the request. Check the connection, permissions, and app review status in that provider.',
  social_rate_limited: 'Too many social requests right now. Wait a moment before trying again.',
  social_route_not_found: 'This social action is unavailable. Refresh Social connectors.',
};

export function socialMessage(code: string, language: SocialLanguage = 'en'): string {
  void language; // Spanish bundle lands separately; English is the fallback.
  return (en as Record<string, string>)[code] ?? 'The social request could not complete. Check the connection settings.';
}

export const socialFailure = (code: SocialMessageCode, status = 400) =>
  new HttpError(status, code, socialMessage(code));
