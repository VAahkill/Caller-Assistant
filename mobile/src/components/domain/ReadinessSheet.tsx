import { StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { noLineForCalls, phoneLineText, serverOutdated, serverOutdatedText, UPDATE_GUIDE_URL } from '../../lib/serverStatus';
import type { Health, ReadyFlags } from '../../lib/types';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';
import { openGuide } from './ServerNotices';

/** The parts of the server a call needs, in the order a call uses them. */
export const READY_PARTS: { key: keyof ReadyFlags; title: string; detail: string; icon: IconName }[] = [
  { key: 'stt', title: 'Hearing', detail: 'Speech to text', icon: 'ear-outline' },
  { key: 'lid', title: 'Language detection', detail: 'Which language the caller speaks', icon: 'globe-outline' },
  { key: 'mt', title: 'Translation', detail: 'Between the caller and you', icon: 'language-outline' },
  { key: 'llm', title: 'Thinking', detail: 'The language model', icon: 'sparkles-outline' },
  { key: 'tts', title: 'Voice', detail: 'Text to speech', icon: 'volume-high-outline' },
];

/** One line for the Today chip. */
export function readinessText(connected: boolean, health: Health | null): { ok: boolean; text: string } {
  if (!connected) return { ok: false, text: 'Reconnecting to your server' };
  if (!health) return { ok: true, text: 'Connected to your server' };
  if (serverOutdated(health)) return { ok: false, text: 'Connected · server needs updating' };
  if (!health.ready) return { ok: true, text: 'Connected' };
  const missing = READY_PARTS.filter((p) => !health.ready?.[p.key]).map((p) => p.title.toLowerCase());
  if (missing.length) return { ok: false, text: `Getting ready: ${missing.join(', ')}` };
  return noLineForCalls(health) ? { ok: false, text: 'Ready · no phone line yet' } : { ok: true, text: 'Connected · everything ready' };
}

export interface ReadinessSheetProps {
  visible: boolean;
  onClose: () => void;
  connected: boolean;
  health: Health | null;
  /** Health could not be fetched. */
  error?: string | null;
  refreshing?: boolean;
  onRefresh: () => void;
}

/** What the server reports about itself: each part a call needs, the model and the phone line. */
export function ReadinessSheet({ visible, onClose, connected, health, error, refreshing, onRefresh }: ReadinessSheetProps) {
  const t = useTokens();
  const c = t.color;
  const summary = readinessText(connected, health);
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Your server"
      subtitle={summary.text}
      testID="readiness-sheet"
      footer={<Button title="Check again" icon="refresh" variant="tonal" fullWidth loading={refreshing} onPress={onRefresh} />}
    >
      {error ? (
        <View style={styles.row}>
          <Icon name="alert-circle" size={20} color={c.danger} />
          <Text variant="subhead" color="danger" style={styles.flex}>
            {error}
          </Text>
        </View>
      ) : null}
      {health?.ready ? (
        READY_PARTS.map((p) => {
          const ok = !!health.ready?.[p.key];
          return (
            <View key={p.key} style={styles.row} accessible accessibilityLabel={`${p.title}: ${ok ? 'ready' : 'still loading'}`} testID={`ready-${p.key}`}>
              <View style={[styles.icon, { backgroundColor: ok ? c.successContainer : c.warningContainer }]}>
                <Icon name={p.icon} size={18} color={ok ? c.onSuccessContainer : c.onWarningContainer} />
              </View>
              <View style={styles.flex}>
                <Text variant="callout" weight="semibold">
                  {p.title}
                </Text>
                <Text variant="footnote" color="text2">
                  {p.key === 'llm' && health.llm_model ? `${p.detail} · ${health.llm_model}` : p.detail}
                </Text>
              </View>
              <Text variant="footnote" weight="semibold" color={ok ? 'success' : 'warning'}>
                {ok ? 'Ready' : 'Loading…'}
              </Text>
            </View>
          );
        })
      ) : health && !serverOutdated(health) ? (
        <Text variant="subhead" color="text2">
          This server doesn't report which parts are ready. Update it to see each one here.
        </Text>
      ) : null}
      {serverOutdated(health) ? (
        <View style={[styles.note, { backgroundColor: c.warningContainer, borderRadius: t.radius.md }]} testID="ready-outdated">
          <Text variant="subhead" color={c.onWarningContainer}>
            {serverOutdatedText(health)}
          </Text>
          <View style={styles.noteAction}>
            <Button title="Open the setup guide" size="sm" icon="open-outline" onPress={() => openGuide(UPDATE_GUIDE_URL)} />
          </View>
        </View>
      ) : null}
      {health?.phone_line?.detail ? (
        <View style={styles.row} testID="ready-phone-line">
          <View style={[styles.icon, { backgroundColor: health.phone_line.ok ? c.successContainer : c.warningContainer }]}>
            <Icon name="call-outline" size={18} color={health.phone_line.ok ? c.onSuccessContainer : c.onWarningContainer} />
          </View>
          <Text variant="footnote" color="text2" style={styles.flex}>
            {health.phone_line.detail}
          </Text>
        </View>
      ) : null}
      {health ? (
        <View style={[styles.facts, { borderTopColor: c.border }]}>
          <Fact label="Phone line" value={phoneLineText(health)} />
          <Fact label="Calls right now" value={String(health.active_calls)} />
          {health.version ? <Fact label="Server version" value={health.version} /> : null}
        </View>
      ) : null}
    </BottomSheet>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text variant="footnote" color="text2" style={styles.flex}>
        {label}
      </Text>
      <Text variant="footnote" weight="semibold">
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  facts: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 8, paddingTop: 12, gap: 8 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  note: { padding: 12, gap: 8 },
  noteAction: { flexDirection: 'row' },
});
