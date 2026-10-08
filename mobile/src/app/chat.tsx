import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { Composer } from '../components/ui/Composer';
import { EmptyState } from '../components/ui/EmptyState';
import { Text } from '../components/ui/Text';
import { errorMessage } from '../hooks/useAsyncAction';
import type { Recording } from '../hooks/useHoldToTalk';
import { api } from '../lib/api';
import { useTokens } from '../lib/design/theme';
import type { ChatTurn } from '../lib/types';

interface Msg extends ChatTurn {
  id: number;
  failed?: boolean;
}

const EXAMPLES = [
  'Who called while I was out?',
  'Tell couriers to leave parcels with the guard',
  "I'm in a meeting until 3, take messages",
  'Call Paradise and book a table for 4 at 8',
];

/** Talk to your own assistant: ask what happened, give instructions, or have it call somewhere. */
export default function Chat() {
  const t = useTokens();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const scroll = useRef<ScrollView>(null);

  const add = (m: Omit<Msg, 'id'>) => setMsgs((list) => [...list, { ...m, id: seq.current++ }]);

  const send = async (text: string) => {
    const history: ChatTurn[] = msgs.filter((m) => !m.failed).slice(-10).map(({ role, content }) => ({ role, content }));
    add({ role: 'user', content: text });
    setBusy(true);
    try {
      const r = await api.chat(text, '', history);
      add({ role: 'assistant', content: r.reply });
    } catch (e) {
      add({ role: 'assistant', content: `That didn't go through. ${errorMessage(e)}`, failed: true });
    } finally {
      setBusy(false);
    }
  };

  const voice = async (r: Recording) => {
    setBusy(true);
    try {
      const reply = await api.voiceChat(r.uri);
      add({ role: 'user', content: reply.heard });
      add({ role: 'assistant', content: reply.reply });
    } catch (e) {
      add({ role: 'assistant', content: `I couldn't use that recording. ${errorMessage(e)}`, failed: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.flex, { backgroundColor: t.color.bg }]}>
      <ScrollView
        ref={scroll}
        contentContainerStyle={[styles.list, { padding: t.space.lg }]}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
      >
        {msgs.length === 0 ? (
          <EmptyState
            icon="chatbubble-ellipses-outline"
            title="Ask your assistant"
            message="Ask who called, change how calls are handled, or have it call a place for you. Type, or hold the mic and speak."
          />
        ) : (
          msgs.map((m) => <Bubble key={m.id} msg={m} />)
        )}
        {busy ? (
          <Text variant="footnote" color="text2" accessibilityLiveRegion="polite">
            Your assistant is thinking…
          </Text>
        ) : null}
      </ScrollView>
      <Composer
        placeholder="Message your assistant"
        suggestions={msgs.length === 0 ? EXAMPLES : undefined}
        busy={busy}
        onSend={send}
        onVoice={voice}
      />
    </KeyboardAvoidingView>
  );
}

function Bubble({ msg }: { msg: Msg }) {
  const t = useTokens();
  const mine = msg.role === 'user';
  return (
    <View style={[styles.row, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: msg.failed ? t.color.dangerContainer : mine ? t.color.bubbleYou : t.color.bubbleAssistant,
            borderRadius: t.radius.lg,
            borderTopRightRadius: mine ? 6 : t.radius.lg,
            borderTopLeftRadius: mine ? t.radius.lg : 6,
          },
        ]}
      >
        <Text variant="body" color={msg.failed ? 'onDangerContainer' : 'text'} selectable>
          {msg.content}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { gap: 10, flexGrow: 1 },
  row: { flexDirection: 'row' },
  bubble: { maxWidth: '86%', paddingHorizontal: 14, paddingVertical: 10 },
});
