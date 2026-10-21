import { it, expect } from 'vitest';
import { profileChanges } from '../src/memory';
import { asksToResumeOnboarding, onboardingProgress } from '../src/onboarding';

/** UX audit Tier 0 — CHG-094 (LIVE-01/LIVE-34). A confirmed business
 * profile must never be dumped back at its owner as a verification
 * demand, and confirmed facts must never be re-asked. The producer
 * was the proposal path: the model answered ordinary requests by
 * proposing the whole record, and the server read the whole record
 * back. These pins cover the shared gate both proposal tools use. */

const confirmed = {
  name: 'Mehyar US',
  vertical: 'salon' as const,
  language: 'en' as const,
  industry: 'Hair Salon',
  businessGoals: ['Grow bookings'],
};

it('a patch restating the confirmed profile has NO changes — it can never become a readback', () => {
  expect(profileChanges(confirmed, { ...confirmed })).toEqual({});
  expect(profileChanges(confirmed, { name: 'Mehyar US', language: 'en' })).toEqual({});
});

it('only the genuinely new field survives the gate', () => {
  expect(
    profileChanges(confirmed, { ...confirmed, locations: ['Queens'] }),
  ).toEqual({ locations: ['Queens'] });
  expect(
    profileChanges(confirmed, { ...confirmed, businessGoals: ['Grow bookings', 'Hire a stylist'] }),
  ).toEqual({ businessGoals: ['Grow bookings', 'Hire a stylist'] });
});

it('LIVE-34: a confirmed vertical answers the industry question — it is never re-asked', () => {
  const progress = onboardingProgress({ name: 'Mehyar US', vertical: 'salon', language: 'en' });
  expect(progress.missing).not.toContain('industry');
  expect(progress.nextQuestion).toBe('What services or products do you offer?');
  expect(progress.readback).not.toContain('What kind of business do you run?');
});

it('without a vertical or industry the trade question is still asked (behavior preserved)', () => {
  const progress = onboardingProgress({ name: 'Mehyar US', language: 'en' });
  expect(progress.missing).toContain('industry');
  expect(progress.nextQuestion).toBe('What kind of business do you run?');
  const withIndustry = onboardingProgress({ name: 'Mehyar US', industry: 'Hair Salon', language: 'en' });
  expect(withIndustry.missing).not.toContain('industry');
});

it('the resume command matches with its clarifying tail — and nothing else changes', () => {
  expect(asksToResumeOnboarding('Resume onboarding from my confirmed details. Ask one missing question.')).toBe(true);
  expect(
    asksToResumeOnboarding(
      'Resume onboarding from my confirmed details. Ask one missing question at a time, and do not repeat details I already confirmed.',
    ),
  ).toBe(true);
  expect(asksToResumeOnboarding('Continue onboarding')).toBe(true);
  expect(asksToResumeOnboarding('Give me a 10-step salon marketing plan')).toBe(false);
  expect(asksToResumeOnboarding('Resume onboarding from my confirmed details')).toBe(false);
});
