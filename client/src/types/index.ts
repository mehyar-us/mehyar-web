// General types

export interface SiteMetadata {
  title: string;
  description: string;
  author: string;
  siteUrl: string;
}

export interface NavItem {
  label: string;
  href: string;
  isExternal?: boolean;
}

export interface SocialLink {
  platform: string;
  url: string;
  icon: React.ElementType;
}

// Form types

export interface ContactFormData {
  name: string;
  email: string;
  company: string;
  message: string;
}

export interface NewsletterFormData {
  email: string;
}

// Admin panel types

export interface SiteSettings {
  siteTitle: string;
  contactEmail: string;
  featuredServices: string;
}

export interface AdminPanelStats {
  blogPosts: number;
  projects: number;
  inquiries: number;
}

// Theme types

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeConfig {
  primary: string;
  variant: 'professional' | 'tint' | 'vibrant';
  appearance: ThemeMode;
  radius: number;
}

// SEO types

export interface SEOProps {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
  article?: boolean;
}
