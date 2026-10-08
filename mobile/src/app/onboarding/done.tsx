import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { OnboardingFrame } from '../../components/domain/OnboardingFrame';
import { Icon } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';

/** Finish: try a practice call, or go to Today. */
export default function DoneStep() {
  const t = useTokens();
  const practice = () => {
    router.replace('/');
    router.push('/practice');
  };
  return (
    <OnboardingFrame
      step="done"
      title="You're all set"
      subtitle="Try a practice call: you play a caller and hear exactly how your assistant answers. No phone line needed."
      primary={{ title: 'Start a practice call', icon: 'call', onPress: practice }}
      secondary={{ title: 'Go to Today', onPress: () => router.replace('/') }}
    >
      <View style={styles.center}>
        <View style={[styles.badge, { backgroundColor: t.color.successContainer }]}>
          <Icon name="checkmark" size={44} color={t.color.onSuccessContainer} />
        </View>
      </View>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', paddingVertical: 32 },
  badge: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
});
