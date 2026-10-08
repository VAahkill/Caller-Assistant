import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { CallRow } from '../../components/domain/CallRow';
import { MessageCard } from '../../components/domain/MessageCard';
import { AsyncContent } from '../../components/ui/AsyncContent';
import { Chip } from '../../components/ui/Chip';
import { LargeHeader } from '../../components/ui/LargeHeader';
import { Screen } from '../../components/ui/Screen';
import { Section } from '../../components/ui/Section';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { TextField } from '../../components/ui/TextField';
import { useResource } from '../../hooks/useResource';
import { api } from '../../lib/api';
import { useLive } from '../../lib/live';
import type { CallSummary, CallerMessage } from '../../lib/types';

type Tab = 'messages' | 'calls';
type Filter = 'all' | 'contacts' | 'unknown' | 'delivery' | 'spam' | 'blocked';

const FILTERS: { value: Filter; label: string; test: (c: CallSummary) => boolean }[] = [
  { value: 'all', label: 'All', test: () => true },
  { value: 'contacts', label: 'Contacts', test: (c) => !!c.contact_name && c.category !== 'spam' },
  { value: 'unknown', label: 'Unknown', test: (c) => !c.contact_name && !['spam', 'delivery'].includes(c.category) && c.status !== 'rejected' },
  { value: 'delivery', label: 'Delivery', test: (c) => c.category === 'delivery' },
  { value: 'spam', label: 'Spam', test: (c) => c.category === 'spam' },
  { value: 'blocked', label: 'Blocked', test: (c) => c.status === 'rejected' },
];

const matches = (q: string, ...fields: string[]) => !q || fields.some((f) => f.toLowerCase().includes(q));

/** Inbox: messages callers left, and every call with its summary. */
export default function Inbox() {
  const { refreshKey, calls: liveCalls } = useLive();
  const [tab, setTab] = useState<Tab>('messages');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const messages = useResource(() => api.messages(), refreshKey);
  const calls = useResource(() => api.calls(), refreshKey);
  const q = query.trim().toLowerCase();

  const shownMessages = useMemo(
    () => (messages.data ?? []).filter((m) => matches(q, m.caller_name, m.number, m.text)),
    [messages.data, q],
  );
  const shownCalls = useMemo(() => {
    const test = FILTERS.find((f) => f.value === filter)!.test;
    return (calls.data ?? []).filter((c) => test(c) && matches(q, c.contact_name, c.number, c.summary, c.message));
  }, [calls.data, filter, q]);
  const unread = (messages.data ?? []).filter((m) => m.status === 'new').length;

  const openMessage = (m: CallerMessage) => {
    if (m.status === 'new') {
      messages.mutate((list) => list?.map((x) => (x.id === m.id ? { ...x, status: 'read' } : x)));
      api.markRead(m.id).catch((e: unknown) => console.warn("Couldn't mark the message read", e));
    }
    router.push(`/call/${m.call_id}`);
  };

  const active = tab === 'messages' ? messages : calls;
  return (
    <Screen topInset refreshing={active.refreshing} onRefresh={() => void active.refresh()} testID="inbox">
      <LargeHeader title="Inbox" subtitle={unread ? `${unread} new ${unread === 1 ? 'message' : 'messages'}` : undefined} />
      <SegmentedControl<Tab>
        accessibilityLabel="Show"
        value={tab}
        onChange={setTab}
        segments={[
          { value: 'messages', label: 'Messages', badge: unread || undefined },
          { value: 'calls', label: 'Calls' },
        ]}
      />
      <TextField
        label="Search"
        icon="search-outline"
        value={query}
        onChangeText={setQuery}
        placeholder={tab === 'messages' ? 'Name, number or words' : 'Name, number or summary'}
        clearable
        returnKeyType="search"
        autoCorrect={false}
      />

      {tab === 'messages' ? (
        <AsyncContent
          data={messages.data}
          loading={messages.loading}
          error={messages.error}
          onRetry={() => void messages.reload()}
          isEmpty={() => shownMessages.length === 0}
          empty={{
            icon: q ? 'search-outline' : 'chatbox-ellipses-outline',
            title: q ? 'No messages match' : 'No messages yet',
            message: q ? 'Try a name, a number or a word from the message.' : 'When callers leave a message, it shows up here with what they said.',
          }}
        >
          {() => (
            <View style={styles.list}>
              {shownMessages.map((m) => (
                <MessageCard
                  key={m.id}
                  message={m}
                  onOpen={() => openMessage(m)}
                  onChanged={(u) => messages.mutate((list) => list?.map((x) => (x.id === u.id ? u : x)))}
                />
              ))}
            </View>
          )}
        </AsyncContent>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
            {FILTERS.map((f) => (
              <Chip
                key={f.value}
                label={f.label}
                kind="filter"
                selected={filter === f.value}
                onPress={() => setFilter(f.value)}
                count={f.value === 'all' ? undefined : (calls.data ?? []).filter(f.test).length || undefined}
              />
            ))}
          </ScrollView>
          <AsyncContent
            data={calls.data}
            loading={calls.loading}
            error={calls.error}
            onRetry={() => void calls.reload()}
            isEmpty={() => shownCalls.length === 0}
            empty={{
              icon: 'call-outline',
              title: q || filter !== 'all' ? 'No calls match' : 'No calls yet',
              message: q || filter !== 'all' ? 'Clear the search or pick another filter.' : 'Calls your assistant answers appear here with a summary.',
            }}
          >
            {() => (
              <Section>
                {shownCalls.map((c) => (
                  <CallRow key={c.id} call={c} live={!!liveCalls[c.id]} onPress={() => router.push(`/call/${c.id}`)} />
                ))}
              </Section>
            )}
          </AsyncContent>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  filters: { gap: 8, paddingRight: 16 },
});
