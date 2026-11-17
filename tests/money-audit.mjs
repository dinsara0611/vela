// Money audit: one realistic setup (four accounts, salary received and salary still expected, a fixed bill due,
// a paid fixed bill, a cash withdrawal (transfer), last month's spending, a dollar account), then every number
// Home, Activity, Plan and Insights show is checked against what the money really is.
// Serve the app on port 5510 first, then: node tests/money-audit.mjs
import { launch, APP_READY } from './headless.mjs';

const url = process.argv.slice(2).find((a) => /^https?:/.test(a)) || 'http://localhost:5510/index.html';

const SEED = `(() => {
    localStorage.clear();
    const s = createDefaultState();
    applyRegionDefaults(s);
    Object.assign(s.config, { currency: 'LKR', currencies: ['LKR', 'USD'], budgetCurrency: 'LKR', budget: 80000, budgetMode: 'fixed', rates: { LKR: 300 }, rateOverrides: { LKR: 300 } });
    s.accounts = [
        { id: 'A', name: 'Commercial bank', kind: 'bank', currency: 'LKR', opening: 100000, createdAt: 0 },
        { id: 'B', name: 'BOC', kind: 'bank', currency: 'LKR', opening: 100000, createdAt: 0 },
        { id: 'C', name: 'Cash', kind: 'cash', currency: 'LKR', opening: 5000, createdAt: 0 },
        { id: 'D', name: 'Wise', kind: 'card', currency: 'USD', opening: 200, createdAt: 0 }
    ];
    s.auth = { user: { id: 'guest-local' }, isMock: true, completedOnboarding: true };
    const now = new Date();
    const day = (n) => toISODate(addDays(now, n));
    // Keep everything inside this month (the audit's month checks), except the "last month" entry.
    const inMonthDay = (n) => { const d = addDays(now, n); return d.getMonth() === now.getMonth() ? toISODate(d) : toISODate(new Date(now.getFullYear(), now.getMonth(), 1)); };
    const base = { note: '', recurringId: null, receipt: null, fixed: false, pending: false };
    let n = 0;
    const tx = (o) => ({ ...base, id: 'x' + (n++), createdAt: Date.now() - n, ...o });
    s.transactions = [
        tx({ type: 'income', desc: 'Salary', amount: 150000, currency: 'LKR', category: 'Salary', date: inMonthDay(-5), accountId: 'A' }),
        tx({ type: 'income', desc: 'Rent from tenant', amount: 32000, currency: 'LKR', category: 'OtherIncome', date: inMonthDay(-2), accountId: 'A', pending: true }),
        tx({ type: 'expense', desc: 'Keells', amount: 2500, currency: 'LKR', category: 'Food', date: day(0), accountId: 'A' }),
        tx({ type: 'expense', desc: 'Dialog', amount: 4550, currency: 'LKR', category: 'Utilities', date: inMonthDay(-3), accountId: 'A', fixed: true }),
        tx({ type: 'transfer', desc: 'ATM withdrawal', amount: 10000, currency: 'LKR', toAmount: 10000, toCurrency: 'LKR', category: 'Transfer', date: inMonthDay(-1), accountId: 'A', toAccountId: 'C' }),
        tx({ type: 'expense', desc: 'Old shopping', amount: 5000, currency: 'LKR', category: 'Shopping', date: toISODate(new Date(now.getFullYear(), now.getMonth() - 1, 10)), accountId: 'A' }),
        tx({ type: 'expense', desc: 'Pharmacy', amount: 1000, currency: 'LKR', category: 'Health', date: day(0), accountId: 'B' }),
        tx({ type: 'expense', desc: 'Kottu', amount: 800, currency: 'LKR', category: 'Food', date: day(0), accountId: 'C' }),
        tx({ type: 'expense', desc: 'Netflix', amount: 20, currency: 'USD', category: 'Entertainment', date: day(0), accountId: 'D' })
    ];
    s.recurring = [{ id: 'rent', type: 'expense', name: 'Rent', amount: 12000, currency: 'LKR', category: 'Rent', frequency: 'monthly', nextDate: day(3), anchorDay: addDays(now, 3).getDate(), autoLog: false, accountId: 'A', createdAt: 1 }];
    s.debts = [{ id: 'd1', direction: 'lent', person: 'Nimal', amount: 5000, currency: 'LKR', repaid: 2000, dueDate: null, note: '', accountId: 'B', moved: true, createdAt: 1 },
        { id: 'd0', direction: 'lent', person: 'Old', amount: 7000, currency: 'LKR', repaid: 0, dueDate: null, note: '', accountId: 'B', createdAt: 1 }];
    s.savings = [{ id: 'g1', name: 'Phone', target: 100000, currency: 'LKR', saved: 20000, deadline: null, accountId: 'A', createdAt: 1 }];
    // BOC keeps its budget "from income" but gets no income this month.
    s.config.accountBudgets = { B: { budget: 50000, categoryBudgets: {}, budgetCurrency: 'LKR', budgetMode: 'income', budgetSavePct: 0 } };
    state = s; saveState(); localStorage.setItem('VELA_VIEW_ACCOUNT', 'A');
    return true;
})()`;

const page = await launch({ width: 412, height: 915 });
const problems = [];
const check = (what, got, want) => { if (!(Math.abs(Number(got) - Number(want)) < 0.01)) problems.push(`${what}: shows ${got}, should be ${want}`); };
const v = (sel) => page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? Number(el.dataset.v) : NaN; })()`);
const settle = () => page.evaluate('new Promise((r) => setTimeout(r, 900))');
try {
    await page.open(url); await page.evaluate(APP_READY);
    await page.evaluate(SEED);
    await page.open(url); await page.evaluate(APP_READY); await settle();
    // Helper in the page: close any pop-up (the late payment opens "Payments to check" on start), then show a tab.
    await page.evaluate("window.go = (t) => { while (openSheets.length) hideSheet(openSheets[openSheets.length - 1]); switchTab(t, { fromHistory: true }); }");
    const now = new Date();
    const firstOfMonth = now.getDate() <= 5; // salary may land on the 1st; numbers stay the same

    // ---- Account A, Home
    await page.evaluate("go('dashboard')"); await settle();
    const balA = 100000 + 150000 - 2500 - 4550 - 10000 - 5000;
    check('Home: Commercial bank balance', await v('#dash-balance'), balA);
    check('Home: income this month (received only)', await v('#dash-income'), 150000);
    check('Home: spent this month', await v('#dash-spent'), 2500 + 4550);
    const sub = await page.evaluate("$('dash-balance-sub').textContent");
    const changeA = 150000 - 2500 - 4550 - 10000;
    if (!sub.includes(await page.evaluate(`formatCompact(${changeA}, 'LKR')`))) problems.push(`Home: change this month says "${sub}", should be +${changeA} (the transfer to Cash left this account too)`);
    // Account cards
    for (const [id, want] of [['A', balA], ['B', 99000 - 3000], ['C', 5000 + 10000 - 800], ['D', 180]]) {
        const got = await page.evaluate(`accountBalance(state.accounts.find((a) => a.id === '${id}'))`);
        check(`Account ${id} balance`, got, want);
    }
    // After fixed expenses
    const fx = await page.evaluate('fixedForMonth()');
    check('Fixed: money in account', fx.balance, balA);
    check('Fixed: still due (rent)', fx.due, 12000);
    check('Fixed: paid (Dialog)', fx.paid, 4550);
    check('Fixed: set aside for goals', fx.goals, 20000);
    check('Fixed: left', fx.left, balA - 12000 - 20000);

    // ---- Activity (this month, this account)
    await page.evaluate("go('activity')"); await settle();
    check('Activity: income', await v('#act-income'), 150000);
    check('Activity: spent', await v('#act-spent'), 2500 + 4550);
    check('Activity: net', await v('#act-net'), 150000 - 2500 - 4550);
    const rows = await page.evaluate("[...document.querySelectorAll('#tab-activity .tx-title')].map((e) => e.textContent.trim())");
    for (const other of ['Pharmacy', 'Kottu', 'Netflix']) if (rows.includes(other)) problems.push(`Activity (Commercial bank) lists ${other}, which is in another account`);

    // ---- Plan
    await page.evaluate("planTab = 'budgets'; go('plan')"); await settle();
    const ms = await page.evaluate('monthStats()');
    check('Plan: budget', ms.budget, 80000);
    check('Plan: spent against budget', ms.spent, 7050);
    // Commercial bank "from income": only the salary received counts; the rent still expected is shown separately.
    const msInc = await page.evaluate("(() => { const keep = state.config.budgetMode; state.config.budgetMode = 'income'; const r = monthStats(); state.config.budgetMode = keep; return r; })()");
    check('Plan: budget from income (received only)', msInc.budget, 150000);
    check('Plan: income still expected', msInc.expectedIncome, 32000);
    await page.evaluate("planTab = 'bills'; go('plan')"); await settle();
    const fixedText = await page.evaluate("$('plan-content').innerText");
    if (/Pharmacy|Kottu|Netflix/.test(fixedText)) problems.push('Plan > Fixed shows entries from another account');

    // ---- Insights: this account, 30 days
    await page.evaluate("localStorage.removeItem('VELA_INSIGHTS_ALL'); analyticsRange = '30'; go('analytics')"); await settle();
    check('Insights (account): income', await v('#metric-income'), 150000);
    check('Insights (account): spent', await v('#metric-total'), 7050);
    // ---- Insights: all accounts
    await page.evaluate("document.querySelector('[data-insights-scope=\"all\"]').click()"); await settle();
    check('Insights (all): spent', await v('#metric-total'), 7050 + 1000 + 800 + 20 * 300);
    check('Insights (all): income', await v('#metric-income'), 150000);
    await page.evaluate("document.querySelector('[data-insights-scope=\"account\"]').click()");

    // ---- Account B: from-income budget with no income this month
    await page.evaluate("setViewAccount('B'); go('dashboard')"); await settle();
    const where = await page.evaluate("JSON.stringify({ view: viewId(), tab: currentTab })");
    if (!where.includes('"view":"B"') || !where.includes('"tab":"dashboard"')) problems.push(`Switching to BOC then Home ended up at ${where}`);
    check('Home: BOC balance (Rs. 3,000 still lent out)', await v('#dash-balance'), 96000);
    check('Home: BOC spent', await v('#dash-spent'), 1000);
    const msB = await page.evaluate('monthStats()');
    // BOC "from income" with no income: its balance (Rs. 96,000 now) plus what it spent this month (Rs. 1,000).
    check('Plan: BOC budget from its balance (no income yet)', msB.budget, 96000 + 1000);
    check('Plan: BOC left to spend = its balance', msB.budget - msB.spent, 96000);
    const msBal = await page.evaluate("(() => { setViewAccount('A'); const keep = state.config.budgetMode; state.config.budgetMode = 'balance'; const r = monthStats(); state.config.budgetMode = keep; setViewAccount('B'); return r; })()");
    check('Plan: Commercial bank budget "my balance"', msBal.budget, balA + 7050);
    await page.evaluate("planTab = 'bills'; go('plan')"); await settle();
    const fixedB = await page.evaluate("$('plan-content').innerText");
    if (/Dialog/.test(fixedB)) problems.push("Plan > Fixed in BOC lists Commercial bank's Dialog bill");
    // ---- Dollar account shown in rupees
    await page.evaluate("setViewAccount('D'); go('dashboard')"); await settle();
    check('Home: Wise balance in LKR', await v('#dash-balance'), 180 * 300);
    if (firstOfMonth) console.log('(early in the month: some entries were moved to the 1st)');
    if (page.pageErrors.length) problems.push('Errors in the page: ' + page.pageErrors.slice(0, 3).join(' | '));
} catch (e) {
    problems.push('Audit could not finish: ' + e.message);
}
await page.close();
console.log(problems.length ? `${problems.length} problems:\n- ${problems.join('\n- ')}` : 'Money audit: every number matches the real money');
process.exit(problems.length ? 1 : 0);
