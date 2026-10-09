import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { CallerPreview } from '../components/domain/CallerPreview';
import { RuleCard } from '../components/domain/RuleCard';
import { RuleEditorSheet, type RuleDraft } from '../components/domain/RuleEditorSheet';
import { Banner } from '../components/ui/Banner';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Chip } from '../components/ui/Chip';
import { ChipRow } from '../components/ui/ChipRow';
import { EmptyState } from '../components/ui/EmptyState';
import { Screen } from '../components/ui/Screen';
import { Section } from '../components/ui/Section';
import { SkeletonRows } from '../components/ui/Skeleton';
import { Text } from '../components/ui/Text';
import { useToast } from '../components/ui/Toast';
import { errorMessage } from '../hooks/useAsyncAction';
import { useProfile } from '../hooks/useProfile';
import { api, awayActive } from '../lib/api';
import { AWAY_PRESETS, DURATIONS, awayMessage, untilFor, type AwayPreset } from '../lib/away';
import { Icon } from '../lib/design';
import { useTokens } from '../lib/design/theme';
import { SHARE_WITH } from '../lib/labels';
import { numbersLabel } from '../lib/phone';
import { RULE_FILTERS, filterRules, notePreview, ruleCounts, type RuleFilter } from '../lib/rules';
import type { Away, KnowledgeInput, KnowledgeNote, ShareWith } from '../lib/types';

const AUDIENCE_ICON = {
  anyone: 'people-outline',
  contacts: 'person-outline',
  delivery: 'bicycle-outline',
  numbers: 'keypad-outline',
} as const;

const IDEAS: { text: string; share_with: ShareWith }[] = [
  { text: "I'm usually free to talk after 6 PM on weekdays.", share_with: 'contacts' },
  { text: 'Parcels can be left with the security guard at the main gate.', share_with: 'delivery' },
  { text: 'The office is closed on Sundays.', share_with: 'anyone' },
  { text: 'For work, email is the quickest way to reach me.', share_with: 'anyone' },
];

/** One-tap away statuses; "More" opens the full Away screen. */
const QUICK_AWAY: AwayPreset[] = ['meeting', 'driving', 'sleeping'].map((id) => AWAY_PRESETS.find((a) => a.id === id)!);

const BLANK: RuleDraft = { text: '', audience: 'contacts', numbers: [], category: '', expires_at: null };

const toInput = (d: RuleDraft): KnowledgeInput => ({
  text: d.text,
  share_with: d.audience as ShareWith,
  numbers: d.numbers,
  expires_at: d.expires_at,
});

const toDraft = (n: KnowledgeNote): RuleDraft => ({ text: n.text, audience: n.share_with, numbers: n.numbers, category: '', expires_at: n.expires_at });

const durationLabel = (a: AwayPreset) => DURATIONS.find((d) => d.value === a.defaultFor)?.label ?? '';

/** What callers may know: facts the assistant may share, and with whom.
 *  Being away for a while is an away status (PUT /away), not a note. */
export default function Notes() {
  const t = useTokens();
  const toast = useToast();
  const profile = useProfile();
  const [editing, setEditing] = useState<{ id: string | null; draft: RuleDraft } | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [filter, setFilter] = useState<RuleFilter>('all');
  const [awayBusy, setAwayBusy] = useState<string | null>(null);

  const p = profile.data;
  const assistant = p?.assistant_name || 'Your assistant';
  const homeCc = p?.home_country_code ?? '+91';
  const all = useMemo(() => p?.knowledge ?? [], [p?.knowledge]);
  const list = useMemo(() => filterRules(all, filter), [all, filter]);
  const counts = ruleCounts(all);
  const away = p && awayActive(p.away) ? p.away : null;
  const unusedIdeas = IDEAS.filter((idea) => !all.some((n) => n.text.trim().toLowerCase() === idea.text.toLowerCase()));

  const setList = (update: (list: KnowledgeNote[]) => KnowledgeNote[]) =>
    profile.mutate((d) => (d ? { ...d, knowledge: update(d.knowledge) } : d));

  const toggle = async (n: KnowledgeNote, enabled: boolean) => {
    setToggling(n.id);
    setList((l) => l.map((x) => (x.id === n.id ? { ...x, enabled } : x)));
    try {
      const saved = await api.updateNote(n.id, { enabled });
      setList((l) => l.map((x) => (x.id === n.id ? saved : x)));
      toast.success(enabled ? `Note on. ${assistant} may share it from the next call.` : 'Note off.');
    } catch (e) {
      setList((l) => l.map((x) => (x.id === n.id ? n : x)));
      toast.error(`Not changed. ${errorMessage(e)}`);
    } finally {
      setToggling(null);
    }
  };

  const save = async (d: RuleDraft) => {
    const id = editing?.id;
    if (id) {
      const saved = await api.updateNote(id, toInput(d));
      setList((l) => l.map((x) => (x.id === id ? saved : x)));
      toast.success('Note saved.');
    } else {
      const saved = await api.addNote({ ...toInput(d), enabled: true });
      setList((l) => [saved, ...l]);
      setFilter('all');
      toast.success('Note added.');
    }
    setEditing(null);
  };

  const remove = async (n: KnowledgeNote) => {
    setEditing(null);
    setList((l) => l.filter((x) => x.id !== n.id));
    try {
      await api.deleteNote(n.id);
    } catch (e) {
      setList((l) => [n, ...l]);
      toast.error(`Not deleted. ${errorMessage(e)}`);
      return;
    }
    toast.undo('Note deleted.', () => {
      api
        .addNote({ ...toInput(toDraft(n)), enabled: n.enabled })
        .then((back) => setList((l) => [back, ...l]))
        .catch((e: unknown) => toast.error(`Couldn't restore it. ${errorMessage(e)}`));
    });
  };

  // Puts back whatever away status was there before (or none).
  const restoreAway = (before: Away | null) => {
    const undo = before && awayActive(before) ? api.putAway({ preset: before.preset, message: before.message, until: before.until }) : api.clearAway();
    undo.then((back) => profile.mutate(() => back)).catch((e: unknown) => toast.error(`Couldn't undo. ${errorMessage(e)}`));
  };

  const setAway = async (preset: AwayPreset) => {
    const before = p?.away ?? null;
    const until = untilFor(preset.defaultFor);
    const message = awayMessage(preset.phrase, until);
    setAwayBusy(preset.id);
    try {
      const next = await api.putAway({ preset: preset.id, message, until });
      profile.mutate(() => next);
      toast.undo(`Away: ${message}. Callers hear it now.`, () => restoreAway(before));
    } catch (e) {
      toast.error(`Away not set. ${errorMessage(e)}`);
    } finally {
      setAwayBusy(null);
    }
  };

  const endAway = async () => {
    const before = p?.away ?? null;
    setAwayBusy('off');
    try {
      const next = await api.clearAway();
      profile.mutate(() => next);
      toast.undo('Away turned off. Calls are answered as usual.', () => restoreAway(before));
    } catch (e) {
      toast.error(`Still away. ${errorMessage(e)}`);
    } finally {
      setAwayBusy(null);
    }
  };

  const editingNote = editing?.id ? all.find((x) => x.id === editing.id) : undefined;
  const newFrom = (idea: (typeof IDEAS)[number]) => setEditing({ id: null, draft: { ...BLANK, text: idea.text, audience: idea.share_with } });

  return (
    <Screen
      bottomInset
      refreshing={profile.refreshing}
      onRefresh={() => void profile.refresh()}
      footer={<Button title="New note" icon="add" fullWidth onPress={() => setEditing({ id: null, draft: BLANK })} />}
      testID="notes"
    >
      <Text variant="subhead" color="text2">
        Facts {assistant} may share when a caller asks. Anything not here, it checks with you first.
      </Text>
      {profile.error && !p ? (
        <Banner tone="danger" title="Couldn't load your notes" message={profile.error} action={{ label: 'Retry', onPress: () => void profile.reload() }} />
      ) : !p ? (
        <SkeletonRows rows={3} />
      ) : (
        <>
          {away ? (
            <Card tone="info" testID="notes-away">
              <View style={styles.awayRow}>
                <Icon name="moon" size={20} color={t.color.info} />
                <View style={styles.flex}>
                  <Text variant="bodyStrong">Away: {away.message}</Text>
                  <Text variant="footnote" color="text2">
                    Callers hear this first, then {assistant} takes a message.
                  </Text>
                </View>
              </View>
              <View style={styles.awayActions}>
                <Button title="Change" size="sm" variant="tonal" icon="create-outline" onPress={() => router.push('/away')} />
                <Button title="Turn off" size="sm" variant="ghost" icon="close" loading={awayBusy === 'off'} onPress={() => void endAway()} />
              </View>
            </Card>
          ) : (
            <Card testID="notes-away">
              <View style={styles.awayRow}>
                <Icon name="moon-outline" size={20} color={t.color.text2} />
                <View style={styles.flex}>
                  <Text variant="bodyStrong">Busy or away for a while?</Text>
                  <Text variant="footnote" color="text2">
                    Set an away status instead of a note. Callers hear it straight away.
                  </Text>
                </View>
              </View>
              <ChipRow testID="away-quick">
                {QUICK_AWAY.map((a) => (
                  <Chip
                    key={a.id}
                    kind="suggestion"
                    icon={a.icon}
                    label={`${a.label} · ${durationLabel(a).replace(/^Until/, 'until')}`}
                    disabled={awayBusy != null}
                    onPress={() => void setAway(a)}
                  />
                ))}
                <Chip kind="suggestion" icon="ellipsis-horizontal" label="More" onPress={() => router.push('/away')} />
              </ChipRow>
            </Card>
          )}

          {all.length === 0 ? (
            <EmptyState icon="book-outline" title="No notes yet" message="Add facts like when you're free, or where parcels go." compact />
          ) : (
            <>
              <ChipRow testID="note-filters">
                {RULE_FILTERS.map((f) => (
                  <Chip
                    key={f.value}
                    label={f.label}
                    selected={filter === f.value}
                    count={f.value === 'all' ? undefined : counts[f.value] || undefined}
                    onPress={() => setFilter(f.value)}
                  />
                ))}
              </ChipRow>
              {list.length === 0 ? (
                <EmptyState
                  compact
                  icon={filter === 'ended' ? 'time-outline' : 'pause-circle-outline'}
                  title={filter === 'ended' ? 'Nothing has ended' : filter === 'paused' ? 'Nothing is switched off' : 'Nothing in use'}
                  message="Notes you give an end date move here once it passes."
                />
              ) : (
                <View style={styles.list} testID="note-list">
                  {list.map((n) => (
                    <RuleCard
                      key={n.id}
                      text={n.text}
                      enabled={n.enabled}
                      audience={n.share_with === 'numbers' ? numbersLabel(n.numbers, p.contacts, homeCc) : (SHARE_WITH[n.share_with] ?? n.share_with)}
                      audienceIcon={AUDIENCE_ICON[n.share_with]}
                      expiresAt={n.expires_at}
                      toggleBusy={toggling === n.id}
                      onToggle={(v) => void toggle(n, v)}
                      onPress={() => setEditing({ id: n.id, draft: toDraft(n) })}
                      testID={`note-${n.id}`}
                    />
                  ))}
                </View>
              )}
            </>
          )}

          {unusedIdeas.length ? (
            <Section title="Ideas" grouped={false}>
              <View style={styles.chips}>
                {unusedIdeas.map((idea) => (
                  <Chip key={idea.text} kind="suggestion" icon="add" label={idea.text} onPress={() => newFrom(idea)} />
                ))}
              </View>
            </Section>
          ) : null}

          {all.length ? (
            <Section title="Preview: who's calling?" grouped={false} testID="note-preview">
              <CallerPreview assistant={assistant} notes={all} />
            </Section>
          ) : null}
        </>
      )}

      <RuleEditorSheet
        visible={!!editing}
        kind="note"
        draft={editing?.draft ?? null}
        isNew={!editing?.id}
        audiences={SHARE_WITH}
        contacts={p?.contacts ?? []}
        homeCc={homeCc}
        preview={(d) => notePreview(d.text, d.audience as ShareWith, assistant, d.expires_at)}
        onClose={() => setEditing(null)}
        onSave={save}
        onDelete={editingNote ? () => void remove(editingNote) : undefined}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  awayRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  awayActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
});
