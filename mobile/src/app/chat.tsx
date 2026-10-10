import { router, Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { OutboxBubble } from '../components/domain/OutboxBubble';
import { Chip } from '../components/ui/Chip';
import { Composer } from '../components/ui/Composer';
import { HeaderRight } from '../components/ui/HeaderRight';
import { IconButton } from '../components/ui/IconButton';
import { Text } from '../components/ui/Text';
import { TypingDots } from '../components/ui/TypingDots';
import { errorMessage } from '../hooks/useAsyncAction';
import type { Recording } from '../hooks/useHoldToTalk';
import { useProfile } from '../hooks/useProfile';
import { api } from '../lib/api';
import { chatActionChip } from '../lib/chatActions';
import { Icon, type IconName } from '../lib/design';
import { useTokens } from '../lib/design/theme';
import { duration } from '../lib/format';
import { haptic } from '../lib/haptics';
import { useLive } from '../lib/live';
import type { ChatAction, ChatReply, ChatTurn } from '../lib/types';

interface Item {
  id: string;
  role: 'user' | 'assistant';
  /** Typed text, what was heard from a recording, or the reply. */
  content: string;
  kind: 'text' | 'voice';
  /** The owner's messages: on their way, in, or not sent. */
  state: 'sending' | 'sent' | 'failed';
  error?: string;
  seconds?: number;
  /** A recording, kept so a failed one can be sent again. */
  uri?: string;
  actions?: ChatAction[];
}

const EXAMPLES: { icon: IconName; text: string }[] = [
  { icon: 'call-outline', text: 'Who called while I was out?' },
  { icon: 'bicycle-outline', text: 'Tell couriers to leave parcels with the guard' },
  { icon: 'moon-outline', text: "I'm in a meeting until 3, take messages" },
  { icon: 'restaurant-outline', text: 'Call Paradise and book a table for 4 at 8' },
];

let seq = 0;
const newId = () => `chat-${Date.now().toString(36)}-${seq++}`;

/** Talk to your own assistant: ask what happened, give instructions, or have it
 *  call somewhere. Each message shows at once; a failed one keeps Retry. What the
 *  assistant changed shows as chips that open the place it changed. */
export default function Chat() {
  const t = useTokens();
  const live = useLive();
  const profile = useProfile();
  const name = profile.data?.assistant_name ?? 'your assistant';
  const [items, setItems] = useState<Item[]>([]);
  const scroll = useRef<ScrollView>(null);
  const sending = items.find((i) => i.state === 'sending');

  const update = (id: string, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const history = (): ChatTurn[] =>
    items
      .filter((i) => i.state === 'sent' && i.content)
      .slice(-10)
      .map(({ role, content }) => ({ role, content }));

  const deliver = async (item: Item, request: () => Promise<ChatReply & { heard?: string }>) => {
    try {
      const r = await request();
      setItems((list) => [
        ...list.map((i) => (i.id === item.id ? { ...i, state: 'sent' as const, content: r.heard ?? i.content, error: undefined } : i)),
        { id: newId(), role: 'assistant', kind: 'text', state: 'sent', content: r.reply, actions: r.actions },
      ]);
      if (r.actions.length) live.invalidate();
    } catch (e) {
      haptic.error();
      update(item.id, { state: 'failed', error: errorMessage(e) });
    }
  };

  const send = async (text: string) => {
    if (sending) return;
    const past = history();
    const item: Item = { id: newId(), role: 'user', kind: 'text', content: text, state: 'sending' };
    setItems((list) => [...list, item]);
    await deliver(item, () => api.chat(text, '', past));
  };

  const sendVoice = async (r: Recording) => {
    if (sending) return;
    const item: Item = { id: newId(), role: 'user', kind: 'voice', content: '', seconds: r.durationMs / 1000, uri: r.uri, state: 'sending' };
    setItems((list) => [...list, item]);
    await deliver(item, () => api.voiceChat(r.uri));
  };

  const retry = async (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item || sending) return;
    const past = history();
    update(id, { state: 'sending', error: undefined });
    await deliver(item, () => (item.kind === 'voice' && item.uri ? api.voiceChat(item.uri) : api.chat(item.content, '', past)));
  };

  const remove = (id: string) => setItems((list) => list.filter((i) => i.id !== id));

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.flex, { backgroundColor: t.color.bg }]}>
      <Stack.Screen
        options={{
          title: profile.data ? `Ask ${profile.data.assistant_name}` : 'Ask your assistant',
          headerRight: items.length
            ? () => (
                <HeaderRight>
                  <IconButton icon="create-outline" label="New chat" disabled={!!sending} onPress={() => setItems([])} />
                </HeaderRight>
              )
            : undefined,
        }}
      />
      <ScrollView
        ref={scroll}
        contentContainerStyle={[styles.list, { padding: t.space.lg }]}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
        testID="chat"
      >
        {items.length === 0 ? (
          <Welcome name={name} onPick={(text) => void send(text)} />
        ) : (
          items.map((i) =>
            i.role === 'user' && i.state !== 'sent' ? (
              <OutboxBubble
                key={i.id}
                item={{ id: i.id, speaker: 'user', kind: i.kind, text: i.content, lang: '', seconds: i.seconds, state: i.state, error: i.error, after: 0 }}
                label="You"
                assistantName={name}
                onRetry={(id) => void retry(id)}
                onRemove={remove}
              />
            ) : (
              <Bubble key={i.id} item={i} assistantName={profile.data?.assistant_name ?? 'Assistant'} />
            ),
          )
        )}
        {sending ? <Thinking text={sending.kind === 'voice' ? `${cap(name)} is listening to your recording…` : `${cap(name)} is thinking…`} /> : null}
      </ScrollView>
      <Composer
        testID="composer"
        placeholder={`Message ${name}`}
        hint={items.length === 0 ? 'Type, or hold the mic and speak.' : undefined}
        busy={!!sending}
        busyMessage={`Wait for ${name}'s reply first.`}
        onSend={send}
        onVoice={sendVoice}
      />
    </KeyboardAvoidingView>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Welcome({ name, onPick }: { name: string; onPick: (text: string) => void }) {
  const t = useTokens();
  const c = t.color;
  return (
    <View style={styles.welcome} testID="chat-welcome">
      <View style={[styles.badge, { backgroundColor: c.primaryContainer }]}>
        <Icon name="chatbubble-ellipses-outline" size={28} color={c.onPrimaryContainer} />
      </View>
      <Text variant="title2" align="center">
        What can {name} do for you?
      </Text>
      <Text variant="subhead" color="text2" align="center" style={styles.welcomeText}>
        Ask who called, change how calls are handled, or have it call a place for you.
      </Text>
      <View style={styles.examples}>
        {EXAMPLES.map((e) => (
          <Pressable
            key={e.text}
            onPress={() => {
              haptic.tap();
              onPick(e.text);
            }}
            accessibilityRole="button"
            accessibilityLabel={e.text}
            android_ripple={{ color: c.surface3 }}
            style={({ pressed }) => [
              styles.example,
              { backgroundColor: c.surface, borderColor: c.border, borderRadius: t.radius.lg, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Icon name={e.icon} size={20} color={c.primary} />
            <Text variant="callout" style={styles.flex}>
              {e.text}
            </Text>
            <Icon name="arrow-up-outline" size={16} color={c.text3} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Thinking({ text }: { text: string }) {
  const t = useTokens();
  return (
    <View style={styles.row} testID="chat-thinking" accessible accessibilityLabel={text} accessibilityLiveRegion="polite">
      <View style={[styles.thinking, { backgroundColor: t.color.bubbleAssistant, borderRadius: t.radius.lg, borderTopLeftRadius: 6 }]}>
        <TypingDots color={t.color.onPrimaryContainer} />
        <Text variant="footnote" color="text2" numberOfLines={1}>
          {text}
        </Text>
      </View>
    </View>
  );
}

function Bubble({ item, assistantName }: { item: Item; assistantName: string }) {
  const t = useTokens();
  const c = t.color;
  const mine = item.role === 'user';
  const chips = (item.actions ?? []).map(chatActionChip).filter((x) => x !== null);
  return (
    <View style={[styles.row, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
      <View style={[styles.column, { alignItems: mine ? 'flex-end' : 'flex-start' }]}>
        <View
          style={[
            styles.bubble,
            {
              backgroundColor: mine ? c.bubbleYou : c.bubbleAssistant,
              borderRadius: t.radius.lg,
              borderTopRightRadius: mine ? 6 : t.radius.lg,
              borderTopLeftRadius: mine ? t.radius.lg : 6,
            },
          ]}
        >
          {!mine ? (
            <Text variant="caption" weight="semibold" color="text2">
              {assistantName}
            </Text>
          ) : null}
          {item.kind === 'voice' ? (
            <View style={styles.voice}>
              <Icon name="mic" size={15} color={c.text2} />
              <Text variant="caption" color="text2">
                Voice message{item.seconds ? ` · ${duration(item.seconds)}` : ''}
              </Text>
            </View>
          ) : null}
          <Text variant="body" selectable>
            {item.kind === 'voice' ? `"${item.content}"` : item.content}
          </Text>
        </View>
        {chips.length ? (
          <View style={styles.chips} testID="chat-actions">
            {chips.map((chip, n) => (
              <Chip
                key={`${chip.label}-${n}`}
                label={chip.label}
                icon={chip.icon}
                kind="suggestion"
                disabled={!chip.href}
                onPress={chip.href ? () => router.push(chip.href!) : undefined}
              />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { gap: 12, flexGrow: 1 },
  row: { flexDirection: 'row' },
  column: { maxWidth: '86%', gap: 6 },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, gap: 2 },
  voice: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, maxWidth: '86%' },
  welcome: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 24 },
  badge: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  welcomeText: { maxWidth: 320 },
  examples: { alignSelf: 'stretch', gap: 10, marginTop: 14 },
  example: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', minHeight: 52 },
});
