// One-time (build-time) download of shop and bank logos into ./logos, so the app shows real logos without ever
// contacting anyone while it runs (no spending data leaves the phone).
// Source: each brand's own app icon on Google Play (192 px PNG). Every app below was checked to be published by the
// brand itself (the developer name must match), and every icon was checked by eye before it was added to the app.
// Brands with no official app keep the site icon saved earlier, or Vela's badge in the brand's colours.
// Logos are trademarks of their owners and are shown only to identify where money was spent.
// Run: node scripts/fetch-logos.mjs
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'logos');
mkdirSync(out, { recursive: true });

// slug (as in BRANDS in app.js) -> [Google Play package, text the developer name must contain]
// Left out after checking by eye (16-17 Nov 2026): Daraz and SHEIN use seasonal sale icons (Daraz keeps its site icon),
// Standard Chartered's Sri Lankan app isn't on Play (the Indian one is labelled IN), Nolimit's site icon is blurry.
const APPS = {
    netflix: ['com.netflix.mediaclient', 'Netflix'], spotify: ['com.spotify.music', 'Spotify'], youtube: ['com.google.android.youtube', 'Google'],
    primevideo: ['com.amazon.avod.thirdpartyclient', 'Amazon'], disney: ['com.disney.disneyplus', 'Disney'], steam: ['com.valvesoftware.android.steam.community', 'Valve'],
    playstation: ['com.scee.psxandroid', 'PlayStation'], openai: ['com.openai.chatgpt', 'OpenAI'], claude: ['com.anthropic.claude', 'Anthropic'],
    canva: ['com.canva.editor', 'Canva'], github: ['com.github.android', 'GitHub'], paypal: ['com.paypal.android.p2pmobile', 'PayPal'],
    amazon: ['com.amazon.mShop.android.shopping', 'Amazon'], google: ['com.google.android.googlequicksearchbox', 'Google'],
    uber: ['com.ubercab', 'Uber'], ubereats: ['com.ubercab.eats', 'Uber'], booking: ['com.booking', 'Booking.com'], agoda: ['com.agoda.mobile.consumer', 'agoda'],
    airbnb: ['com.airbnb.android', 'Airbnb'], aliexpress: ['com.alibaba.aliexpresshd', 'Alibaba'], temu: ['com.einnovation.temu', 'Temu'],
    ebay: ['com.ebay.mobile', 'eBay'], pickme: ['com.pickme.passenger', 'Digital Mobility'],
    koko: ['com.sl.koko.bnpl', 'Koko'], mintpay: ['lk.mintpay.app', 'Mintpay'], subway: ['com.subway.mobile.subwayapp03', 'SUBWAY'],
    tacobell: ['com.tacobell.ordering', 'Taco Bell'], pizzahut: ['lk.gamma.pizzakraft.PizzaHut', 'Pizzakraft'], dominos: ['com.dominos.srilanka', 'Jubilant'],
    burgerking: ['in.burgerking.android', 'Restaurant Brands'], keells: ['com.jkit.keellsretailapp', 'Keells'], cargills: ['com.service.online.cargills', 'Cargills'],
    spar: ['com.sparsrilanka.apps', 'SPAR'], arpico: ['com.arpico.groupit.myarpico', 'RICHARD PIERIS'], laugfsgas: ['com.laugfsgaseasyconnect.laugfs_easy_connect', 'LAUGFS'],
    kapruka: ['com.kapruka.kaprukamobile', 'Kapruka'], singer: ['com.singersl.androidapp', 'Singer'], abans: ['com.abans.myabans', 'Sirius'],
    softlogic: ['com.mobileapp.softlogiccare', 'Softlogic'], srilankan: ['com.sla.android.app', 'SriLankan'], dialog: ['net.omobio.dialogsc', 'Dialog'],
    mobitel: ['com.mobitel.selfcare', 'Mobitel'], slt: ['com.slt.selfcare', 'Sri Lanka Telecom'], hutch: ['com.omobio.etisalatone', 'Hutch'],
    airtel: ['com.tsdc.selfcare', 'Airtel'], leco: ['com.leco.myleco', 'LANKA ELECTRICITY'], waterboard: ['com.SadeepDhananjana.NWSDBSelfCare', 'National Water'],
    litro: ['lk.litro.fixel', 'Fixel'], nawaloka: ['com.health_assist', 'Nawaloka'],
    // Banks and wallets
    combank: ['combank.com.combankdigital', 'Commercial Bank'], sampath: ['lk.sampath.sampathvishwa', 'Sampath'], hnb: ['com.hnb.DigitalApp', 'Hatton National'],
    boc: ['com.ofss.fcdb.mobile.android.phone.boc.launcher', 'Bank of Ceylon'], peoples: ['com.peoplesbank.retailbanking', "People's Bank"],
    nsb: ['lk.nsbpay.user', 'National Savings'], ntb: ['com.nationstrust.mobilebanking', 'Nations Trust'], ndb: ['com.ndb.mobilebanking', 'National Development'],
    seylan: ['com.fg.seylan', 'Seylan'], dfcc: ['com.dfcc.digitalapp', 'DFCC'], pabc: ['com.panasia.retail.digital', 'PAN ASIA'], unionbank: ['com.epic.ubmobilebank', 'Union Bank'],
    amana: ['lk.amanabank.onlinebanking', 'Amana'], cargillsbank: ['com.fg.wallet', 'Cargills Bank'], hsbc: ['com.hsbc.hsbcnet', 'HSBC'], mcb: ['com.mcb.mobilebanking', 'MCB'], rdb: ['lk.rdbquick.app', 'Pradeshiya'],
    hdfc: ['com.hdfcbank.android.now', 'HDFC'], lolc: ['com.fg.lolc', 'LOLC'], frimi: ['com.nationstrust.frimi', 'Nations Trust'], mcash: ['family.mobitel.mcash', 'Mobitel']
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (url, as = 'text') => {
    for (let n = 0; n < 3; n++) {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
            if (res.ok) return as === 'text' ? res.text() : Buffer.from(await res.arrayBuffer());
            if (res.status !== 429 && res.status < 500) return null;
        } catch (e) { /* retry */ }
        await sleep(3000 * (n + 1));
    }
    return null;
};

const got = [];
const failed = [];
for (const [slug, [pkg, dev]] of Object.entries(APPS)) {
    const html = await get(`https://play.google.com/store/apps/details?id=${pkg}&hl=en&gl=LK`);
    const ld = html && /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(html);
    let info = null;
    try { info = ld && JSON.parse(ld[1]); } catch (e) { /* unreadable page */ }
    const author = info && info.author ? String(info.author.name) : '';
    if (!info || !info.image || !author.toLowerCase().includes(dev.toLowerCase())) { failed.push(`${slug} (${pkg}: developer "${author}")`); continue; }
    const png = await get(`${info.image}=s192-rp`, 'buffer');
    if (!png || png.readUInt32BE(0) !== 0x89504e47) { failed.push(`${slug} (no PNG)`); continue; }
    writeFileSync(join(out, `${slug}.png`), png);
    got.push(slug);
    await sleep(400);
}
const all = readdirSync(out).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)).sort();
writeFileSync(join(out, 'index.json'), JSON.stringify(all, null, 1));
console.log(`app icons saved: ${got.length}\nnot saved: ${failed.join(', ') || 'none'}\nlogos now: ${all.length}`);
if (!existsSync(join(out, 'koko.png'))) console.log('note: koko has no logo');
