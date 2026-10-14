import { defineConfig } from '@moeru/eslint-config'

export default defineConfig({ test: false }, {
  // These rules misread explicit union return types and generic calls in TS 6.
  rules: {
    'sonarjs/argument-type': 'off',
    'sonarjs/function-return-type': 'off',
  },
})
