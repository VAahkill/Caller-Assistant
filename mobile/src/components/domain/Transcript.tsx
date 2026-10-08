import { StyleSheet, View } from 'react-native';

import type { TranscriptLine } from '../../lib/types';
import { ChatBubble } from '../ui/ChatBubble';
import { Text } from '../ui/Text';

export interface TranscriptProps {
  lines: TranscriptLine[];
  callerLabel: string;
  assistantLabel?: string;
  showTranslation: boolean;
  ownerLanguage: string;
  /** Live calls: a missing translation is on its way. */
  live?: boolean;
  emptyText?: string;
}

/** The lines of a call as chat bubbles, each with its translation. */
export function Transcript({ lines, callerLabel, assistantLabel, showTranslation, ownerLanguage, live, emptyText }: TranscriptProps) {
  if (!lines.length) {
    return (
      <Text variant="subhead" color="text2" align="center" style={styles.empty}>
        {emptyText ?? (live ? 'Waiting for the first words…' : 'No transcript for this call.')}
      </Text>
    );
  }
  return (
    <View style={styles.list} accessibilityRole="list">
      {lines.map((line, i) => (
        <ChatBubble
          key={line.id}
          line={line}
          callerLabel={callerLabel}
          assistantLabel={assistantLabel}
          showTranslation={showTranslation}
          ownerLanguage={ownerLanguage}
          // Only recent lines can still be waiting for their translation.
          awaitingTranslation={!!live && i >= lines.length - 2}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10 },
  empty: { paddingVertical: 32 },
});
