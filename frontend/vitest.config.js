import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    // Enable global test APIs (describe, it, expect, etc.)
    globals: true,

    // Use jsdom for DOM testing
    environment: 'jsdom',

    // Setup files to run before each test file
    setupFiles: ['./tests/setup.js'],

    // Test file patterns
    include: [
      'src/**/*.{test,spec}.{js,jsx,ts,tsx}',
      'tests/**/*.{test,spec}.{js,jsx,ts,tsx}'
    ],

    // Exclude patterns
    exclude: [
      'node_modules',
      'dist',
      'tests/e2e/**/*'  // E2E tests are handled by Playwright
    ],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json'],
      reportsDirectory: './coverage',
      exclude: [
        'node_modules/',
        'tests/',
        'src/main.jsx',
        '**/*.config.{js,ts}',
        '**/index.{js,jsx,ts,tsx}',
        '**/*.d.ts'
      ],
      // Coverage thresholds - will fail tests if not met
      thresholds: {
        global: {
          lines: 70,
          functions: 70,
          branches: 70,
          statements: 70
        }
      }
    },

    // Reporter configuration
    reporters: ['default', 'html'],

    // Test timeout
    testTimeout: 10000,

    // Hook timeout
    hookTimeout: 10000,

    // Watch mode configuration
    watch: true,
    watchExclude: ['node_modules', 'dist'],

    // Pool options for test isolation
    pool: 'forks',

    // Enable CSS modules support
    css: {
      modules: {
        classNameStrategy: 'non-scoped'
      }
    },

    // Mock configuration
    mockReset: true,
    restoreMocks: true,
    clearMocks: true,

    // Retry failed tests
    retry: 0,

    // Sequence options
    sequence: {
      shuffle: false
    }
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
})
