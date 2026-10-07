import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Body, Button, Card, Chip, Input, Muted, Title } from '../../components/ui';
import { api, phoneFromText } from '../../lib/api';
import { useLive } from '../../lib/live';
import { timeAgo, useTheme } from '../../lib/theme';
import type { Task, TaskKind } from '../../lib/types';

const STATUS: Record<Task['status'], string> = {
  queued: 'Queued',
  dialing: 'Dialling…',
  in_call: 'On the call',
  waiting_user: 'Waiting for your decision',
  done: 'Done',
  failed: 'Failed',
};

/** "Call for me": give a number and a goal; the assistant calls and reports back.
 *  Deep link: opencall://tasks?number=...&goal=... */
export default function Tasks() {
  const t = useTheme();
  const params = useLocalSearchParams<{ number?: string; goal?: string; name?: string }>();
  const { version, taskUpdates } = useLive();
  const [number, setNumber] = useState(params.number ?? '');
  const [name, setName] = useState(params.name ?? '');
  const [goal, setGoal] = useState(params.goal ?? '');
  const [kind, setKind] = useState<TaskKind>('enquire');
  const [clip, setClip] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState('');

  useFocusEffect(
    useCallback(() => {
      api.tasks().then(setTasks).catch(() => {});
      // Offer a number the user just copied from Maps, WhatsApp, a website...
      Clipboard.getStringAsync()
        .then((s) => setClip(phoneFromText(s)))
        .catch(() => {});
    }, [version]),
  );

  useEffect(() => {
    if (params.number) setNumber(params.number);
    if (params.goal) setGoal(params.goal);
  }, [params.number, params.goal]);

  async function start() {
    setError('');
    try {
      const task = await api.createTask(number, goal, kind, name);
      setGoal('');
      setTasks((ts) => [task, ...ts]);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
      <Card>
        <Title>Call a place for me</Title>
        {clip && clip !== number ? (
          <Chip label={`Use copied number ${clip}`} onPress={() => setNumber(clip)} />
        ) : null}
        <Input value={number} onChangeText={setNumber} placeholder="Phone number" keyboardType="phone-pad" />
        <Input value={name} onChangeText={setName} placeholder="Place name (optional)" />
        <Input
          value={goal}
          onChangeText={setGoal}
          placeholder="e.g. Table for 3 at 8 PM tonight"
          multiline
          style={{ minHeight: 70 }}
        />
        <View style={styles.row}>
          <Chip label="Just check" active={kind === 'enquire'} onPress={() => setKind('enquire')} />
          <Chip label="Check and book" active={kind === 'book'} onPress={() => setKind('book')} />
          <Chip label="Other" active={kind === 'custom'} onPress={() => setKind('custom')} />
        </View>
        {error ? <Text style={{ color: t.danger }}>{error}</Text> : null}
        <Button title="Start the call" onPress={start} disabled={!number || !goal.trim()} />
        <Muted>If they offer something different, like another time, you'll get a notification to decide while they hold.</Muted>
      </Card>

      {tasks.map((task0) => {
        const task = taskUpdates[task0.id] ?? task0;
        const color = task.status === 'done' ? t.ok : task.status === 'failed' ? t.danger : task.status === 'waiting_user' ? t.warnText : t.primary;
        return (
          <Pressable key={task.id} onPress={() => task.call_id && router.push(`/call/${task.call_id}`)}>
            <Card>
              <Body style={{ fontWeight: '600' }}>{task.target_name || task.number}</Body>
              <Body>{task.goal}</Body>
              <Text style={{ color, fontWeight: '600' }}>{STATUS[task.status]}{task.outcome ? ` · ${task.outcome}` : ''}</Text>
              {task.result ? <Body>{task.result}</Body> : null}
              <Muted>{timeAgo(task.created_at)}</Muted>
            </Card>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
});
