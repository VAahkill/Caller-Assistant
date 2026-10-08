import { useEffect, useRef, useState } from 'react';
import { Linking, PanResponder, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useKeyboardState } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useHoldToTalk, type Recording } from '../../hooks/useHoldToTalk';
import { Icon, fonts } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { duration } from '../../lib/format';
import { Chip } from './Chip';
import { IconButton } from './IconButton';
import { Text } from './Text';
import { useToast } from './Toast';

export interface ComposerProps {
  onSend: (text: string) => void | Promise<void>;
  /** Enables the mic: hold to talk, release to send; a short tap locks recording on. */
  onVoice?: (r: Recording) => void | Promise<void>;
  placeholder?: string;
  /** Line above the box, e.g. "Reply in English, they'll hear Telugu". */
  hint?: string;
  /** Quick replies shown as chips. */
  suggestions?: string[];
  /** Sending is in flight: the send button shows a spinner and input waits. */
  busy?: boolean;
  disabled?: boolean;
  /** Why it is disabled, shown in place of the box. */
  disabledReason?: string;
  /** Pad for the gesture bar when the keyboard is closed (default true). */
  bottomInset?: boolean;
  testID?: string;
}

const CANCEL_DX = -80;
// A browser textarea starts two rows tall; Android starts at one and grows.
const WEB_ONE_ROW = Platform.OS === 'web' ? { rows: 1 } : null;

/** Bottom bar for chats and live calls: text with send, or hold-to-talk. */
export function Composer({
  onSend,
  onVoice,
  placeholder = 'Type a message',
  hint,
  suggestions,
  busy,
  disabled,
  disabledReason,
  bottomInset = true,
  testID,
}: ComposerProps) {
  const t = useTokens();
  const c = t.color;
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const keyboardOpen = useKeyboardState((s) => s.isVisible);
  const [text, setText] = useState('');
  const [locked, setLocked] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const pressStart = useRef(0);

  const talk = useHoldToTalk({
    onRecorded: (r) => {
      void onVoice?.(r);
    },
    onPermissionDenied: () =>
      toast.show({
        tone: 'error',
        message: 'Microphone access is off. Allow it in Settings to talk instead of typing.',
        action: { label: 'Settings', onPress: () => void Linking.openSettings() },
      }),
    onError: (m) => toast.error(m),
  });

  // Hold the mic: start on touch, send on release, slide left to cancel.
  // A quick tap locks recording on until Send or Cancel.
  const talkRef = useRef(talk);
  useEffect(() => {
    talkRef.current = talk;
  });
  // PanResponder runs these handlers only during a touch, never while rendering,
  // so reading talkRef in them is safe; the rule cannot see that.
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        pressStart.current = e.nativeEvent.timestamp;
        setCancelling(false);
        void talkRef.current.start();
      },
      onPanResponderMove: (_, g) => setCancelling(g.dx < CANCEL_DX),
      onPanResponderRelease: (e, g) => {
        const quick = e.nativeEvent.timestamp - pressStart.current < 350;
        if (quick && g.dx > CANCEL_DX) {
          setLocked(true);
          return;
        }
        setCancelling(false);
        void talkRef.current.stop(g.dx < CANCEL_DX);
      },
      onPanResponderTerminate: () => {
        setCancelling(false);
        void talkRef.current.stop(true);
      },
    }),
  );

  const send = async (value: string) => {
    const v = value.trim();
    if (!v || busy || disabled) return;
    setText('');
    await onSend(v);
  };

  const finishLocked = (cancel: boolean) => {
    setLocked(false);
    void talk.stop(cancel);
  };

  const recording = talk.recording || locked;
  const showSend = !!text.trim() || !onVoice;
  const padBottom = (bottomInset && !keyboardOpen ? insets.bottom : 0) + t.space.sm;

  return (
    <View
      testID={testID}
      style={[styles.wrap, { backgroundColor: c.surface, borderTopColor: c.border, paddingBottom: padBottom }]}
    >
      {suggestions?.length && !recording ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={styles.bleed}
          contentContainerStyle={styles.suggestions}
        >
          {suggestions.map((s) => (
            <Chip key={s} label={s} kind="suggestion" disabled={disabled || busy} onPress={() => void send(s)} />
          ))}
        </ScrollView>
      ) : null}
      {hint && !recording ? (
        <Text variant="caption" color="text2" style={styles.hint} numberOfLines={2}>
          {hint}
        </Text>
      ) : null}
      {disabled && disabledReason ? (
        <View style={[styles.disabled, { backgroundColor: c.surface2, borderRadius: t.radius.lg }]}>
          <Text variant="subhead" color="text2" align="center">
            {disabledReason}
          </Text>
        </View>
      ) : (
        <View style={styles.row}>
          {recording ? (
            <View
              key="recording"
              style={[styles.recording, { backgroundColor: cancelling ? c.dangerContainer : c.surface2, borderRadius: t.radius.xl }]}
              accessibilityLiveRegion="polite"
            >
              <View style={[styles.dot, { backgroundColor: c.danger, opacity: 0.4 + talk.level * 0.6 }]} />
              <Text variant="callout" tabular>
                {duration(talk.elapsedMs / 1000)}
              </Text>
              <View style={[styles.meter, { backgroundColor: c.surface3 }]}>
                <View style={[styles.meterFill, { width: `${Math.round(talk.level * 100)}%`, backgroundColor: c.primary }]} />
              </View>
              <Text variant="caption" color={cancelling ? 'onDangerContainer' : 'text2'} numberOfLines={1}>
                {locked ? 'Recording' : cancelling ? 'Release to cancel' : 'Slide left to cancel'}
              </Text>
            </View>
          ) : (
            <View key="input" style={[styles.inputBox, { backgroundColor: c.surface2, borderRadius: t.radius.xl, borderColor: c.border }]}>
              <TextInput
                testID={testID ? `${testID}-input` : 'composer-input'}
                value={text}
                onChangeText={setText}
                placeholder={placeholder}
                placeholderTextColor={c.text3}
                selectionColor={c.primary}
                cursorColor={c.primary}
                multiline
                {...WEB_ONE_ROW}
                editable={!disabled}
                accessibilityLabel={placeholder}
                onSubmitEditing={() => void send(text)}
                style={[styles.input, { color: c.text, fontFamily: fonts.regular }]}
              />
            </View>
          )}
          {locked ? (
            <View key="locked" style={styles.lockedActions}>
              <IconButton icon="trash-outline" label="Cancel recording" variant="tonal" size={44} onPress={() => finishLocked(true)} />
              <IconButton icon="send" label="Send recording" variant="filled" size={44} onPress={() => finishLocked(false)} />
            </View>
          ) : showSend ? (
            <IconButton
              key="send"
              testID={testID ? `${testID}-send` : 'composer-send'}
              icon="arrow-up"
              label="Send"
              variant="filled"
              size={44}
              loading={busy}
              disabled={!text.trim() || disabled}
              onPress={() => void send(text)}
            />
          ) : (
            // Stays mounted while recording so the hold gesture isn't interrupted.
            <View
              key="mic"
              {...pan.panHandlers}
              testID={testID ? `${testID}-mic` : 'composer-mic'}
              accessible
              accessibilityRole="button"
              accessibilityLabel="Hold to talk"
              accessibilityHint="Hold to record, release to send. Tap once to record hands-free."
              accessibilityActions={[{ name: 'activate', label: 'Record hands-free' }]}
              onAccessibilityAction={() => {
                setLocked(true);
                void talk.start();
              }}
              style={[
                styles.mic,
                talk.recording && styles.micHeld,
                { backgroundColor: talk.recording ? c.danger : c.primaryContainer },
              ]}
            >
              <Icon name="mic" size={22} color={talk.recording ? c.onPrimary : c.onPrimaryContainer} />
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, paddingHorizontal: 12, gap: 8 },
  // Chips scroll edge to edge instead of being cut off at the padding.
  bleed: { marginHorizontal: -12 },
  suggestions: { gap: 8, paddingHorizontal: 12 },
  hint: { paddingHorizontal: 4 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  inputBox: { flex: 1, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center' },
  input: { fontSize: 16, maxHeight: 120, paddingVertical: 10, minHeight: 44, outlineWidth: 0 },
  mic: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  micHeld: { transform: [{ scale: 1.15 }] },
  lockedActions: { flexDirection: 'row', gap: 8 },
  recording: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  meter: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  meterFill: { height: 4, borderRadius: 2 },
  disabled: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', padding: 12 },
});
