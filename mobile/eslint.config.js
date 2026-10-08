// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

// A promise .catch or a catch block that does nothing hides failures from the
// person using the app. Show the error, log it, or let it propagate.
const swallowedErrors = [
  {
    selector: "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression[body.type='BlockStatement'][body.body.length=0]",
    message: 'Empty .catch() hides failures. Show the error to the user or log it.',
  },
  {
    selector: "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression[body.type!='BlockStatement'][body.type!='CallExpression'][body.type!='AwaitExpression']",
    message: '.catch() that only returns a value hides failures. Show the error to the user or log it.',
  },
];

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'dist-web/*', 'android/*', 'ios/*', 'node_modules/*', '.expo/*'],
  },
  {
    rules: {
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-restricted-syntax': ['error', ...swallowedErrors],
      // React Native renders text literally; apostrophes in copy are fine.
      'react/no-unescaped-entities': 'off',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'jest.setup.ts', 'scripts/**'],
    languageOptions: { globals: { jest: 'readonly', describe: 'readonly', it: 'readonly', test: 'readonly', expect: 'readonly', beforeEach: 'readonly', afterEach: 'readonly', beforeAll: 'readonly', afterAll: 'readonly' } },
  },
]);
