// Profiles Vela on a slowed CPU with a large history: which functions take the time when opening Plan,
// switching accounts and opening Activity / Insights / Home. Serve the app on port 5510 first, then:
// node tests/profile.mjs [startup]
import { launch, APP_READY } from './headless.mjs';
const url = 'http://localhost:5510/index.html';
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
const page = await launch({ width: 412, height: 915 });
await page.open(url); await page.evaluate(APP_READY); await page.evaluate(SEED);
await page.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await page.send('Profiler.enable');
await page.send('Profiler.setSamplingInterval', { interval: 200 });
const startup = process.argv.includes('startup');
if (startup) { await page.send('Profiler.start'); await page.open(url); await page.evaluate(APP_READY); await page.evaluate('new Promise((r) => setTimeout(r, 800))'); }
else {
    await page.open(url); await page.evaluate(APP_READY); await page.evaluate('new Promise((r) => setTimeout(r, 800))');
    await page.send('Profiler.start');
    await page.evaluate(`(async () => { const w = (ms) => new Promise((r) => setTimeout(r, ms));
        const only = '${process.argv[2] || ''}';
        for (let k = 0; k < 4; k++) { if (only === 'activity') { switchTab('activity', { fromHistory: true }); renderActive(); await w(100); continue; } switchTab('plan'); await w(150); setViewAccount(k % 2 ? 'a-com' : 'a-boc'); await w(150); switchTab('activity'); await w(150); switchTab('analytics'); await w(150); switchTab('dashboard'); await w(150); } })()`);
}
const { profile } = await page.send('Profiler.stop');
const self = new Map();
const dt = profile.timeDeltas;
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
profile.samples.forEach((id, i) => { const n = byId.get(id); const f = n.callFrame; const key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`; self.set(key, (self.get(key) || 0) + (dt[i] || 0) / 1000); });
const total = [...self.values()].reduce((a, v) => a + v, 0);
[...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, v]) => console.log(`${v.toFixed(0).padStart(6)} ms  ${(v / total * 100).toFixed(1).padStart(5)}%  ${k}`));
await page.close();
