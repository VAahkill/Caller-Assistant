import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CallRow } from '../../components/domain/CallRow';
import { HoldQuestionCard } from '../../components/domain/HoldQuestionCard';
import { StatusHero } from '../../components/domain/StatusHero';
import { Banner, Button, EmptyState, IconButton, LargeHeader, Screen, Section, Skeleton, Text } from '../../components/ui';
import { useProfile } from '../../hooks/useProfile';
import { useServerConfig } from '../../hooks/useServerConfig';
import { useResource } from '../../hooks/useResource';
import { api, awayActive } from '../../lib/api';
import { Icon, type IconName } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { greeting, isToday, timeAgo } from '../../lib/format';
import { useLive } from '../../lib/live';

const QUICK_ACTIONS: { icon: IconName; label: string; href: string }[] = [
  { icon: 'mic-outline', label: 'Practice call', href: '/practice' },
  { icon: 'call-outline', label: 'Call for me', href: '/tasks' },
  { icon: 'moon-outline', label: 'Set away', href: '/away' },
  { icon: 'chatbubble-ellipses-outline', label: 'Ask assistant', href: '/chat' },
];

/** Today: the assistant's state, what needs the owner, live calls and the day so far. */
export default function Today() {
  const t = useTokens();
  const live = useLive();
  const server = useServerConfig();
  const configured = !!server.config;
  const profile = useProfile(configured);
  const calls = useResource(() => api.calls(), live.refreshKey, configured);
  const messages = useResource(() => api.messages(), live.refreshKey, configured);
  const health = useResource(() => api.health(), live.connected, configured);
  const [toggling, setToggling] = useState(false);

  const today = useMemo(() => (calls.data ?? []).filter((c) => isToday(c.started_at)), [calls.data]);
  const stats = useMemo(
    () => ({
      answered: today.filter((c) => c.direction === 'inbound' && c.status !== 'rejected').length,
      messages: (messages.data ?? []).filter((m) => isToday(m.created_at)).length,
      blocked: today.filter((c) => c.status === 'rejected' || c.category === 'spam').length,
    }),
    [today, messages.data],
  );
  const liveCalls = Object.values(live.calls);
  const newMessages = (messages.data ?? []).filter((m) => m.status === 'new');
  const p = profile.data;

  if (server.loaded && !configured) {
    return (
      <Screen topInset>
        <LargeHeader eyebrow={greeting()} title="Welcome to OpenCall" />
        <EmptyState
          icon="server-outline"
          title="Connect your server"
          message="OpenCall runs on your own computer. Connect the app to it to start answering calls."
          action={{ label: 'Set up', icon: 'arrow-forward', onPress: () => router.push('/onboarding') }}
        />
      </Screen>
    );
  }

  const refresh = async () => {
    await Promise.all([profile.refresh(), calls.refresh(), messages.refresh(), health.refresh()]);
  };

  const toggle = async (enabled: boolean) => {
    setToggling(true);
    await profile.patch({ enabled }, enabled ? 'Your assistant is answering calls.' : 'Calls will ring through as usual.');
    setToggling(false);
  };

  const needsYou = live.questions.length + live.alerts.length;
  return (
    <Screen topInset refreshing={profile.refreshing || calls.refreshing} onRefresh={() => void refresh()} testID="today">
      <LargeHeader
        eyebrow={new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
        title={p?.user_name ? `${greeting()}, ${p.user_name}` : greeting()}
        actions={<IconButton icon="chatbubble-ellipses-outline" label="Ask your assistant" variant="tonal" onPress={() => router.push('/chat')} />}
      />

      {profile.error && !p ? (
        <Banner tone="danger" title="Couldn't load your assistant" message={profile.error} action={{ label: 'Retry', onPress: () => void profile.reload() }} />
      ) : p ? (
        <StatusHero
          assistantName={p.assistant_name}
          enabled={p.enabled}
          onToggle={(v) => void toggle(v)}
          toggling={toggling}
          away={awayActive(p.away) ? p.away : null}
          onAwayPress={() => router.push('/away')}
          connected={live.connected}
          health={health.data ?? null}
          liveCalls={liveCalls.length}
        />
      ) : (
        <Skeleton height={148} radius={t.radius.xl} />
      )}

      {needsYou ? (
        <Section title={`Needs you · ${needsYou}`} grouped={false}>
          {live.alerts.map((a) => (
            <Banner
              key={a.id}
              tone="danger"
              icon="shield-checkmark"
              title={`${a.who} asked for your ${a.kind || 'private details'}`}
              message={`${a.text} Your assistant refused. ${timeAgo(a.at)}.`}
              action={{ label: 'View call', onPress: () => router.push(`/call/${a.callId}`) }}
              onDismiss={() => live.dismissAlert(a.id)}
            />
          ))}
          {live.questions.map((q) => (
            <HoldQuestionCard
              key={q.holdId}
              callId={q.callId}
              holdId={q.holdId}
              who={q.who}
              question={q.question}
              at={q.at}
              isTask={q.isTask}
              callerLanguage={live.calls[q.callId]?.language}
              ownerLanguage={p?.owner_language}
              onOpen={() => router.push(`/call/${q.callId}`)}
            />
          ))}
        </Section>
      ) : null}

      {liveCalls.length ? (
        <Section title="Live now">
          {liveCalls.map((v) => (
            <CallRow key={v.record.id} call={v.record} live onPress={() => router.push(`/call/${v.record.id}`)} />
          ))}
        </Section>
      ) : null}

      <Section title="Today">
        <View style={styles.stats}>
          <Stat icon="call-outline" value={stats.answered} label="Answered" loading={calls.loading} />
          <View style={[styles.vrule, { backgroundColor: t.color.border }]} />
          <Stat icon="chatbox-ellipses-outline" value={stats.messages} label="Messages" loading={messages.loading} />
          <View style={[styles.vrule, { backgroundColor: t.color.border }]} />
          <Stat icon="shield-outline" value={stats.blocked} label="Spam stopped" loading={calls.loading} />
        </View>
      </Section>

      <View style={styles.quick}>
        {QUICK_ACTIONS.map((a) => (
          <QuickAction key={a.href} {...a} />
        ))}
      </View>

      <Section
        title={newMessages.length ? `New messages · ${newMessages.length}` : 'Messages'}
        action={{ label: 'See all', onPress: () => router.push('/inbox') }}
      >
        {messages.loading ? (
          <View style={styles.pad}>
            <Skeleton height={44} />
          </View>
        ) : messages.error ? (
          <View style={styles.pad}>
            <Text variant="subhead" color="danger">
              {messages.error}
            </Text>
            <Button title="Retry" variant="ghost" size="sm" onPress={() => void messages.reload()} />
          </View>
        ) : newMessages.length ? (
          newMessages.slice(0, 3).map((m) => (
            <Pressable
              key={m.id}
              onPress={() => router.push(`/call/${m.call_id}`)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.message, { opacity: pressed ? 0.8 : 1, paddingHorizontal: t.space.lg }]}
            >
              <View style={[styles.newDot, { backgroundColor: t.color.primary }]} />
              <View style={styles.flex}>
                <Text variant="headline" numberOfLines={1}>
                  {m.caller_name || m.number}
                </Text>
                <Text variant="subhead" color="text2" numberOfLines={2}>
                  {m.text}
                </Text>
              </View>
              <Text variant="footnote" color="text2">
                {timeAgo(m.created_at)}
              </Text>
            </Pressable>
          ))
        ) : (
          <EmptyState compact icon="checkmark-done-outline" title="You're all caught up" message="Messages callers leave appear here." />
        )}
      </Section>
    </Screen>
  );
}

function Stat({ icon, value, label, loading }: { icon: IconName; value: number; label: string; loading?: boolean }) {
  const t = useTokens();
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${label}: ${loading ? 'loading' : value}`}>
      <Icon name={icon} size={18} color={t.color.text2} />
      {loading ? <Skeleton width={28} height={24} /> : <Text variant="title1" tabular>{value}</Text>}
      <Text variant="caption" color="text2" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function QuickAction({ icon, label, href }: { icon: IconName; label: string; href: string }) {
  const t = useTokens();
  return (
    <Pressable
      onPress={() => router.push(href as never)}
      accessibilityRole="button"
      accessibilityLabel={label}
      android_ripple={{ color: t.color.surface3 }}
      style={({ pressed }) => [
        styles.action,
        { backgroundColor: t.color.surface, borderColor: t.color.border, borderRadius: t.radius.lg, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <View style={[styles.actionIcon, { backgroundColor: t.color.primaryContainer }]}>
        <Icon name={icon} size={20} color={t.color.onPrimaryContainer} />
      </View>
      <Text variant="footnote" weight="semibold" align="center" numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', alignItems: 'stretch', paddingVertical: 16 },
  stat: { flex: 1, alignItems: 'center', gap: 4 },
  vrule: { width: StyleSheet.hairlineWidth, marginVertical: 4 },
  quick: { flexDirection: 'row', gap: 10 },
  action: { flex: 1, alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 6, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  actionIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  message: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  newDot: { width: 8, height: 8, borderRadius: 4 },
  flex: { flex: 1 },
  pad: { padding: 16, gap: 8 },
});
