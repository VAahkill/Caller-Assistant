import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AsyncContent } from '../../components/ui/AsyncContent';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { LargeHeader } from '../../components/ui/LargeHeader';
import { Screen } from '../../components/ui/Screen';
import { Section } from '../../components/ui/Section';
import { StatusPill } from '../../components/ui/StatusPill';
import { Text } from '../../components/ui/Text';
import { TextField } from '../../components/ui/TextField';
import { useToast } from '../../components/ui/Toast';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { useResource } from '../../hooks/useResource';
import { api, phoneFromText } from '../../lib/api';
import { Icon, type IconName } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { prettyNumber, timeAgo } from '../../lib/format';
import { TASK_STATUS } from '../../lib/labels';
import { useLive } from '../../lib/live';
import type { Task, TaskKind } from '../../lib/types';

const TEMPLATES: { icon: IconName; label: string; kind: TaskKind; goal: string }[] = [
  { icon: 'restaurant-outline', label: 'Book a table', kind: 'book', goal: 'Book a table for 2 tonight at 8 PM.' },
  { icon: 'cube-outline', label: 'Check order status', kind: 'enquire', goal: 'Ask when my order will be delivered. Order number: ' },
  { icon: 'calendar-outline', label: 'Reschedule', kind: 'custom', goal: 'Move my appointment to another day next week, any evening.' },
  { icon: 'help-circle-outline', label: 'Ask a question', kind: 'enquire', goal: 'Ask whether ' },
];

const KINDS: { value: TaskKind; label: string }[] = [
  { value: 'enquire', label: 'Just ask' },
  { value: 'book', label: 'Ask and book' },
  { value: 'custom', label: 'Something else' },
];

/** "Call for me": give a number and a goal; the assistant calls and reports back.
 *  Deep link: opencall://tasks?number=...&goal=...&name=... */
export default function CallForMe() {
  const t = useTokens();
  const toast = useToast();
  const params = useLocalSearchParams<{ number?: string; goal?: string; name?: string }>();
  const { refreshKey, tasks: liveTasks } = useLive();
  const tasks = useResource(() => api.tasks(), refreshKey);
  const [number, setNumber] = useState(params.number ?? '');
  const [name, setName] = useState(params.name ?? '');
  const [goal, setGoal] = useState(params.goal ?? '');
  const [kind, setKind] = useState<TaskKind>('enquire');

  // A deep link (e.g. "Call back" from a message) fills the form again.
  const linkKey = `${params.number ?? ''}|${params.goal ?? ''}|${params.name ?? ''}`;
  const [seenLink, setSeenLink] = useState(linkKey);
  if (linkKey !== seenLink) {
    setSeenLink(linkKey);
    if (params.number) setNumber(params.number);
    if (params.goal) setGoal(params.goal);
    if (params.name) setName(params.name);
  }

  // Reading the clipboard only when asked: Android shows a notice on every read.
  const paste = async () => {
    try {
      const found = phoneFromText(await Clipboard.getStringAsync());
      if (found) setNumber(found);
      else toast.info('No phone number on the clipboard. Copy one from Maps, WhatsApp or a website.');
    } catch (e) {
      console.warn("Couldn't read the clipboard", e);
      toast.error("Couldn't read the clipboard.");
    }
  };

  const start = useAsyncAction(() => api.createTask(number.trim(), goal.trim(), kind, name.trim()), {
    success: (task) => `Calling ${task.target_name || prettyNumber(task.number)} now. You'll get the result here.`,
  });

  const submit = async () => {
    const task = await start.run();
    if (!task) return;
    setGoal('');
    tasks.mutate((list) => [task, ...(list ?? [])]);
  };

  const list = useMemo(() => (tasks.data ?? []).map((x) => liveTasks[x.id] ?? x), [tasks.data, liveTasks]);
  const numberOk = number.replace(/\D/g, '').length >= 6;

  return (
    <Screen topInset refreshing={tasks.refreshing} onRefresh={() => void tasks.refresh()} testID="tasks">
      <LargeHeader title="Call for me" subtitle="Your assistant calls a place, gets it done and tells you how it went." />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.templates}>
        {TEMPLATES.map((tpl) => (
          <Chip
            key={tpl.label}
            label={tpl.label}
            icon={tpl.icon}
            kind="suggestion"
            onPress={() => {
              setGoal(tpl.goal);
              setKind(tpl.kind);
            }}
          />
        ))}
      </ScrollView>

      <Card>
        <TextField
          label="Phone number"
          value={number}
          onChangeText={setNumber}
          keyboardType="phone-pad"
          autoComplete="tel"
          placeholder="+91 40 2345 6789"
          clearable
          trailing={<Button title="Paste" variant="ghost" size="sm" icon="clipboard-outline" onPress={() => void paste()} />}
        />
        <TextField label="Place or person (optional)" value={name} onChangeText={setName} placeholder="e.g. Paradise Biryani" />
        <TextField
          label="What should your assistant do?"
          value={goal}
          onChangeText={setGoal}
          multiline
          minLines={3}
          placeholder="e.g. Book a table for 3 at 8 PM tonight under my name"
          helper="If they offer something different, like another time, you'll be asked while they hold."
        />
        <View style={styles.kinds}>
          {KINDS.map((k) => (
            <Chip key={k.value} label={k.label} kind="filter" selected={kind === k.value} onPress={() => setKind(k.value)} />
          ))}
        </View>
        <Button title="Start the call" icon="call" size="lg" fullWidth loading={start.busy} disabled={!numberOk || !goal.trim()} onPress={() => void submit()} />
      </Card>

      <Section title="Recent" grouped={false}>
        <AsyncContent
          data={tasks.data}
          loading={tasks.loading}
          error={tasks.error}
          onRetry={() => void tasks.reload()}
          isEmpty={() => list.length === 0}
          empty={{ icon: 'call-outline', title: 'No calls yet', message: 'Calls your assistant makes for you appear here with what happened.' }}
        >
          {() => (
            <View style={styles.list}>
              {list.map((task) => (
                <TaskCard key={task.id} task={task} onPress={task.call_id ? () => router.push(`/call/${task.call_id}`) : undefined} />
              ))}
            </View>
          )}
        </AsyncContent>
      </Section>
      <View style={{ height: t.space.sm }} />
    </Screen>
  );
}

function TaskCard({ task, onPress }: { task: Task; onPress?: () => void }) {
  const t = useTokens();
  const s = TASK_STATUS[task.status];
  return (
    <Card onPress={onPress} accessibilityLabel={`${task.target_name || task.number}: ${s.label}. ${task.goal}`}>
      <View style={styles.taskHead}>
        <View style={[styles.taskIcon, { backgroundColor: t.color.surface2 }]}>
          <Icon name={s.icon} size={18} color={t.color.text2} />
        </View>
        <View style={styles.flex}>
          <Text variant="headline" numberOfLines={1}>
            {task.target_name || prettyNumber(task.number)}
          </Text>
          <Text variant="footnote" color="text2">
            {timeAgo(task.updated_at || task.created_at)}
          </Text>
        </View>
        <StatusPill label={s.label} tone={s.tone} dot={task.status === 'in_call' || task.status === 'dialing'} pulse={task.status === 'in_call'} />
      </View>
      <Text variant="subhead" color="text2">
        {task.goal}
      </Text>
      {task.result ? (
        <View style={[styles.result, { backgroundColor: t.color.surface2, borderRadius: t.radius.md }]}>
          <Text variant="callout">{task.result}</Text>
        </View>
      ) : null}
      {onPress ? (
        <Pressable onPress={onPress} accessibilityRole="link" style={styles.link}>
          <Text variant="footnote" weight="semibold" color="primary">
            See the call
          </Text>
          <Icon name="chevron-forward" size={14} color={t.color.primary} />
        </Pressable>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  // Scrolls edge to edge, while the first chip lines up with the content.
  bleed: { marginHorizontal: -16 },
  templates: { gap: 8, paddingHorizontal: 16 },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  list: { gap: 12 },
  taskHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  taskIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  result: { padding: 12 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
});
