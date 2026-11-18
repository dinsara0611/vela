// Fair speed comparison: each screen drawn 10 times in a row inside the page, average per draw (ms),
// on a 4x slowed CPU with 3,100 entries. Usage: node tests/bench.mjs <url> [<url2> ...]
import { launch, APP_READY } from './headless.mjs';
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
const urls = process.argv.slice(2).filter((a) => /^https?:/.test(a));
const STEPS = {
    home: "switchTab('dashboard', { fromHistory: true }); renderActive();",
    activity: "switchTab('activity', { fromHistory: true }); renderActive();",
    plan: "switchTab('plan', { fromHistory: true }); renderActive();",
    insights: "switchTab('analytics', { fromHistory: true }); renderActive();",
    settings: "switchTab('settings', { fromHistory: true }); renderActive();",
    account: "setViewAccount(state.config && viewId() === 'a-boc' ? 'a-com' : 'a-boc');",
    typing: "openAddTx('expense'); $('tx-desc').value = 'Keel'; $('tx-desc').dispatchEvent(new Event('input', { bubbles: true })); while (openSheets.length) hideSheet(openSheets[openSheets.length - 1]);"
};
const run = async (url) => {
    const page = await launch({ width: 412, height: 915 });
    await page.open(url); await page.evaluate(APP_READY); await page.evaluate(SEED);
    await page.open(url); await page.evaluate(APP_READY); await page.evaluate('new Promise((r) => setTimeout(r, 800))');
    await page.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const out = {};
    for (const [k, code] of Object.entries(STEPS)) {
        out[k] = await page.evaluate(`(async () => { ${code} await new Promise((r) => setTimeout(r, 200));
            const t0 = performance.now(); for (let i = 0; i < 10; i++) { ${code} document.body.offsetHeight; } return Math.round((performance.now() - t0) / 10); })()`);
    }
    await page.close();
    return out;
};
for (let round = 0; round < 3; round++) for (const u of urls) console.log(u.includes('5511') ? 'OLD' : 'NEW', JSON.stringify(await run(u)));
