import { fireEvent, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { renderUI } from '../../../test/render';
import type { TranscriptLine } from '../../../lib/types';
import { player } from '../../../test/expoAudioMock';
import { AudioPlayer } from '../AudioPlayer';
import { Avatar, initials } from '../Avatar';
import { ChatBubble } from '../ChatBubble';
import { Composer } from '../Composer';
import { CountryPicker } from '../CountryPicker';
import { Text } from '../Text';

const line = (over: Partial<TranscriptLine>): TranscriptLine => ({
  id: 'l1',
  speaker: 'caller',
  text: 'నాకు స్విగ్గీ ఆర్డర్ ఉంది, నేను ఎక్కడికి రావాలి?',
  lang: 'te',
  translation: 'I have a Swiggy order, where should I come?',
  translation_lang: 'en',
  english: 'I have a Swiggy order, where should I come?',
  at: 1_760_000_000,
  kind: 'speech',
  ...over,
});

describe('ChatBubble', () => {
  test('shows the original, its language and the translation', async () => {
    await renderUI(<ChatBubble line={line({})} callerLabel="Delivery partner" />);
    expect(screen.getByText('నాకు స్విగ్గీ ఆర్డర్ ఉంది, నేను ఎక్కడికి రావాలి?')).toBeTruthy();
    expect(screen.getByText('I have a Swiggy order, where should I come?')).toBeTruthy();
    expect(screen.getByText('TE')).toBeTruthy();
    expect(screen.getByText('In English')).toBeTruthy();
    expect(screen.getByText('Delivery partner')).toBeTruthy();
  });

  test('translation can be turned off', async () => {
    await renderUI(<ChatBubble line={line({})} showTranslation={false} />);
    expect(screen.queryByText('I have a Swiggy order, where should I come?')).toBeNull();
  });

  test('no translation row for a line already in the owner language', async () => {
    await renderUI(<ChatBubble line={line({ text: 'Hello', lang: 'en', translation: 'Hello' })} />);
    expect(screen.queryByText('In English')).toBeNull();
  });

  test('shows a placeholder while the translation is on its way', async () => {
    await renderUI(<ChatBubble line={line({ translation: '', translation_lang: '' })} awaitingTranslation />);
    expect(screen.getByText('Translating…')).toBeTruthy();
  });

  test("the owner's interjection leads with what they wrote", async () => {
    await renderUI(
      <ChatBubble line={line({ speaker: 'user', text: 'పై అంతస్తుకు రండి', lang: 'te', translation: 'Come to the top floor' })} />,
    );
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText('Come to the top floor')).toBeTruthy();
    expect(screen.getByText('They heard, in Telugu')).toBeTruthy();
  });

  test('security alerts render as a system row', async () => {
    await renderUI(<ChatBubble line={line({ speaker: 'system', kind: 'alert', text: 'Caller asked for your OTP. Nothing was shared.', translation: '' })} />);
    expect(screen.getByText('Caller asked for your OTP. Nothing was shared.')).toBeTruthy();
  });
});

test('Text gives Telugu at least 1.6x line height', async () => {
  await renderUI(<Text testID="t">నమస్కారం</Text>);
  const style = StyleSheet.flatten(screen.getByTestId('t').props.style);
  expect(style.lineHeight / style.fontSize).toBeGreaterThanOrEqual(1.6);
});

test('Avatar initials', async () => {
  expect(initials('Ravi Kumar')).toBe('RK');
  expect(initials('+91 98765 00001')).toBe('');
  expect(initials('శ్రీను')).toBe('శ');
  await renderUI(<Avatar name="Ravi Kumar" />);
  expect(screen.getByText('RK', { includeHiddenElements: true })).toBeTruthy();
});

describe('CountryPicker (owner item 1)', () => {
  test('reads as a country, says it is not a phone number, and changes by name', async () => {
    const onChange = jest.fn();
    await renderUI(<CountryPicker value="+91" onChange={onChange} />);
    expect(screen.getByText('India (+91)')).toBeTruthy();
    expect(screen.getByText(/not your phone number/i)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Your country: India (+91)' }));
    await fireEvent.changeText(screen.getByLabelText('Search Your country'), 'kingdom');
    await fireEvent.press(screen.getByRole('radio', { name: 'United Kingdom, +44' }));
    expect(onChange).toHaveBeenCalledWith('+44');
  });
});

describe('Composer', () => {
  test('sends trimmed text and clears the box', async () => {
    const onSend = jest.fn();
    await renderUI(<Composer onSend={onSend} placeholder="Reply in English" hint="They'll hear it in Telugu" />);
    expect(screen.getByText("They'll hear it in Telugu")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Reply in English'), '  Come to gate 2  ');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('Come to gate 2');
    expect(screen.getByLabelText('Reply in English')).toHaveDisplayValue('');
  });

  test('quick replies send straight away', async () => {
    const onSend = jest.fn();
    await renderUI(<Composer onSend={onSend} suggestions={['Yes, that works', 'Take a message']} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Take a message' }));
    expect(onSend).toHaveBeenCalledWith('Take a message');
  });

  test('shows the mic when empty and voice is supported', async () => {
    await renderUI(<Composer onSend={jest.fn()} onVoice={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Hold to talk' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  });

  test('explains why it is disabled', async () => {
    await renderUI(<Composer onSend={jest.fn()} disabled disabledReason="The call has ended" />);
    expect(screen.getByText('The call has ended')).toBeTruthy();
  });
});

test('AudioPlayer plays, shows the length, and changes speed', async () => {
  await renderUI(<AudioPlayer source={{ uri: 'http://server/calls/c1/recording', headers: { Authorization: 'Bearer t' } }} title="Call recording" />);
  expect(screen.getByText('0:12')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Play Call recording' }));
  expect(player.play).toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Playback speed 1 times' }));
  expect(player.setPlaybackRate).toHaveBeenCalledWith(1.5);
});
