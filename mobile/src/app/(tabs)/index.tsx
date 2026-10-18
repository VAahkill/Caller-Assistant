import { router, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { HoldQuestionCard } from '../../components/domain/HoldQuestionCard';
import { LiveCallCard } from '../../components/domain/LiveCallCard';
import { ReadinessSheet } from '../../components/domain/ReadinessSheet';
import { OutdatedServerBanner, PhoneLineCard } from '../../components/domain/ServerNotices';
import { StatusHero } from '../../components/domain/StatusHero';
import { Avatar, Banner, Button, EmptyState, IconButton, LargeHeader, Screen, Section, Skeleton, Text, useToast } from '../../components/ui';
import { errorMessage } from '../../hooks/useAsyncAction';
import { useProfile } from '../../hooks/useProfile';
import { useServerConfig } from '../../hooks/useServerConfig';
import { useResource } from '../../hooks/useResource';
import { api, awayActive } from '../../lib/api';
import { Icon, type IconName } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { greeting, isToday, prettyNumber, timeAgo } from '../../lib/format';
import { useLive, type SecurityAlert } from '../../lib/live';
import { isPracticeCall, isPracticeNumber } from '../../lib/practiceCalls';
import { assistantOnText, lineUnknown, noLineForCalls, serverOutdated } from '../../lib/serverStatus';
import type { CallerMessage } from '../../lib/types';

const QUICK_ACTIONS: { icon: IconName; label: string; href: Href }[] = [
  { icon: 'mic-outline', label: 'Practice call', href: '/practice' },
  { icon: 'call-outline', label: 'Call for me', href: '/tasks' },
  { icon: 'moon-outline', label: 'Set away', href: '/away' },
  { icon: 'chatbubble-ellipses-outline', label: 'Ask assistant', href: '/chat' },
];

const SECRET_WORDS: Record<string, string> = {
  otp: 'OTP',
  pin: 'PIN',
  password: 'password',
  card: 'card number',
  account: 'account number',
  balance: 'balance',
  aadhaar: 'Aadhaar number',
  pan: 'PAN',
  cvv: 'CVV',
};

/** Today: the assistant's state, what needs the owner, live calls and the day so far. */
export default function Today() {
  const t = useTokens();
  const live = useLive();
  const toast = useToast();
  const server = useServerConfig();
  const configured = !!server.config;
  const profile = useProfile(configured);
  const calls = useResource(() => api.calls(), live.refreshKey, configured);
  const messages = useResource(() => api.messages(), live.refreshKey, configured);
  const health = useResource(() => api.health(), live.connected, configured);
  const [toggling, setToggling] = useState(false);
  const [availableBusy, setAvailableBusy] = useState(false);
  const [readinessOpen, setReadinessOpen] = useState(false);

  // Practice calls and the messages left on them are your own tests: they don't count here.
  const realCalls = useMemo(() => (calls.data ?? []).filter((c) => !isPracticeCall(c)), [calls.data]);
  const realMessages = useMemo(() => {
    const practice = new Set((calls.data ?? []).filter(isPracticeCall).map((c) => c.id));
    return (messages.data ?? []).filter((m) => !isPracticeNumber(m.number) && !practice.has(m.call_id));
  }, [messages.data, calls.data]);
  const today = useMemo(() => realCalls.filter((c) => isToday(c.started_at)), [realCalls]);
  const stats = useMemo(
    () => ({
      answered: today.filter((c) => c.direction === 'inbound' && c.status !== 'rejected').length,
      messages: realMessages.filter((m) => isToday(m.created_at)).length,
      blocked: today.filter((c) => c.status === 'rejected' || c.category === 'spam').length,
    }),
    [today, realMessages],
  );
  const liveCalls = Object.values(live.calls);
  const latest = useMemo(
    // New ones first, then the most recent of the rest.
    () => [...realMessages.filter((m) => m.status === 'new'), ...realMessages.filter((m) => m.status !== 'new')].slice(0, 3),
    [realMessages],
  );
  const unread = realMessages.filter((m) => m.status === 'new').length;
  const p = profile.data;
  const assistant = p?.assistant_name ?? 'Your assistant';
  const h = health.data ?? null;

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
    await profile.patch({ enabled }, enabled ? assistantOnText(assistant, health.data) : 'Calls will ring through as usual.');
    setToggling(false);
  };

  const setAvailable = async (available: boolean) => {
    setAvailableBusy(true);
    await profile.patch(
      { available },
      available ? `${assistant} will put callers on hold to ask you.` : `${assistant} will take messages instead of waiting for you.`,
    );
    setAvailableBusy(false);
  };

  const dismiss = (a: SecurityAlert) => {
    live.dismissAlert(a.id);
    toast.undo('Alert dismissed.', () => live.restoreAlert(a));
  };

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
          health={h}
          liveCalls={liveCalls.length}
          onReadinessPress={() => setReadinessOpen(true)}
          available={p.available}
          onAvailableChange={(v) => void setAvailable(v)}
          availableBusy={availableBusy}
        />
      ) : (
        <Skeleton height={148} radius={t.radius.xl} />
      )}

      {serverOutdated(h) ? <OutdatedServerBanner health={h} /> : null}
      {h && (noLineForCalls(h) || lineUnknown(h)) ? <PhoneLineCard assistantName={p?.assistant_name || 'your assistant'} health={h} /> : null}

      {needsYou ? (
        <Section title={`Needs you · ${needsYou}`} grouped={false} testID="needs-you">
          {live.alerts.map((a) => (
            <Banner
              key={a.id}
              tone="danger"
              icon="shield-checkmark"
              title={alertTitle(a, assistant)}
              message={alertMessage(a, assistant)}
              action={{ label: 'View call', onPress: () => router.push(`/call/${a.callId}`) }}
              onDismiss={() => dismiss(a)}
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
              assistantName={assistant}
              onOpen={() => router.push(`/call/${q.callId}`)}
            />
          ))}
        </Section>
      ) : null}

      {liveCalls.length ? (
        <Section title="Live now" grouped={false}>
          {liveCalls.map((v) => (
            <LiveCallCard
              key={v.record.id}
              view={v}
              assistantName={assistant}
              ownerLanguage={p?.owner_language ?? 'en'}
              onPress={() => router.push(`/call/${v.record.id}`)}
              testID={`live-${v.record.id}`}
            />
          ))}
        </Section>
      ) : null}

      <Section title="Today">
        <View style={styles.stats}>
          <Stat icon="call-outline" value={stats.answered} label="Answered" loading={calls.loading} href="/inbox?tab=calls&filter=all" />
          <View style={[styles.vrule, { backgroundColor: t.color.border }]} />
          <Stat icon="chatbox-ellipses-outline" value={stats.messages} label="Messages" loading={messages.loading} href="/inbox?tab=messages&filter=all" />
          <View style={[styles.vrule, { backgroundColor: t.color.border }]} />
          <Stat icon="shield-outline" value={stats.blocked} label="Spam stopped" loading={calls.loading} href="/inbox?tab=calls&filter=spam" />
        </View>
      </Section>
      {calls.error ? (
        <Banner tone="danger" title="Couldn't load today's calls" message={calls.error} action={{ label: 'Retry', onPress: () => void calls.reload() }} />
      ) : null}

      <View style={styles.quick}>
        {QUICK_ACTIONS.map((a) => (
          <QuickAction key={a.label} {...a} />
        ))}
      </View>

      <Section
        title={unread ? `New messages · ${unread}` : 'Latest messages'}
        action={{ label: 'See all', onPress: () => router.push('/inbox?tab=messages&filter=all') }}
        testID="latest-messages"
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
        ) : latest.length ? (
          latest.map((m) => <MessageRow key={m.id} message={m} onPress={() => openMessage(m)} />)
        ) : (
          <EmptyState compact icon="checkmark-done-outline" title="No messages yet" message="Messages callers leave appear here." />
        )}
      </Section>

      <ReadinessSheet
        visible={readinessOpen}
        onClose={() => setReadinessOpen(false)}
        connected={live.connected}
        health={h}
        error={health.error}
        refreshing={health.refreshing}
        onRefresh={() => void health.refresh()}
      />
    </Screen>
  );
}

const displayWho = (who: string) => (/^\+?[\d\s-]{5,}$/.test(who) ? prettyNumber(who) : who);

function alertTitle(a: SecurityAlert, assistant: string): string {
  if (a.kind === 'blocked_output') return `${assistant} held back a code-like number`;
  return `${displayWho(a.who)} asked for your ${SECRET_WORDS[a.kind] ?? (a.kind || 'private details')}`;
}

function alertMessage(a: SecurityAlert, assistant: string): string {
  const when = timeAgo(a.at);
  if (a.kind === 'blocked_output') return `On the call with ${displayWho(a.who)}. Nothing was said. ${when}.`;
  return `${a.said ? `They said: "${a.said}". ` : ''}${assistant} refused and shared nothing. ${when}.`;
}

function MessageRow({ message: m, onPress }: { message: CallerMessage; onPress: () => void }) {
  const t = useTokens();
  const name = m.caller_name || prettyNumber(m.number);
  const isNew = m.status === 'new';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${isNew ? 'New message' : 'Message'} from ${name}: ${m.text}`}
      android_ripple={{ color: t.color.surface3 }}
      style={({ pressed }) => [styles.message, { opacity: pressed ? 0.85 : 1, paddingHorizontal: t.space.lg }]}
    >
      <Avatar name={m.caller_name || m.number} size={40} />
      <View style={styles.flex}>
        <View style={styles.messageTop}>
          <Text variant="headline" numberOfLines={1} style={styles.flex}>
            {name}
          </Text>
          <Text variant="footnote" color={isNew ? 'primary' : 'text2'} weight={isNew ? 'semibold' : undefined}>
            {timeAgo(m.created_at)}
          </Text>
        </View>
        <View style={styles.messageTop}>
          <Text variant="subhead" color={isNew ? 'text' : 'text2'} numberOfLines={2} style={styles.flex}>
            {m.text}
          </Text>
          {isNew ? <View style={[styles.newDot, { backgroundColor: t.color.primary }]} accessibilityLabel="New" /> : null}
          {m.status === 'replied' ? <Icon name="checkmark-done" size={16} color={t.color.success} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

function Stat({ icon, value, label, loading, href }: { icon: IconName; value: number; label: string; loading?: boolean; href: Href }) {
  const t = useTokens();
  return (
    <Pressable
      style={({ pressed }) => [styles.stat, { opacity: pressed ? 0.7 : 1 }]}
      onPress={() => router.push(href)}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${loading ? 'loading' : value}`}
      accessibilityHint="Opens them in the Inbox"
    >
      <Icon name={icon} size={18} color={t.color.text2} />
      {loading ? <Skeleton width={28} height={24} /> : <Text variant="title1" tabular>{value}</Text>}
      <Text variant="caption" color="text2" numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function QuickAction({ icon, label, href }: { icon: IconName; label: string; href: Href }) {
  const t = useTokens();
  return (
    <Pressable
      onPress={() => router.push(href)}
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
  stat: { flex: 1, alignItems: 'center', gap: 4, minHeight: 48 },
  vrule: { width: StyleSheet.hairlineWidth, marginVertical: 4 },
  quick: { flexDirection: 'row', gap: 10 },
  action: { flex: 1, alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 6, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  actionIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  message: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  messageTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  newDot: { width: 8, height: 8, borderRadius: 4 },
  flex: { flex: 1 },
  pad: { padding: 16, gap: 8 },
});
