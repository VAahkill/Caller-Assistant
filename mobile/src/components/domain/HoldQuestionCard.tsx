import { useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';

import { useAsyncAction } from '../../hooks/useAsyncAction';
import { api } from '../../lib/api';
import { Icon, fonts } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { prettyNumber, timeAgo } from '../../lib/format';
import { languageName } from '../../lib/languages';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { IconButton } from '../ui/IconButton';
import { Text } from '../ui/Text';

export const QUICK_ANSWERS = ['Yes, that works', 'No, sorry', "I'll call them back", "I'm busy, take a message"];

export interface HoldQuestionCardProps {
  callId: string;
  holdId: string;
  who: string;
  question: string;
  at?: number;
  /** The caller's language, for the "they'll hear it in ..." hint. */
  callerLanguage?: string;
  ownerLanguage?: string;
  isTask?: boolean;
  onOpen?: () => void;
  /** Sends the answer; defaults to POST /calls/{id}/answer. The practice call answers over its socket. */
  onAnswer?: (text: string) => Promise<unknown>;
  /** The call screen's composer takes typed answers, so the card shows only quick answers. */
  inlineInput?: boolean;
  assistantName?: string;
  testID?: string;
}

const WEB_ONE_ROW = Platform.OS === 'web' ? { rows: 1 } : null;

/** A caller (or a place the assistant called) waiting on hold for the owner:
 *  the question, one-tap answers and a box for anything else. */
export function HoldQuestionCard({
  callId,
  holdId,
  who,
  question,
  at,
  callerLanguage,
  ownerLanguage = 'en',
  isTask,
  onOpen,
  onAnswer,
  inlineInput = true,
  assistantName = 'Your assistant',
  testID,
}: HoldQuestionCardProps) {
  const t = useTokens();
  const c = t.color;
  const [text, setText] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const shownWho = /^\+?[\d\s-]{5,}$/.test(who) ? prettyNumber(who) : who;
  const answer = useAsyncAction(
    async (reply: string) => {
      await (onAnswer ? onAnswer(reply) : api.answer(callId, reply, holdId));
      return true; // run() resolves to undefined only on failure
    },
    {
      success: `Sent. ${assistantName} is telling ${shownWho}.`,
      error: false, // shown in the card, next to the answer
    },
  );
  const send = async (reply: string) => {
    const v = reply.trim();
    if (!v || answer.busy) return;
    if (await answer.run(v)) {
      setText('');
      setSent(v);
    }
  };
  const translated = !!callerLanguage && callerLanguage !== ownerLanguage;

  return (
    <Card tone="warning" testID={testID}>
      <View style={styles.head}>
        <View style={[styles.badge, { backgroundColor: c.overlay }]}>
          <Icon name={isTask ? 'git-branch-outline' : 'hand-left-outline'} size={16} color={c.onWarningContainer} />
        </View>
        <Text variant="footnote" weight="semibold" color="onWarningContainer" style={styles.flex} numberOfLines={2}>
          {isTask ? `${shownWho} needs a decision` : `${shownWho} is on hold`}
          {at ? ` · ${timeAgo(at)}` : ''}
        </Text>
        {onOpen ? <IconButton icon="chevron-forward" label="Open the call" size={32} color={c.onWarningContainer} onPress={onOpen} /> : null}
      </View>
      <Text variant="headline" color="onWarningContainer">
        {question}
      </Text>
      {sent ? (
        <View style={styles.sent} accessibilityLiveRegion="polite" testID="hold-sent">
          <Icon name="checkmark-circle" size={18} color={c.onWarningContainer} />
          <Text variant="subhead" color="onWarningContainer" style={styles.flex}>
            You said "{sent}". {assistantName} is telling them
            {translated ? ` in ${languageName(callerLanguage)}` : ''}.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.chips}>
            {QUICK_ANSWERS.map((q) => (
              <Chip key={q} label={q} kind="suggestion" disabled={answer.busy} onPress={() => void send(q)} />
            ))}
          </View>
          {inlineInput ? (
            <View
              style={[
                styles.reply,
                {
                  backgroundColor: c.surface2,
                  borderRadius: t.radius.xl,
                  borderColor: answer.error ? c.danger : c.border,
                },
              ]}
            >
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={translated ? `Answer in ${languageName(ownerLanguage)}` : 'Type your answer'}
                placeholderTextColor={c.text3}
                selectionColor={c.primary}
                cursorColor={c.primary}
                accessibilityLabel="Your answer"
                accessibilityHint={translated ? `They'll hear it in ${languageName(callerLanguage)}.` : undefined}
                returnKeyType="send"
                onSubmitEditing={() => void send(text)}
                editable={!answer.busy}
                {...WEB_ONE_ROW}
                style={[styles.input, { color: c.text, fontFamily: fonts.regular }]}
              />
              <IconButton
                icon="arrow-up"
                label="Send answer"
                variant="warning"
                size={36}
                loading={answer.busy}
                disabled={!text.trim()}
                onPress={() => void send(text)}
              />
            </View>
          ) : null}
          {answer.error ? (
            <View style={styles.error} accessibilityLiveRegion="polite">
              <Icon name="alert-circle" size={16} color={c.danger} />
              <Text variant="footnote" color="danger" style={styles.flex}>
                Not sent. {answer.error}
              </Text>
            </View>
          ) : translated ? (
            <Text variant="caption" color="onWarningContainer">
              They'll hear your answer in {languageName(callerLanguage)}.
            </Text>
          ) : null}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reply: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 16,
    paddingRight: 4,
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    minHeight: 44,
    paddingVertical: 10,
    outlineWidth: 0,
  },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  sent: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
});
