/// <reference types="vite/client" />

interface Window {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
}

interface ImportMetaEnv {
  readonly MEHYAR_PUBLIC_GOOGLE_TAG_ID?: string;
  readonly MEHYAR_PUBLIC_GOOGLE_GA4_MEASUREMENT_ID?: string;
  readonly MEHYAR_PUBLIC_GTM_MEASUREMENT_ID?: string;
  readonly MEHYAR_PUBLIC_GTM_ID?: string;
  readonly MEHYAR_PUBLIC_GTM_CONTAINER_ID?: string;
  readonly MEHYAR_PUBLIC_GA4_MEASUREMENT_ID?: string;
  readonly MEHYAR_PUBLIC_GA4_PROPERTY_ID?: string;
  readonly MEHYAR_PUBLIC_ANALYTICS_DRY_RUN?: string;
  readonly MEHYAR_PUBLIC_ANALYTICS_FORCE_ENABLE?: string;
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
