import type { ReactNode } from 'react';
import { RefreshControl, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTokens } from '../../lib/design/theme';

export interface ScreenProps {
  children: ReactNode;
  /** Scrollable content (default). Lists that virtualise pass false. */
  scroll?: boolean;
  /** Tabs draw their own large title, so they need the status bar inset. */
  topInset?: boolean;
  /** Stack screens without a tab bar need the gesture bar inset. */
  bottomInset?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Pinned at the bottom, above the keyboard, e.g. a Save button. */
  footer?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Background, safe areas, keyboard-aware scrolling and pull-to-refresh. */
export function Screen({
  children,
  scroll = true,
  topInset = false,
  bottomInset = false,
  refreshing,
  onRefresh,
  footer,
  contentStyle,
  testID,
}: ScreenProps) {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const padTop = topInset ? insets.top + t.space.sm : t.space.lg;
  const padBottom = (bottomInset && !footer ? insets.bottom : 0) + t.space.x3;
  const content: StyleProp<ViewStyle> = [
    { paddingHorizontal: t.space.lg, paddingTop: padTop, paddingBottom: padBottom, gap: t.space.xl },
    contentStyle,
  ];
  return (
    <View style={[styles.flex, { backgroundColor: t.color.bg }]} testID={testID}>
      {scroll ? (
        <KeyboardAwareScrollView
          bottomOffset={24}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={content}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={!!refreshing}
                onRefresh={onRefresh}
                colors={[t.color.primary]}
                tintColor={t.color.primary}
                progressBackgroundColor={t.color.surface2}
                progressViewOffset={topInset ? insets.top : 0}
              />
            ) : undefined
          }
        >
          {children}
        </KeyboardAwareScrollView>
      ) : (
        <View style={[styles.flex, topInset ? { paddingTop: insets.top } : null]}>{children}</View>
      )}
      {footer ? (
        <KeyboardStickyView offset={{ opened: bottomInset ? insets.bottom : 0 }}>
          <View
            style={[
              styles.footer,
              {
                backgroundColor: t.color.bg,
                borderTopColor: t.color.border,
                paddingHorizontal: t.space.lg,
                paddingBottom: (bottomInset ? insets.bottom : 0) + t.space.md,
              },
            ]}
          >
            {footer}
          </View>
        </KeyboardStickyView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  footer: { paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 },
});
