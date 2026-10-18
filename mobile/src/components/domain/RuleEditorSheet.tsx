import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { errorMessage } from '../../hooks/useAsyncAction';
import { useTokens } from '../../lib/design/theme';
import { prettyNumber } from '../../lib/format';
import { contactName, normalizeNumber, type NamedNumber } from '../../lib/phone';
import { EXPIRY_LABEL, expiryFor, expiryText, parseNumbers, presetOf, type ExpiryPreset } from '../../lib/rules';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { CalendarPicker } from '../ui/CalendarPicker';
import { Chip } from '../ui/Chip';
import { Text } from '../ui/Text';
import { TextField } from '../ui/TextField';
import { ContactPicker } from './ContactPicker';

export interface RuleDraft {
  text: string;
  audience: string;
  numbers: string[];
  category: string;
  expires_at: number | null;
}

export interface RuleEditorSheetProps {
  visible: boolean;
  /** Instruction or note; changes the labels only. */
  kind: 'instruction' | 'note';
  /** The rule being edited, or a template / blank draft for a new one. */
  draft: RuleDraft | null;
  isNew: boolean;
  audiences: Record<string, string>;
  /** Category chips (instructions only). */
  categories?: Record<string, string>;
  /** Saved contacts, to pick "specific numbers" from. */
  contacts?: NamedNumber[];
  homeCc?: string;
  /** Plain-English summary of what the rule does, shown live as you type. */
  preview: (d: RuleDraft) => string;
  onClose: () => void;
  /** Throws to keep the sheet open with the error shown. */
  onSave: (d: RuleDraft) => Promise<void>;
  onDelete?: () => void;
}

const PRESETS: Exclude<ExpiryPreset, 'custom'>[] = ['never', 'today', 'week'];

/** Edit one instruction or note: text, who it applies to (with numbers picked
 *  from contacts), category, and when it ends (a preset or a day on a calendar). */
export function RuleEditorSheet({
  visible,
  kind,
  draft,
  isNew,
  audiences,
  categories,
  contacts = [],
  homeCc = '+91',
  preview,
  onClose,
  onSave,
  onDelete,
}: RuleEditorSheetProps) {
  const t = useTokens();
  const [d, setD] = useState<RuleDraft>({ text: '', audience: 'everyone', numbers: [], category: 'general', expires_at: null });
  // Numbers picked from contacts, and the ones typed in (comma separated).
  const [picked, setPicked] = useState<string[]>([]);
  const [numbersText, setNumbersText] = useState('');
  const [calendar, setCalendar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new draft (another rule, or a template) replaces what is in the form.
  const [source, setSource] = useState<RuleDraft | null>(null);
  if (draft && draft !== source) {
    setSource(draft);
    setD(draft);
    const saved = draft.numbers.map((n) => normalizeNumber(n, homeCc));
    setPicked(saved.filter((n) => contactName(contacts, n, homeCc)));
    setNumbersText(
      saved
        .filter((n) => !contactName(contacts, n, homeCc))
        .map(prettyNumber)
        .join(', '),
    );
    setCalendar(presetOf(draft.expires_at) === 'custom');
    setError(null);
  }

  const preset = presetOf(d.expires_at);
  const numbers = [...new Set([...picked, ...parseNumbers(numbersText, homeCc)])];
  const needsNumbers = d.audience === 'numbers' && numbers.length === 0;
  const current = { ...d, numbers: d.audience === 'numbers' ? numbers : [] };

  const togglePicked = (n: string) => setPicked((list) => (list.includes(n) ? list.filter((x) => x !== n) : [...list, n]));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({ ...current, text: d.text.trim() });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const noun = kind === 'instruction' ? 'instruction' : 'note';
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={isNew ? `New ${noun}` : `Edit ${noun}`}
      footer={
        <View style={styles.footer}>
          {onDelete && !isNew ? <Button title="Delete" variant="ghost" icon="trash-outline" onPress={onDelete} disabled={saving} /> : null}
          <Button
            title={isNew ? `Add ${noun}` : 'Save'}
            icon={isNew ? 'add' : 'checkmark'}
            loading={saving}
            disabled={!d.text.trim() || needsNumbers}
            onPress={() => void save()}
            style={styles.flex}
          />
        </View>
      }
    >
      <View style={styles.body}>
        <TextField
          label={kind === 'instruction' ? 'What should the assistant do?' : 'What may it tell callers?'}
          value={d.text}
          onChangeText={(text) => setD((x) => ({ ...x, text }))}
          multiline
          minLines={3}
          maxLength={500}
          counter
          autoFocus={isNew && !draft?.text}
          helper={kind === 'instruction' ? 'Write it as you would tell a person, in any language.' : 'A fact, in any language. Callers hear it in theirs.'}
          error={error}
        />

        <View style={styles.group}>
          <Text variant="overline" color="text2">
            {kind === 'instruction' ? 'Applies to' : 'Share with'}
          </Text>
          <View style={styles.chips}>
            {Object.entries(audiences).map(([value, label]) => (
              <Chip key={value} label={label} selected={d.audience === value} onPress={() => setD((x) => ({ ...x, audience: value }))} />
            ))}
          </View>
          {d.audience === 'numbers' ? (
            <View style={styles.group} testID="rule-numbers">
              {picked.length ? (
                <View style={styles.chips}>
                  {picked.map((n) => (
                    <Chip key={n} kind="input" icon="person" label={contactName(contacts, n, homeCc) ?? prettyNumber(n)} onRemove={() => togglePicked(n)} />
                  ))}
                </View>
              ) : null}
              <ContactPicker contacts={contacts} homeCc={homeCc} selected={picked} multi onPick={(n) => togglePicked(n)} />
              <TextField
                label="Phone numbers"
                value={numbersText}
                onChangeText={setNumbersText}
                keyboardType="phone-pad"
                placeholder="+91 98480 12345"
                helper={
                  numbers.length
                    ? `${numbers.length} number${numbers.length === 1 ? '' : 's'}. Separate them with commas.`
                    : 'Pick from your contacts, or type numbers. Separate them with commas.'
                }
              />
            </View>
          ) : null}
        </View>

        {categories ? (
          <View style={styles.group}>
            <Text variant="overline" color="text2">
              Category
            </Text>
            <View style={styles.chips}>
              {Object.entries(categories).map(([value, label]) => (
                <Chip key={value} label={label} selected={d.category === value} onPress={() => setD((x) => ({ ...x, category: value }))} />
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.group}>
          <Text variant="overline" color="text2">
            Ends
          </Text>
          <View style={styles.chips}>
            {PRESETS.map((p) => (
              <Chip
                key={p}
                label={EXPIRY_LABEL[p]}
                selected={!calendar && preset === p}
                onPress={() => {
                  setCalendar(false);
                  setD((x) => ({ ...x, expires_at: expiryFor(p) }));
                }}
              />
            ))}
            <Chip
              label={calendar && d.expires_at != null ? (expiryText(d.expires_at) ?? 'Pick a date') : 'Pick a date'}
              icon="calendar-outline"
              selected={calendar}
              onPress={() => setCalendar(true)}
            />
          </View>
          {calendar ? (
            <View style={[styles.calendar, { backgroundColor: t.color.surface2, borderRadius: t.radius.md }]}>
              <CalendarPicker value={d.expires_at} onChange={(expires_at) => setD((x) => ({ ...x, expires_at }))} testID="rule-calendar" />
            </View>
          ) : null}
        </View>

        <View style={[styles.preview, { backgroundColor: t.color.primaryContainer, borderRadius: t.radius.md }]} accessibilityLiveRegion="polite">
          <Text variant="overline" color="onPrimaryContainer">
            {kind === 'instruction' ? 'What the assistant will do' : 'Who hears this'}
          </Text>
          <Text variant="subhead" color="onPrimaryContainer">
            {preview(current)}
          </Text>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 20 },
  group: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  calendar: { padding: 8 },
  preview: { padding: 14, gap: 6 },
  footer: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
});
