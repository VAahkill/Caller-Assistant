import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { CallRow } from '../../components/domain/CallRow';
import { MessageCard } from '../../components/domain/MessageCard';
import { AsyncContent } from '../../components/ui/AsyncContent';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { LargeHeader } from '../../components/ui/LargeHeader';
import { Screen } from '../../components/ui/Screen';
import { SearchField } from '../../components/ui/SearchField';
import { Section } from '../../components/ui/Section';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Text } from '../../components/ui/Text';
import { useToast } from '../../components/ui/Toast';
import { errorMessage, useAsyncAction } from '../../hooks/useAsyncAction';
import { useResource } from '../../hooks/useResource';
import { api } from '../../lib/api';
import { callMatches, groupByDay, INBOX_FILTERS, isInboxFilter, messageMatches, searchMatches, type InboxFilter } from '../../lib/inbox';
import { useLive } from '../../lib/live';
import type { CallSummary, CallerMessage } from '../../lib/types';

type Tab = 'messages' | 'calls';

/** Inbox: messages callers left, and every call with its summary. Search and
 *  the filter chips work on both; each message is filtered by its call. */
export default function Inbox() {
  const { refreshKey, calls: liveCalls } = useLive();
  const toast = useToast();
  const params = useLocalSearchParams<{ tab?: string; filter?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === 'calls' ? 'calls' : 'messages');
  const [filter, setFilter] = useState<InboxFilter>(isInboxFilter(params.filter) ? params.filter : 'all');
  const [query, setQuery] = useState('');
  // A link from Today (e.g. "Spam stopped") opens a tab and filter, even when the Inbox is already open.
  const linked = `${params.tab ?? ''}|${params.filter ?? ''}`;
  const [seenLink, setSeenLink] = useState(linked);
  if (linked !== seenLink) {
    setSeenLink(linked);
    if (params.tab === 'calls' || params.tab === 'messages') setTab(params.tab);
    if (isInboxFilter(params.filter)) setFilter(params.filter);
  }

  const messages = useResource(() => api.messages(), refreshKey);
  const calls = useResource(() => api.calls(), refreshKey);
  const callById = useMemo(() => new Map((calls.data ?? []).map((c) => [c.id, c])), [calls.data]);

  const shownMessages = useMemo(
    () =>
      (messages.data ?? []).filter(
        (m) => messageMatches(filter, m, callById.get(m.call_id)) && searchMatches(query, m.caller_name, m.number, m.text, m.reply),
      ),
    [messages.data, callById, filter, query],
  );
  const shownCalls = useMemo(
    () => (calls.data ?? []).filter((c) => callMatches(filter, c) && searchMatches(query, c.contact_name, c.number, c.summary, c.message)),
    [calls.data, filter, query],
  );
  const counts = useMemo(() => {
    const out = {} as Record<InboxFilter, number>;
    for (const f of INBOX_FILTERS) {
      out[f.value] =
        tab === 'messages'
          ? (messages.data ?? []).filter((m) => messageMatches(f.value, m, callById.get(m.call_id))).length
          : (calls.data ?? []).filter((c) => callMatches(f.value, c)).length;
    }
    return out;
  }, [tab, messages.data, calls.data, callById]);
  const unread = (messages.data ?? []).filter((m) => m.status === 'new');

  const markAll = useAsyncAction(async () => {
    const ids = unread.map((m) => m.id);
    messages.mutate((list) => list?.map((x) => (ids.includes(x.id) ? { ...x, status: 'read' } : x)));
    const results = await Promise.allSettled(ids.map((id) => api.markRead(id)));
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) {
      await messages.refresh();
      throw new Error(`${failed.length} of ${ids.length} couldn't be marked read: ${errorMessage((failed[0] as PromiseRejectedResult).reason)}`);
    }
    return ids.length;
  }, {
    success: (n) => (n === 1 ? 'Marked 1 message read.' : `Marked ${n} messages read.`),
  });

  const openMessage = (m: CallerMessage) => {
    if (m.status === 'new') {
      messages.mutate((list) => list?.map((x) => (x.id === m.id ? { ...x, status: 'read' } : x)));
      api.markRead(m.id).catch((e: unknown) => {
        console.warn("Couldn't mark the message read", e);
        toast.error(`Couldn't mark the message read: ${errorMessage(e)}`);
      });
    }
    router.push(`/call/${m.call_id}`);
  };

  const narrowed = !!query.trim() || filter !== 'all';
  const clear = () => {
    setQuery('');
    setFilter('all');
  };
  const active = tab === 'messages' ? messages : calls;
  return (
    <Screen
      topInset
      refreshing={messages.refreshing || calls.refreshing}
      onRefresh={() => void Promise.all([messages.refresh(), calls.refresh()])}
      testID="inbox"
    >
      <LargeHeader
        title="Inbox"
        subtitle={unread.length ? `${unread.length} new ${unread.length === 1 ? 'message' : 'messages'}` : 'All caught up'}
        actions={
          unread.length && tab === 'messages' ? (
            <Button title="Mark all read" variant="ghost" size="sm" icon="checkmark-done" loading={markAll.busy} onPress={() => void markAll.run()} />
          ) : null
        }
      />
      <SegmentedControl<Tab>
        accessibilityLabel="Show"
        value={tab}
        onChange={setTab}
        segments={[
          { value: 'messages', label: 'Messages', badge: unread.length || undefined },
          { value: 'calls', label: 'Calls' },
        ]}
      />
      <View style={styles.tools}>
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder={tab === 'messages' ? 'Search names, numbers, words' : 'Search names, numbers, summaries'}
          accessibilityLabel={tab === 'messages' ? 'Search messages' : 'Search calls'}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.filters} keyboardShouldPersistTaps="handled">
          {INBOX_FILTERS.map((f) => (
            <Chip
              key={f.value}
              label={f.label}
              kind="filter"
              selected={filter === f.value}
              onPress={() => setFilter(f.value)}
              count={f.value === 'all' || active.loading ? undefined : counts[f.value] || undefined}
              testID={`filter-${f.value}`}
            />
          ))}
        </ScrollView>
      </View>

      {tab === 'messages' ? (
        <AsyncContent
          data={messages.data}
          loading={messages.loading}
          error={messages.error}
          onRetry={() => void messages.reload()}
          isEmpty={() => shownMessages.length === 0}
          empty={
            narrowed
              ? { icon: 'search-outline', title: 'No messages match', message: 'Try another word or filter.', action: { label: 'Clear search and filter', onPress: clear } }
              : { icon: 'chatbox-ellipses-outline', title: 'No messages yet', message: 'When callers leave a message, it shows up here with what they said.' }
          }
        >
          {() => (
            <View style={styles.groups}>
              {groupByDay(shownMessages, (m) => m.created_at).map((g) => (
                <View key={g.key} style={styles.list}>
                  <DayTitle title={g.title} />
                  {g.items.map((m) => (
                    <MessageCard
                      key={m.id}
                      message={m}
                      call={callById.get(m.call_id)}
                      testID={`message-${m.id}`}
                      onOpen={() => openMessage(m)}
                      onChanged={(u) => messages.mutate((list) => list?.map((x) => (x.id === u.id ? u : x)))}
                    />
                  ))}
                </View>
              ))}
            </View>
          )}
        </AsyncContent>
      ) : (
        <AsyncContent
          data={calls.data}
          loading={calls.loading}
          error={calls.error}
          onRetry={() => void calls.reload()}
          isEmpty={() => shownCalls.length === 0}
          skeletonRows={5}
          empty={
            narrowed
              ? { icon: 'search-outline', title: 'No calls match', message: 'Try another word or filter.', action: { label: 'Clear search and filter', onPress: clear } }
              : { icon: 'call-outline', title: 'No calls yet', message: 'Calls your assistant answers appear here with a summary.' }
          }
        >
          {() => (
            <View style={styles.groups}>
              {groupByDay(shownCalls, (c: CallSummary) => c.started_at).map((g) => (
                <Section key={g.key} title={g.title}>
                  {g.items.map((c) => (
                    <CallRow key={c.id} call={c} live={!!liveCalls[c.id]} onPress={() => router.push(`/call/${c.id}`)} />
                  ))}
                </Section>
              ))}
            </View>
          )}
        </AsyncContent>
      )}
    </Screen>
  );
}

function DayTitle({ title }: { title: string }) {
  return (
    <Text variant="overline" color="text2" accessibilityRole="header" style={styles.day}>
      {title}
    </Text>
  );
}

const styles = StyleSheet.create({
  tools: { gap: 12 },
  groups: { gap: 20 },
  list: { gap: 12 },
  day: { paddingHorizontal: 4 },
  // Scrolls edge to edge, while the first chip lines up with the content.
  bleed: { marginHorizontal: -16 },
  filters: { gap: 8, paddingHorizontal: 16 },
});
