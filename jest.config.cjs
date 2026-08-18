/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/support/**/*.spec.ts'],
  transform: { '^.+\\.ts$': 'ts-jest' },
  testEnvironment: 'node',
  setupFiles: ['reflect-metadata'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/generated/**',
    '!src/**/*.module.ts',
    '!src/**/*.types.ts',
    '!src/main.ts',
    '!src/rag/ingest-knowledge.ts',
    '!src/rag/evaluate-rag.ts',
    '!src/rag/evaluation/rag-evaluation.cases.ts',
    '!src/chat/evaluate-conversation-security.ts',
    '!src/chat/evaluation/conversation-security-evaluation.cases.ts',
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
