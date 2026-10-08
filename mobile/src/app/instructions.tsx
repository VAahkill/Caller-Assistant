import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { RuleCard } from '../components/domain/RuleCard';
import { RuleEditorSheet, type RuleDraft } from '../components/domain/RuleEditorSheet';
import { Banner } from '../components/ui/Banner';
import { BottomSheet } from '../components/ui/BottomSheet';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Screen } from '../components/ui/Screen';
import { Section } from '../components/ui/Section';
import { SkeletonRows } from '../components/ui/Skeleton';
import { Text } from '../components/ui/Text';
import { useToast } from '../components/ui/Toast';
import { errorMessage } from '../hooks/useAsyncAction';
import { useProfile } from '../hooks/useProfile';
import { useResource } from '../hooks/useResource';
import { api } from '../lib/api';
import { Icon } from '../lib/design';
import { useTokens } from '../lib/design/theme';
import { APPLIES_TO, INSTRUCTION_CATEGORY, categoryLabel } from '../lib/labels';
import { instructionPreview, isExpired } from '../lib/rules';
import type { AppliesTo, Instruction, InstructionInput, InstructionTemplate } from '../lib/types';

const AUDIENCE_ICON = {
  everyone: 'people-outline',
  contacts: 'person-outline',
  unknown: 'help-circle-outline',
  delivery: 'bicycle-outline',
  numbers: 'keypad-outline',
} as const;

const CATEGORIES = Object.fromEntries(Object.entries(INSTRUCTION_CATEGORY).map(([k, v]) => [k, v.label]));

const BLANK: RuleDraft = { text: '', audience: 'everyone', numbers: [], category: 'general', expires_at: null };

const toInput = (d: RuleDraft): InstructionInput => ({
  text: d.text,
  applies_to: d.audience as AppliesTo,
  numbers: d.numbers,
  category: d.category,
  expires_at: d.expires_at,
});

const toDraft = (i: Pick<Instruction, 'text' | 'applies_to' | 'numbers' | 'category' | 'expires_at'>): RuleDraft => ({
  text: i.text,
  audience: i.applies_to,
  numbers: i.numbers,
  category: i.category || 'general',
  expires_at: i.expires_at,
});

/** Instructions: rules for how calls are handled. On/off, who it applies to, when it ends. */
export default function Instructions() {
  const t = useTokens();
  const toast = useToast();
  const profile = useProfile();
  const templates = useResource(() => api.instructionTemplates());
  const [editing, setEditing] = useState<{ id: string | null; draft: RuleDraft } | null>(null);
  const [ideas, setIdeas] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const p = profile.data;
  const assistant = p?.assistant_name || 'Your assistant';
  const list = useMemo(() => {
    const items = [...(p?.instructions ?? [])];
    // In use first, then off or ended; newest first within each.
    const rank = (i: Instruction) => (i.enabled && !isExpired(i.expires_at) ? 0 : 1);
    return items.sort((a, b) => rank(a) - rank(b) || b.created_at - a.created_at);
  }, [p?.instructions]);

  const setList = (update: (list: Instruction[]) => Instruction[]) =>
    profile.mutate((d) => (d ? { ...d, instructions: update(d.instructions) } : d));

  const toggle = async (i: Instruction, enabled: boolean) => {
    setToggling(i.id);
    setList((l) => l.map((x) => (x.id === i.id ? { ...x, enabled } : x)));
    try {
      const saved = await api.updateInstruction(i.id, { enabled });
      setList((l) => l.map((x) => (x.id === i.id ? saved : x)));
    } catch (e) {
      setList((l) => l.map((x) => (x.id === i.id ? i : x)));
      toast.error(`Not changed. ${errorMessage(e)}`);
    } finally {
      setToggling(null);
    }
  };

  const save = async (d: RuleDraft) => {
    const id = editing?.id;
    if (id) {
      const saved = await api.updateInstruction(id, toInput(d));
      setList((l) => l.map((x) => (x.id === id ? saved : x)));
      toast.success('Instruction saved.');
    } else {
      const saved = await api.addInstruction({ ...toInput(d), enabled: true });
      setList((l) => [saved, ...l]);
      toast.success('Instruction added. It applies from the next call.');
    }
    setEditing(null);
  };

  const remove = async (i: Instruction) => {
    setEditing(null);
    setList((l) => l.filter((x) => x.id !== i.id));
    try {
      await api.deleteInstruction(i.id);
    } catch (e) {
      setList((l) => [i, ...l]);
      toast.error(`Not deleted. ${errorMessage(e)}`);
      return;
    }
    // Undo puts the same rule back (it gets a new id on the server).
    toast.undo('Instruction deleted.', () => {
      api
        .addInstruction({ ...toInput(toDraft(i)), enabled: i.enabled })
        .then((back) => setList((l) => [back, ...l]))
        .catch((e: unknown) => toast.error(`Couldn't restore it. ${errorMessage(e)}`));
    });
  };

  const fromTemplate = (tpl: InstructionTemplate) => {
    setIdeas(false);
    setEditing({ id: null, draft: { ...BLANK, text: tpl.text, audience: tpl.applies_to, category: tpl.category } });
  };

  const editingRule = editing?.id ? list.find((x) => x.id === editing.id) : undefined;

  return (
    <Screen
      bottomInset
      refreshing={profile.refreshing}
      onRefresh={() => void profile.refresh()}
      footer={
        <View style={styles.footer}>
          <Button title="Ideas" variant="tonal" icon="bulb-outline" onPress={() => setIdeas(true)} style={styles.flex} />
          <Button title="New instruction" icon="add" onPress={() => setEditing({ id: null, draft: BLANK })} style={styles.flex} />
        </View>
      }
      testID="instructions"
    >
      <Text variant="subhead" color="text2">
        Rules {assistant} follows on every call. Turn one off to pause it, or give it an end date.
      </Text>
      {profile.error && !p ? (
        <Banner tone="danger" title="Couldn't load your instructions" message={profile.error} action={{ label: 'Retry', onPress: () => void profile.reload() }} />
      ) : !p ? (
        <SkeletonRows rows={4} />
      ) : list.length === 0 ? (
        <EmptyState
          icon="list-outline"
          title="No instructions yet"
          message={`Tell ${assistant} how to handle couriers, family, sales calls and more. Start from an idea or write your own.`}
          action={{ label: 'Browse ideas', icon: 'bulb-outline', onPress: () => setIdeas(true) }}
        />
      ) : (
        <Section title={`${list.filter((i) => i.enabled && !isExpired(i.expires_at)).length} in use`} grouped={false}>
          {list.map((i) => (
            <RuleCard
              key={i.id}
              text={i.text}
              enabled={i.enabled}
              audience={APPLIES_TO[i.applies_to] ?? i.applies_to}
              audienceIcon={AUDIENCE_ICON[i.applies_to]}
              category={i.category && i.category !== 'general' ? categoryLabel(i.category) : undefined}
              expiresAt={i.expires_at}
              numbers={i.applies_to === 'numbers' ? i.numbers : undefined}
              toggleBusy={toggling === i.id}
              onToggle={(v) => void toggle(i, v)}
              onPress={() => setEditing({ id: i.id, draft: toDraft(i) })}
              testID={`instruction-${i.id}`}
            />
          ))}
        </Section>
      )}

      <RuleEditorSheet
        visible={!!editing}
        kind="instruction"
        draft={editing?.draft ?? null}
        isNew={!editing?.id}
        audiences={APPLIES_TO}
        categories={CATEGORIES}
        preview={(d) => instructionPreview(d.text, d.audience as AppliesTo, assistant, d.expires_at)}
        onClose={() => setEditing(null)}
        onSave={save}
        onDelete={editingRule ? () => void remove(editingRule) : undefined}
      />

      <BottomSheet visible={ideas} onClose={() => setIdeas(false)} title="Ideas" subtitle="Tap one to adjust it before adding.">
        {templates.error && !templates.data ? (
          <Banner tone="danger" title="Couldn't load ideas" message={templates.error} action={{ label: 'Retry', onPress: () => void templates.reload() }} />
        ) : !templates.data ? (
          <SkeletonRows rows={4} />
        ) : (
          <View style={styles.ideas}>
            {groupByCategory(templates.data).map(([cat, items]) => (
              <View key={cat} style={styles.group}>
                <View style={styles.groupTitle}>
                  <Icon name={INSTRUCTION_CATEGORY[cat]?.icon ?? 'list-outline'} size={16} color={t.color.text2} />
                  <Text variant="overline" color="text2">
                    {categoryLabel(cat)}
                  </Text>
                </View>
                {items.map((tpl) => (
                  <Pressable
                    key={tpl.text}
                    onPress={() => fromTemplate(tpl)}
                    accessibilityRole="button"
                    accessibilityLabel={`Use: ${tpl.text}`}
                    android_ripple={{ color: t.color.surface3 }}
                    style={[styles.idea, { backgroundColor: t.color.surface2, borderRadius: t.radius.md }]}
                  >
                    <Text variant="subhead" style={styles.flex}>
                      {tpl.text}
                    </Text>
                    <Icon name="add-circle-outline" size={20} color={t.color.primary} />
                  </Pressable>
                ))}
              </View>
            ))}
          </View>
        )}
      </BottomSheet>
    </Screen>
  );
}

function groupByCategory(list: InstructionTemplate[]): [string, InstructionTemplate[]][] {
  const groups = new Map<string, InstructionTemplate[]>();
  for (const tpl of list) groups.set(tpl.category, [...(groups.get(tpl.category) ?? []), tpl]);
  return [...groups.entries()];
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  footer: { flexDirection: 'row', gap: 10 },
  ideas: { gap: 20 },
  group: { gap: 8 },
  groupTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  idea: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
});
