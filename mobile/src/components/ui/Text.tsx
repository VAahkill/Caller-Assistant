import { Children, type ReactNode } from 'react';
import { Text as RNText, type StyleProp, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { INDIC_LINE_HEIGHT, fonts, textStyle, type FontWeightName, type TextVariant, type Palette } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { hasIndicScript } from '../../lib/script';

export type TextColor = keyof Palette;

export interface TextProps extends Omit<RNTextProps, 'style'> {
  variant?: TextVariant;
  /** A palette key (preferred) or a raw colour. */
  color?: TextColor | (string & {});
  weight?: FontWeightName;
  align?: TextStyle['textAlign'];
  /** Fixed-width digits for times, durations and counts. */
  tabular?: boolean;
  style?: StyleProp<TextStyle>;
  children?: ReactNode;
}

function plainText(children: ReactNode): string {
  let out = '';
  Children.forEach(children, (c) => {
    if (typeof c === 'string' || typeof c === 'number') out += String(c);
  });
  return out;
}

/** The only text primitive in the app. Inter for Latin; Indic scripts fall back
 *  to the system Noto fonts and get taller lines so vowel signs aren't clipped. */
export function Text({
  variant = 'body',
  color = 'text',
  weight,
  align,
  tabular,
  style,
  children,
  maxFontSizeMultiplier = 1.6,
  ...rest
}: TextProps) {
  const t = useTokens();
  const base = textStyle(variant);
  const resolved = color in t.color ? t.color[color as TextColor] : color;
  const indic = hasIndicScript(plainText(children));
  const lineHeight = indic
    ? Math.max(base.lineHeight ?? 0, Math.round((base.fontSize ?? 16) * INDIC_LINE_HEIGHT))
    : base.lineHeight;
  return (
    <RNText
      {...rest}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[
        base,
        { color: resolved, lineHeight },
        weight ? { fontFamily: fonts[weight] } : null,
        align ? { textAlign: align } : null,
        tabular ? { fontVariant: ['tabular-nums'] } : null,
        style,
      ]}
    >
      {children}
    </RNText>
  );
}
