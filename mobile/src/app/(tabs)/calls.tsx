import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Switch, View } from 'react-native';

import { Body, Button, Card, Chip, Input, Muted } from '../../components/ui';
import { api } from '../../lib/api';
import { useLive } from '../../lib/live';
import { timeAgo } from '../../lib/theme';
import type { CallRecord, CallerMessage } from '../../lib/types';

export default function Calls() {
  const { version } = useLive();
  const [tab, setTab] = useState<'messages' | 'calls'>('messages');
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [messages, setMessages] = useState<CallerMessage[]>([]);

  const load = useCallback(() => {
    api.calls().then(setCalls).catch(() => {});
    api.messages().then(setMessages).catch(() => {});
  }, []);
  useFocusEffect(useCallback(() => load(), [load, version]));

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.tabs}>
        <Chip label="Messages" active={tab === 'messages'} onPress={() => setTab('messages')} />
        <Chip label="All calls" active={tab === 'calls'} onPress={() => setTab('calls')} />
      </View>
      {tab === 'messages' ? (
        <FlatList
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          ListEmptyComponent={<Muted>Messages callers leave for you show up here.</Muted>}
          renderItem={({ item }) => <MessageCard msg={item} onChange={load} />}
        />
      ) : (
        <FlatList
          data={calls}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          renderItem={({ item }) => (
            <Pressable onPress={() => item.status !== 'rejected' && router.push(`/call/${item.id}`)}>
              <Card>
                <Body style={{ fontWeight: '600' }}>
                  {item.direction === 'outbound' ? '↗ ' : '↙ '}
                  {item.contact_name || item.number || 'Unknown'}
                </Body>
                <Muted>
                  {item.status === 'rejected' ? `Blocked: ${item.reject_reason}` : item.summary || item.category} ·{' '}
                  {timeAgo(item.started_at)}
                </Muted>
              </Card>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

function MessageCard({ msg, onChange }: { msg: CallerMessage; onChange: () => void }) {
  const [reply, setReply] = useState('');
  const [callBack, setCallBack] = useState(true);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    await api.replyMessage(msg.id, reply, callBack).catch(() => {});
    setBusy(false);
    onChange();
  }

  return (
    <Card>
      <Pressable onPress={() => router.push(`/call/${msg.call_id}`)}>
        <Body style={{ fontWeight: '600' }}>{msg.caller_name || msg.number}</Body>
        <Body>{msg.text}</Body>
        <Muted>{timeAgo(msg.created_at)} · tap for transcript and recording</Muted>
      </Pressable>
      {msg.status === 'replied' ? (
        <Muted>You replied: {msg.reply}{msg.callback_task_id ? ' (the assistant is calling them back)' : ''}</Muted>
      ) : (
        <>
          <Input value={reply} onChangeText={setReply} placeholder="Reply for the assistant to pass on" />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Switch value={callBack} onValueChange={setCallBack} />
            <Body style={{ flex: 1 }}>Call them back and tell them</Body>
          </View>
          <Button title="Send reply" onPress={send} disabled={!reply.trim() || busy} />
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
});
