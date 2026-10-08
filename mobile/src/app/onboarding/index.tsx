import { StyleSheet, View } from 'react-native';

import { OnboardingFrame } from '../../components/domain/OnboardingFrame';
import { Text } from '../../components/ui/Text';
import { Icon, type IconName } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';

const POINTS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'call-outline', title: "Answers when you can't", text: 'Talks to callers in English, Hindi, Telugu or Tamil, and takes messages.' },
  { icon: 'shield-checkmark-outline', title: 'Keeps you safe', text: 'Never shares OTPs, PINs or bank details, and warns you about scams.' },
  { icon: 'chatbubbles-outline', title: 'You stay in charge', text: 'Watch calls live, answer its questions, or step in yourself.' },
  { icon: 'home-outline', title: 'Free and private', text: 'Runs on your own computer. No paid services, no cloud.' },
];

/** Welcome: what OpenCall does, then into setup. */
export default function Welcome() {
  const t = useTokens();
  return (
    <OnboardingFrame step="index" title="Your own phone receptionist" subtitle="Set it up in a few minutes." primary={{ title: 'Get started' }} noSkip>
      <View style={styles.list}>
        {POINTS.map((p) => (
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
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  list: { gap: 20 },
  point: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  tile: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
});
