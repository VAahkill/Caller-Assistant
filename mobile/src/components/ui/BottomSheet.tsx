import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTokens } from '../../lib/design/theme';
import { IconButton } from './IconButton';
import { Text } from './Text';

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  /** Pinned under the content, e.g. Save / Cancel buttons. */
  footer?: ReactNode;
  /** Wrap children in a ScrollView (default true). */
  scroll?: boolean;
  /** Fraction of the screen height the sheet may take. */
  maxHeight?: number;
  testID?: string;
}

/** Slides up from the bottom over a dimmed backdrop. Tap outside, swipe the
 *  handle down or press back to close. */
export function BottomSheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  footer,
  scroll = true,
  maxHeight = 0.88,
  testID,
}: BottomSheetProps) {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [progress] = useState(() => new Animated.Value(0));
  const [drag] = useState(() => new Animated.Value(0));
  const [mounted, setMounted] = useState(visible);
  // Mount as soon as the sheet opens (adjusting state while rendering, as React
  // recommends over an effect); unmount only after the closing animation.
  if (visible && !mounted) setMounted(true);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (visible) {
      drag.setValue(0);
      Animated.spring(progress, { toValue: 1, useNativeDriver: true, damping: 20, stiffness: 240, mass: 1 }).start();
    } else {
      Animated.timing(progress, { toValue: 0, duration: t.motion.exit, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, progress, drag, t.motion.exit]);

  // PanResponder runs these handlers only during a drag, never while rendering,
  // so reading closeRef in them is safe; the rule cannot see that.
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        if (g.dy > 100 || g.vy > 1.2) closeRef.current();
        else Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
      },
    }),
  );

  if (!mounted) return null;

  const translateY = Animated.add(
    progress.interpolate({ inputRange: [0, 1], outputRange: [height * 0.6, 0] }),
    drag,
  );

  const body = scroll ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingHorizontal: t.space.lg, paddingBottom: t.space.lg, gap: t.space.md }}
      style={styles.flexShrink}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flexShrink, { paddingHorizontal: t.space.lg, paddingBottom: t.space.lg }]}>{children}</View>
  );

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
      testID={testID}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.color.scrim, opacity: progress }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <KeyboardAvoidingView behavior="padding" style={styles.end} pointerEvents="box-none">
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              backgroundColor: t.color.surface,
              borderTopLeftRadius: t.radius.xl,
              borderTopRightRadius: t.radius.xl,
              maxHeight: height * maxHeight,
              paddingBottom: Math.max(insets.bottom, t.space.sm),
              transform: [{ translateY }],
            },
            t.elevation.level3,
          ]}
        >
          <View {...pan.panHandlers} style={styles.handleZone}>
            <View style={[styles.handle, { backgroundColor: t.color.borderStrong }]} />
          </View>
          {title ? (
            <View style={[styles.header, { paddingHorizontal: t.space.lg }]}>
              <View style={styles.flex}>
                <Text variant="title2" accessibilityRole="header">
                  {title}
                </Text>
                {subtitle ? (
                  <Text variant="subhead" color="text2">
                    {subtitle}
                  </Text>
                ) : null}
              </View>
              <IconButton icon="close" label="Close" onPress={onClose} variant="tonal" size={36} />
            </View>
          ) : null}
          {body}
          {footer ? (
            <View style={[styles.footer, { paddingHorizontal: t.space.lg, borderTopColor: t.color.border }]}>{footer}</View>
          ) : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  end: { flex: 1, justifyContent: 'flex-end' },
  sheet: { width: '100%', alignSelf: 'center', maxWidth: 640, overflow: Platform.OS === 'android' ? 'hidden' : 'visible' },
  handleZone: { alignItems: 'center', paddingTop: 10, paddingBottom: 6 },
  handle: { width: 40, height: 4, borderRadius: 2 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingBottom: 12, paddingTop: 4 },
  footer: { paddingTop: 12, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
  flex: { flex: 1, gap: 2 },
  flexShrink: { flexShrink: 1 },
});
