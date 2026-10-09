/**
 * Crew 5 UX — business naming.
 *
 * The app never auto-creates a nameless business. After sign-in, when the
 * owner has no business membership, the conversation asks "What's your
 * business called?" and POST /api/businesses is called only with the real
 * name the owner types. "My business" is rejected as a name — it was the old
 * auto-create placeholder and must never become a business name again.
 */

/** Returns an honest, actionable problem, or null when the name is usable. */
export function validateBusinessName(raw: string): string | null {
  const name = raw.trim();
  if (!name) return 'Type your business name to continue — that’s how your front desk gets set up.';
  if (name.length > 160) return 'Business names are at most 160 characters. Shorten it a little and try again.';
  if (name.toLowerCase() === 'my business')
    return '“My business” is just the placeholder. What’s your business actually called?';
  return null;
}

/** First-run greeting: the spec's onboarding question, asked in conversation. */
export function namingGreeting(): string {
  return 'Welcome to The Mayor — I run the front of your business: bookings, missed calls, customers.\n\nWhat’s your business called? Type the name your customers know.';
}
