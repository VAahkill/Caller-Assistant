import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { errorMessage } from '../../hooks/useAsyncAction';
import { useTokens } from '../../lib/design/theme';
import { EXPIRY_LABEL, expiryFor, expiryText, parseNumbers, presetOf, type ExpiryPreset } from '../../lib/rules';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Text } from '../ui/Text';
import { TextField } from '../ui/TextField';

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
  /** Plain-English summary of what the rule does, shown live as you type. */
  preview: (d: RuleDraft) => string;
  onClose: () => void;
  /** Throws to keep the sheet open with the error shown. */
  onSave: (d: RuleDraft) => Promise<void>;
  onDelete?: () => void;
}

const PRESETS: Exclude<ExpiryPreset, 'custom'>[] = ['never', 'today', 'week'];

/** Edit one instruction or note: text, who it applies to, category and when it ends. */
export function RuleEditorSheet({ visible, kind, draft, isNew, audiences, categories, preview, onClose, onSave, onDelete }: RuleEditorSheetProps) {
  const t = useTokens();
  const [d, setD] = useState<RuleDraft>({ text: '', audience: 'everyone', numbers: [], category: 'general', expires_at: null });
  const [numbersText, setNumbersText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new draft (another rule, or a template) replaces what is in the form.
  const [source, setSource] = useState<RuleDraft | null>(null);
  if (draft && draft !== source) {
    setSource(draft);
    setD(draft);
    setNumbersText(draft.numbers.join(', '));
    setError(null);
  }

  const preset = presetOf(d.expires_at);
  const numbers = parseNumbers(numbersText);
  const needsNumbers = d.audience === 'numbers' && numbers.length === 0;
  const current = { ...d, numbers: d.audience === 'numbers' ? numbers : [] };

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
            <TextField
              label="Phone numbers"
              value={numbersText}
              onChangeText={setNumbersText}
              keyboardType="phone-pad"
              helper={numbers.length ? `${numbers.length} number${numbers.length === 1 ? '' : 's'}. Separate them with commas.` : 'Separate them with commas.'}
              // STUB(B3): pick numbers from saved contacts instead of typing them.
            />
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
              <Chip key={p} label={EXPIRY_LABEL[p]} selected={preset === p} onPress={() => setD((x) => ({ ...x, expires_at: expiryFor(p) }))} />
            ))}
            {preset === 'custom' ? <Chip label={expiryText(d.expires_at) ?? 'Custom'} selected /> : null}
            {/* STUB(B3): a "Pick a date" chip with a date picker for custom expiry. */}
          </View>
        </View>

        <View style={[styles.preview, { backgroundColor: t.color.surface2, borderRadius: t.radius.md }]} accessibilityLiveRegion="polite">
          <Text variant="overline" color="text2">
            What the assistant will do
          </Text>
          <Text variant="subhead">{preview(current)}</Text>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 20 },
  group: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  preview: { padding: 14, gap: 6 },
  footer: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
});
