/**
 * PWA Icon Generator Script
 *
 * This script generates PWA icons from the favicon.svg
 * Run: node scripts/generate-pwa-icons.js
 *
 * Prerequisites:
 * npm install sharp
 */

import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

// SVG template for the icon
const iconSvg = `<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="96" fill="#1c1917"/>
  <path d="M192 128H320V192H384V320H320V384H192V320H128V192H192V128Z" fill="#f59e0b"/>
</svg>`;

// Maskable icon with more padding for safe zone
const maskableIconSvg = `<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="#1c1917"/>
  <path d="M208 160H304V208H352V304H304V352H208V304H160V208H208V160Z" fill="#f59e0b"/>
</svg>`;

async function generateIcons() {
  console.log('Generating PWA icons...');

  try {
    // Generate standard icons
    await sharp(Buffer.from(iconSvg))
      .resize(192, 192)
      .png()
      .toFile(join(publicDir, 'pwa-192x192.png'));
    console.log('✓ pwa-192x192.png');

    await sharp(Buffer.from(iconSvg))
      .resize(512, 512)
      .png()
      .toFile(join(publicDir, 'pwa-512x512.png'));
    console.log('✓ pwa-512x512.png');

    // Generate maskable icon (with safe zone padding)
    await sharp(Buffer.from(maskableIconSvg))
      .resize(512, 512)
      .png()
      .toFile(join(publicDir, 'pwa-maskable-512x512.png'));
    console.log('✓ pwa-maskable-512x512.png');

    // Generate Apple touch icon
    await sharp(Buffer.from(iconSvg))
      .resize(180, 180)
      .png()
      .toFile(join(publicDir, 'apple-touch-icon.png'));
    console.log('✓ apple-touch-icon.png');

    // Generate favicon PNGs
    await sharp(Buffer.from(iconSvg))
      .resize(32, 32)
      .png()
      .toFile(join(publicDir, 'favicon-32x32.png'));
    console.log('✓ favicon-32x32.png');

    await sharp(Buffer.from(iconSvg))
      .resize(16, 16)
      .png()
      .toFile(join(publicDir, 'favicon-16x16.png'));
    console.log('✓ favicon-16x16.png');

    console.log('\nAll PWA icons generated successfully!');
  } catch (error) {
    console.error('Error generating icons:', error);
    console.log('\nTo generate icons manually:');
    console.log('1. npm install sharp');
    console.log('2. node scripts/generate-pwa-icons.js');
    console.log('\nOr use an online tool like https://www.pwabuilder.com/imageGenerator');
  }
}

generateIcons();
