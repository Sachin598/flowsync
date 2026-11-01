import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      MONGODB_URI: process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/flowsync-test',
      JWT_SECRET: 'test-secret-test-secret-test-secret-1234',
      CLIENT_URL: 'http://localhost:5173',
      LOG_LEVEL: 'silent',
    },
  },
});
