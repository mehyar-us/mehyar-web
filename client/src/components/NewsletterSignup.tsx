import { SmartSignup } from "@/components/conversion/ConversionFlow";

type NewsletterVariant = "card" | "footer" | "inline";

type NewsletterSignupProps = {
  variant?: NewsletterVariant;
  source?: string;
  title?: string;
  description?: string;
  compact?: boolean;
};

const NewsletterSignup = ({
  variant = "card",
  source = "newsletter_signup",
  title = "Get the free AI automation checklist.",
  description = "A short owner-friendly checklist for finding missed calls, bad website flow, weak follow-up, and manual work before buying another tool.",
  compact = false,
}: NewsletterSignupProps) => (
  <SmartSignup
    variant={variant}
    source={source}
    title={title}
    description={description}
    featureFlags={{ compact }}
    campaign="free_ai_automation_checklist"
  />
);

export default NewsletterSignup;
