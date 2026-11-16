// One-time (build-time) download of brand logos into ./logos, so the app shows real logos without ever
// contacting anyone while it runs (no spending data leaves the phone).
// Source: each brand's own site icon, through Google's public favicon service (128 px).
// Run: node scripts/fetch-logos.mjs
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'logos');
mkdirSync(out, { recursive: true });

// slug -> official domain (slugs must match LOGO_SLUGS in app.js)
const DOMAINS = {
    keells: 'keellssuper.com', cargills: 'cargillsonline.com', glomark: 'glomark.lk', spar: 'spar2u.lk', sathosa: 'lankasathosa.lk',
    arpico: 'arpicosupercentre.com', laugfs: 'laugfs.lk', ubereats: 'ubereats.com', kfc: 'kfc.lk', mcdonalds: 'mcdonalds.lk',
    pizzahut: 'pizzahut.lk', dominos: 'dominos.lk', burgerking: 'burgerking.lk', koko: 'paykoko.com', daraz: 'daraz.lk',
    odel: 'odel.lk', fashionbug: 'fashionbug.lk', coolplanet: 'coolplanet.lk', nolimit: 'nolimit.lk', singer: 'singersl.com',
    abans: 'abans.lk', softlogic: 'softlogic.lk', aliexpress: 'aliexpress.com', temu: 'temu.com', amazon: 'amazon.com',
    netflix: 'netflix.com', spotify: 'spotify.com', youtube: 'youtube.com', apple: 'apple.com', google: 'google.com',
    uber: 'uber.com', pickme: 'pickme.lk', lankaioc: 'lankaioc.com', ceypetco: 'ceypetco.gov.lk', dialog: 'dialog.lk',
    mobitel: 'mobitel.lk', slt: 'slt.lk', hutch: 'hutch.lk', airtel: 'airtel.lk', ceb: 'ceb.lk', leco: 'leco.lk',
    waterboard: 'waterboard.lk', combank: 'combank.lk'
};
// Other official sites to try when the first gives no icon.
const ALTERNATES = {
    combank: ['combank.net'], koko: ['koko.lk', 'mykoko.lk'], mcdonalds: ['mcdonalds.com'], pizzahut: ['pizzahut.com'],
    dominos: ['dominos.com'], arpico: ['arpico.com'], abans: ['abans.com'], airtel: ['airtel.in'], spar: ['spar-international.com'],
    laugfs: ['laugfsgas.lk', 'laugfssupermarkets.lk'], hutch: ['hutch.com'], softlogic: ['softlogiclife.lk'], fashionbug: ['fashionbug.com'],
    sathosa: ['sathosa.lk'], coolplanet: ['coolplanet.com'], leco: ['leco.lk']
};

// Google returns the same generic globe for unknown sites: learn its hash and skip it.
const fetchIcon = async (domain) => {
    const res = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`, { headers: { 'User-Agent': 'vela-build' } });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (!type.startsWith('image/png')) return null;
    return Buffer.from(await res.arrayBuffer());
};
const md5 = (b) => createHash('md5').update(b).digest('hex');
const globe = await fetchIcon('no-such-site-for-vela-logos.invalid');
const globeHash = globe ? md5(globe) : '';

const got = [];
const skipped = [];
for (const [slug, domain] of Object.entries(DOMAINS)) {
    try {
        // A real icon: PNG, not the placeholder globe, and not a tiny 16 px fallback.
        const usable = (p) => p && md5(p) !== globeHash && p.length > 24 && p.readUInt32BE(16) >= 48;
        let png = null;
        for (const d of [domain, ...(ALTERNATES[slug] || [])]) {
            const p = await fetchIcon(d);
            if (usable(p)) { png = p; break; }
        }
        if (!png) { skipped.push(`${slug} (${domain})`); continue; }
        writeFileSync(join(out, `${slug}.png`), png);
        got.push(slug);
    } catch (e) {
        skipped.push(`${slug} (${domain}: ${e.message})`);
    }
}
// Checked by eye on 16 Nov 2026: these sites return another company's icon, so they're left to Vela's badge.
for (const bad of ['hutch', 'odel', 'fashionbug', 'softlogic']) { const i = got.indexOf(bad); if (i >= 0) { got.splice(i, 1); try { (await import('node:fs')).rmSync(join(out, `${bad}.png`)); } catch (e) { /* gone */ } } }
writeFileSync(join(out, 'index.json'), JSON.stringify(got.sort(), null, 1));
console.log(`saved ${got.length}: ${got.join(', ')}`);
console.log(`no usable logo (Vela draws a brand-coloured badge instead): ${skipped.join(', ') || 'none'}`);
