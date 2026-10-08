import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTokens } from '../../lib/design/theme';
import { ONBOARDING_STEPS, nextStep, skipOnboarding, stepHref, type OnboardingStep } from '../../lib/onboarding';
import { Button } from '../ui/Button';
import { Screen } from '../ui/Screen';
import { Text } from '../ui/Text';
import { useToast } from '../ui/Toast';

export interface OnboardingFrameProps {
  step: OnboardingStep;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  /** The main button; defaults to "Continue" going to the next step. */
  primary?: { title: string; onPress?: () => void; loading?: boolean; disabled?: boolean; icon?: 'arrow-forward' | 'checkmark' | 'call' };
  /** Hide "Skip this step" (e.g. on the last step). */
  noSkip?: boolean;
}

/** Shared layout for the first-run steps: progress, title, content, and a pinned Continue. */
export function OnboardingFrame({ step, title, subtitle, children, primary, noSkip }: OnboardingFrameProps) {
  const t = useTokens();
  const toast = useToast();
  const index = ONBOARDING_STEPS.indexOf(step);
  const total = ONBOARDING_STEPS.length - 1; // the welcome screen is step 0
  const next = nextStep(step);
  const goNext = () => (next ? router.push(stepHref(next) as never) : router.replace('/'));

  const later = () => {
    skipOnboarding()
      .then(() => router.replace('/'))
      .catch((e: unknown) => {
        console.warn("Couldn't remember that setup was skipped", e);
        toast.error("Couldn't save that. You may see setup again next time.");
        router.replace('/');
      });
  };

  return (
    <Screen
      topInset
      bottomInset
      footer={
        <View style={styles.footer}>
          <Button
            title={primary?.title ?? 'Continue'}
            icon={primary?.icon ?? 'arrow-forward'}
            size="lg"
            fullWidth
            loading={primary?.loading}
            disabled={primary?.disabled}
            onPress={primary?.onPress ?? goNext}
            testID="onboarding-next"
          />
          {!noSkip && next ? <Button title="Skip this step" variant="ghost" fullWidth onPress={goNext} /> : null}
        </View>
      }
      testID={`onboarding-${step}`}
    >
      <View style={styles.top}>
        {index > 0 ? (
          <View style={styles.progress} accessibilityLabel={`Step ${index} of ${total}`} accessible>
            {Array.from({ length: total }, (_, i) => (
              <View
                key={i}
                style={[styles.dash, { backgroundColor: i < index ? t.color.primary : t.color.surface3, borderRadius: t.radius.pill }]}
              />
            ))}
          </View>
        ) : (
          <View style={styles.flex} />
        )}
        <Button title="Set up later" variant="ghost" size="sm" onPress={later} />
      </View>
      <View style={styles.heading}>
        <Text variant="largeTitle">{title}</Text>
        {subtitle ? (
          <Text variant="body" color="text2">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {children}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  progress: { flex: 1, flexDirection: 'row', gap: 4 },
  dash: { flex: 1, height: 4 },
  heading: { gap: 8 },
  footer: { gap: 4 },
});
