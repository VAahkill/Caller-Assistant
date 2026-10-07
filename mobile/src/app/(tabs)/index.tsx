import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Body, Button, Card, Muted, Title } from '../../components/ui';
import { api, loadConfig } from '../../lib/api';
import { useLive } from '../../lib/live';
import { timeAgo, useTheme } from '../../lib/theme';
import type { CallerMessage, Profile } from '../../lib/types';

export default function Home() {
  const t = useTheme();
  const { connected, liveCalls, questions, alerts, version } = useLive();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [messages, setMessages] = useState<CallerMessage[]>([]);
  const [configured, setConfigured] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const cfg = await loadConfig();
    setConfigured(!!cfg);
    if (!cfg) return;
    try {
      const [p, m] = await Promise.all([api.profile(), api.messages()]);
      setProfile(p);
      setMessages(m.filter((x) => x.status === 'new').slice(0, 5));
    } catch {}
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load, version]),
  );

  async function toggle(field: 'enabled' | 'available', value: boolean) {
    setProfile((p) => (p ? { ...p, [field]: value } : p));
    await api.patchProfile({ [field]: value }).catch(() => load());
  }

  if (!configured) {
    return (
      <View style={{ padding: 16, gap: 12 }}>
        <Title>Welcome to OpenCall</Title>
        <Body>Connect the app to your OpenCall server to get started.</Body>
        <Button title="Open settings" onPress={() => router.push('/settings')} />
      </View>
    );
  }

  const calls = Object.values(liveCalls);
  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <Card>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Title>{profile?.enabled ? `${profile.assistant_name} is answering` : 'Assistant is off'}</Title>
            <Muted>{connected ? 'Connected to your server' : 'Reconnecting to your server…'}</Muted>
          </View>
          <Switch value={!!profile?.enabled} onValueChange={(v) => toggle('enabled', v)} />
        </View>
        <View style={styles.row}>
          <Body style={{ flex: 1 }}>I can answer questions on hold</Body>
          <Switch value={!!profile?.available} onValueChange={(v) => toggle('available', v)} />
        </View>
      </Card>

      {questions.map((q) => (
        <Pressable key={q.holdId} onPress={() => router.push(`/call/${q.callId}`)}>
          <Card style={{ backgroundColor: t.warn, borderColor: t.warn }}>
            <Text style={{ color: t.warnText, fontWeight: '700' }}>{q.who} is waiting for your answer</Text>
            <Text style={{ color: t.warnText, fontSize: 16 }}>{q.question}</Text>
            <Text style={{ color: t.warnText }}>Tap to answer</Text>
          </Card>
        </Pressable>
      ))}

      {calls.map((c) => (
        <Pressable key={c.id} onPress={() => router.push(`/call/${c.id}`)}>
          <Card>
            <Text style={{ color: t.ok, fontWeight: '700' }}>● LIVE {c.direction === 'outbound' ? '· calling for you' : ''}</Text>
            <Body style={{ fontWeight: '600' }}>{c.contact_name || c.number || 'Unknown caller'}</Body>
            <Muted>{c.transcript[c.transcript.length - 1]?.text ?? 'Connecting…'}</Muted>
          </Card>
        </Pressable>
      ))}

      {alerts.slice(0, 3).map((a) => (
        <Card key={a.at}>
          <Text style={{ color: t.danger, fontWeight: '700' }}>🔒 Security · {a.who}</Text>
          <Body>{a.text}</Body>
        </Card>
      ))}

      <Card>
        <Title>New messages</Title>
        {messages.length === 0 ? <Muted>No new messages.</Muted> : null}
        {messages.map((m) => (
          <Pressable key={m.id} onPress={() => router.push('/calls')} style={{ gap: 2, paddingVertical: 4 }}>
            <Body style={{ fontWeight: '600' }}>{m.caller_name || m.number}</Body>
            <Body>{m.text}</Body>
            <Muted>{timeAgo(m.created_at)}</Muted>
          </Pressable>
        ))}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
