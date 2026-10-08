import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { clockTime } from '../../lib/format';
import type { Away, Health } from '../../lib/types';
import { Switch } from '../ui/Switch';
import { Text } from '../ui/Text';

export interface StatusHeroProps {
  assistantName: string;
  enabled: boolean;
  onToggle: (on: boolean) => void;
  toggling?: boolean;
  away: Away | null;
  onAwayPress: () => void;
  connected: boolean;
  health: Health | null;
  liveCalls: number;
}

const PARTS: [keyof NonNullable<Health['ready']>, string][] = [
  ['stt', 'hearing'],
  ['llm', 'thinking'],
  ['tts', 'voice'],
  ['mt', 'translation'],
  ['lid', 'language detection'],
];

function readiness(connected: boolean, health: Health | null): { ok: boolean; text: string } {
  if (!connected) return { ok: false, text: 'Reconnecting to your server' };
  if (!health) return { ok: true, text: 'Connected to your server' };
  if (!health.ready) return { ok: true, text: 'Connected' };
  const missing = PARTS.filter(([k]) => !health.ready?.[k]).map(([, label]) => label);
  return missing.length
    ? { ok: false, text: `Getting ready: ${missing.join(', ')}` }
    : { ok: true, text: 'Connected · everything ready' };
}

/** Top of Today: is the assistant answering, is the owner away, is the server ready. */
export function StatusHero({ assistantName, enabled, onToggle, toggling, away, onAwayPress, connected, health, liveCalls }: StatusHeroProps) {
  const t = useTokens();
  const c = t.color;
  const ready = readiness(connected, health);
  const title = !enabled ? 'Assistant is off' : liveCalls ? `${assistantName} is on ${liveCalls === 1 ? 'a call' : `${liveCalls} calls`}` : `${assistantName} is answering`;
  return (
    <LinearGradient
      colors={[c.heroFrom, c.heroTo]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.hero, { borderRadius: t.radius.xl }]}
    >
      <View style={styles.row}>
        <View style={[styles.badge, { backgroundColor: c.onHeroOverlay }]}>
          <Icon name={enabled ? 'headset' : 'moon-outline'} size={22} color={c.onHero} />
        </View>
        <View style={styles.flex}>
          <Text variant="title2" color={c.onHero} numberOfLines={2}>
            {title}
          </Text>
          <Text variant="subhead" color={c.onHero2}>
            {enabled ? 'Calls are screened and answered for you.' : 'Calls ring through as usual.'}
          </Text>
        </View>
        <Switch value={enabled} onValueChange={onToggle} busy={toggling} accessibilityLabel="Assistant answers calls" />
      </View>
      <View style={styles.chips}>
        <Pressable
          onPress={onAwayPress}
          accessibilityRole="button"
          accessibilityLabel={away ? `Away: ${away.message}. Change` : 'Set an away status'}
          style={({ pressed }) => [styles.chip, { backgroundColor: c.onHeroOverlay, opacity: pressed ? 0.8 : 1 }]}
        >
          <Icon name={away ? 'moon' : 'moon-outline'} size={15} color={c.onHero} />
          <Text variant="footnote" weight="medium" color={c.onHero} numberOfLines={1}>
            {away ? `${away.message}${away.until && !/\buntil\b/i.test(away.message) ? ` · until ${clockTime(away.until)}` : ''}` : 'Set away'}
          </Text>
        </Pressable>
        <View style={[styles.chip, { backgroundColor: c.onHeroOverlay }]} accessibilityLabel={ready.text}>
          <View style={[styles.dot, { backgroundColor: ready.ok ? c.heroSuccess : c.heroWarning }]} />
          <Text variant="footnote" weight="medium" color={c.onHero} numberOfLines={1}>
            {ready.text}
          </Text>
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  hero: { padding: 20, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  badge: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, gap: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 999, maxWidth: '100%' },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
