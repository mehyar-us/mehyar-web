import { z } from 'zod';
import { tSocial, type SocialLanguage, type SocialCopyKey } from './i18n';

export const SOCIAL_PROVIDERS = ['instagram', 'facebook', 'tiktok', 'x'] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];
export const socialProviderSchema = z.enum(SOCIAL_PROVIDERS);

/** Why publishing stays dark per provider. All four are test-gated until the
 * MehyarSoft app passes review and the owner flips SOCIAL_PUBLISH_ENABLED. */
export type PublishGateReason = 'meta_app_review_pending' | 'provider_app_review_pending';

export interface SocialConnectCard {
  provider: SocialProvider;
  /** Short label for the connect card. */
  name: string;
  /** Icon key for the frontend (maps to a brand glyph, no third-party claims). */
  icon: 'instagram' | 'facebook' | 'tiktok' | 'x';
  /** What connecting enables — read-only, honest, no growth/virality claims. */
  enables: string;
  /** Permissions the OAuth grant asks for, in plain words. */
  permissions: string;
  /** Why publishing is currently test-gated for this provider. */
  publishNote: string;
  publishGateReason: PublishGateReason;
  /** Read-only capabilities this connection offers. */
  capabilities: ('profile_read' | 'posts_read')[];
}

export function socialConnectCards(language: SocialLanguage = 'en'): SocialConnectCard[] {
  const t = (key: SocialCopyKey) => tSocial(language, key);
  return [
    {
      provider: 'instagram', name: 'Instagram', icon: 'instagram',
      enables: t('instagram_enables'), permissions: t('instagram_permissions'),
      publishNote: t('instagram_publish_note'), publishGateReason: 'meta_app_review_pending',
      capabilities: ['profile_read', 'posts_read'],
    },
    {
      provider: 'facebook', name: 'Facebook', icon: 'facebook',
      enables: t('facebook_enables'), permissions: t('facebook_permissions'),
      publishNote: t('facebook_publish_note'), publishGateReason: 'meta_app_review_pending',
      capabilities: ['profile_read', 'posts_read'],
    },
    {
      provider: 'tiktok', name: 'TikTok', icon: 'tiktok',
      enables: t('tiktok_enables'), permissions: t('tiktok_permissions'),
      publishNote: t('tiktok_publish_note'), publishGateReason: 'provider_app_review_pending',
      capabilities: ['profile_read', 'posts_read'],
    },
    {
      provider: 'x', name: 'X', icon: 'x',
      enables: t('x_enables'), permissions: t('x_permissions'),
      publishNote: t('x_publish_note'), publishGateReason: 'provider_app_review_pending',
      capabilities: ['profile_read', 'posts_read'],
    },
  ];
}

export function isSocialProvider(value: unknown): value is SocialProvider {
  return socialProviderSchema.safeParse(value).success;
}

/** Vertical-aware ordering hint: which social providers matter most per vertical.
 * Read defensively — verticals.ts may gain profiles; unknown values fall back
 * to the default order. */
const VERTICAL_ORDER: Record<string, SocialProvider[]> = {
  salon: ['instagram', 'facebook', 'tiktok', 'x'],
  restaurant: ['instagram', 'facebook', 'tiktok', 'x'],
  plumbing_hvac: ['facebook', 'instagram', 'x', 'tiktok'],
  dental: ['facebook', 'instagram', 'x', 'tiktok'],
  auto_repair: ['facebook', 'instagram', 'tiktok', 'x'],
  other: ['instagram', 'facebook', 'tiktok', 'x'],
};

export function orderedSocialCards(vertical: string | undefined | null, language: SocialLanguage = 'en'): SocialConnectCard[] {
  const cards = socialConnectCards(language);
  const order = VERTICAL_ORDER[vertical ?? 'other'] ?? VERTICAL_ORDER.other;
  return [...cards].sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider));
}
