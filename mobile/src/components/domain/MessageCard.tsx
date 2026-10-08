import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { useAsyncAction } from '../../hooks/useAsyncAction';
import { api } from '../../lib/api';
import { prettyNumber, timeAgo } from '../../lib/format';
import { categoryOf } from '../../lib/labels';
import type { CallSummary, CallerMessage } from '../../lib/types';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { StatusPill } from '../ui/StatusPill';
import { Switch } from '../ui/Switch';
import { Text } from '../ui/Text';
import { TextField } from '../ui/TextField';
import { useToast } from '../ui/Toast';

export interface MessageCardProps {
  message: CallerMessage;
  /** The call it was left on, for its category and urgency. */
  call?: CallSummary;
  onOpen?: () => void;
  onChanged?: (m: CallerMessage) => void;
  testID?: string;
}

const digits = (n: string) => n.replace(/[^\d]/g, '');

/** A message a caller left: read it, reply through the assistant, call or WhatsApp back. */
export function MessageCard({ message: m, call, onOpen, onChanged, testID }: MessageCardProps) {
  const toast = useToast();
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState('');
  const [callBack, setCallBack] = useState(true);
  const name = m.caller_name || prettyNumber(m.number);

  const reply = useAsyncAction(() => api.replyMessage(m.id, text.trim(), callBack), {
    success: callBack ? `Your assistant will call ${name} back with your reply.` : 'Reply saved.',
  });

  const open = async (url: string, what: string) => {
    try {
      await Linking.openURL(url);
    } catch (e) {
      console.warn(`Couldn't open ${what}`, e);
      toast.error(`Couldn't open ${what} on this phone.`);
    }
  };

  const send = async () => {
    const updated = await reply.run();
    if (updated) {
      setReplying(false);
      setText('');
      onChanged?.(updated);
    }
  };

  return (
    <Card onPress={onOpen} testID={testID} accessibilityLabel={`Message from ${name}: ${m.text}`}>
      <View style={styles.head}>
        <Avatar name={m.caller_name || m.number} size={36} />
        <View style={styles.flex}>
          <Text variant="headline" numberOfLines={1}>
            {name}
          </Text>
          <Text variant="footnote" color="text2" numberOfLines={1}>
            {timeAgo(m.created_at)}
            {call && call.category !== 'unknown' ? ` · ${categoryOf(call.category).label}` : ''}
            {call?.urgent ? (
              <Text variant="footnote" weight="semibold" color="danger">
                {' · Urgent'}
              </Text>
            ) : null}
          </Text>
        </View>
        {m.status === 'new' ? <StatusPill label="New" tone="primary" dot /> : null}
        {m.status === 'replied' ? <StatusPill label="Replied" tone="success" icon="checkmark" /> : null}
      </View>
      <Text variant="body">{m.text}</Text>
      {m.status === 'replied' && m.reply ? (
        <Text variant="subhead" color="text2">
          You replied: {m.reply}
          {m.callback_task_id ? ' (your assistant is calling them back)' : ''}
        </Text>
      ) : null}
      {replying ? (
        <View style={styles.reply}>
          <TextField
            label="Reply for your assistant to pass on"
            value={text}
            onChangeText={setText}
            multiline
            autoFocus
            error={reply.error}
          />
          <View style={styles.switchRow}>
            <Text variant="callout" style={styles.flex}>
              Call them back and tell them
            </Text>
            <Switch value={callBack} onValueChange={setCallBack} accessibilityLabel="Call them back and tell them" />
          </View>
          <View style={styles.actions}>
            <Button title="Cancel" variant="ghost" size="sm" onPress={() => setReplying(false)} />
            <Button title="Send reply" size="sm" icon="send" loading={reply.busy} disabled={!text.trim()} onPress={() => void send()} />
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
          {m.status !== 'replied' ? <Button title="Reply" variant="tonal" size="sm" icon="chatbubble-outline" onPress={() => setReplying(true)} /> : null}
          <Button title="Call" variant="tonal" size="sm" icon="call-outline" onPress={() => void open(`tel:${m.number}`, 'the dialler')} />
          <Button title="WhatsApp" variant="tonal" size="sm" icon="logo-whatsapp" onPress={() => void open(`https://wa.me/${digits(m.number)}`, 'WhatsApp')} />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  reply: { gap: 12 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-start' },
});
