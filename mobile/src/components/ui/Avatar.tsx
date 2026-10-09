import { StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { accentFor } from '../../lib/design/tokens';
import { Text } from './Text';

// Indic scripts (Devanagari to Sinhala): a letter carries its vowel signs.
const INDIC = /^[\u0900-\u0DFF]/;
// Virama/halant, which joins a consonant to the next one (Devanagari .. Malayalam).
const VIRAMA = /[\u094D\u09CD\u0A4D\u0ACD\u0B4D\u0BCD\u0C4D\u0CCD\u0D4D]/;

/** The first letter as it is written: "వెం" from వెంకట, with its vowel signs,
 *  and a bare "శ" from శ్రీను rather than a dangling halant. */
function firstLetter(word: string): string {
  const chars = [...word];
  let out = chars[0] ?? '';
  for (const ch of chars.slice(1)) {
    if (!/\p{M}/u.test(ch) || VIRAMA.test(ch)) break;
    out += ch;
  }
  return out;
}

export function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '';
  if (/^\+?\d/.test(words[0])) return '';
  // Two Indic letters read as a word ("వన"), so Indic names get one.
  if (INDIC.test(words[0])) return firstLetter(words[0]);
  const first = [...words[0]][0] ?? '';
  const last = words.length > 1 ? ([...words[words.length - 1]][0] ?? '') : '';
  return (first + last).toUpperCase();
}

export interface AvatarProps {
  /** Contact name, or a number when there is no name. */
  name: string;
  size?: number;
  /** Shown instead of initials, e.g. 'bicycle-outline' for delivery. */
  icon?: IconName;
  /** A small ring for VIP callers. */
  ring?: boolean;
}

export function Avatar({ name, size = 40, icon, ring }: AvatarProps) {
  const t = useTokens();
  const accent = accentFor(t, name || '?');
  const text = icon ? '' : initials(name);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: accent.bg,
          borderWidth: ring ? 2 : 0,
          borderColor: t.color.warning,
        },
      ]}
    >
      {text ? (
        <Text variant={size >= 48 ? 'headline' : 'footnote'} weight="semibold" color={accent.fg} maxFontSizeMultiplier={1.2}>
          {text}
        </Text>
      ) : (
        <Icon name={icon ?? 'person'} size={Math.round(size * 0.48)} color={accent.fg} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
});
