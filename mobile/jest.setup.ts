// Native modules that have no JS fallback in the test runtime.
jest.mock('react-native-keyboard-controller', () => require('react-native-keyboard-controller/jest'));
