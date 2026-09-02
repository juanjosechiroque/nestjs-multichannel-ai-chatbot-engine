/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/support/**/*.spec.ts'],
  transform: { '^.+\\.ts$': 'ts-jest' },
  testEnvironment: 'node',
  setupFiles: ['reflect-metadata'],
  setupFilesAfterEnv: ['<rootDir>/test/support/silence-logging.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
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
