import { storage } from './storage';

const KEY = 'onboarding_skipped';

/** The owner chose "Set up later": don't send them back to onboarding. */
export async function onboardingSkipped(): Promise<boolean> {
  return (await storage.get(KEY)) === '1';
}

export async function skipOnboarding(): Promise<void> {
  await storage.set(KEY, '1');
}

/** First-run steps in order (routes under /onboarding). */
export const ONBOARDING_STEPS = ['index', 'connect', 'names', 'region', 'contacts', 'voice', 'done'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const stepHref = (s: OnboardingStep): string => (s === 'index' ? '/onboarding' : `/onboarding/${s}`);

/** The route after `s`, or null at the end. */
export function nextStep(s: OnboardingStep): OnboardingStep | null {
  const i = ONBOARDING_STEPS.indexOf(s);
  return i >= 0 && i < ONBOARDING_STEPS.length - 1 ? ONBOARDING_STEPS[i + 1] : null;
}
