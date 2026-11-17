// One-time (build-time) download of the brands in scripts/brands-extra.txt from each brand's OWN website:
// the home-screen icon the site publishes (apple-touch-icon, web-app manifest icon, or large favicon).
// Every logo is resized to a small 128 px WebP and must be checked by eye before it ships (see logos-check/).
// The app never fetches logos while it runs, so typing a shop name never leaves the phone.
// Needs sharp:  npm i sharp   then:  node scripts/fetch-logos-extra.mjs [--only=slug,slug] [--convert-existing]
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { spawnSync } from 'node:child_process';

const root = process.env.VELA_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'logos');
const check = join(root, 'logos-check');
mkdirSync(check, { recursive: true });
const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);

// An honest name for this script. Sites that refuse it are left out (they keep Vela's coloured badge).
const UA = 'Mozilla/5.0 (compatible; VelaLogoFetcher/1.0)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// curl, not Node's fetch: many brand sites turn away Node's requests but answer curl like a normal browser.
const tmp = join(check, '.download');
const get = async (url, as = 'text') => {
    try {
        const res = spawnSync('curl', ['-sL', '--compressed', '--max-time', '15', '-A', UA, '-H', 'Accept-Language: en', '-o', tmp, '-w', '%{http_code} %{url_effective}', url], { encoding: 'utf8' });
        const [code, ...rest] = String(res.stdout || '').trim().split(' ');
        if (!/^2/.test(code) || !existsSync(tmp)) return null;
        const buf = readFileSync(tmp);
        return as === 'text' ? { text: buf.toString('utf8'), url: rest.join(' ') || url } : buf;
    } catch (e) { return null; }
};

// Reads the list. Lines: "slug | pattern | name | category | site"   or   "@slug | site" for brands already in app.js.
const brands = readFileSync(join(root, 'scripts', 'brands-extra.txt'), 'utf8').split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => l.split(' | ').map((x) => x.trim())) // fields are separated by " | "; patterns use "|" without spaces
    .map((p) => (p[0].startsWith('@') ? { slug: p[0].slice(1), site: p[1], existing: true } : { slug: p[0], pattern: p[1], name: p[2], cat: p[3], site: p[4] }))
    .filter((b) => !only.length || only.includes(b.slug));

const sizeOf = (s) => { const m = /(\d+)x(\d+)/.exec(s || ''); return m ? Number(m[1]) : 0; };
const candidatesFor = async (site) => {
    const list = [];
    const page = await get(`https://${site}/`);
    if (page) {
        const base = page.url;
        const links = page.text.match(/<link\b[^>]*>/gi) || [];
        for (const tag of links) {
            const rel = (/rel=["']([^"']+)["']/i.exec(tag) || [])[1] || '';
            const href = (/href=["']([^"']+)["']/i.exec(tag) || [])[1];
            if (!href) continue;
            const abs = (() => { try { return new URL(href.replace(/&amp;/g, '&'), base).href; } catch (e) { return null; } })();
            if (!abs) continue;
            if (/apple-touch-icon/i.test(rel)) list.push({ url: abs, score: 3000 + (sizeOf((/sizes=["']([^"']+)/i.exec(tag) || [])[1]) || 180) });
            else if (/(^|\s)icon(\s|$)|shortcut icon|mask-icon/i.test(rel)) {
                const size = sizeOf((/sizes=["']([^"']+)/i.exec(tag) || [])[1]);
                list.push({ url: abs, score: (/\.svg(\?|$)/i.test(abs) ? 2500 : 1000) + size });
            } else if (/manifest/i.test(rel)) {
                const man = await get(abs);
                try {
                    const icons = (JSON.parse(man.text).icons || []);
                    icons.forEach((i) => { try { list.push({ url: new URL(i.src, abs).href, score: 2000 + sizeOf(i.sizes) }); } catch (e) { /* bad icon */ } });
                } catch (e) { /* no manifest */ }
            }
        }
    }
    list.push({ url: `https://${site}/apple-touch-icon.png`, score: 1500 });
    // Google's copy of the site's own icon at high resolution (works when the site blocks automatic visits).
    list.push({ url: `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(`https://${site}`)}&size=256`, score: 1800 });
    list.push({ url: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(site)}&sz=256`, score: 500 });
    return list.sort((a, b) => b.score - a.score);
};

// Decodes an icon and checks it is a clear, square picture of at least 96 px (or 64 px as a last resort).
// Old .ico files usually hold PNG pictures inside: take the biggest one.
const fromIco = (buf) => {
    if (buf.length < 22 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) return buf;
    let best = null;
    for (let i = 0, n = buf.readUInt16LE(4); i < n; i++) {
        const e = 6 + i * 16;
        const size = buf.readUInt32LE(e + 8);
        const off = buf.readUInt32LE(e + 12);
        const w = buf[e] || 256;
        if (off + size <= buf.length && buf.readUInt32BE(off) === 0x89504e47 && (!best || w > best.w)) best = { w, data: buf.subarray(off, off + size) };
    }
    return best ? best.data : buf;
};
const tryIcon = async (url) => {
    const raw = await get(url, 'buffer');
    if (!raw || raw.length < 100) return null;
    const buf = fromIco(raw);
    try {
        const img = sharp(buf, { density: 300 });
        const meta = await img.metadata();
        if (!meta.width || !meta.height) return null;
        const ratio = meta.width / meta.height;
        if (ratio < 0.8 || ratio > 1.25) return null;
        const px = meta.format === 'svg' ? 512 : Math.min(meta.width, meta.height);
        return { buf, px, format: meta.format };
    } catch (e) { return null; }
};

// Big brands whose sites don't share a clear icon: their official Google Play app icon instead.
// [package, text the publisher's name must contain] - a different publisher means it is skipped.
const PLAY = {
    whatsapp: ['com.whatsapp', 'WhatsApp'],
    slack: ['com.Slack', 'Slack'],
    fedex: ['com.fedex.ida.android', 'FedEx'],
    ups: ['com.ups.mobile.android', 'UPS'],
    doordash: ['com.dd.doordash', 'DoorDash'],
    chickfila: ['com.chickfila.cfaflagship', 'Chick-fil-A'],
    bestbuy: ['com.bestbuy.android', 'Best Buy'],
    hyatt: ['com.hyatt.hyt', 'Hyatt'],
    verizon: ['com.vzw.hss.myverizon', 'Verizon'],
    tmobile: ['com.tmobile.pr.mytmobile', 'T-Mobile'],
    kaspersky: ['com.kms.free', 'Kaspersky'],
    imo: ['com.imo.android.imoim', 'imo'],
    hp: ['com.hp.printercontrol', 'HP'],
    shopee: ['com.shopee.my', 'Shopee'],
    dhl: ['com.dhl.exp.dhlmobile', 'DHL'],
    toyota: ['com.toyota.oneapp', 'Toyota'],
    sony: ['com.sony.songpal.mdr', 'Sony'],
    oppo: ['com.oppo.store', 'OPPO'],
    sephora: ['com.sephora', 'Sephora'],
    dunkin: ['com.dunkinbrands.otgo', 'Dunkin'],
    papajohns: ['com.papajohns.android', 'Papa John'],
    krispykreme: ['com.krispykreme.HotLight', 'Krispy Kreme'],
    dairyqueen: ['com.olo.dairyqueen', 'Dairy Queen'],
    nandos: ['com.nandos.app', 'Nando'],
    lufthansa: ['com.lufthansa.android.lufthansa', 'Lufthansa'],
    malaysiaairlines: ['com.malaysiaairlines.mobile', 'Malaysia Airlines'],
    visa: ['com.visa.vmp', 'Visa'],
    bybit: ['com.bybit.app', 'Bybit'],
    tidal: ['com.aspiro.tidal', 'TIDAL'],
    scribd: ['com.scribd.app.reader0', 'Scribd'],
    hotstar: ['in.startv.hotstar', 'JIOSTAR'],
    headspace: ['com.getsomeheadspace.android', 'Headspace'],
    jio: ['com.jio.myjio', 'Jio'],
    att: ['com.att.myWireless', 'AT&T'],
    starlink: ['com.starlink.mobile', 'Space Exploration'],
    zoho: ['com.zoho.mail', 'Zoho'],
    indrive: ['sinet.startup.inDriver', 'SUOL INNOVATIONS'],
    ola: ['com.olacabs.customer', 'ANI Technologies'],
    lazada: ['com.lazada.android', 'Lazada'],
    supercell: ['com.supercell.clashofclans', 'Supercell'],
    newbalance: ['com.newbalance.loyalty', 'New Balance'],
    carrefour: ['com.carrefour.fid.android', 'Carrefour'],
    tvs: ['com.tvsmotor.connect', 'TVS Motor'],
    popeyes: ['com.popeyes.app', 'Popeyes']
};
const fromPlay = async (slug) => {
    const app = PLAY[slug];
    if (!app) return null;
    const page = await get(`https://play.google.com/store/apps/details?id=${app[0]}&hl=en&gl=US`);
    const ld = page && /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(page.text);
    let info = null;
    try { info = ld && JSON.parse(ld[1]); } catch (e) { /* unreadable page */ }
    const author = info && info.author ? String(info.author.name) : '';
    if (!info || !info.image || !author.toLowerCase().includes(app[1].toLowerCase())) { console.log(`
  ${slug}: Play publisher "${author}" - skipped`); return null; }
    const icon = await tryIcon(`${info.image}=s192-rp`);
    return icon ? { ...icon, from: `play:${app[0]}` } : null;
};

const got = [];
const small = [];
const failed = [];
const colours = {};
for (const b of brands) {
    let best = await fromPlay(b.slug);
    for (const c of best ? [] : await candidatesFor(b.site)) {
        const icon = await tryIcon(c.url);
        if (!icon) continue;
        if (!best || icon.px > best.px) best = { ...icon, from: c.url };
        if (icon.px >= 96) break;
    }
    if (!best || best.px < 48) { failed.push(`${b.slug} (${b.site})`); continue; }
    if (best.px < 96) small.push(`${b.slug} ${best.px}px`);
    const webp = await sharp(best.buf, { density: 300 }).resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 88 }).toBuffer();
    writeFileSync(join(out, `${b.slug}.webp`), webp);
    const { dominant } = await sharp(webp).stats();
    colours[b.slug] = '#' + [dominant.r, dominant.g, dominant.b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    got.push(b.slug);
    process.stdout.write(`${b.slug} `);
    await sleep(150);
}
const resultFile = join(check, 'fetch-result.json');
const before = only.length && existsSync(resultFile) ? JSON.parse(readFileSync(resultFile, 'utf8')) : { got: [], small: [], failed: [], colours: {} };
const merged = {
    got: [...new Set([...before.got, ...got])],
    small: [...before.small.filter((x) => !brands.some((b) => x.startsWith(`${b.slug} `))), ...small],
    failed: [...before.failed.filter((x) => !brands.some((b) => x.startsWith(`${b.slug} `))), ...failed],
    colours: { ...before.colours, ...colours }
};
writeFileSync(resultFile, JSON.stringify(merged, null, 1));
console.log(`\nsaved ${got.length}, small ${small.length}: ${small.join(', ')}\nfailed ${failed.length}: ${failed.join(', ')}`);

// Shrinks the older 192 px PNG logos to the same small WebP.
if (args.includes('--convert-existing')) {
    for (const f of readdirSync(out).filter((x) => x.endsWith('.png'))) {
        const slug = f.slice(0, -4);
        const webp = await sharp(join(out, f)).resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 88 }).toBuffer();
        writeFileSync(join(out, `${slug}.webp`), webp);
        unlinkSync(join(out, f));
    }
}
const all = readdirSync(out).filter((f) => f.endsWith('.webp')).map((f) => f.slice(0, -5)).sort();
writeFileSync(join(out, 'index.json'), JSON.stringify(all, null, 1));
console.log(`logos now: ${all.length}`);
