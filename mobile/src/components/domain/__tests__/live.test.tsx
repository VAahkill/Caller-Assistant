// The pieces of the live and practice call screens: status strip, hold card,
// transcript with pending sends and typing indicator, and the composer modes.

import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';

import { confidenceText, liveStatus, workingText } from '../../../lib/liveStatus';
import type { OutboxItem } from '../../../lib/outbox';
import type { TranscriptLine } from '../../../lib/types';
import { renderUI } from '../../../test/render';
import { ChatBubble } from '../../ui/ChatBubble';
import { Composer } from '../../ui/Composer';
import { ActionTiles } from '../ActionTiles';
import { HoldQuestionCard, QUICK_ANSWERS } from '../HoldQuestionCard';
import { LiveStatusBar } from '../LiveStatusBar';
import { Transcript } from '../Transcript';

const line = (over: Partial<TranscriptLine>): TranscriptLine => ({
  id: 'l1',
  speaker: 'caller',
  text: 'నమస్తే, స్విగ్గీ నుంచి.',
  lang: 'te',
  translation: 'Hello, this is Swiggy.',
  translation_lang: 'en',
  english: 'Hello, this is Swiggy.',
  at: 1_760_000_000,
  kind: 'speech',
  ...over,
});

const item = (over: Partial<OutboxItem>): OutboxItem => ({
  id: 'o1',
  speaker: 'user',
  kind: 'text',
  text: 'Leave it at the gate',
  lang: 'en',
  state: 'sending',
  after: 0,
  ...over,
});

describe('liveStatus words', () => {
  const base = { assistantName: 'Ava' } as const;

  test.each([
    ['listening', 'Ava is listening', false],
    ['transcribing', 'Ava is transcribing', true],
    ['translating', 'Ava is translating', true],
    ['thinking', 'Ava is thinking', true],
    ['speaking', 'Ava is speaking', true],
    ['error', 'Ava had a problem', false],
    ['idle', 'Ava is waiting', false],
  ] as const)('%s reads "%s"', (state, title, busy) => {
    expect(liveStatus({ ...base, state })).toMatchObject({ title, busy });
  });

  test('on hold beats listening and idle, but not working on a turn', () => {
    expect(liveStatus({ ...base, state: 'idle', detail: 'waiting for Arjun', onHold: true }).title).toBe('On hold, waiting for you');
    expect(liveStatus({ ...base, state: 'listening', onHold: true }).title).toBe('On hold, waiting for you');
    expect(liveStatus({ ...base, state: 'translating', onHold: true }).title).toBe('Ava is translating');
  });

  test('the server detail is used for idle and error', () => {
    expect(liveStatus({ ...base, state: 'idle', detail: 'waiting for Arjun' }).title).toBe('Ava is waiting for Arjun');
    expect(liveStatus({ ...base, state: 'error', detail: 'the model timed out' }).title).toBe('Problem: the model timed out');
  });

  test('audio playing on the phone, connecting and ended', () => {
    expect(liveStatus({ ...base, state: 'listening', speaking: true }).title).toBe('Ava is speaking');
    expect(liveStatus({ ...base, state: 'listening', phase: 'connecting' }).title).toBe('Connecting…');
    expect(liveStatus({ ...base, state: 'speaking', phase: 'ended' })).toMatchObject({ title: 'Call ended', busy: false });
  });

  test('an empty name falls back to "Your assistant"', () => {
    expect(liveStatus({ state: 'thinking', assistantName: '' }).title).toBe('Your assistant is thinking');
  });

  test('typing indicator text and confidence', () => {
    expect(workingText('transcribing', 'Ava')).toBe('Ava is writing down what was said…');
    expect(workingText('translating', 'Ava')).toBe('Ava is translating…');
    expect(workingText('thinking', 'Ava')).toBe('Ava is thinking…');
    expect(confidenceText(0.955)).toBe('96% sure');
    expect(confidenceText(1.4)).toBe('100% sure');
    expect(confidenceText(0)).toBe('');
    expect(confidenceText(Number.NaN)).toBe('');
  });
});

describe('LiveStatusBar', () => {
  test('says what the assistant does and which language the caller speaks', async () => {
    await renderUI(
      <LiveStatusBar testID="s" state="translating" assistantName="Ava" language="te" confidence={0.96} ownerLanguage="en" translate onTranslateChange={jest.fn()} />,
    );
    expect(screen.getByTestId('s-title')).toHaveTextContent('Ava is translating');
    expect(screen.getByText('Caller speaks Telugu · 96% sure')).toBeTruthy();
  });

  test('the translation switch flips, and is offered only when the languages differ', async () => {
    const onChange = jest.fn();
    const { rerender } = await renderUI(
      <LiveStatusBar state="listening" assistantName="Ava" language="te" ownerLanguage="en" translate onTranslateChange={onChange} />,
    );
    const toggle = screen.getByRole('switch', { name: 'Show translations in English' });
    expect(toggle).toBeChecked();
    await fireEvent.press(toggle);
    expect(onChange).toHaveBeenCalledWith(false);
    await rerender(<LiveStatusBar state="listening" assistantName="Ava" language="en" ownerLanguage="en" translate onTranslateChange={onChange} />);
    expect(screen.queryByRole('switch')).toBeNull();
  });

  test('before call_language arrives it says the language is being detected', async () => {
    await renderUI(<LiveStatusBar state="listening" assistantName="Ava" ownerLanguage="en" translate />);
    expect(screen.getByText('Detecting the language…')).toBeTruthy();
  });
});

describe('HoldQuestionCard', () => {
  const props = {
    callId: 'c1',
    holdId: 'h1',
    who: '+919700112233',
    question: 'The delivery partner asks: can he bring it up to the flat?',
    callerLanguage: 'te',
    ownerLanguage: 'en',
    assistantName: 'Ava',
  };

  test('a quick answer is sent and the card says what happens next', async () => {
    const onAnswer = jest.fn(async () => ({ ok: true }));
    await renderUI(<HoldQuestionCard {...props} onAnswer={onAnswer} />);
    expect(screen.getByText('+91 97001 12233 is on hold')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: QUICK_ANSWERS[0] }));
    expect(onAnswer).toHaveBeenCalledWith(QUICK_ANSWERS[0]);
    expect(await screen.findByTestId('hold-sent')).toHaveTextContent(/You said "Yes, that works"\. Ava is telling them in Telugu\.$/);
    expect(await screen.findByText('Sent. Ava is telling +91 97001 12233.')).toBeTruthy();
  });

  test('a typed answer goes from the box; the send button waits for text', async () => {
    const onAnswer = jest.fn(async () => undefined);
    await renderUI(<HoldQuestionCard {...props} onAnswer={onAnswer} />);
    expect(screen.getByRole('button', { name: 'Send answer' })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Your answer'), '  Yes, flat 402  ');
    await fireEvent.press(screen.getByRole('button', { name: 'Send answer' }));
    expect(onAnswer).toHaveBeenCalledWith('Yes, flat 402');
    expect(await screen.findByTestId('hold-sent')).toBeTruthy();
  });

  test('a failed answer stays in the card with the reason, and can be sent again', async () => {
    const onAnswer = jest.fn().mockRejectedValueOnce(new Error('The call has ended.')).mockResolvedValueOnce(undefined);
    await renderUI(<HoldQuestionCard {...props} onAnswer={onAnswer} />);
    await fireEvent.changeText(screen.getByLabelText('Your answer'), 'Bring it up');
    await fireEvent.press(screen.getByRole('button', { name: 'Send answer' }));
    expect(await screen.findByText('Not sent. The call has ended.')).toBeTruthy();
    expect(screen.getByLabelText('Your answer')).toHaveDisplayValue('Bring it up');
    await fireEvent.press(screen.getByRole('button', { name: 'Send answer' }));
    expect(await screen.findByTestId('hold-sent')).toBeTruthy();
  });

  test('on the call screen it shows only the quick answers (the composer takes typing)', async () => {
    await renderUI(<HoldQuestionCard {...props} inlineInput={false} onAnswer={jest.fn()} />);
    expect(screen.queryByLabelText('Your answer')).toBeNull();
    expect(screen.getByText("They'll hear your answer in Telugu.")).toBeTruthy();
  });

  test('task decisions read as a decision, not a hold', async () => {
    await renderUI(<HoldQuestionCard {...props} who="Dr Rao's clinic" isTask onAnswer={jest.fn()} />);
    expect(screen.getByText("Dr Rao's clinic needs a decision")).toBeTruthy();
  });
});

describe('Transcript', () => {
  test('a send shows at once under the lines with its state', async () => {
    await renderUI(
      <Transcript lines={[line({})]} callerLabel="Swiggy" assistantLabel="Ava" showTranslation ownerLanguage="en" live pending={[item({})]} />,
    );
    expect(screen.getByText('Leave it at the gate')).toBeTruthy();
    expect(screen.getByText('Sending…')).toBeTruthy();
    expect(screen.getByTestId('outbox-sending')).toBeTruthy();
  });

  test('a sent message says the assistant is saying it', async () => {
    await renderUI(<Transcript lines={[]} callerLabel="Swiggy" assistantLabel="Ava" showTranslation ownerLanguage="en" live pending={[item({ state: 'sent' })]} />);
    expect(screen.getByText('Sent · Ava is saying it')).toBeTruthy();
  });

  test('a failed send shows why, with Retry and Remove', async () => {
    const onRetry = jest.fn();
    const onRemove = jest.fn();
    await renderUI(
      <Transcript
        lines={[]}
        callerLabel="Swiggy"
        showTranslation
        ownerLanguage="en"
        live
        pending={[item({ state: 'failed', error: 'The call has ended.' })]}
        onRetry={onRetry}
        onRemove={onRemove}
      />,
    );
    expect(screen.getByText('Not sent: The call has ended.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledWith('o1');
    await fireEvent.press(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledWith('o1');
  });

  test('a voice message shows its length and, once heard, the words', async () => {
    await renderUI(
      <Transcript lines={[]} callerLabel="Swiggy" showTranslation ownerLanguage="en" live pending={[item({ kind: 'voice', text: 'Come up', seconds: 3.2, state: 'sent' })]} />,
    );
    expect(screen.getByText('Voice message · 0:03')).toBeTruthy();
    expect(screen.getByText('"Come up"')).toBeTruthy();
  });

  test('a typing indicator shows while the assistant works on a reply, only live', async () => {
    const { rerender } = await renderUI(<Transcript lines={[line({})]} callerLabel="Swiggy" assistantLabel="Ava" showTranslation ownerLanguage="en" live state="thinking" />);
    expect(screen.getByTestId('working')).toHaveTextContent('Ava is thinking…');
    await rerender(<Transcript lines={[line({})]} callerLabel="Swiggy" assistantLabel="Ava" showTranslation ownerLanguage="en" live state="listening" />);
    expect(screen.queryByTestId('working')).toBeNull();
    await rerender(<Transcript lines={[line({})]} callerLabel="Swiggy" assistantLabel="Ava" showTranslation ownerLanguage="en" state="thinking" />);
    expect(screen.queryByTestId('working')).toBeNull();
  });

  test('empty live call waits for the first words', async () => {
    await renderUI(<Transcript lines={[]} callerLabel="Swiggy" showTranslation ownerLanguage="en" live />);
    expect(screen.getByText('Waiting for the first words…')).toBeTruthy();
  });
});

test("the owner's words filed as a note still show as the owner's bubble", async () => {
  await renderUI(<ChatBubble line={line({ speaker: 'user', kind: 'note', text: 'Bring it up', lang: 'en', translation: '' })} />);
  expect(screen.getByText('You')).toBeTruthy();
  expect(screen.getByText('Bring it up')).toBeTruthy();
});

describe('Composer modes', () => {
  test('answering a hold shows what is being answered', async () => {
    await renderUI(
      <Composer testID="c" onSend={jest.fn()} context={{ icon: 'hand-left-outline', label: 'Answering Swiggy', text: 'Can he bring it up?' }} />,
    );
    const box = within(screen.getByTestId('c-context'));
    expect(box.getByText('Answering Swiggy')).toBeTruthy();
    expect(box.getByText('Can he bring it up?')).toBeTruthy();
  });

  test('a header (e.g. the speak-as switch) renders above the box', async () => {
    await renderUI(<Composer onSend={jest.fn()} header={<RNText>Speak as</RNText>} />);
    expect(screen.getByText('Speak as')).toBeTruthy();
  });

  test('while a send is in flight nothing else is sent and the text stays', async () => {
    const onSend = jest.fn();
    await renderUI(<Composer testID="c" onSend={onSend} busy placeholder="Reply" suggestions={['Hold on']} />);
    await fireEvent.changeText(screen.getByLabelText('Reply'), 'Second message');
    await fireEvent.press(screen.getByTestId('c-send'));
    await fireEvent.press(screen.getByRole('button', { name: 'Hold on' }));
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Reply')).toHaveDisplayValue('Second message');
  });
});

describe('ActionTiles', () => {
  test('each tile presses, shows busy, and can be disabled', async () => {
    const onCall = jest.fn();
    await renderUI(
      <ActionTiles
        actions={[
          { icon: 'call', label: 'Call back', accessibilityLabel: 'Call Ravi back', onPress: onCall },
          { icon: 'ban', label: 'Block', onPress: jest.fn(), loading: true },
          { icon: 'star', label: 'VIP', onPress: jest.fn(), disabled: true },
        ]}
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Call Ravi back' }));
    expect(onCall).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Block' })).toBeBusy());
    expect(screen.getByRole('button', { name: 'VIP' })).toBeDisabled();
  });
});
