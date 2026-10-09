// TalkBack check for every screen: anything that can be tapped, switched or
// typed into must have a name to read out. An icon-only button without a
// label is read as just "button", which is useless.

jest.mock('expo-file-system', () => require('../test/expoFileSystemMock').expoFileSystemMock);
jest.mock('expo-clipboard', () => ({ getStringAsync: jest.fn(async () => ''), setStringAsync: jest.fn(async () => true) }));
const mockNavigation = { addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() };
jest.mock('expo-router', () => {
  const { Fragment, createElement } = require('react');
  return {
    ...jest.requireActual('expo-router'),
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), canGoBack: () => true },
    useLocalSearchParams: jest.fn(() => ({})),
    useNavigation: () => mockNavigation,
    // Header buttons are part of the screen too.
    Stack: {
      Screen: ({ options }: { options?: { headerRight?: (p: object) => unknown; headerLeft?: (p: object) => unknown } }) =>
        createElement(Fragment, null, options?.headerLeft ? options.headerLeft({}) : null, options?.headerRight ? options.headerRight({}) : null),
    },
  };
});
jest.mock('@maplibre/maplibre-react-native', () => {
  const { View } = require('react-native');
  return { Map: View, Camera: () => null, Marker: View };
});
jest.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true, status: 'granted' })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 17.45, longitude: 78.38 } })),
  reverseGeocodeAsync: jest.fn(async () => [{ street: 'Road No. 2', district: 'Kondapur', city: 'Hyderabad', postalCode: '500084' }]),
}));

import { act, isHiddenFromAccessibility, render, screen } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import type { ComponentType } from 'react';
import { Pressable, Switch, TextInput, View } from 'react-native';

import AssistantHub from '../app/(tabs)/assistant';
import Inbox from '../app/(tabs)/inbox';
import Today from '../app/(tabs)/index';
import Settings from '../app/(tabs)/settings';
import CallForMe from '../app/(tabs)/tasks';
import Away from '../app/away';
import CallScreen from '../app/call/[id]';
import Chat from '../app/chat';
import Gallery from '../app/gallery';
import Instructions from '../app/instructions';
import Languages from '../app/languages';
import LocationScreen from '../app/location';
import Notes from '../app/notes';
import OnboardingConnect from '../app/onboarding/connect';
import OnboardingContacts from '../app/onboarding/contacts';
import OnboardingDone from '../app/onboarding/done';
import OnboardingWelcome from '../app/onboarding/index';
import OnboardingNames from '../app/onboarding/names';
import OnboardingRegion from '../app/onboarding/region';
import OnboardingVoice from '../app/onboarding/voice';
import Persona from '../app/persona';
import Practice from '../app/practice';
import Screening from '../app/screening';
import Voices from '../app/voices';
import { Icon } from '../lib/design';
import { LIVE_CALL_ID } from '../lib/mock/fixtures';
import { resetApi, useMockServer } from '../test/mockApi';
import { renderScreen } from '../test/renderScreen';

type Instance = NonNullable<typeof screen.root>;

beforeEach(async () => {
  await useMockServer();
});
afterEach(resetApi);

/** What TalkBack would read: the label, or else the text inside. */
function accessibleName(el: Instance): string {
  const label = el.props.accessibilityLabel ?? el.props['aria-label'];
  if (typeof label === 'string' && label.trim()) return label;
  const parts: string[] = [];
  const walk = (node: Instance | string) => {
    if (typeof node === 'string') {
      parts.push(node);
      return;
    }
    if (node.props.accessibilityElementsHidden || node.props.importantForAccessibility === 'no-hide-descendants') return;
    node.children.forEach((c) => walk(c as Instance | string));
  };
  walk(el);
  return parts.join('').trim();
}

const norm = (x: string) => x.toLowerCase().replace(/\s+/g, ' ').trim();

/** The first piece of visible text inside an element (a title, a button label). */
function firstVisibleText(el: Instance): string {
  let found = '';
  const walk = (node: Instance | string) => {
    if (found) return;
    if (typeof node === 'string') {
      if (node.trim()) found = node.trim();
      return;
    }
    if (node.props.accessibilityElementsHidden || node.props.importantForAccessibility === 'no-hide-descendants') return;
    node.children.forEach((c) => walk(c as Instance | string));
  };
  el.children.forEach((c) => walk(c as Instance | string));
  return found;
}

const ROLES = new Set(['button', 'link', 'switch', 'checkbox', 'radio', 'tab', 'menuitem', 'togglebutton', 'adjustable', 'combobox', 'search']);

/** Host elements a finger or TalkBack can act on. */
function interactive(root: Instance): Instance[] {
  return root.queryAll(
    (el) =>
      typeof el.type === 'string' &&
      el.props.accessible !== false &&
      (typeof el.props.onClick === 'function' || el.type === 'TextInput' || ROLES.has(el.props.accessibilityRole ?? el.props.role)),
  );
}

function describeEl(el: Instance): string {
  const { testID, accessibilityRole } = el.props as { testID?: string; accessibilityRole?: string };
  let owner = '';
  for (let p: Instance | null = el; p && !owner; p = p.parent) if (p.props.testID) owner = String(p.props.testID);
  return `<${el.type}${accessibilityRole ? ` role=${accessibilityRole}` : ''}${testID ? ` testID=${testID}` : ''}> inside ${owner || 'screen'}`;
}

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

const SCREENS: [string, ComponentType, Record<string, string>?][] = [
  ['Today', Today],
  ['Inbox', Inbox],
  ['Call for me', CallForMe],
  ['Assistant', AssistantHub],
  ['Settings', Settings],
  ['Live call', CallScreen, { id: LIVE_CALL_ID }],
  ['Finished call', CallScreen, { id: 'call-rajesh' }],
  ['Scam call', CallScreen, { id: 'call-kyc' }],
  ['Chat', Chat],
  ['Practice', Practice],
  ['Voices', Voices],
  ['Instructions', Instructions],
  ['Notes', Notes],
  ['Location', LocationScreen],
  ['Persona', Persona],
  ['Languages', Languages],
  ['Screening', Screening],
  ['Away', Away],
  ['Onboarding welcome', OnboardingWelcome],
  ['Onboarding connect', OnboardingConnect],
  ['Onboarding names', OnboardingNames],
  ['Onboarding region', OnboardingRegion],
  ['Onboarding contacts', OnboardingContacts],
  ['Onboarding voice', OnboardingVoice],
  ['Onboarding done', OnboardingDone],
  ['Gallery', Gallery],
];

test.each(SCREENS.map(([name, Screen, params]) => ({ name, Screen, params })))('$name: every control has a name TalkBack can read', async ({ Screen, params }) => {
  jest.mocked(useLocalSearchParams).mockReturnValue(params ?? {});
  const view = await renderScreen(<Screen />);
  await settle();
  const root = screen.root as Instance;
  const controls = interactive(root).filter((el) => !isHiddenFromAccessibility(el));
  expect(controls.length).toBeGreaterThan(0);
  const unnamed = controls.filter((el) => !accessibleName(el)).map(describeEl);
  expect(unnamed).toEqual([]);
  // What TalkBack says starts from what is on screen (WCAG 2.5.3, label in
  // name), so "Tap Record your voice" works with voice access too.
  const mismatched = controls
    .filter((el) => typeof el.props.accessibilityLabel === 'string' && el.props.accessibilityLabel.trim())
    .map((el) => ({ el, visible: firstVisibleText(el) }))
    .filter(({ el, visible }) => visible && !norm(el.props.accessibilityLabel).includes(norm(visible)))
    .map(({ el, visible }) => `${describeEl(el)}: label "${el.props.accessibilityLabel}" but shows "${visible}"`);
  expect(mismatched).toEqual([]);
  await view.unmount();
});

test('the check finds an icon-only button, a switch and a field without names', async () => {
  await render(
    <View>
      <Pressable onPress={() => undefined} testID="icon-only">
        <Icon name="close" size={20} color="#fff" />
      </Pressable>
      <Switch value onValueChange={() => undefined} testID="bare-switch" />
      <TextInput testID="bare-field" />
      <Pressable onPress={() => undefined} accessibilityLabel="Close">
        <Icon name="close" size={20} color="#fff" />
      </Pressable>
    </View>,
  );
  const unnamed = interactive(screen.root as Instance)
    .filter((el) => !accessibleName(el))
    .map((el) => el.props.testID);
  expect(unnamed).toEqual(['icon-only', 'bare-switch', 'bare-field']);
});
