import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { cardColors, type CardTone } from './Card';
import { Text } from './Text';

export type PillTone = Exclude<CardTone, 'default'> | 'neutral';

export interface StatusPillProps {
  label: string;
  tone?: PillTone;
  icon?: IconName;
  /** A dot before the label; `pulse` animates it (e.g. Live). */
  dot?: boolean;
  pulse?: boolean;
  testID?: string;
}

/** Live, On hold, Blocked, Spam, Delivery, Contact, language tags. */
export function StatusPill({ label, tone = 'neutral', icon, dot, pulse, testID }: StatusPillProps) {
  const t = useTokens();
  const colors = tone === 'neutral' ? { bg: t.color.surface3, fg: t.color.text, accent: t.color.text2 } : cardColors(t, tone);
  const [blink] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!pulse) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0.25, duration: 650, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, blink]);
  return (
    <View testID={testID} style={[styles.pill, { backgroundColor: colors.bg, borderRadius: t.radius.pill }]}>
      {dot ? <Animated.View style={[styles.dot, { backgroundColor: colors.accent, opacity: blink }]} /> : null}
      {icon ? <Icon name={icon} size={13} color={colors.fg} /> : null}
      <Text variant="caption" weight="semibold" color={colors.fg} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, height: 24, alignSelf: 'flex-start' },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
