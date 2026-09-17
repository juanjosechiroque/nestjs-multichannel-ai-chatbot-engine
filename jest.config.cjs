/** @type {import('jest').Config} */
module.exports = {
  // `ts` before `json` so a co-located data file (e.g. business/profile.json)
  // never shadows its loader module (business/profile.ts) in bare imports.
  moduleFileExtensions: ['ts', 'js', 'json'],
  rootDir: '.',
  testMatch: [
    '<rootDir>/src/**/*.spec.ts',
    '<rootDir>/business/**/*.spec.ts',
    '<rootDir>/test/support/**/*.spec.ts',
  ],
  // `isolatedModules` transpiles each file without a full type-check, which is
  // the dominant cost of a cold Jest run. Type safety is still enforced by the
  // standalone `tsc --noEmit` step in `npm run validate`.
  transform: { '^.+\\.ts$': ['ts-jest', { isolatedModules: true }] },
  testEnvironment: 'node',
  setupFiles: ['reflect-metadata'],
  setupFilesAfterEnv: ['<rootDir>/test/support/silence-logging.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    'business/**/*.ts',
    '!business/**/*.spec.ts',
    '!src/**/*.spec.ts',
    '!src/generated/**',
    '!src/**/*.module.ts',
    '!src/**/*.types.ts',
    '!src/main.ts',
    '!src/rag/ingest-knowledge.ts',
    // Offline evaluation harness: a development calibration tool, verified by
    // running it against the live model, not by unit tests.
    '!src/chat/evaluate-*.ts',
    '!src/chat/evaluation/**',
    '!src/rag/evaluate-rag.ts',
    '!src/rag/evaluation/**',
  ],
  coveragePathIgnorePatterns: ['/node_modules/', '/src/generated/'],
  coverageThreshold: {
    global: {
      statements: 85,
      branches: 75,
      functions: 80,
      lines: 85,
    },
  },
  watchman: false,
};
