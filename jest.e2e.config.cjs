const baseConfig = require('./jest.config.cjs');

/** @type {import('jest').Config} */
module.exports = {
  ...baseConfig,
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
  testTimeout: 120_000,
  maxWorkers: 1,
  globalSetup: '<rootDir>/test/support/e2e-global-setup.ts',
  globalTeardown: '<rootDir>/test/support/e2e-global-teardown.ts',
};
