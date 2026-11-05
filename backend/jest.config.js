module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { diagnostics: false }] },
  testTimeout: 60000,
  globalSetup: '<rootDir>/test/global-setup.ts',
};
