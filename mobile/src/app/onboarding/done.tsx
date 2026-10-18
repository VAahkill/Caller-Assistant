import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { OnboardingFrame, OnboardingPoints, useLeaveOnboarding, type OnboardingPoint } from '../../components/domain/OnboardingFrame';
import { Icon } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';

const POINTS: OnboardingPoint[] = [
  { icon: 'chatbubbles-outline', title: 'Play the caller', text: 'Type or speak, in any language your callers use. Try "I have a Swiggy order, where should I come?"' },
  { icon: 'eye-outline', title: 'Watch it think', text: 'See what it heard, the translation, and each reply as it speaks.' },
  { icon: 'hand-left-outline', title: 'Step in', text: 'Reply as yourself in your language; the caller hears it in theirs.' },
];

/** The last step: try a practice call (no phone line needed), or go to Today. */
export default function DoneStep() {
  const t = useTokens();
  const leave = useLeaveOnboarding();
  return (
    <OnboardingFrame
      step="done"
      title="You're all set"
      subtitle="Hear exactly how your assistant answers with a practice call. No phone line needed."
      art={
        <View style={[styles.badge, { backgroundColor: t.color.successContainer }]}>
          <Icon name="checkmark" size={36} color={t.color.onSuccessContainer} />
        </View>
      }
      primary={{ title: 'Start a practice call', icon: 'call', onPress: () => leave('/', () => router.push('/practice')) }}
      secondary={{ title: 'Go to Today', onPress: () => leave('/') }}
    >
      <OnboardingPoints points={POINTS} />
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  badge: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
});
