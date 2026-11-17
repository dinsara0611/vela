// Speed check: Vela with a large, realistic history on a CPU slowed down 4x (about a mid-range phone).
// Times start-up, each tab, switching accounts, opening the entry form, typing a name and the theme switch.
// Serve the app on port 5510 first, then: node tests/perf.mjs [--cpu=4]
import { launch, APP_READY } from './headless.mjs';

const url = process.argv.slice(2).find((a) => /^https?:/.test(a)) || 'http://localhost:5510/index.html';
const repeat = Number((process.argv.find((a) => a.startsWith('--repeat=')) || '--repeat=1').split('=')[1]);
const cpuArg = process.argv.find((a) => a.startsWith('--cpu='));
const cpu = cpuArg ? Number(cpuArg.split('=')[1]) : 4;

const SEED = `(() => {
    localStorage.clear();
    const s = createDefaultState();
    applyRegionDefaults(s);
    Object.assign(s.config, { currency: 'LKR', currencies: ['LKR', 'USD'], budgetCurrency: 'LKR', budget: 250000, rates: { LKR: 300 } });
    s.config.categoryBudgets = { Food: 60000, Travel: 20000, Shopping: 30000 };
    s.accounts = [
        { id: 'a-cash', name: 'Cash', kind: 'cash', currency: 'LKR', opening: 20000, createdAt: 0 },
        { id: 'a-com', name: 'Commercial Bank', kind: 'bank', currency: 'LKR', opening: 300000, createdAt: 0 },
        { id: 'a-boc', name: 'BOC', kind: 'bank', currency: 'LKR', opening: 50000, createdAt: 0 },
        { id: 'a-usd', name: 'Wise', kind: 'card', currency: 'USD', opening: 500, createdAt: 0 }
    ];
    s.auth = { user: { id: 'guest-local' }, isMock: true, completedOnboarding: true };
    const shops = [['Keells', 'Food'], ['Cargills', 'Food'], ['Uber Eats', 'Food'], ['PickMe', 'Travel'], ['Uber', 'Travel'], ['Dialog', 'Utilities'], ['SLT', 'Utilities'],
        ['Daraz', 'Shopping'], ['Netflix', 'Entertainment'], ['Spotify', 'Entertainment'], ['Kottu', 'Food'], ['Bus', 'Travel'], ['Pharmacy', 'Health'], ['Carnage', 'Shopping'],
        ['Sunil Stores', 'Food'], ['KFC', 'Food'], ['Pizza Hut', 'Food'], ['Lanka IOC', 'Travel'], ['Odel', 'Shopping'], ['Rent', 'Rent']];
    const accs = ['a-cash', 'a-com', 'a-boc', 'a-usd'];
    const now = Date.now();
    const tx = [];
    for (let n = 0; n < 3000; n++) {
        const [desc, category] = shops[n % shops.length];
        const d = new Date(now - Math.floor(n / 6) * 86400000);
        const acc = accs[n % 4];
        tx.push({ id: 'p' + n, type: 'expense', desc, amount: 200 + (n * 37) % 9000, currency: acc === 'a-usd' ? 'USD' : 'LKR', category, date: toISODate(d), note: '', createdAt: now - n * 1000, accountId: acc, recurringId: null, receipt: null, fixed: false, pending: false });
        if (n % 30 === 0) tx.push({ id: 'i' + n, type: 'income', desc: 'Salary', amount: 250000, currency: 'LKR', category: 'Salary', date: toISODate(d), note: '', createdAt: now - n * 1000, accountId: 'a-com', recurringId: null, receipt: null, fixed: false, pending: false });
    }
    s.transactions = tx;
    s.recurring = [{ id: 'b1', type: 'expense', name: 'Rent', amount: 45000, currency: 'LKR', category: 'Rent', frequency: 'monthly', nextDate: toISODate(new Date(now + 5 * 86400000)), anchorDay: 5, autoLog: false, accountId: 'a-com', createdAt: 1 }];
    state = s; saveState(); return tx.length;
})()`;

// Times fn in the page: its own run plus the style/layout work it causes (read back with offsetHeight).
const time = (label, body) => `(async () => {
    await new Promise((r) => requestAnimationFrame(() => r()));
    const t0 = performance.now();
    ${body}
    document.body.offsetHeight;
    const t1 = performance.now();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    return { label: ${JSON.stringify(label)}, run: Math.round(t1 - t0), toPaint: Math.round(performance.now() - t0) };
})()`;

const page = await launch({ width: 412, height: 915 });
try {
    await page.open(url);
    await page.evaluate(APP_READY);
    const n = await page.evaluate(SEED);
    await page.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    const t0 = Date.now();
    await page.open(url);
    await page.evaluate(APP_READY);
    await page.evaluate('new Promise((r) => setTimeout(r, 300))');
    const startup = Date.now() - t0;
    const all = [];
    for (let r = 0; r < repeat; r++) {
        const rows = [];
        rows.push(await page.evaluate(time('Home (render)', "switchTab('dashboard'); renderActive();")));
        for (const tab of ['activity', 'plan', 'analytics', 'settings', 'dashboard']) rows.push(await page.evaluate(time(`Open tab: ${tab}`, `switchTab('${tab}');`)));
        rows.push(await page.evaluate(time('Switch account (BOC)', "setViewAccount('a-boc');")));
        rows.push(await page.evaluate(time('Switch account (Commercial Bank)', "setViewAccount('a-com');")));
        rows.push(await page.evaluate(time('Open add form', "openAddTx('expense');")));
        rows.push(await page.evaluate(time('Type a letter in the name', "$('tx-desc').value = 'Keel' + 'abc'[" + r + " % 3]; $('tx-desc').dispatchEvent(new Event('input', { bubbles: true }));")));
        await page.evaluate("closeSheet('modal-tx'); new Promise((r) => setTimeout(r, 400))");
        rows.push(await page.evaluate(time('Theme switch (applyTheme)', "applyTheme(state.config.theme === 'dark' ? 'light' : 'dark');")));
        rows.push(await page.evaluate(time('Activity search', "switchTab('activity'); $('activity-search').value = 'keells'.slice(0, 4 + (" + r + " % 3)); $('activity-search').dispatchEvent(new Event('input', { bubbles: true }));")));
        all.push(rows);
    }
    // The middle value of the repeats for each action (one slow moment on the computer doesn't count).
    const med = (xs) => { const v = [...xs].sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
    const rows = all[0].map((r, k) => ({ label: r.label, run: med(all.map((x) => x[k].run)), toPaint: med(all.map((x) => x[k].toPaint)) }));
    console.log(`${n} entries, CPU slowed ${cpu}x. Start-up to usable: ${startup} ms`);
    rows.forEach((r) => console.log(`${r.label.padEnd(36)} ${String(r.run).padStart(5)} ms   (to next frame ${r.toPaint} ms)`));
    if (page.pageErrors.length) console.log('Errors:', page.pageErrors.slice(0, 3).join(' | '));
} catch (e) {
    console.error('Could not measure:', e.message);
}
await page.close();
