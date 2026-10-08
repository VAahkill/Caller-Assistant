import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useAsyncAction } from '../../hooks/useAsyncAction';
import { api } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { languageName } from '../../lib/languages';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { IconButton } from '../ui/IconButton';
import { Text } from '../ui/Text';
import { TextField } from '../ui/TextField';

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
  testID?: string;
}

/** A caller (or a place the assistant called) waiting on hold for the owner. */
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
  testID,
}: HoldQuestionCardProps) {
  const [text, setText] = useState('');
  const answer = useAsyncAction((reply: string) => api.answer(callId, reply, holdId), {
    success: `Sent. Your assistant is telling ${who}.`,
    error: false, // shown under the answer field
  });
  const send = async (reply: string) => {
    const v = reply.trim();
    if (!v) return;
    if ((await answer.run(v)) !== undefined) setText('');
  };
  const translated = callerLanguage && callerLanguage !== ownerLanguage;

  return (
    <Card tone="warning" testID={testID}>
      <View style={styles.head}>
        <Text variant="overline" color="onWarningContainer" style={styles.flex}>
          {isTask ? `${who} needs a decision` : `${who} is on hold`}
          {at ? ` · ${timeAgo(at)}` : ''}
        </Text>
        {onOpen ? <IconButton icon="open-outline" label="Open the call" size={32} onPress={onOpen} /> : null}
      </View>
      <Text variant="headline" color="onWarningContainer">
        {question}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.chips}>
        {QUICK_ANSWERS.map((q) => (
          <Chip key={q} label={q} kind="suggestion" disabled={answer.busy} onPress={() => void send(q)} />
        ))}
      </ScrollView>
      <TextField
        label="Your answer"
        value={text}
        onChangeText={setText}
        placeholder="Type what to tell them"
        helper={translated ? `They'll hear it in ${languageName(callerLanguage)}.` : undefined}
        returnKeyType="send"
        onSubmitEditing={() => void send(text)}
        error={answer.error}
      />
      <Button title="Send answer" icon="send" loading={answer.busy} disabled={!text.trim()} onPress={() => void send(text)} />
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  chips: { gap: 8 },
});
