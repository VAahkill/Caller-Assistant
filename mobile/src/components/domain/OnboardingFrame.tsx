import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '../../lib/design';
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
  /** A quieter second action under the main button, in place of "Skip this step". */
  secondary?: { title: string; onPress: () => void };
}

/** Shared layout for the first-run steps: progress, title, content, and a pinned Continue. */
export function OnboardingFrame({ step, title, subtitle, children, primary, noSkip, secondary }: OnboardingFrameProps) {
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
          {secondary ? (
            <Button title={secondary.title} variant="ghost" fullWidth onPress={secondary.onPress} />
          ) : !noSkip && next ? (
            <Button title="Skip this step" variant="ghost" fullWidth onPress={goNext} />
          ) : null}
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
        {next ? <Button title="Set up later" variant="ghost" size="sm" onPress={later} /> : null}
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

export interface OnboardingPoint {
  icon: IconName;
  title: string;
  text: string;
}

/** A short list of what a step gives you, each with an icon tile. */
export function OnboardingPoints({ points }: { points: OnboardingPoint[] }) {
  const t = useTokens();
  return (
    <View style={styles.points}>
      {points.map((p) => (
        <View key={p.title} style={styles.point}>
          <View style={[styles.tile, { backgroundColor: t.color.primaryContainer, borderRadius: t.radius.md }]}>
            <Icon name={p.icon} size={22} color={t.color.onPrimaryContainer} />
          </View>
          <View style={styles.flex}>
            <Text variant="headline">{p.title}</Text>
            <Text variant="subhead" color="text2">
              {p.text}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  points: { gap: 20 },
  point: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  tile: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  // Same height with or without "Set up later", so titles line up across steps.
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 36 },
  progress: { flex: 1, flexDirection: 'row', gap: 4 },
  dash: { flex: 1, height: 4 },
  heading: { gap: 8 },
  footer: { gap: 4 },
});
