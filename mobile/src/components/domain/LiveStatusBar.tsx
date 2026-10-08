import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { haptic } from '../../lib/haptics';
import { languageName } from '../../lib/languages';
import { confidenceText, liveStatus, type LiveStatusInput, type StatusTone } from '../../lib/liveStatus';
import { TypingDots } from '../ui/TypingDots';
import { Text } from '../ui/Text';

export interface LiveStatusBarProps extends LiveStatusInput {
  /** The caller's language, from call_language. */
  language?: string;
  confidence?: number;
  ownerLanguage: string;
  /** Show caller lines in the owner's language (only offered when the languages differ). */
  translate: boolean;
  onTranslateChange?: (on: boolean) => void;
  /** Extra buttons at the right, e.g. mute. */
  trailing?: ReactNode;
  testID?: string;
}

/** The strip under the header of a live or practice call: what the assistant is
 *  doing right now, which language the caller speaks, and the translation toggle. */
export function LiveStatusBar({
  language,
  confidence = 0,
  ownerLanguage,
  translate,
  onTranslateChange,
  trailing,
  testID,
  ...input
}: LiveStatusBarProps) {
  const t = useTokens();
  const c = t.color;
  const s = liveStatus(input);
  const tone = toneColors(t, s.tone);
  const sure = confidenceText(confidence);
  const offerTranslation = !!language && language !== ownerLanguage && !!onTranslateChange;
  const [pulse] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (!s.busy) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.55, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [s.busy, pulse]);

  return (
    <View testID={testID} style={[styles.bar, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
      <Animated.View style={[styles.badge, { backgroundColor: tone.bg, opacity: pulse }]}>
        <Icon name={s.icon} size={18} color={tone.fg} />
      </Animated.View>
      <View style={styles.flex} accessible accessibilityRole="text" accessibilityLiveRegion="polite" accessibilityLabel={`${s.title}.${language ? ` Caller speaks ${languageName(language)}.` : ''}`}>
        <View style={styles.titleRow}>
          <Text variant="callout" weight="semibold" numberOfLines={1} style={styles.shrink} testID={testID ? `${testID}-title` : undefined}>
            {s.title}
          </Text>
          {s.busy ? <TypingDots color={tone.accent} size={5} /> : null}
        </View>
        <Text variant="caption" color="text2" numberOfLines={1}>
          {language ? `Caller speaks ${languageName(language)}${sure ? ` · ${sure}` : ''}` : 'Detecting the language…'}
        </Text>
      </View>
      {offerTranslation ? (
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel={`Show translations in ${languageName(ownerLanguage)}`}
          accessibilityState={{ checked: translate }}
          hitSlop={8}
          onPress={() => {
            haptic.tap();
            onTranslateChange?.(!translate);
          }}
          style={({ pressed }) => [
            styles.toggle,
            {
              backgroundColor: translate ? c.primaryContainer : 'transparent',
              borderColor: translate ? c.primaryContainer : c.borderStrong,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Icon name="language" size={15} color={translate ? c.onPrimaryContainer : c.text2} />
          <Text variant="caption" weight="semibold" color={translate ? c.onPrimaryContainer : c.text2}>
            {languageName(ownerLanguage)}
          </Text>
        </Pressable>
      ) : null}
      {trailing}
    </View>
  );
}

function toneColors(t: ReturnType<typeof useTokens>, tone: StatusTone) {
  const c = t.color;
  switch (tone) {
    case 'success':
      return { bg: c.successContainer, fg: c.onSuccessContainer, accent: c.success };
    case 'primary':
      return { bg: c.primaryContainer, fg: c.onPrimaryContainer, accent: c.primary };
    case 'info':
      return { bg: c.infoContainer, fg: c.onInfoContainer, accent: c.info };
    case 'warning':
      return { bg: c.warningContainer, fg: c.onWarningContainer, accent: c.warning };
    case 'danger':
      return { bg: c.dangerContainer, fg: c.onDangerContainer, accent: c.danger };
    default:
      return { bg: c.surface3, fg: c.text2, accent: c.text2 };
  }
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 60,
  },
  badge: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, gap: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shrink: { flexShrink: 1 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 32, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1 },
});
