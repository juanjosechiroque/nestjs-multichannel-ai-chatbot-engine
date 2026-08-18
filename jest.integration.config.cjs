const baseConfig = require('./jest.config.cjs');

/** @type {import('jest').Config} */
module.exports = {
  ...baseConfig,
  testMatch: ['<rootDir>/test/**/*.integration-spec.ts'],
  testTimeout: 60_000,
  maxWorkers: 1,
};
