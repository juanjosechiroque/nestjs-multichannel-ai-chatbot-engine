const baseConfig = require('./jest.config.cjs');

/** @type {import('jest').Config} */
module.exports = {
  ...baseConfig,
  testRegex: '.*\\.integration-spec\\.ts$',
  testTimeout: 60_000,
  maxWorkers: 1,
};
