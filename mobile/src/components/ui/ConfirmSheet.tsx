import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Text } from './Text';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  icon?: IconName;
}

export interface ConfirmSheetProps extends ConfirmOptions {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

/** A small sheet that asks before something can't be undone. */
export function ConfirmSheet({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  icon,
  busy,
  onConfirm,
  onCancel,
}: ConfirmSheetProps) {
  const t = useTokens();
  const tone = destructive
    ? { bg: t.color.dangerContainer, fg: t.color.onDangerContainer }
    : { bg: t.color.primaryContainer, fg: t.color.onPrimaryContainer };
  return (
    <BottomSheet visible={visible} onClose={onCancel} scroll={false}>
      <View style={styles.body}>
        <View style={[styles.badge, { backgroundColor: tone.bg }]}>
          <Icon name={icon ?? (destructive ? 'trash-outline' : 'help-circle-outline')} size={26} color={tone.fg} />
        </View>
        <Text variant="title2" align="center" accessibilityRole="header">
          {title}
        </Text>
        {message ? (
          <Text variant="body" color="text2" align="center">
            {message}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <Button
            title={confirmLabel}
            variant={destructive ? 'destructive' : 'filled'}
            onPress={onConfirm}
            loading={busy}
            fullWidth
            testID="confirm-sheet-confirm"
          />
          <Button title={cancelLabel} variant="ghost" onPress={onCancel} fullWidth testID="confirm-sheet-cancel" />
        </View>
      </View>
    </BottomSheet>
  );
}

type Ask = (o: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<Ask | null>(null);

/** `if (await confirm({ title: 'Delete voice?', destructive: true })) ...` */
export function useConfirm(): Ask {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm outside ConfirmProvider');
  return ctx;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const ask = useCallback<Ask>(
    (o) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false);
        resolver.current = resolve;
        setOptions(o);
      }),
    [],
  );

  const finish = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOptions(null);
  };

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <ConfirmSheet
        visible={!!options}
        title={options?.title ?? ''}
        message={options?.message}
        confirmLabel={options?.confirmLabel}
        cancelLabel={options?.cancelLabel}
        destructive={options?.destructive}
        icon={options?.icon}
        onConfirm={() => finish(true)}
        onCancel={() => finish(false)}
      />
    </ConfirmContext.Provider>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', gap: 10, paddingTop: 8 },
  badge: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  actions: { alignSelf: 'stretch', gap: 4, marginTop: 12 },
});
