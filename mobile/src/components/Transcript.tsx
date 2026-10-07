import { useEffect, useRef } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../lib/theme';
import type { TranscriptLine } from '../lib/types';

const LABEL: Record<TranscriptLine['speaker'], string> = {
  caller: 'Caller',
  assistant: 'Assistant',
  user: 'You',
  system: '',
};

/** Chat-style live transcript. Caller on the left, assistant and you on the right. */
export function Transcript({ lines, callerLabel }: { lines: TranscriptLine[]; callerLabel?: string }) {
  const t = useTheme();
  const list = useRef<FlatList<TranscriptLine>>(null);

  useEffect(() => {
    const id = setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(id);
  }, [lines.length]);

  return (
    <FlatList
      ref={list}
      data={lines}
      keyExtractor={(_, i) => String(i)}
      contentContainerStyle={{ padding: 12, gap: 8 }}
      renderItem={({ item }) => {
        if (item.kind === 'hold_question') {
          return (
            <View style={[styles.banner, { backgroundColor: t.warn }]}>
              <Text style={{ color: t.warnText, fontWeight: '700' }}>Needs your answer</Text>
              <Text style={{ color: t.warnText, fontSize: 16 }}>{item.text}</Text>
            </View>
          );
        }
        if (item.speaker === 'system') {
          const alert = item.kind === 'alert';
          return (
            <Text style={[styles.system, { color: alert ? t.danger : t.muted }]}>
              {alert ? '🔒 ' : ''}
              {item.text}
            </Text>
          );
        }
        const mine = item.speaker !== 'caller';
        const bg = item.speaker === 'caller' ? t.caller : item.speaker === 'user' ? t.user : t.assistant;
        return (
          <View style={[styles.row, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
            <View style={[styles.bubble, { backgroundColor: bg }]}>
              <Text style={[styles.who, { color: t.muted }]}>
                {item.speaker === 'caller' ? callerLabel || LABEL.caller : LABEL[item.speaker]}
              </Text>
              <Text style={{ color: t.text, fontSize: 16, lineHeight: 22 }}>{item.text}</Text>
            </View>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  bubble: { maxWidth: '82%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  who: { fontSize: 11, fontWeight: '600', marginBottom: 2 },
  banner: { borderRadius: 12, padding: 12, gap: 4 },
  system: { textAlign: 'center', fontSize: 13, marginVertical: 2 },
});
