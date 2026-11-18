// Whole-app check: every tab and every sheet opened with a realistic history (light and dark, phone and wide),
// and every error the page logs is reported. Serve the app on port 5510 first, then: node tests/app-check.mjs
import { launch, APP_READY } from './headless.mjs';
const url = 'http://localhost:5510/index.html';
const SEED = `(() => {
    localStorage.clear();
    const s = createDefaultState(); applyRegionDefaults(s);
    Object.assign(s.config, { currency: 'LKR', currencies: ['LKR', 'USD'], rates: { LKR: 300 } });
    s.accounts = [{ id: 'A', name: 'Commercial Bank', kind: 'bank', currency: 'LKR', opening: 100000, createdAt: 0 }, { id: 'C', name: 'Cash', kind: 'cash', currency: 'LKR', opening: 5000, createdAt: 0 }, { id: 'W', name: 'Wise', kind: 'card', currency: 'USD', opening: 50, createdAt: 0 }];
    s.auth = { user: { id: 'guest-local' }, isMock: true, completedOnboarding: true };
    const d = (n) => toISODate(addDays(new Date(), n));
    const b = { note: '', recurringId: null, receipt: null, fixed: false, pending: false, currency: 'LKR', accountId: 'A' };
    s.transactions = [
        { ...b, id: 't1', type: 'income', desc: 'Salary', amount: 150000, category: 'Salary', date: d(-3), createdAt: 1 },
        { ...b, id: 't2', type: 'expense', desc: 'Keells', amount: 4500, category: 'Food', date: d(0), createdAt: 2, sectionId: 'f1' },
        { ...b, id: 't3', type: 'expense', desc: 'Claude', amount: 6922.23, category: 'Other', date: d(-1), createdAt: 3, fx: { amount: 20, currency: 'USD', fee: 4.05, estimated: false } },
        { ...b, id: 't4', type: 'expense', desc: 'Netflix', amount: 3450, category: 'Entertainment', date: d(2), createdAt: 4, pending: true, fixed: true },
        { ...b, id: 't5', type: 'transfer', desc: 'ATM withdrawal', amount: 10000, toAmount: 10000, toCurrency: 'LKR', toAccountId: 'C', category: 'Transfer', date: d(-2), createdAt: 5 },
        { ...b, id: 't6', type: 'expense', desc: 'Old bill', amount: 900, category: 'Utilities', date: d(-9), createdAt: 6, beforeBalance: true }
    ];
    s.recurring = [{ id: 'r1', type: 'expense', name: 'Spotify Premium', amount: 1290, currency: 'LKR', category: 'Entertainment', frequency: 'monthly', nextDate: d(6), anchorDay: 5, autoLog: false, accountId: 'A', createdAt: 1, sub: true }];
    s.savings = [{ id: 'g1', name: 'Laptop', target: 300000, currency: 'LKR', saved: 50000, deadline: null, accountId: 'A', createdAt: 1 }];
    s.debts = [{ id: 'db1', direction: 'lent', person: 'Nimal', amount: 5000, currency: 'LKR', repaid: 0, dueDate: null, note: '', accountId: 'A', moved: true, createdAt: 1 }];
    s.config.sections = [{ id: 'f1', name: 'Food', mode: 'manual', value: 0, currency: 'LKR', color: 'pink', icon: 'c-Food', accountId: 'A' }, { id: 'f2', name: 'Savings', mode: 'rest', value: 0, currency: 'LKR', color: 'green', icon: 'c-Investment', accountId: null }];
    s.config.sectionSince = d(-30);
    s.config.sectionMoves = [{ id: 'm1', date: d(-3), kind: 'add', incomeId: null, from: null, to: 'f1', amount: 7500, currency: 'LKR' }];
    s.config.trips = [{ id: 'tr', name: 'Trip to Ella', budget: 30000, currency: 'LKR', start: d(-1), end: d(3), endedAt: null }];
    state = s; saveState(); return true;
})()`;
const STEPS = [
    "switchTab('dashboard', { fromHistory: true })", "switchTab('activity', { fromHistory: true })", "activityView = 'calendar'; renderActive()", "activityView = 'list'; renderActive()",
    "planTab = 'budgets'; switchTab('plan', { fromHistory: true })", "planTab = 'bills'; renderPlan()", "planTab = 'goals'; renderPlan()", "planTab = 'debts'; renderPlan()", "planTab = 'sections'; renderPlan()",
    "switchTab('analytics', { fromHistory: true })", "switchTab('settings', { fromHistory: true })",
    "openAddTx('expense')", "openAddTx('income')", "openEditTx('t3')", "openEditTx('t6')", "openTransfer()", "openEditTx('t5')", "openAddBill()", "openEditBill('r1')",
    "openAddGoal()", "openAddDebt()", "openSubscriptions()", "openTrips()", "openTrips('tr')", "openSectionView('f1')", "openSectionEditor('f1')", "openSectionEditor()",
    "openSecMove('f1', 'move')", "openSecMove('f1', 'add')", "openDivide('t1')", "openUnassigned()", "openCategoryManager()", "openCategoryEditor('Food')",
    "openAccountEditor('A')", "openAccountEditor()", "openNotifs()", "openBrandPick ? (openAddTx('expense'), $('tx-desc').value = 'Kottu', openBrandPick()) : 0", "wipeData()",
    "setViewAccount('W'); switchTab('dashboard', { fromHistory: true })", "setViewAccount('C'); planTab = 'sections'; switchTab('plan', { fromHistory: true })", "setViewAccount('A')",
    "applyTheme('light'); renderActive()", "applyTheme('dark'); renderActive()"
];
const page = await launch({ width: 412, height: 915 });
const problems = [];
try {
    await page.open(url); await page.evaluate(APP_READY); await page.evaluate(SEED);
    await page.open(url); await page.evaluate(APP_READY); await page.evaluate('new Promise((r) => setTimeout(r, 900))');
    await page.evaluate("window.__errs = []; window.addEventListener('error', (e) => window.__errs.push(String(e.message))); window.addEventListener('unhandledrejection', (e) => window.__errs.push('promise: ' + String(e.reason && e.reason.message || e.reason)));");
    for (const w of [412, 1280]) {
        await page.setSize(w, w > 800 ? 800 : 915, w === 1280);
        for (const step of STEPS) {
            const r = await page.evaluate(`(async () => { try { while (openSheets.length) hideSheet(openSheets[openSheets.length - 1]); ${step}; await new Promise((r) => setTimeout(r, 120)); const errs = window.__errs.splice(0); return errs.length ? errs.join(' | ') : ''; } catch (e) { return 'threw: ' + e.message; } })()`);
            if (r) problems.push(`${w}px  ${step}: ${r}`);
        }
    }
    if (page.pageErrors.length) problems.push('Page errors: ' + page.pageErrors.slice(0, 5).join(' | '));
} catch (e) { problems.push('Check could not finish: ' + e.message); }
await page.close();
console.log(problems.length ? `${problems.length} problems:\n- ${problems.join('\n- ')}` : `App check: ${STEPS.length} screens and sheets opened at 2 sizes, light and dark, no errors`);
process.exit(problems.length ? 1 : 0);
