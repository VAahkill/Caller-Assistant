import { StyleSheet, View } from 'react-native';

import { useTokens } from '../../lib/design/theme';
import { WORKING, workingText } from '../../lib/liveStatus';
import type { OutboxItem } from '../../lib/outbox';
import type { AssistantState, TranscriptLine } from '../../lib/types';
import { ChatBubble } from '../ui/ChatBubble';
import { Text } from '../ui/Text';
import { TypingDots } from '../ui/TypingDots';
import { OutboxBubble } from './OutboxBubble';

export interface TranscriptProps {
  lines: TranscriptLine[];
  callerLabel: string;
  assistantLabel?: string;
  showTranslation: boolean;
  ownerLanguage: string;
  /** Live calls: a missing translation is on its way. */
  live?: boolean;
  emptyText?: string;
  /** Sends not in the transcript yet (shown after the lines). */
  pending?: OutboxItem[];
  /** Label over the owner's pending bubbles (default "You"). */
  userLabel?: string;
  onRetry?: (id: string) => void;
  onRemove?: (id: string) => void;
  /** The assistant's state; while it works on a reply a typing indicator shows. */
  state?: AssistantState;
}

/** The lines of a call as chat bubbles, each with its translation, then
 *  anything just sent and, while the assistant works, a typing indicator. */
export function Transcript({
  lines,
  callerLabel,
  assistantLabel = 'Assistant',
  showTranslation,
  ownerLanguage,
  live,
  emptyText,
  pending = [],
  userLabel = 'You',
  onRetry,
  onRemove,
  state,
}: TranscriptProps) {
  const working = !!live && !!state && WORKING.has(state);
  if (!lines.length && !pending.length && !working) {
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
      {pending.map((item) => (
        <OutboxBubble
          key={item.id}
          item={item}
          label={item.speaker === 'user' ? userLabel : callerLabel}
          assistantName={assistantLabel}
          onRetry={onRetry}
          onRemove={onRemove}
        />
      ))}
      {working ? <WorkingBubble text={workingText(state!, assistantLabel)} /> : null}
    </View>
  );
}

/** The assistant's side of the chat while it hears, translates or thinks. */
export function WorkingBubble({ text }: { text: string }) {
  const t = useTokens();
  return (
    <View style={[styles.row, styles.end]} testID="working" accessible accessibilityLabel={text} accessibilityLiveRegion="polite">
      <View style={[styles.working, { backgroundColor: t.color.bubbleAssistant, borderRadius: t.radius.lg, borderTopRightRadius: 6 }]}>
        <TypingDots color={t.color.onPrimaryContainer} />
        <Text variant="footnote" color="text2" numberOfLines={1}>
          {text}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10 },
  empty: { paddingVertical: 32 },
  row: { flexDirection: 'row' },
  end: { justifyContent: 'flex-end' },
  working: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, maxWidth: '86%' },
});
