import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { RuleCard } from '../components/domain/RuleCard';
import { RuleEditorSheet, type RuleDraft } from '../components/domain/RuleEditorSheet';
import { Banner } from '../components/ui/Banner';
import { Button } from '../components/ui/Button';
import { Chip } from '../components/ui/Chip';
import { EmptyState } from '../components/ui/EmptyState';
import { Screen } from '../components/ui/Screen';
import { Section } from '../components/ui/Section';
import { SkeletonRows } from '../components/ui/Skeleton';
import { Text } from '../components/ui/Text';
import { useToast } from '../components/ui/Toast';
import { errorMessage } from '../hooks/useAsyncAction';
import { useProfile } from '../hooks/useProfile';
import { api } from '../lib/api';
import { SHARE_WITH } from '../lib/labels';
import { isExpired, notePreview } from '../lib/rules';
import type { KnowledgeInput, KnowledgeNote, ShareWith } from '../lib/types';

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
  { text: "I'm travelling this week and back on Monday.", share_with: 'contacts' },
];

const BLANK: RuleDraft = { text: '', audience: 'contacts', numbers: [], category: '', expires_at: null };

const toInput = (d: RuleDraft): KnowledgeInput => ({
  text: d.text,
  share_with: d.audience as ShareWith,
  numbers: d.numbers,
  expires_at: d.expires_at,
});

const toDraft = (n: KnowledgeNote): RuleDraft => ({ text: n.text, audience: n.share_with, numbers: n.numbers, category: '', expires_at: n.expires_at });

/** What callers may know: facts the assistant may share, and with whom. */
export default function Notes() {
  const toast = useToast();
  const profile = useProfile();
  const [editing, setEditing] = useState<{ id: string | null; draft: RuleDraft } | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  const p = profile.data;
  const assistant = p?.assistant_name || 'Your assistant';
  const list = useMemo(() => {
    const rank = (n: KnowledgeNote) => (n.enabled && !isExpired(n.expires_at) ? 0 : 1);
    return [...(p?.knowledge ?? [])].sort((a, b) => rank(a) - rank(b) || b.created_at - a.created_at);
  }, [p?.knowledge]);

  const setList = (update: (list: KnowledgeNote[]) => KnowledgeNote[]) =>
    profile.mutate((d) => (d ? { ...d, knowledge: update(d.knowledge) } : d));

  const toggle = async (n: KnowledgeNote, enabled: boolean) => {
    setToggling(n.id);
    setList((l) => l.map((x) => (x.id === n.id ? { ...x, enabled } : x)));
    try {
      const saved = await api.updateNote(n.id, { enabled });
      setList((l) => l.map((x) => (x.id === n.id ? saved : x)));
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

  const editingNote = editing?.id ? list.find((x) => x.id === editing.id) : undefined;

  return (
    <Screen
      bottomInset
      refreshing={profile.refreshing}
      onRefresh={() => void profile.refresh()}
      footer={<Button title="New note" icon="add" fullWidth onPress={() => setEditing({ id: null, draft: BLANK })} />}
      testID="notes"
    >
      <Text variant="subhead" color="text2">
        Facts {assistant} may share when a caller asks. Anything not here, it checks with you first. It never shares OTPs, PINs,
        passwords, card or account numbers.
      </Text>
      <Banner
        tone="info"
        icon="moon-outline"
        title="Busy or away for a while?"
        message="Set an away status instead. Callers hear it straight away."
        action={{ label: 'Set away', onPress: () => router.push('/away') }}
      />
      {profile.error && !p ? (
        <Banner tone="danger" title="Couldn't load your notes" message={profile.error} action={{ label: 'Retry', onPress: () => void profile.reload() }} />
      ) : !p ? (
        <SkeletonRows rows={3} />
      ) : list.length === 0 ? (
        <>
          <EmptyState icon="book-outline" title="No notes yet" message="Add facts like when you're free, or where parcels go." compact />
          <Section title="Ideas" grouped={false}>
            <View style={styles.chips}>
              {IDEAS.map((idea) => (
                <Chip
                  key={idea.text}
                  kind="suggestion"
                  icon="add"
                  label={idea.text}
                  onPress={() => setEditing({ id: null, draft: { ...BLANK, text: idea.text, audience: idea.share_with } })}
                />
              ))}
            </View>
          </Section>
        </>
      ) : (
        <Section title={`${list.filter((n) => n.enabled && !isExpired(n.expires_at)).length} in use`} grouped={false}>
          {list.map((n) => (
            <RuleCard
              key={n.id}
              text={n.text}
              enabled={n.enabled}
              audience={SHARE_WITH[n.share_with] ?? n.share_with}
              audienceIcon={AUDIENCE_ICON[n.share_with]}
              expiresAt={n.expires_at}
              numbers={n.share_with === 'numbers' ? n.numbers : undefined}
              toggleBusy={toggling === n.id}
              onToggle={(v) => void toggle(n, v)}
              onPress={() => setEditing({ id: n.id, draft: toDraft(n) })}
              testID={`note-${n.id}`}
            />
          ))}
        </Section>
      )}

      <RuleEditorSheet
        visible={!!editing}
        kind="note"
        draft={editing?.draft ?? null}
        isNew={!editing?.id}
        audiences={SHARE_WITH}
        preview={(d) => notePreview(d.text, d.audience as ShareWith, assistant, d.expires_at)}
        onClose={() => setEditing(null)}
        onSave={save}
        onDelete={editingNote ? () => void remove(editingNote) : undefined}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
