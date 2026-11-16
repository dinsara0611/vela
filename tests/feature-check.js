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

    // Live rates must not change mid-run: block new downloads and let one already running finish first.
    if (!window.__rateStub) {
        const realFetch = window.fetch.bind(window);
        window.fetch = (u, o) => (String(u).includes('open.er-api.com') ? Promise.reject(new Error('rates blocked in tests')) : realFetch(u, o));
        window.__rateStub = true;
    }
    for (let i = 0; i < 100 && g('rateStatus') === 'syncing'; i++) await wait(100);
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
        const btn = document.querySelector(`[data-pay="tx:${rent.id}"]`);
        const label = btn && btn.textContent.trim();
        btn.click(); await wait(200);
        const askText = $('confirm-title').textContent + ' / ' + $('btn-confirm-ok').textContent + ' / ' + $('btn-confirm-cancel').textContent;
        await confirmOk();
        const st1 = g('monthStats')();
        const cash1 = g('accountBalance')(s().accounts[0]);
        return (waiting && /received/i.test(label) && /arrived/.test(askText) && /Not yet/.test(askText) && rent.pending === false && rent.dueDate > today && rent.date === today && st1.income === st0.income + 30000 && cash1 === cash0 + 30000)
            || `waiting ${waiting}, button "${label}", pending ${rent.pending}, date ${rent.date}, income ${st0.income}->${st1.income}, cash ${cash0}->${cash1}`;
    });

    await T('Unpaid past payment shows OVERDUE, counts only when paid, on the day it was paid', async () => {
        const y = iso(addDays(new Date(), -1));
        s().transactions.push({ id: 'wait-1', type: 'expense', desc: 'Water bill', amount: 1800, currency: 'LKR', category: 'Utilities', date: y, note: '', createdAt: 5, recurringId: null, accountId: 'acc-cash', receipt: null, fixed: true, pending: true });
        g('saveState')(); g('switchTab')('activity'); await wait(300);
        const spentBefore = g('expenses')().some((t) => t.id === 'wait-1');
        const row = document.querySelector('[data-pay="tx:wait-1"]');
        const badge = row && row.closest('li').querySelector('.tx-upcoming').textContent;
        g('confirmTx')('wait-1'); await wait(200);
        const counted = g('expenses')().some((t) => t.id === 'wait-1');
        const paidToday = s().transactions.find((t) => t.id === 'wait-1');
        return (!spentBefore && badge === 'Overdue' && /paid/i.test(row.textContent) && counted && paidToday.date === today && paidToday.dueDate === y) || `counted before ${spentBefore}, badge ${badge}, after ${counted}`;
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

    // ---- Bank SMS accuracy: realistic Commercial Bank formats ----
    const P = (body, address = 'COMBANK', extra = {}) => g('parseBankSms')({ id: `t-${Math.random()}`, address, body, date: new Date(2026, 10, 16, 12, 0).getTime(), ...extra });
    const smsCases = [
        ['card payment', 'Transaction Alert: LKR 3,450.00 POS purchase at KEELLS SUPER COLOMBO 07 on your ComBank Debit Card ending 4321 on 16/11/2026 10:20:15. Avl Bal: LKR 12,345.67',
            { type: 'expense', kind: 'card', amount: 3450, desc: 'Keells Super Colombo 07', last4: '4321', date: '2026-11-16', time: '10:20', category: 'Food', confidence: 'high' }],
        ['account debit with ref + balance', 'Dear Customer, Your A/C No.8001234567 has been debited for LKR 3,450.00 on 16/11/2026 at 10:15 Ref:FT2632012345. Avl Bal LKR 45,230.50',
            { type: 'expense', amount: 3450, ref: 'FT2632012345', last4: '4567', date: '2026-11-16' }],
        ['salary credit', 'LKR 150,000.00 credited to A/C 8001234567 on 16/11/26 SALARY ABC PVT LTD. Avl Bal LKR 200,000.00',
            { type: 'income', amount: 150000, category: 'Salary', date: '2026-11-16' }],
        ['online purchase in USD', 'Your ComBank Card ending 4321 was used for an online transaction of USD 12.99 at NETFLIX.COM on 16/11/2026',
            { type: 'expense', kind: 'online', amount: 12.99, currency: 'USD', last4: '4321' }],
        ['ATM withdrawal', 'ATM Cash Withdrawal LKR 10,000.00 from A/C ...1234 at COMBANK ATM KOLLUPITIYA on 16/11/2026 11:02',
            { type: 'atm', kind: 'atm', amount: 10000, desc: 'ATM withdrawal' }],
        ['transfer out', 'CEFT transfer of LKR 25,000.00 to NIMAL PERERA from A/C ...1234 successful on 16/11/2026. Ref 778899',
            { type: 'expense', kind: 'transfer_out', amount: 25000, desc: 'Nimal Perera', ref: '778899' }],
        ['transfer in', 'Fund transfer LKR 20,000.00 received from KAMAL SILVA via CEFT to A/C ...1234 on 16/11/2026 Ref:FT123456',
            { type: 'income', kind: 'transfer_in', amount: 20000, desc: 'Kamal Silva', ref: 'FT123456' }],
        ['refund', 'LKR 2,500.00 refund from DARAZ credited to your card ending 4321 on 15/11/2026',
            { type: 'income', kind: 'refund', amount: 2500, desc: 'Refund: Daraz', date: '2026-11-15' }],
        ['reversal', 'Reversal of LKR 2,500.00 transaction at KEELLS SUPER on card ending 4321 on 16/11/2026',
            { type: 'reversal', kind: 'reversal', amount: 2500 }],
        ['bank charge', 'Service charge of LKR 150.00 debited from A/C ...1234 for SMS alerts on 16/11/2026',
            { type: 'expense', kind: 'fee', amount: 150, desc: 'Commercial Bank charges' }],
        ['two amounts (LKR + USD)', 'LKR 4,320.00 (USD 12.99) debited at NETFLIX.COM on card ending 4321 on 16/11/2026',
            { type: 'expense', amount: 4320, currency: 'LKR' }],
        ['no shop name: asks to check', 'Your A/C ...1234 has been debited with LKR 1,200.00 on 16/11/2026',
            { type: 'expense', amount: 1200, confidence: 'medium' }],
        ['no date in message: date when it arrived', 'LKR 500.00 POS purchase at CARGILLS on card ending 4321',
            { amount: 500, date: '2026-11-16', confidence: 'medium' }],
        ['other bank: reviewed', 'HNB: Purchase of LKR 900.00 at PIZZA HUT on card ending 1111 on 16/11/2026', { type: 'expense', amount: 900, confidence: 'medium' }, 'HNB']
    ];
    const ignoredCases = [
        ['declined', 'Your transaction of LKR 5,000.00 at ABC STORE was declined due to insufficient funds. ComBank'],
        ['failed', 'ComBank: Fund transfer of LKR 10,000.00 failed. Please try again.'],
        ['OTP with an amount', 'Your OTP for the transaction of LKR 3,450.00 at DARAZ is 123456. Do not share. ComBank'],
        ['balance enquiry', 'Your A/C ...1234 Avl Bal is LKR 45,230.50 as at 16/11/2026. ComBank'],
        ['login alert', 'You have logged in to ComBank Digital on 16/11/2026 10:00. If this was not you call 0112353353'],
        ['promotion', 'Enjoy 20% off at ODEL with ComBank cards. Spend LKR 10,000 and win! ComBank'],
        ['payment reminder', 'ComBank: Your credit card payment of LKR 15,000.00 is due on 25/11/2026.'],
        ['not a bank', 'Hi machan, send me Rs. 500 for the bus', '0771234567']
    ];

    await T('SMS accuracy: transaction formats read correctly', () => {
        const bad = [];
        smsCases.forEach(([name, body, want, address]) => {
            const r = P(body, address || 'COMBANK');
            if (!r) { bad.push(`${name}: not read (${g('smsLastReason')})`); return; }
            Object.entries(want).forEach(([k, v]) => { if (r[k] !== v) bad.push(`${name}: ${k} = ${JSON.stringify(r[k])}, want ${JSON.stringify(v)}`); });
        });
        return bad.length ? bad.join(' | ') : true;
    });

    await T('SMS accuracy: OTPs, declined, failed, balance, login, promotions, reminders and chats are never used', () => {
        const used = ignoredCases.filter(([, body, address]) => P(body, address || 'COMBANK')).map(([n]) => n);
        return used.length ? `used: ${used.join(', ')}` : true;
    });

    await T('SMS accuracy: balance is never taken as the amount; account numbers are masked', () => {
        const r = P('Dear Customer, Your A/C No.8001234567 has been debited for LKR 3,450.00 on 16/11/2026 Ref:FT1. Avl Bal LKR 45,230.50');
        return (r.amount === 3450 && !r.masked.includes('8001234567') && r.masked.includes('••4567')) || `amount ${r.amount}, masked "${r.masked}"`;
    });

    await T('SMS duplicates: same transaction twice (resent or read twice) is offered once; recorded ones never again', async () => {
        localStorage.removeItem('VELA_SMS');
        const body = 'Dear Customer, Your A/C ...1234 has been debited for LKR 777.00 at UBER on 16/11/2026 Ref:DUP777';
        const before = g('smsQueue').length;
        g('smsTake')([{ id: 'd1', address: 'COMBANK', body, date: Date.now() }, { id: 'd2', address: 'COMBANK', body: body + ' ', date: Date.now() + 5000 }]);
        const queued = g('smsQueue').length - before;
        g('smsAdd')('d1'); await wait(300);
        const added = s().transactions.filter((t) => t.bank && t.bank.ref === 'DUP777').length;
        const again = g('smsTake')([{ id: 'd3', address: 'COMBANK', body, date: Date.now() + 9000 }]);
        if (g('isSheetOpen')('modal-sms')) await close('modal-sms');
        return (queued === 1 && added === 1 && again === 0) || `queued ${queued}, added ${added}, offered again ${again}`;
    });

    await T('SMS reconcile: an entry you logged by hand is linked (bank-verified), not added again', async () => {
        await addTx({ amount: 640, desc: 'Lunch at work', category: 'Food' });
        const n = s().transactions.length;
        g('smsTake')([{ id: 'l1', address: 'COMBANK', body: 'LKR 640.00 POS purchase at CAFE KOPI on card ending 4321 on ' + new Date().toLocaleDateString('en-GB'), date: Date.now() }]);
        g('showSmsSheet')(); await wait(400);
        const linkBtn = document.querySelector('[data-sms-match="l1"]');
        const text = linkBtn && linkBtn.textContent;
        linkBtn.click(); await wait(300);
        const t = find('Lunch at work');
        return (/Link/.test(text) && s().transactions.length === n && t.bank && t.bank.bank === 'Commercial Bank') || `button "${text}", entries ${n}->${s().transactions.length}, linked ${!!t.bank}`;
    });

    await T('SMS reversal: removes the reversed payment, never adds income', async () => {
        await addTx({ amount: 2222, desc: 'Shoes', category: 'Shopping' });
        const incomeBefore = g('monthStats')().income;
        g('smsTake')([{ id: 'r1', address: 'COMBANK', body: 'Reversal of LKR 2,222.00 transaction at BATA on card ending 4321', date: Date.now() }]);
        g('showSmsSheet')(); await wait(400);
        document.querySelector('[data-sms-match="r1"]').click(); await wait(300);
        return (!find('Shoes') && g('monthStats')().income === incomeBefore) || `shoes still ${!!find('Shoes')}, income ${incomeBefore}->${g('monthStats')().income}`;
    });

    await T('SMS ATM withdrawal: moved from bank to Cash (not counted as spending twice)', async () => {
        if (!s().accounts.some((a) => a.kind === 'bank')) s().accounts.push({ id: 'acc-bank-t', name: 'ComBank', kind: 'bank', currency: 'LKR', opening: 0, createdAt: 1 });
        const bank = s().accounts.find((a) => a.kind === 'bank');
        const spent0 = g('monthStats')().spent;
        g('smsTake')([{ id: 'a1', address: 'COMBANK', body: 'ATM Cash Withdrawal LKR 5,000.00 from A/C ...1234 at COMBANK ATM KANDY on ' + new Date().toLocaleDateString('en-GB'), date: Date.now() }]);
        g('showSmsSheet')(); await wait(400);
        $('sms-account').value = bank.id;
        document.querySelector('[data-sms-add="a1"]').click(); await wait(300);
        const tr = s().transactions.find((t) => t.bank && t.bank.smsId === 'a1');
        return (tr && tr.type === 'transfer' && tr.toAccountId === 'acc-cash' && g('monthStats')().spent === spent0) || `entry ${JSON.stringify(tr && { type: tr.type, to: tr.toAccountId })}, spent ${spent0}->${g('monthStats')().spent}`;
    });

    await T('SMS edit details: the form opens filled in; saving adds it once with the bank details', async () => {
        g('smsTake')([{ id: 'e1', address: 'COMBANK', body: 'Your A/C ...1234 has been debited with LKR 3,000.00 on ' + new Date().toLocaleDateString('en-GB'), date: Date.now() }]);
        g('showSmsSheet')(); await wait(400);
        document.querySelector('[data-sms-edit="e1"]').click(); await wait(400);
        const filled = $('tx-amount').value;
        $('tx-desc').value = 'Electricity bill';
        await g('submitTx')(); await wait(400);
        const t = find('Electricity bill');
        const queued = g('smsQueue').some((i) => i.id === 'e1');
        return (filled === '3,000' && t && t.bank && t.bank.smsId === 'e1' && !queued) || `filled ${filled}, saved ${!!t}, bank ${t && !!t.bank}, still queued ${queued}`;
    });

    await T('SMS paste: works without SMS permission; non-bank text is refused', async () => {
        g('openSmsPaste')(); await wait(300);
        $('sms-paste-text').value = 'hello, call me later';
        g('checkPastedSms')(); await wait(100);
        const refused = /doesn.t look like/.test($('sms-paste-result').textContent);
        $('sms-paste-text').value = 'ComBank: LKR 1,111.00 POS purchase at ARPICO on card ending 4321 on ' + new Date().toLocaleDateString('en-GB');
        g('checkPastedSms')(); await wait(700);
        const queued = g('smsQueue').find((i) => i.amount === 1111);
        if (g('isSheetOpen')('modal-sms')) { g('smsIgnore')(queued.id); await wait(300); }
        return (refused && queued && queued.confidence === 'medium') || `refused ${refused}, queued ${JSON.stringify(queued && queued.confidence)}`;
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

    // ---- Bank connections: SMS + bank-app notifications through one engine ----
    // Examples follow common Sri Lankan bank alert wording; they are written for testing, not real ComBank messages.
    const NOW = Date.now();
    const smsMsg = (id, body, at = NOW) => ({ id, source: 'sms', address: 'COMBANK', body, date: at });
    const ntfMsg = (id, body, at = NOW) => ({ id, source: 'notification', address: 'combank.com.combankdigital', bank: 'Commercial Bank', body, date: at });
    const freshEngine = () => { localStorage.removeItem('VELA_SMS'); (0, eval)('smsQueue = []'); };
    const fakeBankPlugin = (status = {}, extra = {}) => {
        const calls = { cleared: [], listeners: {}, opened: [], disconnected: 0, deleted: 0, notif: [], paused: [] };
        const st = { sdk: 34, smsPermission: 'granted', smsEnabled: true, notifEnabled: true, paused: false, notifAccess: true, listenerConnected: true, postNotifications: true, lastDetected: 0, hiddenAt: 0, pending: 0,
            apps: [{ pkg: 'combank.com.combankdigital', name: 'ComBank Digital', installed: true, selected: true }, { pkg: 'net.combank.passbook', name: 'ComBank ePassbook', installed: false, selected: false }], ...status };
        window.Capacitor = { isNativePlatform: () => true, Plugins: {
            SmsReader: {
                status: async () => st, checkPermissions: async () => ({ sms: st.smsPermission }), requestPermissions: async () => ({ sms: st.smsPermission }),
                setEnabled: async () => {}, setNotifTracking: async (o) => { calls.notif.push(o); st.notifEnabled = o.enabled; }, setPaused: async ({ paused }) => { calls.paused.push(paused); st.paused = paused; },
                disconnect: async () => { calls.disconnected++; st.smsEnabled = false; st.notifEnabled = false; }, deleteDetections: async () => { calls.deleted++; },
                openNotificationAccess: async () => { calls.opened.push('ntf'); }, openAppSettings: async () => { calls.opened.push('app'); },
                getPending: async () => ({ messages: extra.pending || [] }), readInbox: async () => ({ messages: [] }),
                clearHandled: async ({ ids }) => { calls.cleared.push(...ids); }, addListener: (name, fn) => { calls.listeners[name] = fn; }
            },
            LocalNotifications: { checkPermissions: async () => ({ display: 'granted' }), requestPermissions: async () => ({ display: 'granted' }) }
        } };
        return { calls, st };
    };

    await T('Notification: debit and credit from the ComBank app are read (no SMS needed)', () => {
        const out = P('Transaction Alert. LKR 3,450.00 spent at KEELLS SUPER using card ending 4321', 'combank.com.combankdigital', { source: 'notification', bank: 'Commercial Bank' });
        const inn = P('Funds received. LKR 20,000.00 credited to your account from KAMAL SILVA', 'combank.com.combankdigital', { source: 'notification', bank: 'Commercial Bank' });
        return (out && out.type === 'expense' && out.amount === 3450 && out.bank === 'Commercial Bank' && out.sources.join() === 'notification' && out.confidence === 'high'
            && inn && inn.type === 'income' && inn.amount === 20000) || `out ${JSON.stringify(out && [out.type, out.amount, out.confidence, out.checks])}, in ${JSON.stringify(inn && [inn.type, inn.amount])}`;
    });

    await T('Notification: failed, OTP, hidden or incomplete notifications are never used', () => {
        const n = (body) => P(body, 'combank.com.combankdigital', { source: 'notification', bank: 'Commercial Bank' });
        const used = [
            ['declined', 'Transaction declined. LKR 5,000.00 at ABC STORE'],
            ['otp', 'Your OTP is 482913 for LKR 3,450.00 payment'],
            ['hidden', 'Contents hidden'],
            ['no amount', 'Transaction alert. Tap to view details'],
            ['security', 'Security alert: beware of calls asking for your PIN'],
            ['balance', 'Your available balance is LKR 45,230.50']
        ].filter(([, b]) => n(b)).map(([k]) => k);
        return used.length ? `used: ${used}` : true;
    });

    await T('Same purchase by SMS + notification becomes ONE transaction listing both sources', async () => {
        freshEngine();
        g('smsTake')([smsMsg('x-sms', 'LKR 3,450.00 POS purchase at KEELLS SUPER on card ending 4321 on ' + new Date().toLocaleDateString('en-GB'), NOW)]);
        g('smsTake')([ntfMsg('x-ntf', 'Transaction Alert. LKR 3,450.00 spent at KEELLS SUPER', NOW + 40000)]);
        const q = g('smsQueue');
        const one = q.length === 1 && q[0].sources.join('+') === 'sms+notification';
        g('showSmsSheet')(); await wait(400);
        const shows = /SMS/.test($('sms-list').innerText) && /Bank notification/.test($('sms-list').innerText);
        const n0 = s().transactions.length;
        document.querySelector('[data-sms-add="x-sms"]').click(); await wait(300);
        const t = s().transactions.find((x) => x.bank && x.bank.smsId === 'x-sms');
        return (one && shows && s().transactions.length === n0 + 1 && t.bank.sources.length === 2 && !g('isSheetOpen')('modal-sms'))
            || `queued ${q.length} ${q[0] && q[0].sources}, popup shows sources ${shows}, added ${s().transactions.length - n0}, sources ${t && t.bank.sources}`;
    });

    await T('Notification arriving after the SMS was confirmed only adds the source, never a second entry', async () => {
        const n0 = s().transactions.length;
        // The same notification read again (e.g. after a restart) is never offered again.
        const added = g('smsTake')([ntfMsg('x-ntf', 'Transaction Alert. LKR 3,450.00 spent at KEELLS SUPER', NOW + 40000)]);
        const t = s().transactions.find((x) => x.bank && x.bank.smsId === 'x-sms');
        // The reversed order: notification confirmed first, then the SMS.
        freshEngine();
        g('smsTake')([ntfMsg('y-ntf', 'Payment of LKR 980.00 at UBER EATS', NOW)]);
        g('smsAdd')('y-ntf'); await wait(200);
        const before = s().transactions.length;
        const again = g('smsTake')([smsMsg('y-sms', 'LKR 980.00 online transaction at UBER EATS on card ending 4321', NOW + 30000)]);
        const y = s().transactions.find((x) => x.bank && x.bank.smsId === 'y-ntf');
        return (added === 0 && s().transactions.length === before && again === 0 && y.bank.sources.includes('sms') && t.bank.sources.includes('notification') && before === n0 + 1)
            || `late notification added ${added}, sms after notification added ${again}, sources ${y && y.bank.sources}`;
    });

    await T('Two real purchases with the same amount are NOT merged', () => {
        freshEngine();
        const n = g('smsTake')([
            smsMsg('p1', 'LKR 500.00 POS purchase at CARGILLS on card ending 4321', NOW),
            smsMsg('p2', 'LKR 500.00 POS purchase at CARGILLS on card ending 4321 at 12:31', NOW + 4 * 60000),
            ntfMsg('p3', 'LKR 500.00 spent at CARGILLS', NOW + 8 * 60 * 60000) // hours later: a third purchase
        ]);
        return (n === 3 && g('smsQueue').length === 3) || `kept ${g('smsQueue').length}`;
    });

    await T('Duplicate SMS delivery and notification updates are kept once', () => {
        freshEngine();
        const body = 'Dear Customer, Your A/C ...1234 has been debited for LKR 2,000.00 at DIALOG on 16/11/2026';
        g('smsTake')([smsMsg('d-a', body, NOW), smsMsg('d-b', body, NOW + 2000)]); // resent SMS (new id)
        g('smsTake')([ntfMsg('n-a', 'LKR 750.00 spent at PICKME', NOW), ntfMsg('n-a', 'LKR 750.00 spent at PICKME', NOW)]); // same notification twice
        g('smsTake')([ntfMsg('n-a', 'LKR 750.00 spent at PICKME', NOW + 1000)]); // an update keeps its id on the phone
        const kept = g('smsQueue').length;
        freshEngine();
        // The same text twice is NOT a repeat when it is a separate alert: two notifications, or two SMS hours apart.
        g('smsTake')([ntfMsg('two-a', 'LKR 750.00 spent at PICKME', NOW), ntfMsg('two-b', 'LKR 750.00 spent at PICKME', NOW + 5 * 60000)]);
        g('smsTake')([smsMsg('two-c', 'LKR 450.00 POS purchase at CAFE KOPI on card ending 4321', NOW), smsMsg('two-d', 'LKR 450.00 POS purchase at CAFE KOPI on card ending 4321', NOW + 3 * 3600000)]);
        const separate = g('smsQueue').length;
        // A pasted copy of a message already waiting is a copy, whenever it is pasted.
        g('smsTake')([{ id: 'paste-copy', address: 'Pasted', shared: true, body: 'LKR 450.00 POS purchase at CAFE KOPI on card ending 4321', date: NOW + 5 * 3600000 }]);
        const afterPaste = g('smsQueue').length;
        freshEngine();
        return (kept === 2 && separate === 4 && afterPaste === 4) || `kept ${kept} (want 2), identical separate alerts ${separate} (want 4), after pasted copy ${afterPaste} (want 4)`;
    });

    await T('No reference: matched only within the time window and when card numbers agree', () => {
        freshEngine();
        g('smsTake')([smsMsg('w1', 'LKR 1,500.00 POS purchase at ODEL on card ending 4321', NOW)]);
        g('smsTake')([ntfMsg('w2', 'LKR 1,500.00 spent at ODEL', NOW + 30 * 60000)]); // 30 min later: outside 15 min
        const outside = g('smsQueue').length;
        freshEngine();
        g('smsTake')([smsMsg('c1', 'LKR 1,500.00 POS purchase at ODEL on card ending 4321', NOW)]);
        g('smsTake')([ntfMsg('c2', 'LKR 1,500.00 spent at ODEL with card ending 9999', NOW + 60000)]); // different card
        const otherCard = g('smsQueue').length;
        freshEngine();
        g('smsTake')([smsMsg('m1', 'LKR 1,500.00 POS purchase at ODEL on card ending 4321', NOW)]);
        g('smsTake')([ntfMsg('m2', 'LKR 1,500.00 spent at FASHION BUG', NOW + 60000)]); // different shop: ask
        const q = g('smsQueue');
        const flagged = q.length === 2 && q[1].confidence === 'medium' && /same as another/.test(q[1].checks.join());
        freshEngine();
        g('smsTake')([smsMsg('r1', 'LKR 1,500.00 POS purchase at ODEL Ref:AB1234', NOW)]);
        g('smsTake')([ntfMsg('r2', 'LKR 1,500.00 spent at ODEL Ref:AB1234', NOW + 50 * 60000)]); // same reference: same even if late
        const byRef = g('smsQueue').length;
        freshEngine();
        return (outside === 2 && otherCard === 2 && flagged && byRef === 1) || `outside window ${outside}, other card ${otherCard}, different shop flagged ${flagged}, same ref ${byRef}`;
    });

    await T('Refund lowers the original purchase (not new income); partial refund lowers it by the refund', async () => {
        await addTx({ amount: 6000, desc: 'Daraz order', category: 'Shopping' });
        const inc0 = g('monthStats')().income;
        freshEngine();
        g('smsTake')([smsMsg('rf1', 'LKR 2,000.00 refund from DARAZ credited to your card ending 4321', NOW)]);
        g('showSmsSheet')(); await wait(300);
        const btn = document.querySelector('[data-sms-match="rf1"]');
        const label = btn && btn.textContent;
        btn.click(); await wait(300);
        const order = find('Daraz order');
        return (/Refund for/.test(label) && order.amount === 4000 && g('monthStats')().income === inc0) || `button "${label}", order ${order && order.amount}, income ${inc0}->${g('monthStats')().income}`;
    });

    await T('Transfer between own accounts: recorded as a transfer, not income or spending', async () => {
        if (!s().accounts.some((a) => a.kind === 'bank')) s().accounts.push({ id: 'acc-bank-t', name: 'ComBank', kind: 'bank', currency: 'LKR', opening: 0, createdAt: 1 });
        const st0 = g('monthStats')();
        freshEngine();
        g('smsTake')([smsMsg('tr1', 'CEFT transfer of LKR 15,000.00 to D PERERA from A/C ...1234 successful on ' + new Date().toLocaleDateString('en-GB') + '. Ref 556677', NOW)]);
        g('showSmsSheet')(); await wait(300);
        $('sms-account').value = s().accounts.find((a) => a.kind === 'bank').id;
        document.querySelector('[data-sms-move="tr1"]').click(); await wait(400);
        await g('submitTransfer')(); await wait(400);
        const t = s().transactions.find((x) => x.bank && x.bank.smsId === 'tr1');
        const st1 = g('monthStats')();
        return (t && t.type === 'transfer' && st1.spent === st0.spent && st1.income === st0.income) || `entry ${t && t.type}, spent ${st0.spent}->${st1.spent}, income ${st0.income}->${st1.income}`;
    });

    await T('Detected but not confirmed: balances and totals do not change', () => {
        const st0 = g('monthStats')();
        const bal0 = JSON.stringify(s().accounts.map((a) => g('accountBalance')(a)));
        freshEngine();
        g('smsTake')([smsMsg('u1', 'LKR 99,999.00 POS purchase at SINGER on card ending 4321', NOW)]);
        const st1 = g('monthStats')();
        const bal1 = JSON.stringify(s().accounts.map((a) => g('accountBalance')(a)));
        freshEngine();
        return (st0.spent === st1.spent && bal0 === bal1) || `spent ${st0.spent}->${st1.spent}`;
    });

    await T('Vela closed: kept detections load on start; tapping the notification opens the review', async () => {
        freshEngine();
        const { calls } = fakeBankPlugin({}, { pending: [ntfMsg('closed-1', 'LKR 1,234.00 spent at CARGILLS', NOW - 600000)] });
        g('initSms')();
        await calls.listeners.reviewRequested({ id: 'closed-1' }); await wait(500);
        const open = g('isSheetOpen')('modal-sms') && /1,234/.test($('sms-list').innerText);
        g('smsIgnore')('closed-1'); await wait(300);
        const cleared = calls.cleared.includes('closed-1');
        const added = s().transactions.some((t) => t.bank && t.bank.smsId === 'closed-1');
        delete window.Capacitor;
        freshEngine();
        return (open && cleared && !added) || `review open ${open}, ignored cleared ${cleared}, added ${added}`;
    });

    await T('Bank connections: "Connected" only when Android access really works', async () => {
        g('switchTab')('settings'); await wait(300);
        const look = async (status) => { fakeBankPlugin(status); await g('refreshBankStatus')(); return [$('bank-sms-state').textContent, $('bank-ntf-state').textContent, $('bank-overall').textContent]; };
        const ok = await look({});
        const noAccess = await look({ notifAccess: false, listenerConnected: false });
        const stopped = await look({ listenerConnected: false });
        const noSms = await look({ smsPermission: 'denied' });
        const hidden = await look({ hiddenAt: NOW, lastDetected: NOW - 1000 });
        const noApp = await look({ apps: [{ pkg: 'combank.com.combankdigital', name: 'ComBank Digital', installed: false, selected: true }] });
        const paused = await look({ paused: true });
        const fixBtn = (await look({ notifAccess: false }), !!document.querySelector('[data-bank-fix="ntf"]'));
        delete window.Capacitor;
        await g('refreshBankStatus')();
        const web = $('bank-overall').textContent;
        const good = ok[0] === 'Connected' && ok[1] === 'Connected' && /Disconnected/.test(noAccess[1]) && /Android stopped/.test(stopped[1]) && /no SMS access/.test(noSms[0])
            && /hidden/.test(hidden[1]) && /not found/.test(noApp[1]) && paused[2] === 'Paused' && fixBtn && web === 'Android only';
        return good || JSON.stringify({ ok, noAccess, stopped, noSms, hidden, noApp, paused, fixBtn, web });
    });

    await T('Notification access: restricted, not granted, disconnected and connected come from Android', async () => {
        g('switchTab')('settings'); await wait(200);
        const look = async (status) => { fakeBankPlugin(status); await g('refreshBankStatus')(); return [$('bank-ntf-state').textContent, $('bank-ntf-help').innerText]; };
        const restricted = await look({ notifState: 'restricted', notifAccess: false, listenerConnected: false, restrictedSettings: 'restricted', notifRequestedAt: 0 });
        const stepsBtns = ['ntf', 'app', 'check'].every((k) => document.querySelector(`#bank-ntf-help [data-bank-fix="${k}"]`));
        const tried = (await look({ notifState: 'restricted', notifAccess: false, listenerConnected: false, notifRequestedAt: NOW }), document.querySelectorAll('#bank-ntf-help .bank-step.is-done').length);
        const notGranted = await look({ notifState: 'not_granted', notifAccess: false, listenerConnected: false });
        const disconnected = await look({ notifState: 'disconnected', notifAccess: true, listenerConnected: false });
        const connected = await look({ notifState: 'connected', notifAccess: true, listenerConnected: true });
        delete window.Capacitor;
        await g('refreshBankStatus')();
        const ok = /restricted setting/.test(restricted[0]) && /Allow restricted settings/.test(restricted[1]) && stepsBtns && tried === 1
            && /Not allowed/.test(notGranted[0]) && /different from Vela/.test(notGranted[1]) && /Android stopped/.test(disconnected[0]) && connected[0] === 'Connected';
        return ok || JSON.stringify({ restricted: restricted[0], stepsBtns, tried, notGranted: notGranted[0], disconnected: disconnected[0], connected: connected[0] });
    });

    await T('Entry status: "Not received yet" waits (not counted); switching to Received counts it; and back again', async () => {
        g('openAddTx')('income'); await wait(300);
        const labels = $('tx-status-done').textContent + '/' + $('tx-status-waiting').textContent;
        $('tx-amount').value = '1000'; $('tx-desc').value = 'Status test income';
        $('tx-status-waiting').click();
        await g('submitTx')(); await wait(300);
        const t = find('Status test income');
        const inc0 = g('monthStats')().income;
        g('openEditTx')(t.id); await wait(300);
        const shows = $('tx-status-waiting').getAttribute('aria-pressed') === 'true';
        $('tx-status-done').click(); await g('submitTx')(); await wait(300);
        const inc1 = g('monthStats')().income;
        const done = find('Status test income');
        g('openEditTx')(t.id); await wait(300);
        $('tx-status-waiting').click(); await g('submitTx')(); await wait(300);
        const inc2 = g('monthStats')().income;
        const back = find('Status test income');
        g('openAddTx')('expense'); await wait(200);
        const expLabels = $('tx-status-done').textContent + '/' + $('tx-status-waiting').textContent;
        await close('modal-tx');
        s().transactions = s().transactions.filter((x) => x.id !== t.id);
        return (labels === 'Received/Not received yet' && expLabels === 'Paid/Not paid yet' && t.pending === true && shows && done.pending === false && !!done.paidAt && inc1 - inc0 === 1000 && back.pending === true && inc1 - inc2 === 1000)
            || JSON.stringify({ labels, expLabels, waited: t.pending, shows, done: done.pending, inc: [inc0, inc1, inc2], back: back.pending });
    });

    await T('SMS restricted by Android: unlock steps shown, never "Connected"', async () => {
        g('switchTab')('settings'); await wait(200);
        fakeBankPlugin({ smsPermission: 'denied', restrictedSettings: 'restricted' });
        await g('refreshBankStatus')();
        const st = $('bank-sms-state').textContent;
        const help = $('bank-sms-help').innerText;
        const btns = !!document.querySelector('#bank-sms-help [data-bank-fix="app"]') && !!document.querySelector('#bank-sms-help [data-bank-fix="check"]');
        delete window.Capacitor;
        await g('refreshBankStatus')();
        return (/restricted setting/.test(st) && /Allow restricted settings/.test(help) && btns) || `state "${st}", buttons ${btns}`;
    });

    await T('Standard edition (no SMS / notification access): explains share & paste, offers no dead switches', async () => {
        g('switchTab')('settings'); await wait(200);
        const { calls } = fakeBankPlugin({ smsAvailable: false, notifAvailable: false, smsPermission: 'unavailable', smsEnabled: false, notifEnabled: false, notifAccess: false, listenerConnected: false });
        await g('refreshBankStatus')();
        const note = !$('bank-web-note').hidden && /Play Protect/.test($('bank-web-note').textContent) && /Check a bank SMS/.test($('bank-web-note').textContent);
        const hidden = $('bank-conns').hidden && $('btn-bank-disconnect').hidden && !$('btn-sms-paste').hidden;
        const pill = $('bank-overall').textContent;
        await g('enableNotifTracking')(true); await wait(100);
        const noConsent = !g('isConfirmOpen')() && calls.notif.length === 0;
        delete window.Capacitor;
        await g('refreshBankStatus')();
        return (note && hidden && pill === 'Share & paste' && noConsent) || `note ${note}, rows hidden ${hidden}, pill ${pill}, tried to enable ${!noConsent}`;
    });

    await T('Bank connections: notification tracking asks for consent, then opens Android access', async () => {
        const { calls } = fakeBankPlugin({ notifEnabled: false, notifAccess: false, listenerConnected: false });
        await g('enableNotifTracking')(true); await wait(200);
        const consent = /Notification access/.test($('confirm-message').textContent) && /Nothing is sent/.test($('confirm-message').textContent);
        const notYet = calls.notif.length === 0;
        await confirmOk(); await wait(200);
        const ok = consent && notYet && calls.notif[0] && calls.notif[0].enabled && calls.notif[0].apps.join() === 'combank.com.combankdigital' && calls.opened.includes('ntf');
        delete window.Capacitor;
        return ok || `consent ${consent}, waited for consent ${notYet}, set ${JSON.stringify(calls.notif)}, opened ${calls.opened}`;
    });

    await T('Bank connections: pause, delete records and disconnect really stop and remove data', async () => {
        const { calls } = fakeBankPlugin({});
        await g('setBankPaused')(true);
        const pausedOk = calls.paused[0] === true && $('bank-overall').textContent === 'Paused';
        await g('setBankPaused')(false);
        g('smsTake')([smsMsg('del-1', 'LKR 300.00 POS purchase at CARGILLS on card ending 4321', NOW)]);
        g('deleteDetectionRecords')(); await confirmOk(); await wait(200);
        const withRef = s().transactions.filter((t) => t.bank && (t.bank.ref || t.bank.last4 || t.bank.bodyKeys)).length;
        const deleted = calls.deleted === 1 && g('smsQueue').length === 0 && withRef === 0;
        g('disconnectBank')(); await confirmOk(); await wait(600);
        if (g('isConfirmOpen')()) $('btn-confirm-cancel').click();
        const p = JSON.parse(localStorage.getItem('VELA_SMS') || '{}');
        const disc = calls.disconnected === 1 && !p.enabled && !p.notifEnabled;
        delete window.Capacitor;
        freshEngine();
        return (pausedOk && deleted && disc) || `paused ${pausedOk}, deleted ${deleted} (still with details ${withRef}), disconnected ${disc}`;
    });

    await T('Activity shows the source; the entry shows reference and "Manual entry" for hand-made ones', async () => {
        const t = s().transactions.find((x) => x.bank && x.bank.sources && x.bank.sources.length === 2);
        g('switchTab')('activity'); await wait(300);
        document.querySelector('[data-activity-status="bank"]').click(); await wait(200);
        const tag = [...document.querySelectorAll('.tx-bank')].map((e) => e.textContent).join('|');
        document.querySelector('[data-activity-status="all"]').click(); await wait(100);
        g('openEditTx')(s().transactions.find((x) => !x.bank && x.type !== 'transfer').id); await wait(300);
        const manual = $('tx-source').textContent;
        await close('modal-tx');
        return (/SMS \+ Notification/.test(tag) && /Manual entry/.test(manual) && !!t) || `tags ${tag}, manual "${manual}"`;
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
        const n = scheduled.find((x) => x.extra && x.extra.payKey === 'tx:wait-3' && x.ongoing);
        s().transactions = s().transactions.filter((t) => t.id !== 'wait-3');
        return (n && n.ongoing === true && n.autoCancel === false) || `notification ${JSON.stringify(n)}`;
    });

    await T('Payments: Home card, pop-up on open, fixed expense paid with "Not yet" / "Yes"', async () => {
        const y = iso(addDays(new Date(), -2));
        s().recurring.push({ id: 'pay-bill', type: 'expense', name: 'Boarding fee', amount: 12000, currency: 'LKR', category: 'Rent', frequency: 'monthly', nextDate: y, anchorDay: new Date(y).getDate(), autoLog: false, accountId: 'acc-cash', createdAt: 1 });
        g('saveState')(); g('switchTab')('dashboard'); await wait(400);
        const card = $('due-section');
        const shows = !card.hidden && /overdue/i.test($('pay-summary').textContent) && (!!card.querySelector('[data-pay="bill:pay-bill"]') || !!card.querySelector('.pay-more'));
        (0, eval)('payPopupShownAt = 0');
        await g('showPaymentsPopup')(); await wait(400);
        const popup = g('isSheetOpen')('modal-payments') && /Boarding fee/.test($('pay-popup-list').innerText);
        // "Not yet" keeps it unpaid.
        document.querySelector('#pay-popup-list [data-pay="bill:pay-bill"]').click(); await wait(200);
        $('btn-confirm-cancel').click(); await wait(200);
        const stillUnpaid = s().recurring.find((b) => b.id === 'pay-bill').nextDate === y;
        // "Yes" pays it today, keeps the due date, moves the bill to next month.
        document.querySelector('#pay-popup-list [data-pay="bill:pay-bill"]').click(); await wait(200);
        await confirmOk();
        const bill = s().recurring.find((b) => b.id === 'pay-bill');
        const tx = s().transactions.find((t) => t.recurringId === 'pay-bill');
        const ok = shows && popup && stillUnpaid && tx && tx.date === today && tx.dueDate === y && bill.nextDate > today && !g('isSheetOpen')('modal-payments');
        s().recurring = s().recurring.filter((b) => b.id !== 'pay-bill');
        return ok || `card ${shows}, popup ${popup}, not-yet kept ${stillUnpaid}, paid ${tx && tx.date}/${tx && tx.dueDate}, next ${bill.nextDate}`;
    });

    await T('Reminders stay: rescheduling never cancels an unpaid reminder; paying cancels it', async () => {
        const later = iso(addDays(new Date(), 3));
        s().transactions.push({ id: 'keep-1', type: 'expense', desc: 'Insurance', amount: 9000, currency: 'LKR', category: 'Other', date: later, note: '', createdAt: 9, recurringId: null, accountId: 'acc-cash', receipt: null, fixed: true, pending: true });
        const cancelled = [];
        let scheduled = [];
        window.Capacitor = { isNativePlatform: () => true, Plugins: { LocalNotifications: {
            checkPermissions: async () => ({ display: 'granted' }), requestPermissions: async () => ({ display: 'granted' }), createChannel: async () => {},
            cancel: async ({ notifications }) => { cancelled.push(...notifications.map((n) => n.id)); }, schedule: async (o) => { scheduled = o.notifications; }
        } } };
        s().config.reminders = true;
        await g('scheduleReminders')();
        const ids = g('reminderIdsFor')('tx:keep-1');
        const first = scheduled.filter((n) => ids.includes(n.id));
        await g('scheduleReminders')(); // e.g. the app opened again
        const wipedOnReschedule = cancelled.filter((id) => ids.includes(id)).length;
        g('confirmTx')('keep-1'); await wait(100);
        await g('scheduleReminders')();
        const cancelledOnPay = ids.every((id) => cancelled.includes(id));
        delete window.Capacitor;
        s().config.reminders = false;
        const persistent = first.filter((n) => n.ongoing && n.autoCancel === false).length;
        return (first.length === 3 && persistent === 2 && wipedOnReschedule === 0 && cancelledOnPay) || `reminders ${first.length}, persistent ${persistent}, cancelled on reschedule ${wipedOnReschedule}, cancelled when paid ${cancelledOnPay}`;
    });

    await T('Activity filters: paid, unpaid, upcoming, overdue, from bank', async () => {
        s().transactions.push({ id: 'f-up', type: 'expense', desc: 'Future thing', amount: 100, currency: 'LKR', category: 'Other', date: iso(addDays(new Date(), 40)), note: '', createdAt: 1, recurringId: null, accountId: 'acc-cash', receipt: null, pending: true });
        s().transactions.push({ id: 'f-od', type: 'expense', desc: 'Old unpaid', amount: 100, currency: 'LKR', category: 'Other', date: iso(addDays(new Date(), -40)), note: '', createdAt: 1, recurringId: null, accountId: 'acc-cash', receipt: null, pending: true });
        g('switchTab')('activity'); await wait(300);
        const rows = async (v) => { document.querySelector(`[data-activity-status="${v}"]`).click(); await wait(200); return [...document.querySelectorAll('#activity-entries .tx-title')].map((e) => e.textContent); };
        const up = await rows('upcoming');
        const od = await rows('overdue');
        const un = await rows('unpaid');
        const bk = await rows('bank');
        const pd = await rows('paid');
        await rows('all');
        s().transactions = s().transactions.filter((t) => !['f-up', 'f-od'].includes(t.id));
        return (up.includes('Future thing') && !up.includes('Old unpaid') && od.includes('Old unpaid') && !od.includes('Future thing') && un.includes('Future thing') && un.includes('Old unpaid') && bk.length > 0 && !pd.includes('Old unpaid'))
            || `upcoming ${up}, overdue ${od}, unpaid ${un.length}, bank ${bk.length}, paid has old ${pd.includes('Old unpaid')}`;
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
        const ok = calls.includes(900001) && (calls.includes(g('hashToInt')(slt.id)) || g('reminderIdsFor')(`bill:${slt.id}`).some((id) => calls.includes(id)));
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
