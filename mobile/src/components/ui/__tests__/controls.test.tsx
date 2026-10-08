import { fireEvent, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';

import { renderUI } from '../../../test/render';
import { Button } from '../Button';
import { Chip } from '../Chip';
import { IconButton } from '../IconButton';
import { ListRow } from '../ListRow';
import { SegmentedControl } from '../SegmentedControl';
import { TextField } from '../TextField';

describe('Button', () => {
  test('presses with haptic feedback', async () => {
    const onPress = jest.fn();
    await renderUI(<Button title="Sync contacts" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Sync contacts' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(Haptics.selectionAsync).toHaveBeenCalled();
  });

  test('loading shows a spinner and ignores presses', async () => {
    const onPress = jest.fn();
    await renderUI(<Button title="Save" onPress={onPress} loading testID="save" />);
    expect(screen.getByTestId('save-spinner')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    expect(button).toBeBusy();
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  test('success swaps the label for a confirmation', async () => {
    await renderUI(<Button title="Save" success successTitle="Saved" />);
    expect(screen.getByText('Saved')).toBeTruthy();
    expect(screen.queryByText('Save')).toBeNull();
  });
});

test('IconButton exposes its label to screen readers', async () => {
  const onPress = jest.fn();
  await renderUI(<IconButton icon="trash-outline" label="Delete voice" onPress={onPress} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Delete voice' }));
  expect(onPress).toHaveBeenCalled();
});

describe('TextField', () => {
  function Controlled(props: { secret?: boolean; error?: string }) {
    const [v, setV] = useState('hello');
    return <TextField label="Your name" value={v} onChangeText={setV} clearable helper="Callers hear this" {...props} />;
  }

  test('keeps a visible label and helper', async () => {
    await renderUI(<Controlled />);
    expect(screen.getByText('Your name')).toBeTruthy();
    expect(screen.getByText('Callers hear this')).toBeTruthy();
    expect(screen.getByLabelText('Your name')).toHaveDisplayValue('hello');
  });

  test('clear button empties the field', async () => {
    await renderUI(<Controlled />);
    await fireEvent.press(screen.getByRole('button', { name: 'Clear Your name' }));
    expect(screen.getByLabelText('Your name')).toHaveDisplayValue('');
  });

  test('error replaces the helper', async () => {
    await renderUI(<Controlled error="That isn't a name" />);
    expect(screen.getByText("That isn't a name")).toBeTruthy();
    expect(screen.queryByText('Callers hear this')).toBeNull();
  });

  test('secret fields can be revealed', async () => {
    await renderUI(<Controlled secret />);
    expect(screen.getByLabelText('Your name').props.secureTextEntry).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Show Your name' }));
    expect(screen.getByLabelText('Your name').props.secureTextEntry).toBe(false);
  });
});

test('SegmentedControl reports the chosen segment', async () => {
  const onChange = jest.fn();
  await renderUI(
    <SegmentedControl
      value="messages"
      onChange={onChange}
      segments={[
        { value: 'messages', label: 'Messages', badge: 2 },
        { value: 'calls', label: 'Calls' },
      ]}
    />,
  );
  expect(screen.getByRole('tab', { name: 'Messages, 2 new' })).toBeSelected();
  await fireEvent.press(screen.getByRole('tab', { name: 'Calls' }));
  expect(onChange).toHaveBeenCalledWith('calls');
});

test('Chip announces its selected state', async () => {
  const onPress = jest.fn();
  await renderUI(<Chip label="Telugu" selected onPress={onPress} />);
  const chip = screen.getByRole('button', { name: 'Telugu' });
  expect(chip).toBeSelected();
  await fireEvent.press(chip);
  expect(onPress).toHaveBeenCalled();
});

test('ListRow as a switch toggles from the whole row', async () => {
  const onChange = jest.fn();
  await renderUI(<ListRow title="Block international calls" switchValue={false} onSwitchChange={onChange} />);
  await fireEvent.press(screen.getByRole('switch', { name: 'Block international calls' }));
  expect(onChange).toHaveBeenCalledWith(true);
});
