import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { haptic } from '../../lib/haptics';
import { Text } from './Text';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastOptions {
  message: string;
  tone?: ToastTone;
  /** e.g. { label: 'Undo', onPress } */
  action?: { label: string; onPress: () => void };
  duration?: number;
}

interface ToastItem extends Required<Pick<ToastOptions, 'message' | 'tone'>> {
  id: number;
  action?: ToastOptions['action'];
  duration: number;
}

export interface ToastApi {
  show: (o: ToastOptions) => number;
  success: (message: string) => number;
  error: (message: string) => number;
  info: (message: string) => number;
  /** Shows "<message> · Undo"; onUndo runs if tapped before the toast goes. */
  undo: (message: string, onUndo: () => void) => number;
  dismiss: (id?: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx;
}

const ICON: Record<ToastTone, IconName> = {
  success: 'checkmark-circle',
  error: 'alert-circle',
  info: 'information-circle',
};

// Height of the bottom tab bar the toast must clear (see (tabs)/_layout.tsx).
export const TAB_BAR_HEIGHT = 64;

/** Snackbar host. One toast at a time; a new one replaces the old.
 *  `bottomOffset` lifts it above the tab bar when one is showing. */
export function ToastProvider({ children, bottomOffset }: { children: ReactNode; bottomOffset?: number }) {
  const [current, setCurrent] = useState<ToastItem | null>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback((id?: number) => {
    setCurrent((c) => (id === undefined || c?.id === id ? null : c));
  }, []);

  const show = useCallback(
    (o: ToastOptions) => {
      const id = ++seq.current;
      const tone = o.tone ?? 'info';
      const item: ToastItem = {
        id,
        message: o.message,
        tone,
        action: o.action,
        duration: o.duration ?? (o.action ? 6000 : 4000),
      };
      setCurrent(item);
      if (tone === 'error') haptic.error();
      else if (tone === 'success') haptic.success();
      AccessibilityInfo.announceForAccessibility(o.message);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => dismiss(id), item.duration);
      return id;
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      dismiss,
      success: (message) => show({ message, tone: 'success' }),
      error: (message) => show({ message, tone: 'error' }),
      info: (message) => show({ message, tone: 'info' }),
      undo: (message, onUndo) => show({ message, tone: 'info', action: { label: 'Undo', onPress: onUndo } }),
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastHost item={current} onDismiss={dismiss} bottomOffset={bottomOffset} />
    </ToastContext.Provider>
  );
}

function ToastHost({
  item,
  onDismiss,
  bottomOffset,
}: {
  item: ToastItem | null;
  onDismiss: (id?: number) => void;
  bottomOffset?: number;
}) {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const [anim] = useState(() => new Animated.Value(0));
  // Keeps showing the last toast while it animates out.
  const [shown, setShown] = useState<ToastItem | null>(item);
  if (item && item !== shown) setShown(item);

  useEffect(() => {
    if (item) {
      Animated.spring(anim, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 220, mass: 1 }).start();
    } else {
      Animated.timing(anim, { toValue: 0, duration: t.motion.exit, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setShown(null);
      });
    }
  }, [item, anim, t.motion.exit]);

  if (!shown) return null;
  const bottom = (bottomOffset ?? 0) + insets.bottom + t.space.md;
  const iconColor =
    shown.tone === 'error' ? t.color.inverseDanger : shown.tone === 'success' ? t.color.inverseSuccess : t.color.inversePrimary;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          bottom,
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
        },
      ]}
    >
      <View
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        testID="toast"
        style={[styles.toast, { backgroundColor: t.color.inverseSurface, borderRadius: t.radius.md }, t.elevation.level3]}
      >
        <Icon name={ICON[shown.tone]} size={20} color={iconColor} />
        <Text variant="subhead" color={t.color.inverseText} style={styles.message} numberOfLines={3}>
          {shown.message}
        </Text>
        {shown.action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={shown.action.label}
            hitSlop={12}
            onPress={() => {
              haptic.tap();
              shown.action?.onPress();
              onDismiss(shown.id);
            }}
            style={({ pressed }) => [styles.action, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text variant="button" color={t.color.inversePrimary}>
              {shown.action.label}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            hitSlop={12}
            onPress={() => onDismiss(shown.id)}
            style={styles.action}
          >
            <Icon name="close" size={18} color={t.color.inverseText} />
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 12,
    minHeight: 52,
    width: '100%',
    maxWidth: 560,
  },
  message: { flex: 1 },
  action: { minHeight: 36, minWidth: 36, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
});
