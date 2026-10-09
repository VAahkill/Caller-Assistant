import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type TextInput } from 'react-native';

import { ContactPicker } from '../../components/domain/ContactPicker';
import { HoldQuestionCard } from '../../components/domain/HoldQuestionCard';
import { TaskTimeline } from '../../components/domain/TaskTimeline';
import { AsyncContent } from '../../components/ui/AsyncContent';
import { Banner } from '../../components/ui/Banner';
import { BottomSheet } from '../../components/ui/BottomSheet';
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
import { useProfile } from '../../hooks/useProfile';
import { useResource } from '../../hooks/useResource';
import { api, phoneFromText } from '../../lib/api';
import { Icon } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { prettyNumber, timeAgo } from '../../lib/format';
import { haptic } from '../../lib/haptics';
import { TASK_STATUS } from '../../lib/labels';
import { useLive } from '../../lib/live';
import { normalizeNumber } from '../../lib/phone';
import { TASK_KINDS, TASK_TEMPLATES, isTaskActive, taskTimeline, type TaskTemplate } from '../../lib/tasks';
import type { Task, TaskKind } from '../../lib/types';

/** "Call for me": pick what to do, give a number, and the assistant calls,
 *  gets it done and reports back, step by step.
 *  Deep link: opencall://tasks?number=...&goal=...&name=... */
export default function CallForMe() {
  const t = useTokens();
  const toast = useToast();
  const params = useLocalSearchParams<{ number?: string; goal?: string; name?: string }>();
  const live = useLive();
  const { refreshKey, tasks: liveTasks, taskSteps, questions, calls } = live;
  const tasks = useResource(() => api.tasks(), refreshKey);
  const health = useResource(() => api.health(), live.connected);
  const profile = useProfile();
  const [number, setNumber] = useState(params.number ?? '');
  const [name, setName] = useState(params.name ?? '');
  const [goal, setGoal] = useState(params.goal ?? '');
  const [kind, setKind] = useState<TaskKind>('enquire');
  const [template, setTemplate] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const goalRef = useRef<TextInput>(null);

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
      const found = normalizeNumber(phoneFromText(await Clipboard.getStringAsync()), profile.data?.home_country_code);
      if (found) {
        setNumber(found);
        toast.success(`Pasted ${prettyNumber(found)}.`);
      } else toast.info('No phone number on the clipboard. Copy one from Maps, WhatsApp or a website.');
    } catch (e) {
      console.warn("Couldn't read the clipboard", e);
      toast.error("Couldn't read the clipboard.");
    }
  };

  const applyTemplate = (tpl: TaskTemplate) => {
    haptic.tap();
    setTemplate(tpl.id);
    setGoal(tpl.goal);
    setKind(tpl.kind);
    // Templates that end mid-sentence ("Order number: ") want the rest typed now.
    if (/[:\s]$/.test(tpl.goal)) setTimeout(() => goalRef.current?.focus(), 50);
  };

  const start = useAsyncAction((input: { number: string; goal: string; kind: TaskKind; name: string }) => api.createTask(input.number, input.goal, input.kind, input.name), {
    success: (task) => `Calling ${task.target_name || prettyNumber(task.number)} now. Follow it below.`,
  });

  const submit = async () => {
    const task = await start.run({ number: number.trim(), goal: goal.trim(), kind, name: name.trim() });
    if (!task) return;
    setGoal('');
    setNumber('');
    setName('');
    setTemplate(null);
    setKind('enquire');
    tasks.mutate((list) => [task, ...(list ?? []).filter((x) => x.id !== task.id)]);
  };

  const retry = useAsyncAction((task: Task) => api.createTask(task.number, task.goal, task.kind, task.target_name), {
    success: (task) => `Trying ${task.target_name || prettyNumber(task.number)} again.`,
  });
  const tryAgain = async (failed: Task) => {
    const task = await retry.run(failed);
    if (task) tasks.mutate((list) => [task, ...(list ?? [])]);
  };

  const list = useMemo(() => {
    const merged = (tasks.data ?? []).map((x) => liveTasks[x.id] ?? x);
    // Tasks created elsewhere (e.g. the owner chat) show up from their first update.
    const extra = Object.values(liveTasks).filter((x) => !merged.some((m) => m.id === x.id));
    return [...extra, ...merged].sort((a, b) => b.created_at - a.created_at);
  }, [tasks.data, liveTasks]);
  const active = list.filter(isTaskActive);
  const earlier = list.filter((x) => !isTaskActive(x));

  const digits = number.replace(/\D/g, '').length;
  const numberOk = digits >= 6;
  const p = profile.data;
  const assistant = p?.assistant_name || 'Your assistant';
  const noDialer = health.data?.dialer === 'none';
  const kindInfo = TASK_KINDS.find((k) => k.value === kind);

  const card = (task: Task) => {
    const question = questions.find((q) => q.isTask && (q.taskId === task.id || (!!task.call_id && q.callId === task.call_id)));
    const callOpen = !!task.call_id && (!!calls[task.call_id] || task.status === 'done');
    return (
      <TaskCard
        key={task.id}
        task={task}
        steps={taskSteps[task.id]}
        decision={
          question ? (
            <HoldQuestionCard
              callId={question.callId}
              holdId={question.holdId}
              who={question.who}
              question={question.question}
              at={question.at}
              isTask
              assistantName={assistant}
              testID={`decision-${task.id}`}
            />
          ) : null
        }
        onOpenCall={callOpen ? () => router.push(`/call/${task.call_id}`) : undefined}
        onRetry={task.status === 'failed' ? () => void tryAgain(task) : undefined}
        retrying={retry.busy}
      />
    );
  };

  return (
    <Screen topInset refreshing={tasks.refreshing} onRefresh={() => void Promise.all([tasks.refresh(), health.reload()])} testID="tasks">
      <LargeHeader title="Call for me" subtitle={`${assistant} calls a place for you, gets it done and tells you how it went.`} />

      {noDialer ? (
        <Banner
          tone="warning"
          icon="call-outline"
          title="Outbound calling isn't set up"
          message="Your server can't place calls yet. Connect a phone to the computer by Bluetooth or set up Asterisk, as described in docs/TELEPHONY.md."
          testID="no-dialer"
        />
      ) : null}

      <Section title="What should it do?" grouped={false}>
        <View style={styles.grid}>
          {TASK_TEMPLATES.map((tpl) => {
            const on = template === tpl.id;
            return (
              <Pressable
                key={tpl.id}
                onPress={() => applyTemplate(tpl)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${tpl.label}. ${tpl.hint}`}
                android_ripple={{ color: t.color.surface3 }}
                style={({ pressed }) => [
                  styles.tile,
                  {
                    backgroundColor: on ? t.color.primaryContainer : pressed ? t.color.surface2 : t.color.surface,
                    borderColor: on ? t.color.primary : t.dark ? 'transparent' : t.color.border,
                    borderRadius: t.radius.lg,
                  },
                ]}
                testID={`template-${tpl.id}`}
              >
                <View style={[styles.tileIcon, { backgroundColor: on ? t.color.primary : t.color.primaryContainer }]}>
                  <Icon name={tpl.icon} size={20} color={on ? t.color.onPrimary : t.color.onPrimaryContainer} />
                </View>
                <Text variant="callout" weight="semibold" color={on ? 'onPrimaryContainer' : 'text'} numberOfLines={2}>
                  {tpl.label}
                </Text>
                <Text variant="footnote" color={on ? 'onPrimaryContainer' : 'text2'} numberOfLines={1}>
                  {tpl.hint}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Section>

      <Card>
        <TextField
          label="Phone number"
          value={number}
          onChangeText={setNumber}
          keyboardType="phone-pad"
          autoComplete="tel"
          placeholder="+91 40 2345 6789"
          icon="call-outline"
          error={digits > 0 && digits < 6 ? 'That number looks too short.' : null}
          helper="For a landline, include the area code, like 040."
          trailing={<Button title="Paste" variant="ghost" size="sm" icon="clipboard-outline" onPress={() => void paste()} />}
          testID="task-number"
        />
        <View style={styles.inline}>
          <Button title="Pick from contacts" variant="tonal" size="sm" icon="people-outline" onPress={() => setPicking(true)} />
        </View>
        <TextField label="Place or person (optional)" value={name} onChangeText={setName} placeholder="e.g. Paradise Biryani" autoCapitalize="words" clearable />
        <TextField
          ref={goalRef}
          label="What should your assistant do?"
          value={goal}
          onChangeText={setGoal}
          multiline
          minLines={3}
          maxLength={500}
          placeholder="e.g. Book a table for 3 at 8 PM tonight under my name"
          helper="Write it as you would to a friend. Add names, dates, times and order numbers."
          testID="task-goal"
        />
        <View style={styles.kinds}>
          {TASK_KINDS.map((k) => (
            <Chip key={k.value} label={k.label} kind="filter" selected={kind === k.value} onPress={() => setKind(k.value)} />
          ))}
        </View>
        {kindInfo ? (
          <View style={styles.explain}>
            <Icon name="information-circle-outline" size={16} color={t.color.text2} />
            <Text variant="footnote" color="text2" style={styles.flex}>
              {kindInfo.explain}
            </Text>
          </View>
        ) : null}
        <Button
          title={name.trim() ? `Call ${name.trim()}` : 'Start the call'}
          icon="call"
          size="lg"
          fullWidth
          loading={start.busy}
          disabled={!numberOk || !goal.trim()}
          onPress={() => void submit()}
          testID="start-task"
        />
      </Card>

      {active.length ? (
        <Section title={`In progress · ${active.length}`} grouped={false} testID="tasks-active">
          {active.map(card)}
        </Section>
      ) : null}

      <Section title="Earlier" grouped={false}>
        <AsyncContent
          data={tasks.data}
          loading={tasks.loading}
          error={tasks.error}
          onRetry={() => void tasks.reload()}
          isEmpty={() => earlier.length === 0}
          empty={{
            icon: 'call-outline',
            title: active.length ? 'Nothing finished yet' : 'No calls yet',
            message: 'Calls your assistant makes for you appear here with what happened.',
          }}
        >
          {() => <View style={styles.list}>{earlier.map(card)}</View>}
        </AsyncContent>
      </Section>

      <BottomSheet visible={picking} onClose={() => setPicking(false)} title="Pick a contact" subtitle="Your assistant calls this number.">
        <ContactPicker
          contacts={p?.contacts ?? []}
          homeCc={p?.home_country_code ?? '+91'}
          selected={number ? [number] : []}
          onPick={(n, contactName) => {
            setNumber(n);
            if (contactName) setName(contactName);
            setPicking(false);
          }}
          pageSize={8}
          onSyncContacts={() => {
            setPicking(false);
            router.push('/screening');
          }}
          testID="task-contacts"
        />
      </BottomSheet>
    </Screen>
  );
}

interface TaskCardProps {
  task: Task;
  steps?: Parameters<typeof taskTimeline>[1];
  /** The question the place asked while it holds, with answers. */
  decision?: ReactNode;
  onOpenCall?: () => void;
  onRetry?: () => void;
  retrying?: boolean;
}

function TaskCard({ task, steps, decision, onOpenCall, onRetry, retrying }: TaskCardProps) {
  const t = useTokens();
  const s = TASK_STATUS[task.status];
  const active = isTaskActive(task);
  const who = task.target_name || prettyNumber(task.number);
  return (
    <Card testID={`task-${task.id}`}>
      <View style={styles.taskHead}>
        <View style={[styles.taskIcon, { backgroundColor: active ? t.color.primaryContainer : t.color.surface2 }]}>
          <Icon name={s.icon} size={18} color={active ? t.color.onPrimaryContainer : t.color.text2} />
        </View>
        <View style={styles.flex}>
          <Text variant="headline" numberOfLines={1}>
            {who}
          </Text>
          <Text variant="footnote" color="text2" numberOfLines={1}>
            {[task.target_name ? prettyNumber(task.number) : null, timeAgo(task.updated_at || task.created_at)].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <StatusPill label={s.label} tone={s.tone} dot={active} pulse={task.status === 'in_call' || task.status === 'dialing'} />
      </View>
      <Text variant="subhead" color="text2">
        {task.goal}
      </Text>
      {active ? <TaskTimeline items={taskTimeline(task, steps)} testID={`timeline-${task.id}`} /> : null}
      {decision}
      {task.result ? (
        <View style={[styles.result, { backgroundColor: task.status === 'failed' ? t.color.dangerContainer : t.color.surface2, borderRadius: t.radius.md }]}>
          <Icon
            name={task.status === 'failed' ? 'alert-circle-outline' : 'chatbox-ellipses-outline'}
            size={18}
            color={task.status === 'failed' ? t.color.onDangerContainer : t.color.text2}
          />
          <Text variant="callout" color={task.status === 'failed' ? 'onDangerContainer' : 'text'} style={styles.flex}>
            {task.result}
          </Text>
        </View>
      ) : null}
      {onOpenCall || onRetry ? (
        <View style={styles.actions}>
          {onOpenCall ? (
            <Button title={active ? 'Listen in' : 'See the call'} variant="tonal" size="sm" icon={active ? 'ear-outline' : 'document-text-outline'} onPress={onOpenCall} />
          ) : null}
          {onRetry ? <Button title="Try again" variant="tonal" size="sm" icon="refresh" loading={retrying} onPress={onRetry} /> : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexBasis: '47%', flexGrow: 1, padding: 14, gap: 6, borderWidth: 1.5, minHeight: 112 },
  tileIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  inline: { flexDirection: 'row' },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  explain: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: -4 },
  list: { gap: 12 },
  taskHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  taskIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  result: { padding: 12, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
});
