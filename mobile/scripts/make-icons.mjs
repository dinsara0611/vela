// Renders the Vela launcher icon and splash screen source images into ./assets
// (consumed by `capacitor-assets generate`).
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

mkdirSync('assets', { recursive: true });

const sail = (cx, cy, scale, mast = '#c9cad8') => `
  <g transform="translate(${cx} ${cy}) scale(${scale}) translate(-11.5 -12)">
    <path d="M8.5 6 L8.5 18 L4 17 Z" fill="rgba(155, 81, 224, 0.55)" stroke="#a66bff" stroke-width="1.4" stroke-linejoin="round"/>
    <line x1="9.5" y1="4" x2="9.5" y2="20" stroke="${mast}" stroke-width="1.7" stroke-linecap="round"/>
    <path d="M10.5 5 Q17 11, 19 16 L10.5 19 Z" fill="#ff2a5f" stroke="#ff2a5f" stroke-width="1.4" stroke-linejoin="round"/>
  </g>`;

const ground = (size, strength = 1) => `
  <defs>
    <linearGradient id="base" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#241448"/>
      <stop offset="0.6" stop-color="#0e0b1c"/>
      <stop offset="1" stop-color="#07070b"/>
    </linearGradient>
    <radialGradient id="coral" cx="0.88" cy="0.08" r="0.7">
      <stop offset="0" stop-color="#ff2a5f" stop-opacity="${0.42 * strength}"/>
      <stop offset="1" stop-color="#ff2a5f" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="violet" cx="0.08" cy="0.96" r="0.75">
      <stop offset="0" stop-color="#9b51e0" stop-opacity="${0.5 * strength}"/>
      <stop offset="1" stop-color="#9b51e0" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#base)"/>
  <rect width="${size}" height="${size}" fill="url(#coral)"/>
  <rect width="${size}" height="${size}" fill="url(#violet)"/>`;

const svg = (size, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`);

const out = async (name, size, body) => {
  await sharp(svg(size, body)).png().toFile(`assets/${name}`);
  console.log('wrote assets/' + name);
};

// Adaptive icon: background layer + foreground inside the 66% safe zone.
await out('icon-background.png', 1024, ground(1024));
await out('icon-foreground.png', 1024, sail(512, 520, 25));
// Legacy square icon (also used for the Play Store listing).
await out('icon-only.png', 1024, ground(1024) + sail(512, 520, 31));
// Splash: calm ground, small mark in the centre.
await out('splash.png', 2732, ground(2732, 0.7) + sail(1366, 1366, 20));
await out('splash-dark.png', 2732, ground(2732, 0.7) + sail(1366, 1366, 20));
