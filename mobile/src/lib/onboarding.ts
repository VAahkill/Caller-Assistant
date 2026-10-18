import { loadConfig } from './api';
import { storage } from './storage';

const KEY = 'onboarding_done';

/** The owner finished setup or chose "Set up later": don't show it again. */
export async function onboardingDone(): Promise<boolean> {
  return (await storage.get(KEY)) === '1';
}

export async function finishOnboarding(): Promise<void> {
  await storage.set(KEY, '1');
}

/** Setup again from Settings: the next app start opens the welcome screen. */
export async function resetOnboarding(): Promise<void> {
  await storage.remove(KEY);
}

/** First run only: no server saved and setup never finished or put off.
 *  Someone already connected (e.g. after an update) goes straight to Today. */
export async function shouldShowOnboarding(): Promise<boolean> {
  const [cfg, done] = await Promise.all([loadConfig(), onboardingDone()]);
  return !cfg && !done;
}

/** First-run steps in order (routes under /onboarding). */
export const ONBOARDING_STEPS = ['index', 'connect', 'names', 'region', 'contacts', 'voice', 'done'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Steps that save to the server, so they need it connected first. */
export const NEEDS_SERVER: ReadonlySet<OnboardingStep> = new Set(['names', 'region', 'contacts', 'voice']);

export const stepHref = (s: OnboardingStep): string => (s === 'index' ? '/onboarding' : `/onboarding/${s}`);

/** The route after `s`, or null at the end. */
export function nextStep(s: OnboardingStep): OnboardingStep | null {
  const i = ONBOARDING_STEPS.indexOf(s);
  return i >= 0 && i < ONBOARDING_STEPS.length - 1 ? ONBOARDING_STEPS[i + 1] : null;
}
