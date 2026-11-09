import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    // MUI integration tests need headroom for DOM queries during CI coverage runs.
    testTimeout: 15000,
    // Limit concurrent DOM suites to keep CI coverage runs within resource limits.
    maxWorkers: 2,
    setupFiles: './src/test/setup.js',
    css: true,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/e2e/**',
      '**/.{idea,git,cache,output,temp}/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.config.js',
        '**/*.config.ts',
        '**/main.jsx',
        'dist/',
      ],
      lines: 70,
      functions: 70,
      branches: 70,
      statements: 70,
    },
    // Mock certain modules
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
