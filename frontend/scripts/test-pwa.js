#!/usr/bin/env node
/**
 * PWA Test Script
 *
 * Builds and serves the production app for PWA testing.
 * Run: npm run test:pwa
 */

import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log();
  log(`━━━ ${title} ━━━`, 'cyan');
}

async function main() {
  console.clear();
  log('╔════════════════════════════════════════╗', 'cyan');
  log('║       HMS PWA Test Environment         ║', 'cyan');
  log('╚════════════════════════════════════════╝', 'cyan');
  console.log();

  // Step 1: Build
  logSection('Building Production Bundle');
  log('Running: npm run build', 'dim');

  try {
    execSync('npm run build', {
      cwd: rootDir,
      stdio: 'inherit'
    });
  } catch (error) {
    log('Build failed!', 'yellow');
    process.exit(1);
  }

  // Verify build output
  const swPath = join(rootDir, 'dist', 'sw.js');
  const manifestPath = join(rootDir, 'dist', 'manifest.webmanifest');

  logSection('Verifying PWA Assets');

  const checks = [
    { path: swPath, name: 'Service Worker (sw.js)' },
    { path: manifestPath, name: 'Web Manifest' },
    { path: join(rootDir, 'dist', 'pwa-192x192.png'), name: 'PWA Icon 192x192' },
    { path: join(rootDir, 'dist', 'pwa-512x512.png'), name: 'PWA Icon 512x512' },
    { path: join(rootDir, 'dist', 'apple-touch-icon.png'), name: 'Apple Touch Icon' },
  ];

  let allPassed = true;
  for (const check of checks) {
    if (existsSync(check.path)) {
      log(`  ✓ ${check.name}`, 'green');
    } else {
      log(`  ✗ ${check.name} - MISSING`, 'yellow');
      allPassed = false;
    }
  }

  if (!allPassed) {
    log('\nSome PWA assets are missing. Run: npm run generate-pwa-icons', 'yellow');
  }

  // Step 2: Start preview server
  logSection('Starting Preview Server');

  console.log();
  log('PWA Test Checklist:', 'bright');
  console.log(`
  ${colors.cyan}1. Install Prompt${colors.reset}
     • Look for install icon in browser address bar
     • Or "Install HMS" button at bottom-left
     • Click to install as standalone app

  ${colors.cyan}2. Manifest Check${colors.reset}
     • Open DevTools → Application → Manifest
     • Verify: name, icons, theme color, display mode

  ${colors.cyan}3. Service Worker${colors.reset}
     • DevTools → Application → Service Workers
     • Status should show "activated and running"
     • Check "Update on reload" for testing updates

  ${colors.cyan}4. Offline Mode${colors.reset}
     • Navigate to a few pages first (to cache them)
     • DevTools → Network → Check "Offline"
     • Refresh - app should still work
     • Try navigating to cached pages

  ${colors.cyan}5. Cache Storage${colors.reset}
     • DevTools → Application → Cache Storage
     • Check: workbox-precache, api-cache, images-cache

  ${colors.cyan}6. Update Flow${colors.reset}
     • Make a code change and run: npm run build
     • Refresh the page
     • "Update Available" toast should appear

  ${colors.cyan}7. Mobile Testing${colors.reset}
     • Open on mobile device (same network)
     • Use browser menu → "Add to Home Screen"
     • Launch from home screen - should be fullscreen
`);

  log('─'.repeat(50), 'dim');
  log('Starting server at: http://localhost:4173', 'green');
  log('Press Ctrl+C to stop', 'dim');
  log('─'.repeat(50), 'dim');
  console.log();

  // Start preview server
  const preview = spawn('npm', ['run', 'preview'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true,
  });

  preview.on('error', (error) => {
    log(`Failed to start server: ${error.message}`, 'yellow');
    process.exit(1);
  });

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    console.log();
    log('Stopping PWA test server...', 'dim');
    preview.kill();
    process.exit(0);
  });
}

main().catch(console.error);
