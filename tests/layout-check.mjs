// Opens every tab of the app at small phone to desktop widths, in dark and light, and reports anything that spills
// sideways off the screen (the page scrolls sideways, or an element pokes past the right edge).
// Serve the app on port 5510 first, then: node tests/layout-check.mjs [--shots=folder]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, APP_READY } from './headless.mjs';

const url = process.argv.slice(2).find((a) => /^https?:/.test(a)) || 'http://localhost:5510/index.html';
const shotsArg = process.argv.find((a) => a.startsWith('--shots='));
const shots = shotsArg ? shotsArg.split('=')[1] : null;
if (shots) mkdirSync(shots, { recursive: true });
const SIZES = [[320, 640], [360, 760], [375, 812], [412, 915], [768, 1024], [1024, 768], [1280, 800]];
const TABS = ['dashboard', 'activity', 'plan', 'analytics', 'settings'];

// A guest with a month of typical entries, shop logos included.
const SEED = `(() => {
    localStorage.clear();
    const st = createDefaultState();
    applyRegionDefaults(st);
    Object.assign(st.config, { currency: 'LKR', currencies: ['LKR', 'USD'], budgetCurrency: 'LKR', budget: 150000, rates: { LKR: 300 } });
    st.accounts = [{ id: 'acc-cash', name: 'Cash', kind: 'cash', currency: 'LKR', opening: 20000, createdAt: 0 },
        { id: 'acc-bank', name: 'Commercial Bank Savings Account', kind: 'bank', currency: 'LKR', opening: 250000, createdAt: 0 }];
    st.auth = { user: { id: 'guest-local' }, isMock: true, completedOnboarding: true };
    const d = (n) => toISODate(addDays(new Date(), -n));
    const rows = [['Keells', 4520.5, 'Food', 0], ['Uber Eats', 2765.62, 'Food', 1], ['PickMe', 771.51, 'Travel', 1], ['Netflix', 3312.45, 'Entertainment', 2],
        ['Dialog', 1598, 'Utilities', 3], ['Koko', 2992.42, 'Shopping', 4], ['Daraz', 12500, 'Shopping', 5], ['A very long shop name that keeps going past the edge', 123456789.99, 'Other', 6],
        ['Spotify', 1100, 'Entertainment', 7], ['KFC', 2400, 'Food', 8]];
    st.transactions = rows.map(([desc, amount, category, ago], i) => ({ id: 't' + i, type: 'expense', desc, amount, currency: 'LKR', category, date: d(ago), note: '', createdAt: Date.now() - i, accountId: i % 2 ? 'acc-bank' : 'acc-cash', recurringId: null, receipt: null, fixed: false, pending: false }));
    st.transactions.push({ id: 'inc', type: 'income', desc: 'Salary', amount: 285000, currency: 'LKR', category: 'Salary', date: d(9), note: '', createdAt: 1, accountId: 'acc-bank', recurringId: null, receipt: null, fixed: false, pending: false });
    state = st; saveState(); renderActive(); return true;
})()`;

const CHECK = `(() => {
    const w = document.documentElement.clientWidth;
    const out = [];
    if (document.documentElement.scrollWidth > w + 1) out.push('page scrolls sideways (' + document.documentElement.scrollWidth + ' > ' + w + ')');
    const clipped = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p); if (/(hidden|auto|scroll|clip)/.test(s.overflowX)) { const r = p.getBoundingClientRect(); if (r.right <= w + 1) return true; } } return false; };
    document.querySelectorAll('main *, .appbar *, .tabbar *, nav *').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') return;
        if (r.right > w + 1 && !clipped(el)) out.push((el.id ? '#' + el.id : el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : el.tagName) + ' right edge ' + Math.round(r.right) + 'px');
    });
    return [...new Set(out)].slice(0, 8);
})()`;

let page;
let problems = 0;
try {
    page = await launch({ width: 375, height: 812 });
    for (const dark of [true, false]) {
        for (const [w, h] of SIZES) {
            await page.setSize(w, h, { dark });
            await page.open(url);
            if (!(await page.evaluate(APP_READY))) throw new Error('the app did not start');
            await page.evaluate(SEED);
            await page.open(url); // start again on the saved sample data, as after a restart
            await page.evaluate(APP_READY);
            const gate = await page.evaluate(`[...document.querySelectorAll('.auth, .lock, #auth-screen, #lock-screen')].some((e) => e.offsetParent !== null && e.getBoundingClientRect().height > 200)`);
            if (gate) { problems++; console.log(`${w}x${h}: the sign-in or lock screen is showing, so the tabs could not be checked`); continue; }
            await page.evaluate(`(() => { state.config.theme = '${dark ? 'dark' : 'light'}'; document.documentElement.setAttribute('data-theme', state.config.theme); return true; })()`);
            for (const tab of TABS) {
                await page.evaluate(`(async () => { switchTab('${tab}'); await new Promise((r) => setTimeout(r, 700)); return true; })()`);
                const found = await page.evaluate(CHECK);
                if (found.length) { problems += found.length; console.log(`${w}x${h} ${dark ? 'dark' : 'light'} ${tab}: ${found.join('; ')}`); }
                if (shots) await page.screenshot(join(shots, `${w}-${dark ? 'dark' : 'light'}-${tab}.png`));
            }
        }
    }
    if (page.pageErrors.length) console.log(`Errors in the page: ${page.pageErrors.slice(0, 5).join(' | ')}`);
    console.log(problems ? `${problems} layout problems` : `No layout problems at ${SIZES.map(([w]) => w).join(', ')} px wide, dark and light, ${TABS.length} tabs each`);
} catch (e) {
    console.error(`Could not run the check: ${e.message}`);
    problems = problems || 1;
}
if (page) await page.close();
process.exit(problems ? 1 : 0);
