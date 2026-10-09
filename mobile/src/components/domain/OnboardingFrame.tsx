import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useServerConfig } from '../../hooks/useServerConfig';
import { Icon, type IconName } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { NEEDS_SERVER, ONBOARDING_STEPS, finishOnboarding, nextStep, stepHref, type OnboardingStep } from '../../lib/onboarding';
import { Banner } from '../ui/Banner';
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
  /** Shown above the title, e.g. the app's mark on the welcome screen. */
  art?: ReactNode;
}

/** Ends setup for good (finished or put off) and goes to `href`. */
export function useLeaveOnboarding() {
  const toast = useToast();
  return (href = '/', then?: () => void) => {
    const go = () => {
      router.replace(href as never);
      then?.();
    };
    finishOnboarding()
      .then(go)
      .catch((e: unknown) => {
        console.warn("Couldn't remember that setup is done", e);
        toast.error("Couldn't save that. You may see setup again next time.");
        go();
      });
  };
}

/** Shared layout for the first-run steps: progress, title, content, and a pinned Continue.
 *  Steps that save to the server explain what to do when it isn't connected yet. */
export function OnboardingFrame({ step, title, subtitle, children, primary, noSkip, secondary, art }: OnboardingFrameProps) {
  const t = useTokens();
  const server = useServerConfig();
  const leave = useLeaveOnboarding();
  const index = ONBOARDING_STEPS.indexOf(step);
  const total = ONBOARDING_STEPS.length - 1; // the welcome screen is step 0
  const next = nextStep(step);
  const goNext = () => (next ? router.push(stepHref(next) as never) : leave());
  const offline = NEEDS_SERVER.has(step) && server.loaded && !server.config;
  const main = offline ? { title: 'Continue' } : primary;

  return (
    <Screen
      topInset
      bottomInset
      footer={
        <View style={styles.footer}>
          <Button
            title={main?.title ?? 'Continue'}
            icon={main?.icon ?? 'arrow-forward'}
            size="lg"
            fullWidth
            loading={main?.loading}
            disabled={main?.disabled}
            onPress={main?.onPress ?? goNext}
            testID="onboarding-next"
          />
          {secondary ? (
            <Button title={secondary.title} variant="ghost" fullWidth onPress={secondary.onPress} />
          ) : !noSkip && next && !offline ? (
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
        {next ? <Button title="Set up later" variant="ghost" size="sm" onPress={() => leave()} /> : null}
      </View>
      {art}
      <View style={styles.heading}>
        <Text variant="largeTitle" accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="body" color="text2">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {offline ? (
        <Banner
          tone="warning"
          icon="cloud-offline-outline"
          title="Connect to your server first"
          message="This step saves to your server. Connect it now, or continue and set this up later in the Assistant tab."
          action={{ label: 'Connect', onPress: () => router.navigate(stepHref('connect') as never) }}
          testID="onboarding-offline"
        />
      ) : (
        children
      )}
    </Screen>
  );
}

/** The app's mark: the headset on the brand gradient, as on the app icon. */
export function BrandMark({ size = 72 }: { size?: number }) {
  const t = useTokens();
  return (
    <LinearGradient
      colors={[t.color.heroFrom, t.color.heroTo]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.mark, { width: size, height: size, borderRadius: size * 0.28 }]}
    >
      <Icon name="headset" size={size * 0.5} color={t.color.onHero} />
    </LinearGradient>
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
  mark: { alignItems: 'center', justifyContent: 'center' },
  footer: { gap: 4 },
});
