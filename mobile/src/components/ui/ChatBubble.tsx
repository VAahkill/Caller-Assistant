import { StyleSheet, View } from 'react-native';

import { Icon } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { clockTime } from '../../lib/format';
import { languageName, languageTag } from '../../lib/languages';
import type { TranscriptLine } from '../../lib/types';
import { Skeleton } from './Skeleton';
import { Text } from './Text';

export interface ChatBubbleProps {
  line: TranscriptLine;
  callerLabel?: string;
  assistantLabel?: string;
  /** Show the owner-language translation under the original (owner's toggle). */
  showTranslation?: boolean;
  /** The owner's language; a line already in it needs no translation. */
  ownerLanguage?: string;
  /** Live calls expect a translation to arrive; show a placeholder meanwhile. */
  awaitingTranslation?: boolean;
  testID?: string;
}

function LangTag({ code, color, bg }: { code: string; color: string; bg: string }) {
  if (!code) return null;
  return (
    <View style={[styles.tag, { backgroundColor: bg }]} accessibilityLabel={languageName(code)}>
      <Text variant="caption" weight="semibold" color={color} style={styles.tagText}>
        {languageTag(code)}
      </Text>
    </View>
  );
}

/** One line of a call: what was said, in its language, with the translation
 *  in the owner's language underneath (owner item 4). */
export function ChatBubble({
  line,
  callerLabel = 'Caller',
  assistantLabel = 'Assistant',
  showTranslation = true,
  ownerLanguage = 'en',
  awaitingTranslation = false,
  testID,
}: ChatBubbleProps) {
  const t = useTokens();
  const c = t.color;

  if (line.kind === 'alert') {
    return (
      <View testID={testID} style={[styles.system, { backgroundColor: c.dangerContainer, borderRadius: t.radius.md }]}>
        <Icon name="shield-checkmark" size={16} color={c.onDangerContainer} />
        <Text variant="footnote" weight="medium" color={c.onDangerContainer} style={styles.flexShrink}>
          {line.translation || line.text}
        </Text>
      </View>
    );
  }
  if (line.speaker === 'system' || line.kind === 'note') {
    return (
      <Text testID={testID} variant="footnote" color="text2" align="center" style={styles.note}>
        {line.translation || line.text}
      </Text>
    );
  }

  const isUser = line.speaker === 'user';
  const mine = line.speaker !== 'caller';
  const hold = line.kind === 'hold_question';
  const bg = hold
    ? c.warningContainer
    : line.speaker === 'caller'
      ? c.bubbleCaller
      : isUser
        ? c.bubbleYou
        : c.bubbleAssistant;
  const fg = hold ? c.onWarningContainer : c.text;
  const sub = hold ? c.onWarningContainer : c.text2;
  const who = line.speaker === 'caller' ? callerLabel : isUser ? 'You' : assistantLabel;

  // For the owner's own lines, what they wrote leads; what the caller heard follows.
  const primary = isUser && line.translation ? line.translation : line.text;
  const secondary = isUser ? (line.translation && line.translation !== line.text ? line.text : '') : line.translation;
  const secondaryLang = isUser ? line.lang : line.translation_lang;
  const needsTranslation = !!line.lang && line.lang !== ownerLanguage;
  const showSecondary = !!secondary && (isUser || (showTranslation && needsTranslation));
  const showPending = !isUser && showTranslation && needsTranslation && !line.translation && awaitingTranslation;

  return (
    <View testID={testID} style={[styles.row, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: bg,
            borderRadius: t.radius.lg,
            borderTopLeftRadius: mine ? t.radius.lg : 6,
            borderTopRightRadius: mine ? 6 : t.radius.lg,
          },
        ]}
      >
        <View style={styles.meta}>
          {hold ? <Icon name="hand-left-outline" size={13} color={sub} /> : null}
          <Text variant="caption" weight="semibold" color={sub} numberOfLines={1} style={styles.flexShrink}>
            {hold ? `${callerLabel} asks you` : who}
          </Text>
          <LangTag code={isUser ? ownerLanguage : line.lang} color={sub} bg={c.overlay} />
          <Text variant="caption" color={sub} tabular>
            {clockTime(line.at)}
          </Text>
        </View>
        <Text variant="body" color={fg} selectable>
          {primary}
        </Text>
        {showSecondary ? (
          <View style={[styles.translation, { backgroundColor: c.translation, borderRadius: t.radius.sm }]}>
            <View style={styles.meta}>
              <Icon name={isUser ? 'volume-medium-outline' : 'language-outline'} size={13} color={sub} />
              <Text variant="caption" weight="medium" color={sub}>
                {isUser ? `They heard, in ${languageName(secondaryLang)}` : `In ${languageName(secondaryLang || ownerLanguage)}`}
              </Text>
            </View>
            <Text variant="subhead" color={isUser ? sub : fg} selectable>
              {secondary}
            </Text>
          </View>
        ) : null}
        {showPending ? (
          <View style={[styles.translation, { backgroundColor: c.translation, borderRadius: t.radius.sm }]} accessibilityLabel="Translating">
            <View style={styles.meta}>
              <Icon name="language-outline" size={13} color={sub} />
              <Text variant="caption" weight="medium" color={sub}>
                Translating…
              </Text>
            </View>
            <Skeleton width="70%" height={10} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  bubble: { maxWidth: '86%', paddingHorizontal: 14, paddingVertical: 10, gap: 4 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tag: { borderRadius: 4, paddingHorizontal: 5, height: 16, justifyContent: 'center' },
  tagText: { fontSize: 10, lineHeight: 14 },
  translation: { marginTop: 4, paddingHorizontal: 10, paddingVertical: 8, gap: 4 },
  system: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 8, maxWidth: '92%' },
  note: { alignSelf: 'center', maxWidth: '86%' },
  flexShrink: { flexShrink: 1 },
});
