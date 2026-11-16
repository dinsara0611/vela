/* Vela feature check: drives every feature through the app's own functions and
   reports pass/fail. Run it in the browser on a local copy of the app:
       const r = await (await import('/tests/feature-check.js')).run(); console.table(r.results);
   It replaces the data in this browser's storage, so never run it on real data. */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const g = (name) => {
    // The app's functions live in the page's global script scope; reach them through indirect eval.
    return (0, eval)(name);
};

export async function run() {
    const results = [];
    window.__velaErrors = [];
    const onErr = (e) => window.__velaErrors.push(String(e.message || e.reason || e));
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onErr);
    // Downloads (CSV, backup) go through a link click; catch the file instead of saving it.
    const captureDownload = async (fn) => {
        let blob = null;
        const realUrl = URL.createObjectURL;
        const realClick = HTMLAnchorElement.prototype.click;
        URL.createObjectURL = (b) => { blob = b; return 'blob:test'; };
        HTMLAnchorElement.prototype.click = function () {};
        try { await fn(); } finally { URL.createObjectURL = realUrl; HTMLAnchorElement.prototype.click = realClick; }
        return blob ? await blob.text() : '';
    };
    const T = async (name, fn) => {
        try {
            const r = await fn();
            results.push({ name, ok: r === true, detail: r === true ? '' : String(r) });
        } catch (e) {
            results.push({ name, ok: false, detail: `threw: ${e && e.message}` });
        }
    };
    const $ = (id) => document.getElementById(id);
    const s = () => g('state');
    const confirmOk = async () => { await wait(80); $('btn-confirm-ok').click(); await wait(250); };
    const fmt = (v, c = 'LKR') => g('formatCurrency')(v, c);
    const today = g('todayISO')();
    const addDays = g('addDays');
    const iso = g('toISODate');
    const close = async (id) => { g('closeSheet')(id); await wait(350); };

    // Fresh guest on a phone in Sri Lanka, live rate 1 USD = 300 LKR (round numbers for checks).
    localStorage.clear();
    const fresh = g('createDefaultState')();
    g('applyRegionDefaults')(fresh);
    fresh.config.currency = 'LKR';
    fresh.config.currencies = ['LKR', 'USD'];
    fresh.config.budgetCurrency = 'LKR';
    fresh.config.budget = 100000;
    fresh.config.rates = { LKR: 300, EUR: 0.9 };
    fresh.accounts = [{ id: 'acc-cash', name: 'Cash', kind: 'cash', currency: 'LKR', opening: 0, createdAt: 0 }];
    fresh.auth = { user: { id: 'guest-local' }, isMock: true, completedOnboarding: true };
    (0, eval)('state = ' + JSON.stringify(fresh));
    g('saveState')();
    g('renderActive')();

    const addTx = async ({ type = 'expense', amount, desc, category, currency = 'LKR', date = today, account }) => {
        g('openAddTx')(type);
        await wait(250);
        $('tx-amount').value = String(amount);
        g('fillCurrencySelect')($('tx-currency'), currency);
        $('tx-desc').value = desc;
        $('tx-date').value = date;
        if (account) $('tx-account').value = account;
        if (category) g('selectTxCategory')(category);
        const ok = await g('submitTx')();
        await wait(350);
        return ok;
    };
    const find = (desc) => s().transactions.find((t) => t.desc === desc);

    await T('Region currency on first use (Sri Lanka -> LKR)', () => {
        const st = g('createDefaultState')();
        g('applyRegionDefaults')(st);
        return st.config.currency === g('regionCurrency')() && st.accounts[0].currency === st.config.currency || `got ${st.config.currency}`;
    });

    await T('Add expense saves with main currency', async () => {
        g('openAddTx')('expense'); await wait(200);
        const cur = $('tx-currency').value; await close('modal-tx');
        await addTx({ amount: 1200, desc: 'Kottu', category: 'Food' });
        const t = find('Kottu');
        return (cur === 'LKR' && t && t.amount === 1200 && t.currency === 'LKR' && t.category === 'Food') || `form ${cur}, saved ${JSON.stringify(t)}`;
    });

    await T('Zero amount is refused', async () => {
        const before = s().transactions.length;
        await addTx({ amount: 0, desc: 'Nothing', category: 'Food' });
        const after = s().transactions.length; await close('modal-tx');
        return after === before || 'saved a zero entry';
    });

    await T('Income counts in month totals and Cash', async () => {
        await addTx({ type: 'income', amount: 150000, desc: 'Salary', category: 'Salary' });
        const st = g('monthStats')();
        const cash = g('accountBalance')(s().accounts[0]);
        return (st.income === 150000 && st.spent === 1200 && cash === 148800) || `income ${st.income}, spent ${st.spent}, cash ${cash}`;
    });

    await T('Edit expense updates amount', async () => {
        g('openEditTx')(find('Kottu').id); await wait(250);
        $('tx-amount').value = '1500';
        await g('submitTx')(); await wait(350);
        return find('Kottu').amount === 1500 || `amount ${find('Kottu').amount}`;
    });

    await T('Expense in USD converts into LKR totals', async () => {
        await addTx({ amount: 10, desc: 'Spotify', category: 'Entertainment', currency: 'USD' });
        const st = g('monthStats')();
        return Math.abs(st.spent - (1500 + 3000)) < 0.01 || `spent ${st.spent}`;
    });

    await T('Future-dated income is Upcoming and not counted', async () => {
        const later = iso(addDays(new Date(), 3));
        await addTx({ type: 'income', amount: 30000, desc: 'Rent', category: 'OtherIncome', date: later });
        const st = g('monthStats')();
        const upcoming = g('isUpcoming')(find('Rent'));
        return (upcoming && st.income === 150000) || `upcoming ${upcoming}, income ${st.income}`;
    });

    await T('Waiting entry: not counted until "Received", then counts from today', async () => {
        const st0 = g('monthStats')();
        const cash0 = g('accountBalance')(s().accounts[0]);
        const rent = find('Rent');
        const waiting = rent.pending === true;
        g('switchTab')('dashboard'); await wait(300);
        const btn = document.querySelector(`[data-confirm-tx="${rent.id}"]`);
        const label = btn && btn.textContent.trim();
        btn.click(); await wait(300);
        const st1 = g('monthStats')();
        const cash1 = g('accountBalance')(s().accounts[0]);
        return (waiting && /Received/.test(label) && rent.pending === false && rent.date === today && st1.income === st0.income + 30000 && cash1 === cash0 + 30000)
            || `waiting ${waiting}, button "${label}", pending ${rent.pending}, date ${rent.date}, income ${st0.income}->${st1.income}, cash ${cash0}->${cash1}`;
    });

    await T('Past waiting entry says "Not confirmed" and still does not count', async () => {
        const y = iso(addDays(new Date(), -1));
        s().transactions.push({ id: 'wait-1', type: 'expense', desc: 'Water bill', amount: 1800, currency: 'LKR', category: 'Utilities', date: y, note: '', createdAt: 5, recurringId: null, accountId: 'acc-cash', receipt: null, fixed: true, pending: true });
        g('saveState')(); g('switchTab')('activity'); await wait(300);
        const spentBefore = g('expenses')().some((t) => t.id === 'wait-1');
        const row = document.querySelector('[data-confirm-tx="wait-1"]');
        const badge = row && row.closest('li').querySelector('.tx-upcoming').textContent;
        g('confirmTx')('wait-1'); await wait(200);
        const counted = g('expenses')().some((t) => t.id === 'wait-1');
        return (!spentBefore && badge === 'Not confirmed' && /Paid/.test(row.textContent) && counted) || `counted before ${spentBefore}, badge ${badge}, after ${counted}`;
    });

    await T('Bank SMS: Commercial Bank debit/credit read, OTPs ignored', () => {
        const p = g('parseBankSms');
        const a = p({ id: 'a', address: 'COMBANK', body: 'Dear Cardholder, your Debit Card ending #4321 has been debited with LKR 2,500.00 at KEELLS SUPER on 16/11/26 10:20.', date: Date.now() });
        const b = p({ id: 'b', address: 'COMBANK', body: 'Your A/C xxxx5678 has been credited with Rs. 150,000.00 from ABC PVT LTD on 16/11/26. Salary.', date: Date.now() });
        const c = p({ id: 'c', address: 'COMBANK', body: 'Your OTP for the transaction of LKR 2,500.00 is 123456. Do not share.', date: Date.now() });
        const d = p({ id: 'd', address: 'HNB', body: 'Purchase of USD 12.99 at NETFLIX.COM on your card ending 1111', date: Date.now() });
        const ok = a && a.type === 'expense' && a.amount === 2500 && a.desc === 'Keells Super' && a.bank === 'Commercial Bank' && a.last4 === '4321' && a.category === 'Food'
            && b && b.type === 'income' && b.amount === 150000 && b.category === 'Salary'
            && c === null
            && d && d.currency === 'USD' && d.amount === 12.99 && d.bank === 'HNB';
        return ok || JSON.stringify({ a, b, c, d });
    });

    await T('Bank SMS: turn on, pop-up, add to chosen account, match a waiting entry', async () => {
        const calls = { cleared: [] };
        const msgs = [
            { id: 'sms-1', address: 'COMBANK', body: 'Your Debit Card ending 4321 has been debited with LKR 1,750.00 at PIZZA HUT on 16/11/26', date: Date.now() - 3600000 },
            { id: 'sms-2', address: 'COMBANK', body: 'Your A/C has been credited with LKR 45,000.00 from KOTHALAWALA on 16/11/26', date: Date.now() - 1800000 }
        ];
        // A waiting income the second message confirms.
        s().transactions.push({ id: 'wait-2', type: 'income', desc: 'Rent kothalawala', amount: 45000, currency: 'LKR', category: 'OtherIncome', date: today, note: '', createdAt: 6, recurringId: null, accountId: 'acc-cash', receipt: null, fixed: false, pending: true });
        window.Capacitor = { isNativePlatform: () => true, Plugins: {
            SmsReader: {
                checkPermissions: async () => ({ sms: 'granted' }), requestPermissions: async () => ({ sms: 'granted' }),
                setEnabled: async () => {}, getPending: async () => ({ messages: [] }), readInbox: async () => ({ messages: msgs }),
                clearHandled: async ({ ids }) => { calls.cleared.push(...ids); }, addListener: () => {}
            },
            LocalNotifications: { checkPermissions: async () => ({ display: 'granted' }), requestPermissions: async () => ({ display: 'granted' }) }
        } };
        await g('enableSmsTracking')(true); await wait(500);
        const sheetOpen = g('isSheetOpen')('modal-sms');
        const cards = document.querySelectorAll('#sms-list .sms-card').length;
        const matchBtn = document.querySelector('[data-sms-match="sms-2"]');
        $('sms-account').value = 'acc-cash';
        document.querySelector('[data-sms-add="sms-1"]').click(); await wait(300);
        const pizza = s().transactions.find((t) => t.desc === 'Pizza Hut');
        // The list redraws after each decision: take the button from the current list.
        document.querySelector('[data-sms-match="sms-2"]').click(); await wait(400);
        const rent2 = s().transactions.find((t) => t.id === 'wait-2');
        const dupes = s().transactions.filter((t) => t.amount === 45000).length;
        // Seen messages are not offered again.
        const again = await g('scanSms')();
        delete window.Capacitor;
        localStorage.removeItem('VELA_SMS');
        return (sheetOpen && cards === 2 && !!matchBtn && pizza && pizza.amount === 1750 && pizza.accountId === 'acc-cash' && rent2.pending === false && dupes === 1 && calls.cleared.includes('sms-1') && calls.cleared.includes('sms-2') && again === 0 && !g('isSheetOpen')('modal-sms'))
            || `sheet ${sheetOpen}, cards ${cards}, match ${!!matchBtn}, pizza ${pizza && pizza.amount}/${pizza && pizza.accountId}, rent confirmed ${rent2 && rent2.pending === false}, 45k entries ${dupes}, cleared ${calls.cleared}, again ${again}`;
    });

    await T('Waiting entries get a notification that stays until confirmed', async () => {
        const later = iso(addDays(new Date(), 2));
        s().transactions.push({ id: 'wait-3', type: 'income', desc: 'Freelance job', amount: 20000, currency: 'LKR', category: 'Freelance', date: later, note: '', createdAt: 7, recurringId: null, accountId: 'acc-cash', receipt: null, fixed: false, pending: true });
        let scheduled = [];
        window.Capacitor = { isNativePlatform: () => true, Plugins: { LocalNotifications: {
            checkPermissions: async () => ({ display: 'granted' }), requestPermissions: async () => ({ display: 'granted' }),
            createChannel: async () => {}, cancel: async () => {}, schedule: async (o) => { scheduled = o.notifications; }
        } } };
        s().config.reminders = true;
        await g('scheduleReminders')();
        delete window.Capacitor;
        s().config.reminders = false;
        const n = scheduled.find((x) => x.extra && x.extra.txId === 'wait-3');
        s().transactions = s().transactions.filter((t) => t.id !== 'wait-3');
        return (n && n.ongoing === true && n.autoCancel === false) || `notification ${JSON.stringify(n)}`;
    });

    await T('Delete entry (with confirm)', async () => {
        g('deleteTx')(find('Spotify').id); await confirmOk(); await close('modal-tx');
        return !find('Spotify') || 'still there';
    });

    await T('Overall budget keeps the typed currency', async () => {
        g('openBudget')('__overall'); await wait(250);
        $('budget-amount').value = '30000';
        g('submitBudget')(); await wait(300);
        const st = g('monthStats')();
        return (s().config.budget === 30000 && s().config.budgetCurrency === 'LKR' && st.budget === 30000) || `budget ${s().config.budget} ${s().config.budgetCurrency}, shown ${st.budget}`;
    });

    await T('Budget from income: follows income, keeps saving %, counts rent later this month', async () => {
        g('openBudget')('__overall'); await wait(250);
        document.querySelector('[data-budget-mode="income"]').click();
        document.querySelector('[data-budget-save="20"]').click();
        const amountHidden = $('budget-amount-field').hidden;
        g('submitBudget')(); await wait(300);
        const s1 = g('monthStats')();
        // Rent 30,000 dated later this month (if the month has days left) also counts for planning.
        const now = new Date();
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const rentDate = lastDay.getDate() > now.getDate() ? iso(lastDay) : today;
        await addTx({ type: 'income', amount: 30000, desc: 'Rent this month', category: 'OtherIncome', date: rentDate });
        const s2 = g('monthStats')();
        const expected1 = s1.plannedIncome * 0.8;
        const grew = Math.abs(s2.budget - (s1.plannedIncome + 30000) * 0.8) < 0.01;
        // Category budgets stay fixed amounts: the choice is hidden for them.
        g('openBudget')(); await wait(250);
        $('budget-category').value = 'Food'; $('budget-category').dispatchEvent(new Event('change'));
        const hiddenForCategory = $('budget-mode-field').hidden && !$('budget-amount-field').hidden;
        await close('modal-budget');
        // Back to the fixed amount.
        g('openBudget')('__overall'); await wait(250);
        document.querySelector('[data-budget-mode="fixed"]').click();
        $('budget-amount').value = '30000';
        g('submitBudget')(); await wait(300);
        const back = s().config.budgetMode === 'fixed' && g('monthStats')().budget === 30000;
        s().transactions = s().transactions.filter((t) => t.desc !== 'Rent this month');
        return (amountHidden && Math.abs(s1.budget - expected1) < 0.01 && s1.fromIncome && grew && hiddenForCategory && back)
            || `hidden ${amountHidden}, budget ${s1.budget} vs ${expected1}, grew ${grew} (${s2.budget}), category ${hiddenForCategory}, back ${back}`;
    });

    await T('Amount boxes show commas and still read as numbers', async () => {
        g('openAddTx')('expense'); await wait(250);
        const box = $('tx-amount');
        box.value = '1000000';
        const shown = box.value;
        box.focus();
        g('NATIVE_VALUE').set.call(box, '12345.678');
        box.setSelectionRange(5, 5);
        box.dispatchEvent(new Event('input'));
        const typed = box.value;
        const parsed = g('toNumber')(box.value, NaN);
        await close('modal-tx');
        g('openAccountEditor')(); await wait(250);
        $('account-opening').value = '-25000';
        const negative = $('account-opening').value;
        await close('modal-account');
        const small = ['1000', '10000', '100000', '1000000'].map((v) => g('groupDigits')(v)).join(' ');
        return (shown === '1,000,000' && typed === '12,345.67' && parsed === 12345.67 && negative === '-25,000' && small === '1,000 10,000 100,000 1,000,000')
            || `shown ${shown}, typed ${typed}, parsed ${parsed}, negative ${negative}, small ${small}`;
    });

    await T('Cards show full amounts with commas', () => {
        const a = g('fitMoney')(150000, 'LKR', 12);
        const b = g('fitMoney')(1234567.5, 'LKR', 12);
        return (a === 'Rs. 150,000.00' && b === 'Rs. 1,234,568') || `${a} | ${b}`;
    });

    await T('Mark an expense Fixed (one-off) and see it counted once', async () => {
        g('openAddTx')('expense'); await wait(250);
        $('tx-amount').value = '2500';
        $('tx-desc').value = 'Exam fee';
        g('selectTxCategory')('Other');
        document.querySelector('[data-tx-kind="fixed"]').click();
        g('setSwitch')($('tx-repeat'), false);
        await g('submitTx')(); await wait(350);
        const t = find('Exam fee');
        const f = g('fixedForMonth')();
        const counted = f.items.filter((i) => i.name === 'Exam fee').length;
        const tag = !!document.querySelector('.tx-fixed');
        return (t.fixed === true && !t.recurringId && counted === 1 && tag) || `fixed ${t.fixed}, bill ${t.recurringId}, counted ${counted}, tag ${tag}`;
    });

    await T('Fixed expense that repeats becomes a monthly fixed expense', async () => {
        g('openAddTx')('expense'); await wait(250);
        $('tx-desc').value = 'Internet bill';
        $('tx-desc').dispatchEvent(new Event('input'));
        const suggested = document.querySelector('[data-tx-kind="fixed"]').getAttribute('aria-pressed') === 'true';
        $('tx-amount').value = '3500';
        g('selectTxCategory')('Utilities');
        g('setSwitch')($('tx-repeat'), true);
        await g('submitTx')(); await wait(350);
        const t = find('Internet bill');
        const bill = s().recurring.find((b) => b.id === t.recurringId);
        const next = new Date(); next.setMonth(next.getMonth() + 1);
        return (suggested && t.fixed && bill && bill.frequency === 'monthly' && bill.amount === 3500 && bill.nextDate.slice(0, 7) === iso(next).slice(0, 7))
            || `suggested ${suggested}, fixed ${t.fixed}, bill ${bill && bill.nextDate}`;
    });

    await T('Income minus fixed expenses, each bill counted once per month', async () => {
        const now = new Date();
        const y = now.getFullYear(); const mo = now.getMonth();
        const last = new Date(y, mo + 1, 0).getDate();
        // A rent bill due later this month (not paid yet) and a weekly bill.
        const rentDay = Math.min(last, now.getDate() + 1);
        const rentDate = iso(new Date(y, mo, rentDay));
        s().recurring.push({ id: 'rent-bill', type: 'expense', name: 'Rent', amount: 25000, currency: 'LKR', category: 'Rent', frequency: 'monthly', nextDate: rentDate, anchorDay: rentDay, autoLog: false, accountId: 'acc-cash', createdAt: 1 });
        const weeklyStart = iso(new Date(y, mo, 1));
        s().recurring.push({ id: 'gym-bill', type: 'expense', name: 'Gym', amount: 1000, currency: 'LKR', category: 'Health', frequency: 'weekly', nextDate: weeklyStart, anchorDay: 1, autoLog: false, accountId: 'acc-cash', createdAt: 1 });
        const f1 = g('fixedForMonth')();
        const rentCount = f1.items.filter((i) => i.name === 'Rent').length;
        const gymCount = f1.items.filter((i) => i.name === 'Gym').length;
        const gymExpected = g('billDatesInMonth')(s().recurring.find((b) => b.id === 'gym-bill'), y, mo).length;
        // Paying the rent logs it and moves its due date to next month: it must still count once, not twice or zero.
        g('markBillPaid')('rent-bill'); await wait(300);
        const f2 = g('fixedForMonth')();
        const rentAfter = f2.items.filter((i) => i.name === 'Rent');
        // Two incomes in the month: fixed expenses are still taken off once.
        await addTx({ type: 'income', amount: 50000, desc: 'Side job', category: 'Freelance' });
        const f3 = g('fixedForMonth')();
        const sameFixed = Math.abs(f3.total - f2.total) < 0.01;
        const leftOk = Math.abs(f3.left - (f3.income - f3.total)) < 0.01;
        // Deleting the rent bill keeps this month's payment counted.
        s().recurring = s().recurring.filter((b) => b.id !== 'rent-bill' && b.id !== 'gym-bill');
        const f4 = g('fixedForMonth')();
        const rentKept = f4.items.filter((i) => i.name === 'Rent').length === 1;
        return (rentCount === 1 && gymCount === gymExpected && gymExpected >= 4 && rentAfter.length === 1 && rentAfter[0].paid && sameFixed && leftOk && rentKept)
            || `rent ${rentCount}, gym ${gymCount}/${gymExpected}, rent after paying ${rentAfter.length} paid ${rentAfter[0] && rentAfter[0].paid}, same fixed ${sameFixed}, left ok ${leftOk}, kept after delete ${rentKept}`;
    });

    await T('Home and Plan show income, fixed and what is left', async () => {
        g('switchTab')('dashboard'); await wait(400);
        const home = $('dash-fixed').innerText;
        g('goToPlan')('bills'); await wait(400);
        const plan = document.querySelector('#plan-content .fx-card');
        const f = g('fixedForMonth')();
        const want = fmt(f.left);
        return (/Income/.test(home) && /Fixed expenses/.test(home) && home.includes(want) && plan && plan.innerText.includes(want))
            || `home "${home.slice(0, 120)}", plan ${!!plan}, want ${want}`;
    });

    await T('PDF report includes the fixed expenses section with commas', async () => {
        g('switchTab')('activity'); await wait(300);
        const pdf = await captureDownload(() => g('exportPdf')());
        return (pdf.includes('After fixed expenses') && /\d{1,3},\d{3}/.test(pdf)) || `pdf ${pdf.length} bytes, section ${pdf.includes('After fixed expenses')}`;
    });

    await T('Category budget set and removed', async () => {
        g('openBudget')(); await wait(250);
        $('budget-category').value = 'Food';
        $('budget-amount').value = '10000';
        g('submitBudget')(); await wait(300);
        const set = s().config.categoryBudgets.Food === 10000;
        g('openBudget')('Food'); await wait(250);
        g('deleteBudget')(); await confirmOk(); await close('modal-budget');
        return (set && !s().config.categoryBudgets.Food) || `set ${set}, after ${s().config.categoryBudgets.Food}`;
    });

    await T('Add bank account with opening balance', async () => {
        g('openAccountEditor')(); await wait(250);
        $('account-name').value = 'BOC';
        $('account-kind').value = 'bank';
        g('fillCurrencySelect')($('account-currency'), 'LKR');
        $('account-opening').value = '50000';
        g('submitAccount')(); await wait(350);
        const a = s().accounts.find((x) => x.name === 'BOC');
        return (a && g('accountBalance')(a) === 50000) || 'missing or wrong balance';
    });

    await T('Duplicate account name refused', async () => {
        g('openAccountEditor')(); await wait(250);
        $('account-name').value = 'boc';
        const before = s().accounts.length;
        g('submitAccount')(); await wait(250); await close('modal-account');
        return s().accounts.length === before || 'created a duplicate';
    });

    await T('Transfer between accounts moves money', async () => {
        const boc = s().accounts.find((x) => x.name === 'BOC');
        const cash0 = g('accountBalance')(s().accounts[0]);
        const bank0 = g('accountBalance')(boc);
        const spent0 = g('monthStats')().spent;
        g('openTransfer')(); await wait(250);
        $('transfer-from').value = 'acc-cash';
        $('transfer-to').value = boc.id;
        g('updateTransferFields')();
        $('transfer-amount').value = '20000';
        $('transfer-date').value = today;
        g('submitTransfer')(); await wait(350);
        const cash = g('accountBalance')(s().accounts[0]);
        const bank = g('accountBalance')(boc);
        const st = g('monthStats')();
        // Money moves between accounts; it is not spending.
        return (cash === cash0 - 20000 && bank === bank0 + 20000 && bank0 === 50000 && st.spent === spent0) || `cash ${cash0}->${cash}, bank ${bank0}->${bank}, spent ${spent0}->${st.spent}`;
    });

    await T('Transfer to a USD account needs the received amount', async () => {
        g('openAccountEditor')(); await wait(250);
        $('account-name').value = 'Visa USD';
        $('account-kind').value = 'card';
        g('fillCurrencySelect')($('account-currency'), 'USD');
        $('account-opening').value = '0';
        g('submitAccount')(); await wait(350);
        const usd = s().accounts.find((x) => x.name === 'Visa USD');
        g('openTransfer')(); await wait(250);
        $('transfer-from').value = 'acc-cash';
        $('transfer-to').value = usd.id;
        g('updateTransferFields')();
        $('transfer-amount').value = '3000';
        $('transfer-received').value = '';
        const n = s().transactions.length;
        g('submitTransfer')(); await wait(200);
        const refused = s().transactions.length === n;
        $('transfer-received').value = '10';
        g('submitTransfer')(); await wait(350);
        return (refused && g('accountBalance')(usd) === 10) || `refused ${refused}, usd ${g('accountBalance')(usd)}`;
    });

    await T('Bill auto-logs when due and moves to next month', async () => {
        g('openAddBill')(); await wait(250);
        g('setBillType')('expense');
        $('bill-name').value = 'Netflix';
        $('bill-amount').value = '3450';
        $('bill-next').value = today;
        $('bill-frequency').value = 'monthly';
        $('bill-category').value = 'Entertainment';
        g('setSwitch')($('bill-auto'), true);
        g('submitBill')(); await wait(400);
        const bill = s().recurring.find((b) => b.name === 'Netflix');
        const logged = s().transactions.filter((t) => t.recurringId === bill.id).length;
        return (logged === 1 && bill.nextDate > today) || `logged ${logged}, next ${bill.nextDate}`;
    });

    await T('Mark bill paid logs it once', async () => {
        g('openAddBill')(); await wait(250);
        g('setBillType')('expense');
        $('bill-name').value = 'SLT';
        $('bill-amount').value = '8100';
        $('bill-next').value = iso(addDays(new Date(), 3));
        $('bill-frequency').value = 'monthly';
        $('bill-category').value = 'Utilities';
        g('setSwitch')($('bill-auto'), false);
        g('submitBill')(); await wait(400);
        const bill = s().recurring.find((b) => b.name === 'SLT');
        const next = bill.nextDate;
        g('markBillPaid')(bill.id); await wait(300);
        const logs = s().transactions.filter((t) => t.recurringId === bill.id);
        return (logs.length === 1 && logs[0].date === today && bill.nextDate > next) || `logs ${logs.length}, date ${logs[0] && logs[0].date}, next ${bill.nextDate}`;
    });

    await T('Monthly dates keep the 31st (Jan 31 -> Feb 28 -> Mar 31)', () => {
        const adv = g('advanceDate');
        const a = adv('2027-01-31', 'monthly', 31);
        const b = adv(a, 'monthly', 31);
        const c = adv('2026-12-15', 'monthly', 15);
        const w = adv('2026-11-28', 'weekly', 28);
        const y = adv('2028-02-29', 'yearly', 29);
        return (a === '2027-02-28' && b === '2027-03-31' && c === '2027-01-15' && w === '2026-12-05' && y === '2029-02-28') || `${a} ${b} ${c} ${w} ${y}`;
    });

    await T('Savings goal: deposit, withdraw, over-withdraw refused', async () => {
        g('openAddGoal')(); await wait(250);
        $('goal-name').value = 'Phone';
        $('goal-target').value = '100000';
        $('goal-saved').value = '';
        g('submitGoal')(); await wait(350);
        const goal = s().savings.find((x) => x.name === 'Phone');
        g('openDeposit')(goal.id); await wait(250);
        g('setFundsMode')('deposit');
        $('funds-amount').value = '20000';
        g('submitFunds')(); await wait(350);
        g('openDeposit')(goal.id); await wait(250);
        g('setFundsMode')('withdraw');
        $('funds-amount').value = '5000';
        g('submitFunds')(); await wait(350);
        g('openDeposit')(goal.id); await wait(250);
        g('setFundsMode')('withdraw');
        $('funds-amount').value = '999999';
        g('submitFunds')(); await wait(250); await close('modal-funds');
        return goal.saved === 15000 || `saved ${goal.saved}`;
    });

    await T('Debt: repay part, over-repay refused, settle', async () => {
        g('openAddDebt')(); await wait(250);
        g('setDebtDir')('lent');
        $('debt-person').value = 'Nimal';
        $('debt-amount').value = '10000';
        g('submitDebt')(); await wait(350);
        const d = s().debts.find((x) => x.person === 'Nimal');
        g('openRepay')(d.id); await wait(250);
        $('repay-amount').value = '4000'; g('submitRepay')(); await wait(300);
        g('openRepay')(d.id); await wait(250);
        $('repay-amount').value = '7000'; g('submitRepay')(); await wait(250); await close('modal-repay');
        const partial = d.repaid === 4000;
        g('openRepay')(d.id); await wait(250);
        $('repay-amount').value = '6000'; g('submitRepay')(); await wait(300);
        const totals = g('debtTotals')();
        return (partial && d.repaid === 10000 && totals.owedToYou === 0) || `repaid ${d.repaid}, owed ${totals.owedToYou}`;
    });

    await T('Custom category: add, use, delete moves entries', async () => {
        g('openCategoryEditor')(null, 'expense'); await wait(250);
        $('category-name').value = 'Gym';
        g('submitCategory')(); await wait(350);
        const cat = s().categories.find((c) => c.name === 'Gym');
        await close('modal-category'); await close('modal-tx');
        await addTx({ amount: 5000, desc: 'Gym fee', category: cat.id });
        const used = find('Gym fee').category === cat.id;
        g('deleteCategory')(cat.id); await confirmOk(); await close('modal-category');
        return (used && find('Gym fee').category === 'Other' && !s().categories.some((c) => c.id === cat.id)) || `used ${used}, now ${find('Gym fee').category}`;
    });

    await T('Switch main currency to USD converts everything', async () => {
        const spentLkr = g('monthStats')().spent;
        g('setDisplayCurrency')('USD'); await wait(300);
        const spentUsd = g('monthStats')().spent;
        const form = (g('openAddTx')('expense'), $('tx-currency').value); await close('modal-tx');
        const budget = g('monthStats')().budget;
        g('setDisplayCurrency')('LKR'); await wait(300);
        return (Math.abs(spentUsd - spentLkr / 300) < 0.01 && form === 'USD' && Math.abs(budget - 100) < 0.01) || `lkr ${spentLkr}, usd ${spentUsd}, form ${form}, budget ${budget}`;
    });

    await T('Own exchange rate overrides the live one', () => {
        s().config.rateOverrides = { LKR: 320 };
        const v = g('convertAmount')(320, 'LKR', 'USD');
        s().config.rateOverrides = {};
        return Math.abs(v - 1) < 1e-9 || `got ${v}`;
    });

    await T('Search and filters in Activity', async () => {
        g('switchTab')('activity'); await wait(400);
        $('activity-search').value = 'kottu';
        g('renderActivity')(); await wait(150);
        const rows = document.querySelectorAll('#activity-entries .tx').length;
        $('activity-search').value = '';
        (0, eval)("activityType = 'income'"); g('renderActivity')(); await wait(150);
        const incomeRows = [...document.querySelectorAll('#activity-entries .tx .amount')].every((el) => el.classList.contains('is-income'));
        (0, eval)("activityType = 'all'"); g('renderActivity')();
        return (rows === 1 && incomeRows) || `search rows ${rows}, income filter ok ${incomeRows}`;
    });

    await T('Every tab and the calendar render without errors', async () => {
        for (const t of ['dashboard', 'activity', 'plan', 'analytics', 'settings']) { g('switchTab')(t); await wait(250); }
        (0, eval)("activityView = 'calendar'"); g('switchTab')('activity'); await wait(250);
        (0, eval)("activityView = 'list'"); g('switchTab')('dashboard'); await wait(250);
        return document.documentElement.scrollWidth <= window.innerWidth + 1 || 'page wider than screen';
    });

    await T('CSV export has every entry', async () => {
        const content = (await captureDownload(() => g('exportCsv')())).replace(/^﻿/, '');
        const lines = content.trim().split('\r\n').length - 1;
        return (lines === s().transactions.length && content.includes('Kottu')) || `${lines} rows vs ${s().transactions.length}`;
    });

    await T('Backup export and restore round-trip', async () => {
        const backup = await captureDownload(() => g('exportBackup')());
        const before = s().transactions.length;
        const file = new File([backup], 'b.json', { type: 'application/json' });
        s().transactions = [];
        g('importBackup')(file); await wait(300); await confirmOk();
        return s().transactions.length === before || `restored ${s().transactions.length} of ${before}`;
    });

    await T('PIN: set, wrong PIN refused, unlock, turn off', async () => {
        g('openPinFlow')('set'); await wait(250);
        for (const k of '2580') await g('onPinKey')(k);
        for (const k of '2580') await g('onPinKey')(k);
        await wait(300);
        const on = s().config.lock.enabled;
        g('showLock')(); await wait(200);
        for (const k of '1111') await g('onLockKey')(k);
        const stillLocked = g('isLocked')();
        for (const k of '2580') await g('onLockKey')(k);
        await wait(900);
        const unlocked = !g('isLocked')();
        g('openPinFlow')('disable'); await wait(250);
        for (const k of '2580') await g('onPinKey')(k);
        await wait(300);
        return (on && stillLocked && unlocked && !s().config.lock.enabled) || `on ${on}, wrong-stays-locked ${stillLocked}, unlocked ${unlocked}, off ${!s().config.lock.enabled}`;
    });

    await T('Weak PIN 1234 refused', async () => {
        g('openPinFlow')('set'); await wait(250);
        for (const k of '1234') await g('onPinKey')(k);
        const msg = $('pin-msg').textContent;
        await close('modal-pin');
        return (/harder/.test(msg) && !s().config.lock.enabled) || msg;
    });

    await T('Theme switch applies and is saved', async () => {
        g('setTheme')('light'); await wait(500);
        const light = document.documentElement.dataset.theme === 'light' && s().config.theme === 'light';
        g('setTheme')('dark'); await wait(500);
        return (light && s().config.theme === 'dark') || 'theme did not apply';
    });

    await T('Quick picks: local prices and auto category', () => {
        const list = g('priceList')('LKR');
        const rice = list.items.find((i) => i.name === 'Rice & curry');
        const cat = g('guessCategory')('bus to town');
        return (rice && rice.price > 0 && cat === 'Travel') || `rice ${rice && rice.price}, bus -> ${cat}`;
    });

    await T('Vela AI card: add and undo', async () => {
        const d = g('draftFromAi')({ type: 'expense', description: 'Tea', amount: 120, currency: 'LKR', category: 'Food', date: today });
        const bad = g('draftFromAi')({ type: 'expense', amount: -5 });
        const rec = g('quickSaveTx')(d);
        const added = s().transactions.some((t) => t.id === rec.id);
        s().transactions = s().transactions.filter((t) => t.id !== rec.id);
        return (d && !bad && added) || `draft ${!!d}, bad rejected ${!bad}, added ${added}`;
    });

    await T('Receipt photo is stored on the phone', async () => {
        const canvas = document.createElement('canvas'); canvas.width = 20; canvas.height = 20;
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg'));
        g('openEditTx')(find('Kottu').id); await wait(250);
        await g('pickReceipt')(new File([blob], 'r.jpg', { type: 'image/jpeg' })); await wait(200);
        await g('submitTx')(); await wait(400);
        const r = find('Kottu').receipt;
        const stored = r && await g('receiptStore').get(r.id);
        return !!stored || `receipt ${JSON.stringify(r)}`;
    });

    await T('Reminders schedule bills and the 8 pm nudge', async () => {
        const calls = [];
        let perm = 'prompt';
        window.Capacitor = { isNativePlatform: () => true, Plugins: { LocalNotifications: {
            checkPermissions: async () => ({ display: perm }), requestPermissions: async () => { perm = 'granted'; return { display: perm }; },
            createChannel: async () => {}, cancel: async () => {}, schedule: async (o) => { calls.push(...o.notifications.map((n) => n.id)); }
        } } };
        await g('enableReminders')(true);
        delete window.Capacitor;
        const slt = s().recurring.find((b) => b.name === 'SLT');
        const ok = calls.includes(900001) && calls.includes(g('hashToInt')(slt.id));
        s().config.reminders = false;
        return ok || `scheduled ${calls.join(',')}`;
    });

    await T('Sample data loads with round budgets', async () => {
        const saved = JSON.stringify(s());
        s().transactions = []; s().savings = []; s().recurring = []; s().debts = []; s().config.categoryBudgets = {};
        g('seedData')();
        const n = s().transactions.length;
        const round = Object.values(s().config.categoryBudgets).every((v) => v % 100 === 0);
        (0, eval)('state = ' + saved);
        return (n > 5 && round) || `entries ${n}, round ${round}`;
    });

    // Cloud sync against a fake account.
    const fakeCloud = (settings) => {
        const cloud = { records: [], settings, settingsUploads: 0, deletes: [] };
        const q = (result) => { const p = Promise.resolve(result); const o = { then: (a, b) => p.then(a, b), select: () => o, eq: () => o, limit: () => o, in: () => o, maybeSingle: () => Promise.resolve(result.single !== undefined ? { data: result.single, error: null } : result) }; return o; };
        const client = {
            from: (t) => ({
                select: () => (t === 'vela_records' ? q({ data: cloud.records, error: null }) : t === 'vela_settings' ? q({ single: cloud.settings, error: null }) : q({ single: null, data: null, error: null })),
                upsert: (rows) => {
                    if (t === 'vela_settings') { cloud.settings = JSON.parse(JSON.stringify(rows)); cloud.settingsUploads++; }
                    else (Array.isArray(rows) ? rows : [rows]).forEach((r) => { const i = cloud.records.findIndex((x) => x.id === r.id); if (i >= 0) cloud.records[i] = r; else cloud.records.push(r); });
                    return Promise.resolve({ error: null });
                },
                delete: () => ({ in: (col, ids) => { cloud.deletes.push(...ids); cloud.records = cloud.records.filter((r) => !ids.includes(r.id)); return Promise.resolve({ error: null }); } })
            }),
            auth: { onAuthStateChange() {}, signOut: async () => {} },
            functions: {}
        };
        return { cloud, client };
    };

    await T('Sign in as guest with data: entries upload, account settings kept', async () => {
        const { cloud, client } = fakeCloud({ user_id: 'u1', data: { budget: 45000, budgetCurrency: 'LKR', currency: 'LKR', currencies: ['LKR', 'USD'], accounts: [{ id: 'acc-cash', name: 'Cash', kind: 'cash', currency: 'LKR' }] } });
        const realClient = g('supabaseClient');
        (0, eval)('supabaseClient = window.__fakeClient'); window.__fakeClient = client; (0, eval)('supabaseClient = window.__fakeClient');
        (0, eval)('handledUserId = null');
        const localCount = s().transactions.length;
        await g('handleSession')({ user: { id: 'u1', email: 't@example.com', user_metadata: {} } });
        await wait(600);
        const uploaded = cloud.records.filter((r) => r.kind === 'transaction').length;
        const ok = uploaded === localCount && cloud.settings.data.budget === 45000 && s().config.budget === 45000;
        window.__realClient = realClient;
        return ok || `uploaded ${uploaded}/${localCount}, cloud budget ${cloud.settings.data.budget}, phone budget ${s().config.budget}`;
    });

    await T('Signed in: deleting an entry deletes it in the cloud', async () => {
        const t = find('Kottu');
        g('deleteTx')(t.id); await confirmOk(); await close('modal-tx'); await wait(400);
        const client = window.__fakeClient;
        const recs = await client.from('vela_records').select();
        return !recs.data.some((r) => r.id === t.id) || 'still in cloud';
    });

    await T('Signed in: deleting an account moves entries and removes its transfers in the cloud', async () => {
        const client = window.__fakeClient;
        g('openAccountEditor')(); await wait(250);
        $('account-name').value = 'HNB';
        $('account-kind').value = 'bank';
        g('fillCurrencySelect')($('account-currency'), 'LKR');
        $('account-opening').value = '0';
        g('submitAccount')(); await wait(400);
        const hnb = s().accounts.find((x) => x.name === 'HNB');
        g('openTransfer')(); await wait(250);
        $('transfer-from').value = 'acc-cash';
        $('transfer-to').value = hnb.id;
        g('updateTransferFields')();
        $('transfer-amount').value = '1000';
        $('transfer-date').value = today;
        g('submitTransfer')(); await wait(500);
        const tr = s().transactions.find((t) => t.type === 'transfer' && t.toAccountId === hnb.id);
        const inCloud = (await client.from('vela_records').select()).data.some((r) => r.id === tr.id);
        g('deleteAccount')(hnb.id); await confirmOk(); await wait(600);
        const stillInCloud = (await client.from('vela_records').select()).data.some((r) => r.id === tr.id);
        const phoneGone = !s().transactions.some((t) => t.id === tr.id);
        return (inCloud && phoneGone && !stillInCloud) || `uploaded ${inCloud}, gone on phone ${phoneGone}, still in cloud ${stillInCloud}`;
    });

    await T('Signed in: a settings change uploads by itself', async () => {
        g('setTheme')('light'); await wait(1500);
        const client = window.__fakeClient;
        const set = await client.from('vela_settings').select().maybeSingle();
        g('setTheme')('dark'); await wait(1200);
        return (set.data && set.data.data && set.data.data.theme === 'light') || `cloud theme ${set.data && set.data.data && set.data.data.theme}`;
    });

    await T('Sign out clears this phone', async () => {
        g('resetToSignedOut')(); await wait(300);
        const empty = s().transactions.length === 0 && !s().settingsUser;
        (0, eval)('supabaseClient = window.__realClient');
        return empty || `entries left ${s().transactions.length}`;
    });

    await T('No errors logged during the run', () => (window.__velaErrors || []).length === 0 || window.__velaErrors.join(' | '));

    window.removeEventListener('error', onErr);
    window.removeEventListener('unhandledrejection', onErr);
    localStorage.clear();
    const failed = results.filter((r) => !r.ok);
    return { passed: results.length - failed.length, total: results.length, failed, results };
}
