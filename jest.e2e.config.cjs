const baseConfig = require('./jest.config.cjs');

/** @type {import('jest').Config} */
module.exports = {
  ...baseConfig,
  testRegex: '.*\\.e2e-spec\\.ts$',
  testTimeout: 120_000,
  maxWorkers: 1,
};
