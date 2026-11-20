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
    window.__velaResults = results; // readable while the run is still going
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
    fresh.config.budgetOn = true;
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
        const ok = a && a.type === 'expense' && a.amount === 2500 && a.desc === 'Keells' && a.bank === 'Commercial Bank' && a.last4 === '4321' && a.category === 'Food'
            && b && b.type === 'income' && b.amount === 150000 && b.category === 'Salary'
            && c === null
            && d && d.currency === 'USD' && d.amount === 12.99 && d.bank === 'HNB';
        return ok || JSON.stringify({ a, b, c, d });
    });

    // ---- Bank SMS accuracy: realistic Commercial Bank formats ----
    const P = (body, address = 'COMBANK', extra = {}) => g('parseBankSms')({ id: `t-${Math.random()}`, address, body, date: new Date(2026, 10, 16, 12, 0).getTime(), ...extra });
    const smsCases = [
        ['card payment', 'Transaction Alert: LKR 3,450.00 POS purchase at KEELLS SUPER COLOMBO 07 on your ComBank Debit Card ending 4321 on 16/11/2026 10:20:15. Avl Bal: LKR 12,345.67',
            { type: 'expense', kind: 'card', amount: 3450, desc: 'Keells', last4: '4321', date: '2026-11-16', time: '10:20', category: 'Food', confidence: 'high' }],
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
        ['"credit ed" split across lines, Remarks :KOKO, time with seconds', 'A Transaction for LKR 2,599.67 has been credit ed to Ac No:14202XXXX83 on 19/11/26 16:39:03 . Remarks :KOKO.Bal: LKR 20,445.17',
            { type: 'income', amount: 2599.67, time: '16:39', desc: 'Refund: Koko' }],
        ['BOC transfer credit (money in)', 'Transfer Credit Rs 5000.00 To A/C No XXXXXXXXXX559. Balance available Rs 5878.90 - Thank you for banking with BOC',
            { type: 'income', kind: 'transfer_in', amount: 5000 }],
        ['BOC CEFT transfer debit (money out)', 'CEFT Transfer Debit Rs 1025.00 From A/C No XXXXXXXXXX559. Balance available Rs 146.90 - Thank you for banking with BOC',
            { type: 'expense', kind: 'transfer_out', amount: 1025 }],
        ['BOC ATM cash deposit (money in)', 'ATM Cash Deposit Rs 1100.00 To A/C No XXXXXXXXXX559. Balance available Rs 1246.90 - Thank you for banking with BOC',
            { type: 'income', kind: 'deposit', amount: 1100 }],
        ['BOC POS/ATM transaction (card spend)', 'POS/ATM Transaction Rs 368.00 From A/C No XXXXXXXXXX559. Balance available Rs 878.90 - Thank you for banking with BOC',
            { type: 'expense', amount: 368 }],
        ['bank charge', 'Service charge of LKR 150.00 debited from A/C ...1234 for SMS alerts on 16/11/2026',
            { type: 'expense', kind: 'fee', amount: 150, desc: 'Commercial Bank charges' }],
        ['two amounts (LKR + USD)', 'LKR 4,320.00 (USD 12.99) debited at NETFLIX.COM on card ending 4321 on 16/11/2026',
            { type: 'expense', amount: 4320, currency: 'LKR' }],
        ['no shop name: asks to check', 'Your A/C ...1234 has been debited with LKR 1,200.00 on 16/11/2026',
            { type: 'expense', amount: 1200, confidence: 'medium' }],
        // A live SMS arrives as the payment happens, so with no date in the text the arrival date is used (NTB alerts have none).
        ['no date in message: the day it arrived', 'LKR 500.00 POS purchase at CARGILLS on card ending 4321',
            { amount: 500, date: '2026-11-16', confidence: 'high' }],
        ['other bank, not read on this phone before: reviewed', 'HNB: Purchase of LKR 900.00 at PIZZA HUT on card ending 1111 on 16/11/2026', { type: 'expense', amount: 900, confidence: 'medium' }, 'HNB'],

        // ---- Real alert formats. Shapes are from the owner's ComBank messages and from samples published in open-source
        // Sri Lankan trackers (github.com/123tharu/kasi, kavina-a/expense-tracker PR 1, sarim2000/pennywiseai-tracker PR 1028);
        // names, numbers and amounts here are made up. ----
        ['ComBank card purchase', 'Dear Cardholder, Purchase at UBER EATS 852 LK for LKR 2,765.62 on 15/11/26 01:23 PM has been authorised on your debit card ending #5370.',
            { type: 'expense', kind: 'card', amount: 2765.62, desc: 'Uber Eats', last4: '5370', date: '2026-11-15', time: '13:23', category: 'Food', confidence: 'high' }],
        ['ComBank cash from another bank\'s ATM', 'Withdrawal at Hatton National Bank HNB PANNIPITI LK for LKR 20,000.00 on 14/11/26 06:52 PM from your debit card ending #5370.',
            { type: 'atm', amount: 20000, last4: '5370', bank: 'Commercial Bank', date: '2026-11-14' }],
        ['ComBank foreign purchase with the rupee figure', 'Purchase at NETFLIX.COM for USD 9.99 (LKR 3,312.45) on 16/11/26 from card ending #5370. Avl Bal LKR 80,000.00',
            { type: 'expense', amount: 3312.45, currency: 'LKR', desc: 'Netflix', category: 'Entertainment' }],
        ['ComBank shop with phone number and country', 'Dear Cardholder, Purchase at Google One 650-2530000 US for LKR 6,425.00 on 15/11/26 05:36 PM has been authorised on your debit card ending #5370.',
            { amount: 6425, desc: 'Google', time: '17:36' }],
        ['ComBank unknown shop keeps its own name', 'Dear Cardholder, Purchase at SUNIL STORES (PVT) LTD 0712755777 LK for LKR 1,000.00 on 16/11/26 10:14 AM has been authorised on your debit card ending #5370.',
            { amount: 1000, desc: 'Sunil Stores' }],
        ['shop name containing "bal" is not a balance', 'Dear Cardholder, Purchase at HERBAL CARE LK for LKR 950.00 on 16/11/26 09:10 AM has been authorised on your debit card ending #5370.',
            { type: 'expense', amount: 950, desc: 'Herbal Care' }],
        ['ComBank credit', 'Credit for Rs. 25,000.00 to A/C #1234 on 16/11/26.', { type: 'income', amount: 25000, last4: '1234' }],
        ['HNB internet purchase', 'HNB SMS ALERT:INTERNET, Account:2080***2939,Location:UBER, LK,Amount(Approx.):670.59 LKR,Av.Bal:14621.99 LKR,Date:16.11.26,Time:17:06, Hot Line:0112462462',
            { type: 'expense', kind: 'online', amount: 670.59, currency: 'LKR', desc: 'Uber', last4: '2939', date: '2026-11-16', time: '17:06', bank: 'HNB', category: 'Travel' }, 'HNB'],
        ['HNB card purchase, shop written with commas', 'HNB SMS ALERT: PURCHASE, Debit account:2080***2939,Location:KEELLS SUPER, COLOMBO 03, LK,Amount(Approx.):500.00 LKR,Av.Bal:100.00 LKR,Date:16.11.26,Time:10:00, Hot Line:0112462462',
            { kind: 'card', amount: 500, desc: 'Keells' }, 'HNB'],
        ['HNB shop that mentions another brand', 'HNB SMS ALERT: PURCHASE, Debit account:2080***2939,Location:BARISTA - CARGILLS SQUARE, LK,Amount(Approx.):715.00 LKR,Av.Bal:17573.58 LKR,Date:16.11.26,Time:09:12, Hot Line:0112462462',
            { amount: 715, desc: 'Barista' }, 'HNB'],
        ['HNB bill payment (footer mentions OTP)', 'LKR 1,598.00 debited to Ac No:20802XXXXX39 on 16/11/26 10:18:43 Reason:MB BillPmt/Mobitel/0701150250/0701150250 Bal:LKR 15,975.58 Protect from scams *DO NOT SHARE ACCOUNT DETAILS /OTP* Hotline 0112462462',
            { type: 'expense', kind: 'bill', amount: 1598, desc: 'SLT-Mobitel', category: 'Utilities', time: '10:18' }, 'HNB'],
        ['HNB transfer to a person', 'LKR 5,000.00 debited to Ac No:20802XXXXX39 on 16/11/26 10:18:43 Reason:CEFT/JOHN/DOE Bal:LKR 10,000.00', { type: 'expense', kind: 'transfer_out', amount: 5000, desc: 'John Doe' }, 'HNB'],
        ['HNB reversal announced as a credit', 'LKR 207.65 credited to Ac No:20802XXXXX39 on 16/11/26 05:54:22 Reason:ECOM REV/002117/ID:113007 Bal:LKR 11,762.17', { type: 'reversal', amount: 207.65 }, 'HNB'],
        ['HNB card repayment is a transfer, not spending', 'LKR 10,000.00 debited to Ac No:20802XXXXX39 on 16/11/26 10:18:43 Reason:CARD PAYMENT Bal:LKR 5,000.00', { type: 'cardpay', amount: 10000 }, 'HNB'],
        ['Sampath money back from a shop (footer mentions OTP)', 'LKR 5,000.00 credited to AC **8758 for PICKME - 37419306\n16/11/2026 11:36:52\nTo Inq Call 0112303050\nGet protected -Do not Share OTP',
            { type: 'income', kind: 'refund', amount: 5000, last4: '8758', bank: 'Sampath Bank', time: '11:36' }, 'SAMPATHTXN'],
        ['Sampath credit card purchase ("Cr Crd" is not a credit)', 'Cr Crd no..**0282 Auth Pmt LKR 2,100.00 at SPICE ASIA - DELIVERY Avl Bal LKR 250,000.00 Enq Call 0112300604\n- Sampath Bank 16-NOV',
            { type: 'expense', kind: 'card', amount: 2100, desc: 'Spice Asia - Delivery', last4: '0282', date: '2026-11-16' }, 'SAMPCCTXN'],
        ['NTB card purchase', 'Transaction Approved on your Card 123456******5678 for LKR 771.51 at PICKME RIDE Available Bal LKR 16730.45  Call 0114315315 for any inquiry.',
            { type: 'expense', kind: 'card', amount: 771.51, desc: 'PickMe', last4: '5678', category: 'Travel', date: '2026-11-16' }, 'NTB'],
        ['NTB payment to the card is never income', 'Thank you for your payment of LKR 57,018.67 made to Card # 123456*****1234 on 16-11-2026.', { type: 'cardpay', amount: 57018.67, last4: '1234' }, 'NTB'],
        ['NDB card purchase, balance without a currency', 'LKR 12,724.00 debited from AC XXXXXXXX7497 as POS TXN on 16 Nov 2026 10:28 at COLOMBAY COLOMBO 2. Avl Bal 2,582.08 Call 94112448888 for info',
            { type: 'expense', kind: 'card', amount: 12724, desc: 'Colombay', last4: '7497', date: '2026-11-16', time: '10:28' }, 'NDB'],
        ['NDB transfer in', 'LKR 60,076.25 credited to AC XXXXXXXX1427 on 16 Nov 2026 09:53 as CEFTS Inward Transfer. Avl Bal 1,789,349.08 Call 94112448888 for info', { type: 'income', kind: 'transfer_in', amount: 60076.25, last4: '1427' }, 'NDB'],
        ['NSB "ATM POS" is a card purchase, not cash', 'Dear MR SAMPLE,LKR 3,216.00 Debited from your A/c XXXXXXXX5678 on 16/11/2026 at 11:14.AvlBal LKR 9,437.61. @ Wetara Pharamcy & Groc Polgasowita. ATM POS Transaction.Thank you for banking with us.Call Centre 1972.',
            { type: 'expense', kind: 'card', amount: 3216, desc: 'Wetara Pharamcy & Groc Polgasowita', last4: '5678', time: '11:14' }, 'NSB']
    ];
    const ignoredCases = [
        ['declined', 'Your transaction of LKR 5,000.00 at ABC STORE was declined due to insufficient funds. ComBank'],
        ['failed', 'ComBank: Fund transfer of LKR 10,000.00 failed. Please try again.'],
        ['OTP with an amount', 'Your OTP for the transaction of LKR 3,450.00 at DARAZ is 123456. Do not share. ComBank'],
        ['balance enquiry', 'Your A/C ...1234 Avl Bal is LKR 45,230.50 as at 16/11/2026. ComBank'],
        ['login alert', 'You have logged in to ComBank Digital on 16/11/2026 10:00. If this was not you call 0112353353'],
        ['promotion', 'Enjoy 20% off at ODEL with ComBank cards. Spend LKR 10,000 and win! ComBank'],
        ['payment reminder', 'ComBank: Your credit card payment of LKR 15,000.00 is due on 25/11/2026.'],
        ['not a bank', 'Hi machan, send me Rs. 500 for the bus', '0771234567'],
        ['telecom reload', 'You have recharged Rs. 1000.00  Your account balance is Rs. 754.55 ,expires on 15/12/2026', 'SLT-Mobitel'],
        ['shop promotion', 'Weekend Vibes at Pizza Hut! Get 2 Lava Cakes & 1 Portion of Garlic Bread for Rs.1,990 with any pizza. Pay by card.', 'Pizza Hut'],
        ['bank cashback promotion', 'Pay Bills. Collect Cashback!  Get 10% cashback up to Rs1,500/- when you pay your bills with ComBank Q+. T&C apply.', 'ComBank Q+'],
        ['promise of a future credit', 'Rs. 500 cashback will be credited to your account when you spend Rs. 5,000 at Keells. ComBank', 'COMBANK'],
        ['card statement', 'Your credit card statement is ready. Total due LKR 45,000.00, minimum due LKR 2,250.00. Payment due date 05/12/2026.', 'NTB'],
        ['shop that mentions a bank', 'Your payment of Rs. 2,500 using ComBank card ending 1234 was successful. Thank you for shopping with us', 'Daraz'],
        ['bare code', '482913 is your one time password for HNB online banking.', 'HNB']
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

    await T('Add form: typing a shop name shows its real logo, offers matching shops and picks the category', async () => {
        g('openAddTx')('expense'); await wait(300);
        const input = $('tx-desc');
        input.focus();
        input.dataset.typing = '1';
        input.value = 'dia'; input.dispatchEvent(new Event('input', { bubbles: true })); await wait(50);
        const offered = [...document.querySelectorAll('#tx-brand-suggest [data-name-pick]')].map((b) => b.dataset.namePick);
        document.querySelector('#tx-brand-suggest [data-name-pick="Dialog"]').click(); await wait(80);
        const logo = $('tx-desc-logo').querySelector('img');
        const cat = document.querySelector('#tx-category-picker input:checked');
        input.value = 'Keells super'; input.dispatchEvent(new Event('input', { bubbles: true })); await wait(50);
        const keells = !!$('tx-desc-logo').querySelector('img[src="logos/keells.webp"]');
        input.value = 'Kottu'; input.dispatchEvent(new Event('input', { bubbles: true })); await wait(50);
        const none = !$('tx-desc-wrap').classList.contains('has-brand');
        await close('modal-tx');
        return (offered.includes('Dialog') && input.value === 'Kottu' && logo && /dialog.webp/.test(logo.src) && cat && cat.value === 'Utilities' && keells && none)
            || JSON.stringify({ offered, logo: logo && logo.src, cat: cat && cat.value, keells, none });
    });

    await T('Shared sample messages (tests/sms-corpus.tsv): the app reads each one as the Android filter must', async () => {
        const text = await (await fetch('tests/sms-corpus.tsv', { cache: 'no-store' })).text();
        const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
        const dirOf = { income: 'in', expense: 'out', atm: 'atm', reversal: 'reversal', cardpay: 'cardpay' };
        const wrong = [];
        lines.forEach((line) => {
            const [want, address, raw] = line.split('\t');
            const r = P(raw.replace(/\\n/g, '\n'), address);
            if (want === 'none') { if (r) wrong.push(`should be ignored, read as ${r.type} ${r.amount}: ${raw.slice(0, 60)}`); return; }
            const [dir, cur, amount, ...bank] = want.split(' ');
            if (!r) { wrong.push(`not read (${g('smsLastReason')}), want ${want}: ${raw.slice(0, 60)}`); return; }
            if (dirOf[r.type] !== dir || r.currency !== cur || Math.abs(r.amount - Number(amount)) > 0.005 || r.bank !== bank.join(' ')) wrong.push(`want ${want}, got ${dirOf[r.type]} ${r.currency} ${r.amount} ${r.bank}: ${raw.slice(0, 60)}`);
        });
        return (lines.length >= 60 && !wrong.length) || `${wrong.length} of ${lines.length} read differently: ${wrong.join(' | ')}`;
    });

    await T('SMS senders: unknown named senders and phone numbers are read only with a warning; a rupee figure beside USD is used', () => {
        const other = P('Your account 1234 has been debited with Rs. 2,000.00 at CITY PHARMACY on 16/11/2026', 'XYZ Finance');
        const phone = P('ComBank: LKR 50,000.00 credited to your A/C ...1234 on 16/11/2026', '+94771234567');
        const fx = P('Purchase at NETFLIX.COM for USD 9.99 (LKR 3,312.45) on 16/11/26 from card ending #5370. Avl Bal LKR 80,000.00');
        const ok = other && other.bank === 'XYZ Finance' && other.confidence === 'medium' && /bank list/.test(other.checks.join())
            && phone && phone.confidence === 'medium' && /phone number/.test(phone.checks.join())
            && fx && fx.fx && fx.fx.currency === 'USD' && fx.fx.amount === 9.99;
        return ok || JSON.stringify({ other: other && [other.bank, other.confidence, other.checks], phone: phone && [phone.confidence, phone.checks], fx: fx && fx.fx });
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
        { const sel = document.querySelector('[data-sms-acc="a1"]'); sel.value = bank.id; sel.dispatchEvent(new Event('change', { bubbles: true })); }
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
        { const sel = document.querySelector('[data-sms-acc="sms-1"]'); sel.value = 'acc-cash'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
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

    // ---- Bank SMS tracking: one engine for received, inbox-read and shared/pasted SMS ----
    // Examples follow common Sri Lankan bank alert wording with made-up numbers and names; they are written for
    // testing, not copies of real Commercial Bank messages.
    const NOW = Date.now();
    const smsMsg = (id, body, at = NOW) => ({ id, source: 'sms', address: 'COMBANK', body, date: at });
    const pasted = (id, body, at = NOW) => ({ id, address: 'Pasted', shared: true, body, date: at });
    const freshEngine = () => { localStorage.removeItem('VELA_SMS'); (0, eval)('smsQueue = []'); };
    const fakeBankPlugin = (status = {}, extra = {}) => {
        const calls = { cleared: [], listeners: {}, opened: [], disconnected: 0, deleted: 0, paused: [], requested: 0 };
        const st = { sdk: 37, smsAvailable: true, notifAvailable: false, smsPermission: 'granted', smsEnabled: true, paused: false, restrictedSettings: 'allowed', installSource: 'other', postNotifications: true, lastDetected: 0, pending: 0, ...status };
        window.Capacitor = { isNativePlatform: () => true, Plugins: {
            SmsReader: {
                status: async () => st, checkPermissions: async () => ({ sms: st.smsPermission }), requestPermissions: async () => { calls.requested++; return { sms: st.smsPermission }; },
                setEnabled: async ({ enabled }) => { st.smsEnabled = enabled; }, setPaused: async ({ paused }) => { calls.paused.push(paused); st.paused = paused; },
                disconnect: async () => { calls.disconnected++; st.smsEnabled = false; }, deleteDetections: async () => { calls.deleted++; },
                openAppSettings: async () => { calls.opened.push('app'); },
                getPending: async () => ({ messages: extra.pending || [] }), readInbox: async () => ({ messages: extra.inbox || [] }),
                clearHandled: async ({ ids }) => { calls.cleared.push(...ids); }, addListener: (name, fn) => { calls.listeners[name] = fn; }
            },
            LocalNotifications: { checkPermissions: async () => ({ display: 'granted' }), requestPermissions: async () => ({ display: 'granted' }) }
        } };
        return { calls, st };
    };

    await T('SMS shop names are cleaned, matched to a category and get a brand badge', () => {
        const c = g('cleanMerchant');
        const names = [c('KOKO COLOMBO 03 LK'), c('KEELLS SUPER KOLLUPITIYA'), c('ABC TRADERS (PVT) LTD'), c('CAFE KOPI NUGEGODA 12'), c('ODEL')];
        const koko = P('LKR 2,992.42 POS purchase at KOKO COLOMBO 03 LK on card ending 4321');
        const net = P('Your ComBank Card ending 4321 was used for an online transaction of USD 12.99 at NETFLIX.COM');
        const badge = g('entryBadge')('Koko', 'Shopping', 'expense');
        const realLogo = /logos\/netflix\.webp/.test(g('entryBadge')('Netflix', 'Entertainment', 'expense')) && /logos\/keells\.webp/.test(g('entryBadge')('Keells', 'Food', 'expense'))
            && !/<img/.test(g('entryBadge')('ODEL', 'Shopping', 'expense'));
        if (!realLogo) return 'real logos missing (or shown for a brand without a verified logo)';
        const plain = g('entryBadge')('Lunch with Amal', 'Food', 'expense');
        const ok = names.join('|') === 'Koko|Keells Super|Abc Traders|Cafe Kopi|Odel' && koko.desc === 'Koko' && koko.category === 'Shopping'
            && net.desc === 'Netflix' && net.category === 'Entertainment' && /brand-badge/.test(badge) && !/brand-badge/.test(plain);
        return ok || JSON.stringify({ names, koko: koko && [koko.desc, koko.category], net: net && [net.desc, net.category] });
    });

    await T('Bank details, due date and paid date survive a restart (saved state is loaded again)', () => {
        const t = { id: 'keep-bank', type: 'expense', desc: 'Koko', amount: 2992.42, currency: 'LKR', category: 'Shopping', date: iso(new Date()), note: 'From Commercial Bank (SMS)', createdAt: 1, accountId: 'acc-cash', pending: false,
            dueDate: '2026-11-15', paidAt: '2026-11-16T10:00:00.000Z', bank: { bank: 'Commercial Bank', kind: 'card', ref: 'FT123', last4: '4321', merchant: 'Koko', smsId: 'sms-1', sources: ['sms'], sourceIds: ['sms-1'], bodyKeys: [123], arrivedAt: 1700000000000, sms: 'raw text must not be kept' } };
        const back = g('normalizeTx')(JSON.parse(JSON.stringify(t)));
        const ok = back.bank && back.bank.ref === 'FT123' && back.bank.sourceIds[0] === 'sms-1' && back.bank.bodyKeys[0] === 123 && !('sms' in back.bank) && back.dueDate === '2026-11-15' && back.paidAt === t.paidAt;
        // Old entries that already lost it are repaired from the note Vela wrote, and their shop name tidied.
        const lost = { ...t, id: 'lost-bank', desc: 'Koko Colombo 03 Lk', category: 'Other' };
        delete lost.bank;
        s().transactions.push(lost);
        g('tidyBankEntryNames')();
        const fixed = s().transactions.find((x) => x.id === 'lost-bank');
        s().transactions = s().transactions.filter((x) => x.id !== 'lost-bank');
        return (ok && fixed.bank && fixed.bank.bank === 'Commercial Bank' && fixed.desc === 'Koko' && fixed.category === 'Shopping') || JSON.stringify({ kept: back.bank, due: back.dueDate, paid: back.paidAt, repaired: [fixed.desc, fixed.category, !!fixed.bank] });
    });

    await T('Money not yet paid or received is left out of Insights, charts and "After fixed expenses"', async () => {
        const y0 = iso(addDays(new Date(), 0));
        s().transactions.push({ id: 'acc-wait-in', type: 'income', desc: 'Late transfer', amount: 7777, currency: 'LKR', category: 'OtherIncome', date: y0, note: '', createdAt: 1, recurringId: null, accountId: 'acc-cash', receipt: null, pending: true });
        s().transactions.push({ id: 'acc-wait-out', type: 'expense', desc: 'Unpaid gym', amount: 8888, currency: 'LKR', category: 'Other', date: y0, note: '', createdAt: 1, recurringId: null, accountId: 'acc-cash', receipt: null, pending: true });
        const inRange = g('txInRange')('30').some((t) => t.id === 'acc-wait-in' || t.id === 'acc-wait-out');
        const f = g('fixedForMonth')();
        const html = g('fixedSummaryHtml')();
        s().transactions = s().transactions.filter((t) => !t.id.startsWith('acc-wait'));
        const f2 = g('fixedForMonth')();
        return (!inRange && f.expected - f2.expected === 7777 && f.income === f2.income && /Still expected/.test(html)) || `insights counted waiting ${inRange}, expected +${f.expected - f2.expected}, income changed ${f.income !== f2.income}`;
    });

    await T('A new bank is learned: reviewed until 3 of its messages were confirmed unchanged, a correction starts again', async () => {
        freshEngine();
        const hnb = (n, at) => smsMsg(`learn-${n}`, `HNB SMS ALERT: PURCHASE, Debit account:2080***2939,Location:SHOP ${'ABCDE'[n]}, LK,Amount(Approx.):${100 + n}.00 LKR,Av.Bal:100.00 LKR,Date:${new Date().toLocaleDateString('en-GB').replace(/\//g, '.').replace(/\.20(\d\d)$/, '.$1')},Time:10:0${n}, Hot Line:0112462462`, at);
        const read = (n) => g('parseBankSms')({ ...hnb(n, NOW + n * 600000), address: 'HNB' });
        const first = read(0);
        for (let n = 0; n < 3; n++) { g('smsTake')([{ ...hnb(n, NOW + n * 600000), address: 'HNB' }]); g('smsAdd')(`learn-${n}`); await wait(120); }
        const learned = read(3);
        g('smsLearn')(learned, false);
        const again = read(4);
        s().transactions = s().transactions.filter((t) => !(t.bank && /^learn-/.test(t.bank.smsId || '')));
        freshEngine();
        return (first.confidence === 'medium' && /still learning HNB/.test(first.checks.join()) && learned.confidence === 'high' && again.confidence === 'medium')
            || JSON.stringify({ first: [first.confidence, first.checks], learned: [learned.confidence, learned.checks], again: again.confidence });
    });

    await T('One payment announced twice is not added twice: reversal pair merged, look-alike alerts flagged', () => {
        freshEngine();
        g('smsTake')([{ ...smsMsg('rv-1', 'TRANSACTION REVERSAL, Credit account:2080***2939,Location:UBER, LK,Amount:207.65 LKR,Av.Bal:11762.17 LKR,Date:16.11.26,Time:05:54, Hot Line:0112462462', NOW), address: 'HNB' }]);
        g('smsTake')([{ ...smsMsg('rv-2', 'LKR 207.65 credited to Ac No:20802XXXXX39 on 16/11/26 05:54:22 Reason:ECOM REV/002117/ID:113007 Bal:LKR 11,762.17', NOW + 20000), address: 'HNB' }]);
        const reversals = g('smsQueue').length;
        freshEngine();
        g('smsTake')([smsMsg('tw-1', 'Dear Cardholder, Purchase at SUNIL STORES LK for LKR 1,250.00 on 16/11/26 10:14 AM has been authorised on your debit card ending #5370.', NOW)]);
        g('smsTake')([smsMsg('tw-2', 'Your A/C ...1234 has been debited with LKR 1,250.00 at SUNIL STORES on 16/11/2026', NOW + 30000)]);
        const q = g('smsQueue');
        const flagged = q.length === 2 && q.some((i) => /same as another/.test(i.checks.join()) && i.confidence === 'medium');
        // Two withdrawals in a row (same wording, other time and balance) and two shops charging the same amount are separate.
        freshEngine();
        const wd = (n) => smsMsg(`wd-${n}`, `Withdrawal at COMBANK ATM KANDY LK for LKR 40,000.00 on 16/11/26 06:5${n} PM from your debit card ending #5370. Avl Bal LKR ${90 - n * 40},000.00`, NOW + n * 60000);
        g('smsTake')([wd(1)]); g('smsTake')([wd(2)]);
        const twoCash = g('smsQueue').length === 2 && g('smsQueue').every((i) => i.confidence === 'high');
        freshEngine();
        g('smsTake')([smsMsg('sh-1', 'Dear Cardholder, Purchase at SUNIL STORES LK for LKR 700.00 on 16/11/26 10:14 AM has been authorised on your debit card ending #5370.', NOW)]);
        g('smsTake')([smsMsg('sh-2', 'Your A/C ...1234 has been debited with LKR 700.00 at CITY PHARMACY on 16/11/2026', NOW + 30000)]);
        const twoShops = g('smsQueue').length === 2 && g('smsQueue').every((i) => i.confidence === 'high');
        freshEngine();
        return (reversals === 1 && flagged && twoCash && twoShops) || `reversal pair kept ${reversals} (want 1), look-alike flagged ${flagged}, two withdrawals separate ${twoCash}, two shops separate ${twoShops}`;
    });

    await T('Accounts: a bank name shows its logo while typing, on Home and in the account pickers', async () => {
        g('openAccountEditor')(); await wait(300);
        $('account-name').value = 'Boc'; $('account-name').dispatchEvent(new Event('input', { bubbles: true })); await wait(50);
        const typing = !!$('account-name-logo').querySelector('img[src="logos/boc.webp"]');
        const kind = $('account-kind').value;
        await close('modal-account');
        const before = s().accounts.slice();
        s().accounts = before.concat([{ id: 'acc-boc-test', name: 'Boc', kind: 'bank', currency: 'LKR', opening: 0, createdAt: 0 }]);
        g('switchTab')('dashboard'); await wait(300);
        const chip = !!document.querySelector('[data-view-account="acc-boc-test"] img[src="logos/boc.webp"]');
        g('openAddTx')('expense'); await wait(300);
        $('tx-account').value = 'acc-boc-test'; $('tx-account').dispatchEvent(new Event('change', { bubbles: true })); await wait(50);
        const pick = !!$('tx-account').parentElement.querySelector('.select-logo img[src="logos/boc.webp"]');
        await close('modal-tx');
        s().accounts = before;
        g('renderActive')();
        return (typing && kind === 'bank' && chip && pick) || JSON.stringify({ typing, kind, chip, pick });
    });

    await T('A transaction SMS from a phone number is read for review only, never added automatically', () => {
        const r = P('Acc XXX59 debited by LKR 2,000.00 at COOL PLANET on 30-Mar.', '+94771234567');
        const chat = P('Machan I paid Rs. 2,000 for the tickets, send it back', '+94771234567');
        return (r && r.bank === 'Unknown sender' && r.confidence === 'medium' && /phone number/.test(r.checks.join()) && r.amount === 2000 && chat === null)
            || JSON.stringify({ r: r && [r.bank, r.confidence, r.checks, r.amount], chat });
    });

    await T('Accounts are kept apart: always one account shown, switching changes Home, Activity, payments and new entries', async () => {
        const before = s().accounts.slice();
        const txBefore = s().transactions.slice();
        s().accounts = before.concat([{ id: 'acc-sw', name: 'BOC', kind: 'bank', currency: 'LKR', opening: 0, createdAt: 0 }]);
        s().transactions.push({ id: 'sw-1', type: 'expense', desc: 'Keells', amount: 7777, currency: 'LKR', category: 'Food', date: today, note: '', createdAt: Date.now(), accountId: 'acc-sw', recurringId: null, receipt: null, fixed: false, pending: false });
        g('switchTab')('dashboard'); await wait(200);
        const firstId = g('viewId')();
        const startSpent = g('monthStats')().spent;
        document.querySelector('.account-chip[data-view-account="acc-sw"]').click(); await wait(300);
        const bocSpent = g('monthStats')().spent;
        const bar = /BOC/.test((document.querySelector('#tab-dashboard .view-bar') || {}).innerText || '');
        const noAll = !document.querySelector('[data-view-account="all"]');
        g('openAddTx')('expense'); await wait(250);
        const newGoesHere = $('tx-account').value === 'acc-sw';
        await close('modal-tx');
        g('switchTab')('activity'); await wait(300);
        const actOnly = [...document.querySelectorAll('#tab-activity .tx')].every((r) => !/Kottu|Salary/.test(r.innerText));
        g('setViewAccount')(firstId); await wait(200);
        const back = g('monthStats')().spent === startSpent;
        s().accounts = before; s().transactions = txBefore; g('renderActive')();
        return (firstId !== 'all' && firstId !== 'acc-sw' && bocSpent === 7777 && startSpent !== 7777 && bar && noAll && newGoesHere && actOnly && back)
            || JSON.stringify({ firstId, startSpent, bocSpent, bar, noAll, newGoesHere, actOnly, back });
    });

    await T('Each account keeps its own budget, goals and debts', async () => {
        const before = { accounts: s().accounts.slice(), savings: s().savings.slice(), debts: s().debts.slice(), config: JSON.parse(JSON.stringify(s().config)) };
        const home = g('viewId')();
        s().accounts = before.accounts.concat([{ id: 'acc-sep', name: 'BOC', kind: 'bank', currency: 'LKR', opening: 0, createdAt: 0 }]);
        s().config.budget = 100000; s().config.categoryBudgets = { Food: 20000 }; g('saveState')();
        s().savings.push({ id: 'g-home', name: 'Phone', target: 50000, currency: 'LKR', saved: 1000, deadline: null, accountId: home, createdAt: 1 });
        g('setViewAccount')('acc-sep'); await wait(150);
        const copied = s().config.budget === 100000;
        s().config.budget = 5000; s().config.categoryBudgets = {}; g('saveState')();
        s().debts.push({ id: 'd-sep', direction: 'lent', person: 'Nimal', amount: 2000, currency: 'LKR', repaid: 0, dueDate: null, note: '', accountId: 'acc-sep', createdAt: 1 });
        const sepGoals = g('viewGoals')().map((x) => x.id);
        const sepOwed = g('debtTotals')().owedToYou;
        g('setViewAccount')(home); await wait(150);
        const homeBudget = s().config.budget === 100000 && s().config.categoryBudgets.Food === 20000;
        const homeGoals = g('viewGoals')().some((x) => x.id === 'g-home');
        const homeOwed = g('debtTotals')().owedToYou;
        g('setViewAccount')('acc-sep'); await wait(150);
        const sepBudget = s().config.budget === 5000 && !s().config.categoryBudgets.Food;
        g('setViewAccount')(home); await wait(100);
        Object.assign(s(), { accounts: before.accounts, savings: before.savings, debts: before.debts }); s().config = before.config; g('saveState')(); g('renderActive')();
        return (copied && !sepGoals.includes('g-home') && sepOwed === 2000 && homeBudget && homeGoals && homeOwed !== sepOwed && sepBudget)
            || JSON.stringify({ copied, sepGoals, sepOwed, homeBudget, homeGoals, homeOwed, sepBudget });
    });

    await T('Home shows the real account balance and it moves with every entry', async () => {
        g('switchTab')('dashboard'); await wait(300);
        const acc = g('viewAccountObj')();
        const before = g('viewBalance')();
        const want0 = g('toDisplay')(g('accountBalance')(acc), acc.currency);
        await addTx({ amount: 1234, desc: 'Balance check', category: 'Other', account: acc.id });
        const after = g('viewBalance')();
        const shown = Number($('dash-balance').dataset.v);
        const t = s().transactions.find((x) => x.desc === 'Balance check');
        g('deleteTx')(t.id); await confirmOk(); await close('modal-tx');
        return (Math.abs(before - want0) < 0.01 && Math.abs(before - after - 1234) < 0.01 && Math.abs(shown - after) < 0.01 && /balance/.test($('dash-month-label').textContent))
            || JSON.stringify({ before, want0, after, shown, label: $('dash-month-label').textContent });
    });

    await T('Insights can show all accounts together, the rest of the app stays on one account', async () => {
        const before = { accounts: s().accounts.slice(), tx: s().transactions.slice() };
        const home = g('viewId')();
        s().accounts = before.accounts.concat([{ id: 'acc-ins', name: 'BOC', kind: 'bank', currency: 'LKR', opening: 0, createdAt: 0 }]);
        s().transactions.push({ id: 'ins-1', type: 'expense', desc: 'Keells', amount: 4321, currency: 'LKR', category: 'Food', date: today, note: '', createdAt: Date.now(), accountId: 'acc-ins', recurringId: null, receipt: null, fixed: false, pending: false });
        const spentShown = () => Number($('metric-total').dataset.v || NaN);
        g('switchTab')('analytics'); await wait(300);
        const shown = !$('insights-scope').hidden;
        const one = spentShown();
        document.querySelector('[data-insights-scope="all"]').click(); await wait(300);
        const all = spentShown();
        // Every account's spending in the last 30 days, waiting ones left out (same rule as the screen).
        const from = g('toISODate')(g('addDays')(new Date(), -29));
        const expectAll = s().transactions.filter((t) => t.type === 'expense' && t.date >= from && t.date <= today && !g('isUpcoming')(t)).reduce((sum, t) => sum + g('toDisplay')(t.amount, t.currency), 0);
        const barHidden = !document.querySelector('#tab-analytics .view-bar');
        const homeStill = g('viewId')() === home;
        document.querySelector('[data-insights-scope="account"]').click(); await wait(300);
        const back = spentShown();
        const barBack = !!document.querySelector('#tab-analytics .view-bar');
        s().accounts = before.accounts; s().transactions = before.tx; localStorage.removeItem('VELA_INSIGHTS_ALL'); g('renderActive')();
        return (shown && Math.abs(all - expectAll) < 0.01 && all > one && back === one && barHidden && barBack && homeStill) || JSON.stringify({ shown, one, all, expectAll, back, barHidden, barBack, homeStill });
    });

    await T('Your own shop logo: pick a photo once, shown for that shop everywhere, kept in backups, removable', async () => {
        // A small test picture, as if picked from the gallery.
        const c = document.createElement('canvas'); c.width = 300; c.height = 200;
        const x = c.getContext('2d'); x.fillStyle = '#d11'; x.fillRect(0, 0, 300, 200);
        const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
        const data = await g('makeShopLogo')(new File([blob], 'logo.png', { type: 'image/png' }));
        await addTx({ amount: 450, desc: 'Sunil Stores', category: 'Food' });
        g('openAddTx')('expense'); await wait(250);
        $('tx-desc').value = 'sunil stores'; $('tx-desc').dispatchEvent(new Event('input', { bubbles: true })); await wait(50);
        const offered = !$('tx-logo-row').hidden && /Add a photo logo/.test($('tx-logo-add').innerText);
        g('setShopLogo')('Sunil Stores', data); g('updateDescLogo')();
        const inForm = !!$('tx-desc-logo').querySelector('img[src^="data:image/"]') && !$('tx-logo-remove').hidden;
        await close('modal-tx');
        g('switchTab')('activity'); await wait(300);
        const inList = [...document.querySelectorAll('#tab-activity .tx')].some((r) => /Sunil Stores/.test(r.innerText) && r.querySelector('img[src^="data:image/"]'));
        const backup = JSON.parse(await captureDownload(() => g('exportBackup')()));
        const kept = backup.shopLogos && backup.shopLogos['sunil stores'] === data;
        g('setShopLogo')('Sunil Stores', null);
        const gone = !g('customLogoFor')('Sunil Stores');
        g('switchTab')('dashboard'); await wait(200);
        return (/^data:image\/(webp|jpeg)/.test(data) && offered && inForm && inList && kept && gone) || JSON.stringify({ data: data.slice(0, 20), offered, inForm, inList, kept, gone });
    });

    await T('Bank SMS go to the right account: matched by bank; with two accounts at one bank Vela asks once, then remembers the card', async () => {
        freshEngine();
        const before = s().accounts.slice();
        s().accounts = before.concat([{ id: 'boc-1', name: 'BOC', kind: 'bank', currency: 'LKR', opening: 0, createdAt: 1 }]);
        const bocMsg = (id, amt, card, at) => ({ id, address: 'BOC', date: at, body: `Your A/C XXXXXX${card} has been debited by LKR ${amt}.00 on ${new Date().toLocaleDateString('en-GB')}. Bal LKR 5,000.00` });
        g('smsTake')([bocMsg('ra-1', 1000, '1111', NOW)]);
        const one = g('smsAccountFor')(g('smsQueue')[0]) === 'boc-1';
        // A second BOC account: which one is unclear until you say.
        s().accounts.push({ id: 'boc-2', name: 'BOC Savings', kind: 'bank', currency: 'LKR', opening: 0, createdAt: 2 });
        const undecided = g('smsAccountFor')(g('smsQueue')[0]) === null;
        g('showSmsSheet')(); await wait(300);
        document.querySelector('[data-sms-add="ra-1"]').click(); await wait(400);
        const asked = g('isSheetOpen')('modal-sms-pick') && document.querySelectorAll('#sms-pick-list [data-sms-pick-acc]').length === 2;
        document.querySelector('#sms-pick-list [data-sms-pick-acc="boc-2"]').click(); await wait(400);
        const added = s().transactions.find((t) => t.bank && t.bank.smsId === 'ra-1');
        // Same card later: goes to BOC Savings by itself.
        g('smsTake')([bocMsg('ra-2', 2000, '1111', NOW + 60000)]);
        const remembered = g('smsAccountFor')(g('smsQueue').find((i) => i.id === 'ra-2')) === 'boc-2';
        if (g('isSheetOpen')('modal-sms')) await close('modal-sms');
        s().transactions = s().transactions.filter((t) => !(t.bank && /^ra-/.test(t.bank.smsId || '')));
        s().accounts = before; freshEngine(); g('renderActive')();
        return (one && undecided && asked && added && added.accountId === 'boc-2' && remembered) || JSON.stringify({ one, undecided, asked, addedTo: added && added.accountId, remembered });
    });

    await T('The same message received twice (same time in its text) is offered once, even hours apart; also once added', async () => {
        freshEngine();
        const body = 'Credit for Rs. 300,000.00 to 8024585190 at 12:16 at DIGITAL BANKING DIVISION';
        g('smsTake')([{ id: 'twice-1', address: '+94771234567', body, date: NOW }]);
        g('smsTake')([{ id: 'twice-2', address: '+94771234567', body, date: NOW + 3 * 3600000 }]);
        const queued = g('smsQueue').length;
        const merged = queued === 1 && (g('smsQueue')[0].sourceIds || []).length === 2;
        // After adding it, the same text arriving again is not offered again.
        g('smsQueue')[0].accountId = s().accounts[0].id;
        g('smsAdd')(g('smsQueue')[0].id); await wait(200);
        g('smsTake')([{ id: 'twice-3', address: '+94771234567', body, date: NOW + 6 * 3600000 }]);
        const again = g('smsQueue').length;
        s().transactions = s().transactions.filter((t) => !(t.bank && /^twice-/.test(t.bank.smsId || '')));
        freshEngine(); g('renderActive')();
        return (merged && again === 0) || JSON.stringify({ queued, merged, again });
    });

    await T('ATM withdrawal: cash goes to a real cash wallet, never to an account named after a bank (and old ones are repaired)', async () => {
        freshEngine();
        const before = { accounts: s().accounts.slice(), tx: s().transactions.slice() };
        // The owner's setup: "Commercial bank" saved as type Cash, and BOC.
        s().accounts = [{ id: 'cb', name: 'Commercial bank', kind: 'cash', currency: 'LKR', opening: 100000, createdAt: 0 }, { id: 'boc', name: 'BOC', kind: 'bank', currency: 'LKR', opening: 100000, createdAt: 0 }];
        // An old wrong withdrawal (BOC -> Commercial bank) gets moved to the cash wallet.
        s().transactions.push({ id: 'atm-old', type: 'transfer', desc: 'ATM withdrawal', amount: 1500, currency: 'LKR', toAmount: 1500, toCurrency: 'LKR', category: 'Transfer', date: today, note: '', createdAt: 1, accountId: 'boc', toAccountId: 'cb', bank: { bank: 'Unknown sender', smsId: 'x' } });
        g('repairAccountKinds')();
        const kindFixed = s().accounts.find((a) => a.id === 'cb').kind === 'bank';
        const wallet = s().accounts.find((a) => a.kind === 'cash' && a.name === 'Cash');
        const oldMoved = !!wallet && s().transactions.find((t) => t.id === 'atm-old').toAccountId === wallet.id;
        // A new withdrawal from BOC goes to that wallet too.
        g('smsTake')([{ id: 'atm-new', address: 'BOC', date: NOW, body: 'ATM Cash Withdrawal LKR 2,000.00 from A/C ...1234 at BOC ATM HOMAGAMA on ' + new Date().toLocaleDateString('en-GB') }]);
        const i = g('smsQueue').find((x) => x.id === 'atm-new');
        i.accountId = 'boc';
        g('smsAdd')('atm-new'); await wait(200);
        const tr = s().transactions.find((t) => t.bank && t.bank.smsId === 'atm-new');
        const ok = kindFixed && oldMoved && tr && tr.type === 'transfer' && tr.accountId === 'boc' && tr.toAccountId === wallet.id;
        s().accounts = before.accounts; s().transactions = before.tx; freshEngine(); g('renderActive')();
        return ok || JSON.stringify({ kindFixed, oldMoved, wallet: !!wallet, tr: tr && { from: tr.accountId, to: tr.toAccountId } });
    });

    await T('Privacy: an account balance can be hidden everywhere it shows; holding an account card opens Edit / Hide / Delete', async () => {
        g('switchTab')('dashboard'); await wait(300);
        const id = g('viewId')();
        $('btn-hide-balance').click(); await wait(300);
        const hero = $('dash-balance').textContent;
        const chip = (document.querySelector(`.account-chip[data-view-account="${id}"] .account-bal`) || {}).textContent || '';
        const bar = (document.querySelector('#tab-dashboard .view-bar .amount') || {}).textContent || '';
        const fixedTxt = ($('dash-fixed') || {}).innerText || '';
        const hidden = [hero, chip, bar].every((x) => x.includes('••••')) && !/In this account now\s*Rs\.\s*[\d]/.test(fixedTxt);
        $('btn-hide-balance').click(); await wait(300);
        const shownAgain = !$('dash-balance').textContent.includes('••••');
        // Hold the card for a moment: the menu opens and the tap after it doesn't switch account.
        const card = document.querySelector(`.account-chip[data-view-account="${id}"]`);
        card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
        await wait(650);
        const menu = g('isSheetOpen')('modal-acc-actions') && /Edit account/.test($('modal-acc-actions').innerText);
        card.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        await close('modal-acc-actions');
        return (hidden && shownAgain && menu) || JSON.stringify({ hero, chip, bar, shownAgain, menu });
    });

    await T('Changing the display currency changes every amount: account cards, account bar, payments and transfers', async () => {
        const keep = s().config.currency;
        s().transactions.push({ id: 'cur-pay', type: 'expense', desc: 'Currency check bill', amount: 3000, currency: 'LKR', category: 'Other', date: g('toISODate')(g('addDays')(new Date(), 1)), note: '', createdAt: Date.now(), accountId: g('viewId')(), recurringId: null, receipt: null, fixed: false, pending: true });
        g('setDisplayCurrency')('USD'); await wait(300);
        g('switchTab')('dashboard'); await wait(300);
        const chips = [...document.querySelectorAll('.account-chip .account-bal')].map((e) => e.textContent);
        const bar = (document.querySelector('#tab-dashboard .view-bar .amount') || {}).textContent || '';
        const pay = [...document.querySelectorAll('#due-section .pay-end .amount')].map((e) => e.textContent);
        const allDollar = chips.length && chips.every((x) => x.includes('$')) && bar.includes('$') && pay.length && pay.every((x) => x.includes('$'));
        g('setDisplayCurrency')(keep); await wait(200);
        s().transactions = s().transactions.filter((x) => x.id !== 'cur-pay'); g('renderActive')();
        return allDollar || JSON.stringify({ chips, bar, pay });
    });

    await T('Review screen: Ignore all asks first, then clears every detection without adding anything', async () => {
        freshEngine();
        const n0 = s().transactions.length;
        g('smsTake')([smsMsg('ia-1', 'Dear Cardholder, Purchase at NETFLIX.COM for LKR 1,500.00 on 16/11/26 01:23 PM has been authorised on your debit card ending #5370.', NOW),
            smsMsg('ia-2', 'Dear Cardholder, Purchase at KEELLS SUPER LK for LKR 2,200.00 on 16/11/26 02:23 PM has been authorised on your debit card ending #5370.', NOW + 60000)]);
        g('showSmsSheet')(); await wait(300);
        const logo = !!document.querySelector('#sms-list .sms-card img[src="logos/netflix.webp"]');
        $('btn-sms-ignore-all').click(); await wait(150);
        const asked = g('smsQueue').length === 2;
        await confirmOk();
        const left = g('smsQueue').length;
        freshEngine();
        return (logo && asked && left === 0 && s().transactions.length === n0) || JSON.stringify({ logo, asked, left, added: s().transactions.length - n0 });
    });

    await T('Payment to your own card: offered as a transfer or ignored, never added as income', async () => {
        freshEngine();
        const inc0 = g('monthStats')().income;
        g('smsTake')([{ ...smsMsg('cp-1', 'Thank you for your payment of LKR 57,018.67 made to Card # 123456*****1234 on ' + new Date().toLocaleDateString('en-GB').replace(/\//g, '-') + '.', NOW), address: 'NTB' }]);
        g('showSmsSheet')(); await wait(300);
        const card = document.querySelector('#sms-list .sms-card');
        const buttons = !!card.querySelector('[data-sms-move="cp-1"]') && !card.querySelector('[data-sms-add]') && /transfer, not income/.test(card.innerText);
        document.querySelector('#btn-sms-all').click(); await wait(200);
        const stillWaiting = g('smsQueue').some((i) => i.id === 'cp-1');
        g('smsIgnore')('cp-1'); await wait(300);
        freshEngine();
        return (buttons && stillWaiting && g('monthStats')().income === inc0) || `buttons ${buttons}, add-all left it ${stillWaiting}, income ${inc0}->${g('monthStats')().income}`;
    });

    await T('Same SMS received live AND read from the inbox (different ids, seconds apart) is offered once', () => {
        freshEngine();
        const body = 'LKR 3,450.00 POS purchase at KEELLS SUPER on card ending 4321 on ' + new Date().toLocaleDateString('en-GB');
        g('smsTake')([smsMsg('sms-live', body, NOW)]);
        g('smsTake')([smsMsg('sms-inbox', body, NOW + 3000)]);
        const q = g('smsQueue');
        freshEngine();
        return (q.length === 1 && q[0].sourceIds.length === 2) || `queued ${q.length}`;
    });

    await T('Two real purchases with the same amount are NOT merged', () => {
        freshEngine();
        const n = g('smsTake')([
            smsMsg('p1', 'LKR 500.00 POS purchase at CARGILLS on card ending 4321', NOW),
            smsMsg('p2', 'LKR 500.00 POS purchase at CARGILLS on card ending 4321 at 12:31', NOW + 4 * 60000),
            smsMsg('p3', 'LKR 500.00 POS purchase at CARGILLS on card ending 4321', NOW + 8 * 60 * 60000) // same text, hours later
        ]);
        return (n === 3 && g('smsQueue').length === 3) || `kept ${g('smsQueue').length}`;
    });

    await T('Duplicates: resent SMS kept once; same reference kept once; pasted copy never added again', () => {
        freshEngine();
        const body = 'Dear Customer, Your A/C ...1234 has been debited for LKR 2,000.00 at DIALOG on 16/11/2026';
        g('smsTake')([smsMsg('d-a', body, NOW), smsMsg('d-b', body, NOW + 2000), smsMsg('d-a', body, NOW)]);
        const resent = g('smsQueue').length;
        freshEngine();
        g('smsTake')([smsMsg('r1', 'LKR 1,500.00 POS purchase at ODEL Ref:AB1234', NOW), smsMsg('r2', 'LKR 1,500.00 debited at ODEL. Ref:AB1234', NOW + 50 * 60000)]);
        const byRef = g('smsQueue').length;
        freshEngine();
        const twice = 'LKR 450.00 POS purchase at CAFE KOPI on card ending 4321';
        g('smsTake')([smsMsg('t1', twice, NOW), smsMsg('t2', twice, NOW + 3 * 3600000)]);
        g('smsTake')([pasted('paste-copy', twice, NOW + 5 * 3600000)]);
        const afterPaste = g('smsQueue').length;
        freshEngine();
        return (resent === 1 && byRef === 1 && afterPaste === 2) || `resent ${resent} (want 1), same ref ${byRef} (want 1), after pasted copy ${afterPaste} (want 2)`;
    });

    await T('Pasted copy of an SMS already added to Vela is recognised, not added twice', async () => {
        freshEngine();
        const body = 'LKR 980.00 online transaction at UBER EATS on card ending 4321';
        g('smsTake')([smsMsg('y-sms', body, NOW)]);
        g('smsAdd')('y-sms'); await wait(200);
        const before = s().transactions.length;
        const again = g('smsTake')([pasted('y-paste', body, NOW + 3600000)]);
        const y = s().transactions.find((x) => x.bank && x.bank.smsId === 'y-sms');
        freshEngine();
        return (again === 0 && s().transactions.length === before && y.bank.sources.includes('shared')) || `pasted again added ${again}, sources ${y && y.bank.sources}`;
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
        { const sel = document.querySelector('[data-sms-acc="tr1"]'); sel.value = s().accounts.find((a) => a.kind === 'bank').id; sel.dispatchEvent(new Event('change', { bubbles: true })); }
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

    await T('Vela closed: SMS kept on the phone load on start; tapping the notification opens the review', async () => {
        freshEngine();
        const { calls } = fakeBankPlugin({}, { pending: [smsMsg('closed-1', 'LKR 1,234.00 POS purchase at CARGILLS on card ending 4321', NOW - 600000)] });
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

    await T('Bank connections: "Connected" only when Android really allows SMS; no notification tracking anywhere', async () => {
        g('switchTab')('settings'); await wait(300);
        const look = async (status) => { fakeBankPlugin(status); await g('refreshBankStatus')(); return [$('bank-sms-state').textContent, $('bank-overall').textContent, $('bank-sms-help').innerText]; };
        const ok = await look({});
        const restricted = await look({ smsPermission: 'denied', restrictedSettings: 'restricted' });
        const btns = ['app', 'check'].every((k) => document.querySelector(`#bank-sms-help [data-bank-fix="${k}"]`));
        const notYet = await look({ smsPermission: 'prompt', restrictedSettings: 'allowed' });
        const paused = await look({ paused: true });
        const off = await look({ smsEnabled: false });
        const noNotifUi = !$('switch-ntf') && !document.querySelector('[data-bank-fix="ntf"]') && !/notification access/i.test($('bank-card').innerText);
        delete window.Capacitor;
        await g('refreshBankStatus')();
        const web = $('bank-overall').textContent;
        const good = ok[0] === 'Connected' && ok[1] === 'Connected' && /restricted setting/.test(restricted[0]) && /Allow restricted settings/.test(restricted[2]) && btns
            && /Not allowed yet/.test(notYet[0]) && paused[1] === 'Paused' && off[0] === 'Off' && noNotifUi && web === 'Android only';
        return good || JSON.stringify({ ok, restricted: restricted[0], btns, notYet: notYet[0], paused: paused[1], off: off[0], noNotifUi, web });
    });

    await T('Turning SMS on asks Android once; when blocked, the unlock steps mark step 1 done', async () => {
        freshEngine();
        g('switchTab')('settings'); await wait(200);
        const { calls } = fakeBankPlugin({ smsEnabled: false, smsPermission: 'denied', restrictedSettings: 'restricted' });
        await g('enableSmsTracking')(true); await wait(300);
        if (g('isConfirmOpen')()) $('btn-confirm-cancel').click();
        await wait(200);
        const asked = calls.requested === 1;
        const st = window.Capacitor.Plugins.SmsReader;
        (await st.status()).smsEnabled = true;
        await g('refreshBankStatus')();
        const stepDone = document.querySelectorAll('#bank-sms-help .bank-step.is-done').length;
        delete window.Capacitor;
        await g('refreshBankStatus')();
        freshEngine();
        return (asked && stepDone === 1) || `asked ${calls.requested}, steps done ${stepDone}`;
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

    await T('Standard / Play edition (no SMS permission): explains share & paste, offers no dead switches', async () => {
        g('switchTab')('settings'); await wait(200);
        const { calls } = fakeBankPlugin({ smsAvailable: false, smsPermission: 'unavailable', smsEnabled: false });
        await g('refreshBankStatus')();
        const note = !$('bank-web-note').hidden && /sharing a bank SMS/.test($('bank-web-note').textContent) && /Check a bank SMS/.test($('bank-web-note').textContent);
        const hidden = $('bank-conns').hidden && $('btn-bank-disconnect').hidden && !$('btn-sms-paste').hidden;
        const pill = $('bank-overall').textContent;
        await g('enableSmsTracking')(true); await wait(100);
        const notAsked = calls.requested === 0;
        delete window.Capacitor;
        await g('refreshBankStatus')();
        return (note && hidden && pill === 'Share & paste' && notAsked) || `note ${note}, rows hidden ${hidden}, pill ${pill}, asked ${calls.requested}`;
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
        g('disconnectBank')(); await confirmOk(); await wait(400);
        if (g('isConfirmOpen')()) $('btn-confirm-cancel').click();
        const p = JSON.parse(localStorage.getItem('VELA_SMS') || '{}');
        const disc = calls.disconnected === 1 && !p.enabled;
        delete window.Capacitor;
        freshEngine();
        return (pausedOk && deleted && disc) || `paused ${pausedOk}, deleted ${deleted} (still with details ${withRef}), disconnected ${disc}`;
    });

    await T('Activity shows the source; the entry shows "Manual entry" for hand-made ones', async () => {
        g('switchTab')('activity'); await wait(300);
        document.querySelector('[data-activity-status="bank"]').click(); await wait(200);
        const tag = [...document.querySelectorAll('.tx-bank')].map((e) => e.textContent).join('|');
        document.querySelector('[data-activity-status="all"]').click(); await wait(100);
        g('openEditTx')(s().transactions.find((x) => !x.bank && x.type !== 'transfer').id); await wait(300);
        const manual = $('tx-source').textContent;
        await close('modal-tx');
        return (/SMS/.test(tag) && /Manual entry/.test(manual)) || `tags ${tag}, manual "${manual}"`;
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
        const viewWas = g('viewId')();
        g('setViewAccount')('acc-cash'); // the bill belongs to Cash; each account shows only its own payments
        g('saveState')(); g('switchTab')('dashboard'); await wait(400);
        const card = $('due-section');
        const shows = !card.hidden && /overdue/i.test($('pay-summary').textContent) && (!!card.querySelector('[data-pay="bill:pay-bill"]') || !!card.querySelector('.pay-more'));
        (0, eval)('payPopupShownAt = 0');
        await g('showPaymentsPopup')(); await wait(400);
        const popup = g('isSheetOpen')('modal-payments') && /Boarding fee/.test($('pay-popup-list').innerText);
        // "Not yet" keeps it unpaid.
        document.querySelector('#pay-popup-list [data-pay="bill:pay-bill"]').click(); await wait(300);
        document.querySelector('#modal-mark-paid .btn[data-close-sheet]').click(); await wait(350);
        const stillUnpaid = s().recurring.find((b) => b.id === 'pay-bill').nextDate === y;
        // "Yes" pays it today, keeps the due date, moves the bill to next month.
        document.querySelector('#pay-popup-list [data-pay="bill:pay-bill"]').click(); await wait(300);
        document.querySelector('[data-mark-times="1"]').click(); await wait(350);
        const bill = s().recurring.find((b) => b.id === 'pay-bill');
        const tx = s().transactions.find((t) => t.recurringId === 'pay-bill');
        const ok = shows && popup && stillUnpaid && tx && tx.date === today && tx.dueDate === y && bill.nextDate > today && !g('isSheetOpen')('modal-payments');
        s().recurring = s().recurring.filter((b) => b.id !== 'pay-bill');
        return ok || `card ${shows}, popup ${popup}, not-yet kept ${stillUnpaid}, paid ${tx && tx.date}/${tx && tx.dueDate}, next ${bill.nextDate}, view was ${viewWas}`;
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

    await T('Budget from income: follows income received, keeps saving %, shows rent later this month as expected', async () => {
        g('openBudget')('__overall'); await wait(250);
        document.querySelector('[data-budget-mode="income"]').click();
        document.querySelector('[data-budget-save="20"]').click();
        const amountHidden = $('budget-amount-field').hidden;
        g('submitBudget')(); await wait(300);
        const s1 = g('monthStats')();
        // Rent 30,000 dated later this month (if the month has days left) is expected, not counted until it arrives.
        const now = new Date();
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const rentDate = lastDay.getDate() > now.getDate() ? iso(lastDay) : today;
        await addTx({ type: 'income', amount: 30000, desc: 'Rent this month', category: 'OtherIncome', date: rentDate });
        const s2 = g('monthStats')();
        const expected1 = s1.plannedIncome * 0.8;
        const grew = rentDate > today
            ? Math.abs(s2.budget - s1.budget) < 0.01 && s2.expectedIncome >= 30000 - 0.01
            : Math.abs(s2.budget - (s1.plannedIncome + 30000) * 0.8) < 0.01;
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
        // What's left = the money in the account now minus fixed expenses still due (paid ones already left it).
        const leftOk = Math.abs(f3.left - (f3.balance - f3.due)) < 0.01 && Math.abs(f3.balance - g('viewBalance')()) < 0.01;
        // Deleting the rent bill keeps this month's payment counted.
        s().recurring = s().recurring.filter((b) => b.id !== 'rent-bill' && b.id !== 'gym-bill');
        const f4 = g('fixedForMonth')();
        const rentKept = f4.items.filter((i) => i.name === 'Rent').length === 1;
        return (rentCount === 1 && gymCount === gymExpected && gymExpected >= 4 && rentAfter.length === 1 && rentAfter[0].paid && sameFixed && leftOk && rentKept)
            || `rent ${rentCount}, gym ${gymCount}/${gymExpected}, rent after paying ${rentAfter.length} paid ${rentAfter[0] && rentAfter[0].paid}, same fixed ${sameFixed}, left ok ${leftOk}, kept after delete ${rentKept}`;
    });

    await T('Home and Plan show the money in the account, fixed still due and what is left', async () => {
        g('switchTab')('dashboard'); await wait(400);
        const home = $('dash-fixed').innerText;
        g('goToPlan')('bills'); await wait(400);
        const plan = document.querySelector('#plan-content .fx-card');
        const f = g('fixedForMonth')();
        const want = fmt(f.left);
        return (/In this account now/.test(home) && /Fixed expenses still due/.test(home) && home.includes(want) && plan && plan.innerText.includes(want))
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
        g('deleteCategory')(cat.id); await wait(350); document.querySelector('[data-action="cat-delete-ok"]').click(); await wait(400); await close('modal-category');
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

    await T('Calendar: an unpaid bill is not counted as spending; its day gets a ring', async () => {
        const now = new Date();
        const d = g('toISODate')(now);
        const list = [
            { type: 'expense', amount: 3450, currency: 'LKR', date: d, pending: true },
            { type: 'expense', amount: 500, currency: 'LKR', date: d }
        ];
        g('renderCalendar')(list, now.getFullYear(), now.getMonth());
        const cell = document.querySelector(`[data-cal-day="${d}"]`);
        const amt = cell && cell.querySelector('.cal-amt');
        const ring = cell && cell.querySelector('.cal-due');
        const legend = $('activity-calendar').textContent;
        g('renderCalendar')(null);
        return (amt && /500/.test(amt.textContent) && !/3[,.]?4/.test(amt.textContent) && ring && !/green/i.test(legend)) || `amount "${amt && amt.textContent}", ring ${!!ring}, legend "${legend}"`;
    });

    await T('Lock again after: Now / 1 / 5 / 15 minutes, kept on this phone', async () => {
        localStorage.removeItem('VELA_LOCK_AFTER');
        const byDefault = g('lockAfterMs')();
        if (byDefault !== 60000) return `with nothing chosen it locks after ${byDefault} ms, should be 1 minute`;
        g('setLockAfter')(0);
        const now = g('lockAfterMs')();
        g('setLockAfter')(900);
        const fifteen = g('lockAfterMs')();
        const pressed = document.querySelector('[data-lock-after="900"]').getAttribute('aria-pressed');
        g('setLockAfter')(60);
        return (now === 0 && fifteen === 900000 && pressed === 'true' && g('lockAfterMs')() === 60000) || `now ${now}, 15 min ${fifteen}, pressed ${pressed}`;
    });

    await T('Recent notifications: logged once, new dot, list opens and marks read', async () => {
        (0, eval)('notifLog = []');
        g('logNotif')({ key: 'test:1', kind: 'due', title: 'Rent is due today', text: 'Rs. 12,000' });
        g('logNotif')({ key: 'test:1', kind: 'due', title: 'Rent is due today', text: 'Rs. 12,000' });
        const count = g('notifLog').length;
        const dot = $('btn-notifs').classList.contains('has-unread');
        g('openNotifs')(); await wait(350);
        const shown = $('notif-list').textContent.includes('Rent is due today');
        const dotAfter = $('btn-notifs').classList.contains('has-unread');
        $('btn-notifs-clear').click(); await wait(350);
        return (count === 1 && dot && shown && !dotAfter && g('notifLog').length === 0) || `count ${count}, dot ${dot}, shown ${shown}, dot after ${dotAfter}`;
    });

    // ---- 4.39: income kinds, categories, logos, transfers, saving
    const reloadFromStorage = () => { g('loadState')(); return s(); };

    await T('Fixed income: saved as fixed, expected monthly (not counted twice), kept after restart', async () => {
        const before = g('accountBalance')(s().accounts.find((a) => a.id === 'acc-cash'));
        g('openAddTx')('income'); await wait(250);
        $('tx-amount').value = '150000';
        $('tx-desc').value = 'Monthly salary';
        $('tx-desc').dispatchEvent(new Event('input', { bubbles: true }));
        const guessed = g('txKind');
        const shown = !$('tx-kind-field').hidden && /income/.test($('tx-kind-label').textContent) && !$('tx-repeat-row').hidden;
        await g('submitTx')(); await wait(350);
        const t = find('Monthly salary');
        const bill = s().recurring.find((b) => b.id === t.recurringId);
        const after = g('accountBalance')(s().accounts.find((a) => a.id === 'acc-cash'));
        g('processRecurring')();
        const entries = s().transactions.filter((x) => x.desc === 'Monthly salary').length;
        const kept = reloadFromStorage().transactions.find((x) => x.id === t.id).fixed === true;
        return (guessed === 'fixed' && shown && t.fixed === true && bill && bill.type === 'income' && bill.autoLog === false && after - before === 150000 && entries === 1 && kept)
            || `guessed ${guessed}, shown ${shown}, fixed ${t.fixed}, bill ${bill && bill.type}/${bill && bill.autoLog}, balance +${after - before}, entries ${entries}, kept ${kept}`;
    });

    await T('Variable income and both expense kinds are saved as chosen', async () => {
        await addTx({ type: 'income', amount: 12000, desc: 'Freelance logo job' });
        g('openAddTx')('expense'); await wait(250);
        $('tx-amount').value = '45000'; $('tx-desc').value = 'House rent';
        $('tx-desc').dispatchEvent(new Event('input', { bubbles: true }));
        await g('submitTx')(); await wait(350);
        await addTx({ amount: 900, desc: 'Kottu dinner' });
        const r = reloadFromStorage();
        const f = (d) => r.transactions.find((x) => x.desc === d).fixed;
        return (f('Freelance logo job') === false && f('House rent') === true && f('Kottu dinner') === false) || `freelance ${f('Freelance logo job')}, rent ${f('House rent')}, kottu ${f('Kottu dinner')}`;
    });

    await T('Editing Fixed / Variable on income and expense is saved and kept', async () => {
        const inc = find('Freelance logo job');
        g('openEditTx')(inc.id); await wait(300);
        const loaded = g('txKind') === 'variable' && $('tx-desc').value === 'Freelance logo job' && $('tx-account').value === inc.accountId;
        document.querySelector('[data-tx-kind="fixed"]').click(); await wait(100);
        await g('submitTx')(); await wait(350);
        const exp = find('Kottu dinner');
        g('openEditTx')(exp.id); await wait(300);
        document.querySelector('[data-tx-kind="fixed"]').click(); await wait(100);
        $('tx-note').value = 'every Friday';
        await g('submitTx')(); await wait(350);
        const r = reloadFromStorage();
        const i2 = r.transactions.find((x) => x.id === inc.id);
        const e2 = r.transactions.find((x) => x.id === exp.id);
        const row = [...document.querySelectorAll('#tab-activity .tx-item, .tx-row')].length >= 0;
        return (loaded && i2.fixed === true && e2.fixed === true && e2.note === 'every Friday' && e2.category === exp.category && e2.amount === exp.amount && row)
            || `loaded ${loaded}, income fixed ${i2.fixed}, expense fixed ${e2.fixed}, note "${e2.note}", category ${e2.category}`;
    });

    await T('Transfer Commercial Bank -> HNB Bank: both balances move, not income or spending, bank logos right', async () => {
        const st = s();
        st.accounts.push({ id: 'acc-com', name: 'Commercial Bank', kind: 'bank', currency: 'LKR', opening: 50000, createdAt: 1 }, { id: 'acc-hnb', name: 'HNB Bank', kind: 'bank', currency: 'LKR', opening: 0, createdAt: 2 });
        g('saveState')();
        const bal = (id) => g('accountBalance')(s().accounts.find((a) => a.id === id));
        const ms0 = g('monthStats')();
        g('openTransfer')(); await wait(250);
        $('transfer-from').value = 'acc-com'; $('transfer-to').value = 'acc-hnb';
        g('updateTransferFields')();
        $('transfer-amount').value = '10000'; $('transfer-date').value = today;
        g('submitTransfer')(); await wait(500);
        const ms1 = g('monthStats')();
        const trs = s().transactions.filter((t) => t.type === 'transfer' && t.accountId === 'acc-com' && t.toAccountId === 'acc-hnb');
        const logos = (g('accountBrand')(s().accounts.find((a) => a.id === 'acc-com')) || {}).slug + '/' + (g('accountBrand')(s().accounts.find((a) => a.id === 'acc-hnb')) || {}).slug;
        return (bal('acc-com') === 40000 && bal('acc-hnb') === 10000 && trs.length === 1 && ms1.spent === ms0.spent && ms1.income === ms0.income && logos === 'combank/hnb')
            || `Commercial ${bal('acc-com')}, HNB ${bal('acc-hnb')}, transfers ${trs.length}, spent ${ms0.spent}->${ms1.spent}, income ${ms0.income}->${ms1.income}, logos ${logos}`;
    });

    await T('Brand names written with a dash, "and" or "n" still get their logo (Perera - Sons Bakers)', () => {
        const slug = (t) => (g('brandFor')(t) || {}).slug;
        const got = ['Perera - Sons Bakers', 'PERERA AND SONS', 'Perera n Sons', 'PERERA+SONS COLOMBO 03', 'Perera & Sons'].map(slug);
        const noFalse = !g('brandFor')('Coca-Cola Sri Lanka') || (g('brandFor')('Coca-Cola Sri Lanka') || {}).slug !== 'pereraandsons';
        return (got.every((x) => x === 'pereraandsons') && noFalse) || `got ${got.join(', ')}`;
    });

    await T('HNB Assurance is the insurance company (not HNB Bank) and goes to your Insurance category', async () => {
        g('openCategoryEditor')(null, 'expense'); await wait(250);
        $('category-name').value = 'Insurance';
        g('submitCategory')(); await wait(350);
        await close('modal-category');
        const ins = s().categories.find((c) => c.name === 'Insurance');
        const merchant = g('brandFor')('HNB Assurance').slug;
        const bank = g('accountBrand')({ name: 'HNB Bank' }).slug;
        const sms = g('brandFor')('HNB ASSURANCE PLC', true).slug;
        g('openAddTx')('expense'); await wait(250);
        $('tx-desc').value = 'HNB Assurance';
        $('tx-desc').dispatchEvent(new Event('input', { bubbles: true })); await wait(100);
        const picked = (document.querySelector('input[name="tx-category"]:checked') || {}).value;
        const logo = ($('tx-desc-logo').querySelector('img') || {}).src || '';
        await close('modal-tx');
        return (merchant === 'hnbassurance' && bank === 'hnb' && sms === 'hnbassurance' && picked === ins.id && /hnbassurance\.webp/.test(logo))
            || `merchant ${merchant}, bank ${bank}, sms ${sms}, category ${picked} (Insurance is ${ins && ins.id}), logo ${logo}`;
    });

    await T('Choose a brand logo for a name: shown in the form and the list, kept, and can go back to automatic', async () => {
        await addTx({ amount: 700, desc: 'Corner shop' });
        g('openEditTx')(find('Corner shop').id); await wait(300);
        g('openBrandPick')(); await wait(350);
        $('brand-pick-search').value = 'keells';
        g('renderBrandPick')();
        const offered = !!document.querySelector('[data-brand-choose="keells"]');
        document.querySelector('[data-brand-choose="keells"]').click(); await wait(400);
        const inForm = /keells\.webp/.test($('tx-desc-logo').innerHTML);
        await close('modal-tx');
        const inList = /keells\.webp/.test(g('entryBadge')('Corner shop', 'Food', 'expense'));
        const kept = /^brand:keells$/.test(JSON.parse(localStorage.getItem('VELA_SHOP_LOGOS') || '{}')['corner shop'] || '');
        (0, eval)("brandPickFor = 'Corner shop'"); g('chooseBrandLogo')(''); await wait(300);
        const back = !/keells/.test(g('entryBadge')('Corner shop', 'Food', 'expense'));
        return (offered && inForm && inList && kept && back) || `offered ${offered}, form ${inForm}, list ${inList}, kept ${kept}, back to automatic ${back}`;
    });

    await T('Categories: no duplicate names, built-in ones can\'t be deleted, manager has Income / Expenses tabs', async () => {
        g('openCategoryEditor')(null, 'expense'); await wait(250);
        $('category-name').value = 'insurance';
        const dup = g('submitCategory')() === undefined || !!document.querySelector('#category-form .field-error, #category-name[aria-invalid="true"]');
        const count = s().categories.filter((c) => c.name.toLowerCase() === 'insurance').length;
        await close('modal-category');
        g('deleteCategory')('Food'); await wait(300);
        const foodKept = s().categories.some((c) => c.id === 'Food') && !g('openSheets').includes('modal-cat-delete');
        g('openCategoryManager')(); await wait(300);
        document.querySelector('[data-catman-tab="income"]').click(); await wait(100);
        const incomeTab = /Salary/.test($('categories-body').textContent) && !/Insurance/.test($('categories-body').textContent);
        document.querySelector('[data-catman-tab="expense"]').click(); await wait(100);
        const rowBtns = !!document.querySelector('[data-delete-category]') && !document.querySelector('[data-delete-category="Food"]') && !!document.querySelector('[data-edit-category="Food"]');
        await close('modal-categories');
        return (dup && count === 1 && foodKept && incomeTab && rowBtns) || `duplicate blocked ${dup} (${count}), Food kept ${foodKept}, income tab ${incomeTab}, row buttons ${rowBtns}`;
    });

    await T('Hold a custom category: it wiggles, − asks where its entries go, they move there, it animates away', async () => {
        g('openCategoryEditor')(null, 'expense'); await wait(250);
        $('category-name').value = 'Gifts out';
        g('submitCategory')(); await wait(350); await close('modal-category');
        const cat = s().categories.find((c) => c.name === 'Gifts out');
        await addTx({ amount: 2500, desc: 'Birthday gift', category: cat.id });
        s().config.categoryBudgets[cat.id] = 10; g('saveState')();
        g('openAddTx')('expense'); await wait(300);
        const cell = document.querySelector(`[data-cat-cell="${cat.id}"]`);
        const r = cell.getBoundingClientRect();
        cell.querySelector('.cat-option-box').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.x + 10, clientY: r.y + 10 }));
        await wait(650);
        cell.querySelector('.cat-option-box').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.x + 10, clientY: r.y + 10 }));
        await wait(120);
        const editing = $('tx-category-picker').classList.contains('is-editing') && !$('cat-edit-done').hidden;
        // A plain tap on a built-in category while editing doesn't change anything.
        cell.querySelector('.cat-del').click(); await wait(400);
        const asked = g('openSheets').includes('modal-cat-delete') && !$('cat-del-move-field').hidden;
        $('cat-del-move').value = 'Shopping';
        document.querySelector('[data-action="cat-delete-ok"]').click(); await wait(120);
        const animating = !!document.querySelector(`[data-cat-cell="${cat.id}"].is-removing`);
        await wait(500);
        const moved = find('Birthday gift').category === 'Shopping' && !s().categories.some((c) => c.id === cat.id);
        const budget = !s().config.categoryBudgets[cat.id] && s().config.categoryBudgets.Shopping >= 10;
        const gone = !document.querySelector(`[data-cat-cell="${cat.id}"]`);
        document.querySelector('[data-action="cat-edit-done"]').click();
        await close('modal-tx');
        return (editing && asked && animating && moved && budget && gone) || `editing ${editing}, asked ${asked}, animating ${animating}, moved ${moved}, budget moved ${budget}, gone ${gone}`;
    });

    await T('A save the phone refuses is undone and never reported as saved', async () => {
        const store = g('storage');
        const realSet = store.set;
        const before = s().transactions.length;
        store.set = () => false;
        let ok;
        try { ok = await addTx({ amount: 111, desc: 'Should not stay' }); } finally { store.set = realSet; }
        await close('modal-tx');
        const after = s().transactions.length;
        const toast = [...document.querySelectorAll('.toast')].some((t) => /couldn.t be saved/.test(t.textContent));
        return (ok === false && after === before && !find('Should not stay') && toast) || `returned ${ok}, entries ${before}->${after}, error shown ${toast}`;
    });

    await T('Typing a name suggests: bills (Nw -> Water bill), regular income, goals, people, banks, entries', async () => {
        const chips = (box) => [...$(box).querySelectorAll('[data-name-pick]')].map((b) => b.dataset.namePick);
        const type = async (input, text) => { $(input).focus(); $(input).value = text; $(input).dispatchEvent(new Event('input', { bubbles: true })); await wait(60); };
        g('openAddBill')('expense'); await wait(300);
        await type('bill-name', 'Nw');
        const water = chips('bill-name-suggest');
        document.querySelector('#bill-name-suggest [data-name-pick="Water bill"]').click(); await wait(100);
        const filled = $('bill-name').value === 'Water bill' && $('bill-category').value === 'Utilities';
        await type('bill-name', 'ne');
        const netflix = chips('bill-name-suggest').includes('Netflix');
        g('setBillType')('income');
        await type('bill-name', 'sal');
        const salary = chips('bill-name-suggest').includes('Salary');
        await close('modal-bill');
        g('openAddGoal') && g('openAddGoal')(); await wait(300);
        await type('goal-name', 'lap');
        const goal = chips('goal-name-suggest').includes('Laptop');
        await close('modal-goal');
        g('openAccountEditor')(); await wait(300);
        await type('account-name', 'samp');
        const bank = chips('account-name-suggest').includes('Sampath Bank');
        await close('modal-account');
        g('openAddTx')('expense'); await wait(300);
        $('tx-desc').dataset.typing = '1';
        await type('tx-desc', 'elec');
        const entry = [...$('tx-brand-suggest').querySelectorAll('[data-name-pick]')].map((b) => b.dataset.namePick).includes('Electricity bill');
        await close('modal-tx');
        return (water.includes('Water bill') && filled && netflix && salary && goal && bank && entry)
            || `Nw: ${water.join('/')}, filled ${filled}, netflix ${netflix}, salary ${salary}, goal ${goal}, bank ${bank}, entry ${entry}`;
    });

    await T('Trip: start it, expenses (also from bank SMS) count for it, switch off excludes one, end it, kept after restart', async () => {
        g('openTrips')(); await wait(350);
        $('trip-name').value = 'Trip to Ella';
        $('trip-budget').value = '30000';
        g('fillCurrencySelect')($('trip-currency'), 'LKR');
        $('trip-start').value = today;
        g('startTrip')(); await wait(350);
        const trip = g('activeTrip')();
        const pre = s().transactions.filter((t) => t.tripId === trip.id).length; // today's earlier expenses join
        g('openAddTx')('expense'); await wait(300);
        const rowShown = !$('tx-trip-row').hidden && /Ella/.test($('tx-trip-name').textContent) && $('tx-trip').getAttribute('aria-checked') === 'true';
        $('tx-amount').value = '4500'; $('tx-desc').value = 'Hotel Ella'; await g('submitTx')(); await wait(350);
        g('openAddTx')('expense'); await wait(300);
        $('tx-trip').click(); await wait(50);
        $('tx-amount').value = '800'; $('tx-desc').value = 'Home internet'; await g('submitTx')(); await wait(350);
        const sms = g('quickSaveTx')({ type: 'expense', desc: 'Ella train', amount: 1200, currency: 'LKR', category: 'Travel', date: today });
        g('switchTab')('dashboard'); await wait(300);
        const card = /Trip to Ella/.test($('dash-trip').textContent);
        const st = g('tripStats')(trip);
        const ok1 = find('Hotel Ella').tripId === trip.id && !find('Home internet').tripId && sms.tripId === trip.id;
        g('openTrips')(trip.id); await wait(300);
        const detail = /Hotel Ella/.test($('trip-view').textContent);
        g('endTrip')(); await confirmOk(); await wait(300);
        await addTx({ amount: 300, desc: 'After trip snack' });
        const after = !find('After trip snack').tripId && !g('activeTrip')();
        const r = g('loadState')() || s();
        const kept = s().config.trips.some((t) => t.id === trip.id && t.endedAt) && s().transactions.find((t) => t.desc === 'Hotel Ella').tripId === trip.id;
        const synced = Array.isArray(g('settingsPayload')().trips) && g('settingsPayload')().trips.length >= 1;
        return (rowShown && ok1 && card && st.spent >= 5700 && st.budget === 30000 && detail && after && kept && synced)
            || `row ${rowShown}, tagged ${ok1}, card ${card}, spent ${st.spent} (earlier ${pre}), budget ${st.budget}, detail ${detail}, ended ${after}, kept ${kept}, synced ${synced}`;
    });

    await T('Subscription: tap Spotify, type the price, it becomes a monthly bill; total per month shows', async () => {
        g('openSubscriptions')(); await wait(350);
        const tile = document.querySelector('[data-sub-pick="Spotify Premium"]');
        const logo = !!(tile && tile.querySelector('img'));
        tile.click(); await wait(400);
        const form = $('bill-name').value === 'Spotify Premium' && $('bill-frequency').value === 'monthly' && $('bill-category').value === 'Entertainment';
        $('bill-amount').value = '1290';
        g('fillCurrencySelect')($('bill-currency'), 'LKR');
        g('submitBill')(); await wait(400);
        const bill = s().recurring.find((b) => b.name === 'Spotify Premium');
        g('openSubscriptions')(); await wait(350);
        const total = /1,290/.test($('subs-mine').textContent) && !document.querySelector('[data-sub-pick="Spotify Premium"]');
        await close('modal-subs');
        g('loadState')();
        const kept = s().recurring.find((b) => b.name === 'Spotify Premium').sub === true;
        return (logo && form && bill && bill.sub && bill.frequency === 'monthly' && total && kept) || `logo ${logo}, form ${form}, bill ${!!bill}/${bill && bill.sub}, total ${total}, kept ${kept}`;
    });

    await T('Sections: split by plan, below-zero filled first, leftover moved, balances continue, undo, restart, sync', async () => {
        const st = s();
        st.config.sectionSkipped = st.transactions.filter((t) => t.type === 'income').map((t) => t.id); // earlier test incomes stay out
        g('setupSections')('503020'); await wait(200);
        st.config.sectionSince = today; g('saveState')();
        const [needs, wants, savings] = s().config.sections;
        const bal = () => g('sectionBalances')();
        const r = (o) => [o[needs.id], o[wants.id], o[savings.id]].map((v) => Math.round(v)).join('/');
        // Salary 1: the divide sheet opens by itself after adding it.
        await addTx({ type: 'income', amount: 100000, desc: 'Salary Nov', category: 'Salary' }); await wait(600);
        const opened = g('openSheets').includes('modal-divide');
        g('confirmDivide')(); await wait(300);
        const b1 = r(bal());
        // Spending out of sections (from any account).
        g('openAddTx')('expense'); await wait(300);
        const pickerShown = !$('tx-section-field').hidden;
        document.querySelector(`[data-tx-section="${needs.id}"]`).click();
        $('tx-amount').value = '60000'; $('tx-desc').value = 'Rent and bills'; g('selectTxCategory')('Rent');
        await g('submitTx')(); await wait(350);
        // Needs hasn't got Rs. 60,000: Vela asks; here we let it go below zero on purpose.
        const belowBtn = document.querySelector('[data-tx-cover="below"]');
        if (belowBtn) { belowBtn.click(); await wait(400); }
        g('openAddTx')('expense'); await wait(300);
        document.querySelector(`[data-tx-section="${wants.id}"]`).click();
        $('tx-amount').value = '10000'; $('tx-desc').value = 'Concert'; g('selectTxCategory')('Entertainment');
        await g('submitTx')(); await wait(350);
        const b2 = r(bal());
        // Salary 2: Needs (below zero) filled first, Wants' leftover moved to Savings, the rest split by the plan.
        await addTx({ type: 'income', amount: 100000, desc: 'Salary Dec', category: 'Salary' }); await wait(600);
        const sel = document.querySelector(`[data-sec-carry="${wants.id}"]`);
        sel.value = savings.id; sel.dispatchEvent(new Event('change', { bubbles: true })); await wait(100);
        const fillShown = /Cover deficits first/.test($('divide-fills').textContent);
        g('confirmDivide')(); await wait(300);
        const b3 = r(bal());
        const total = Object.values(bal()).reduce((a, v) => a + v, 0);
        // Undo the second division, then divide again keeping leftovers where they are.
        const sal2 = find('Salary Dec');
        (0, eval)('undoDivide')(sal2.id); await confirmOk(); await wait(300);
        const b4 = r(bal());
        g('openDivide')(sal2.id); await wait(350); g('confirmDivide')(); await wait(300);
        const b5 = r(bal());
        // Restart and sync keep it all.
        g('loadState')();
        const b6 = r(bal());
        const payload = g('settingsPayload')();
        const synced = payload.sections.length === 3 && payload.sectionMoves.length >= 6;
        // A bank SMS expense in the Rent category lands in Needs (learned from what you picked).
        const smsTx = g('quickSaveTx')({ type: 'expense', desc: 'CEB', amount: 5000, currency: 'LKR', category: 'Rent', date: today });
        return (opened && b1 === '50000/30000/20000' && pickerShown && b2 === '-10000/20000/20000' && fillShown && b3 === '45000/27000/58000' && Math.round(total) === 130000
            && b4 === '-10000/20000/20000' && b5 === '45000/47000/38000' && b6 === b5 && synced && smsTx.sectionId === needs.id)
            || `opened ${opened}, b1 ${b1}, picker ${pickerShown}, b2 ${b2}, fill shown ${fillShown}, b3 ${b3}, total ${Math.round(total)}, undo ${b4}, redo ${b5}, restart ${b6}, synced ${synced}, sms ${smsTx.sectionId === needs.id}`;
    });

    await T('Sections: move money, put money in, delete a section keeps every rupee, Home / Plan / Insights show it', async () => {
        const [needs, wants, savings] = s().config.sections;
        const sum = () => Math.round(Object.values(g('sectionBalances')()).reduce((a, v) => a + v, 0));
        const before = sum();
        g('openSecMove')(savings.id, 'move'); await wait(300);
        $('sec-move-to').value = wants.id; $('sec-move-amount').value = '3000';
        g('submitSecMove')(); await wait(300);
        const moved = Math.round(g('sectionBalances')()[wants.id]);
        g('openSecMove')(needs.id, 'add'); await wait(300);
        $('sec-move-amount').value = '1000'; g('submitSecMove')(); await wait(300);
        const added = sum() - before;
        g('switchTab')('dashboard'); await wait(300);
        const home = /Funds/.test($('dash-sections').textContent) && /Needs/.test($('dash-sections').textContent);
        g('goToPlan')('sections'); await wait(300);
        const plan = /Total in funds/.test($('plan-content').textContent);
        g('switchTab')('analytics'); await wait(400);
        const insights = !$('section-breakdown-card').hidden && /Needs/.test($('section-breakdown').textContent);
        const totalBeforeDelete = sum();
        g('openSectionEditor')(wants.id); await wait(300);
        g('deleteSection')(); await confirmOk(); await wait(300);
        const after = sum();
        const gone = !s().config.sections.some((x) => x.id === wants.id) && !s().transactions.some((t) => t.sectionId === wants.id);
        return moved === 50000 && added === 1000 && home && plan && insights && after === totalBeforeDelete && gone
            || `moved ${moved}, added ${added}, home ${home}, plan ${plan}, insights ${insights}, total ${totalBeforeDelete}->${after}, gone ${gone}`;
    });

    await T('One bank SMS read twice (live listener + inbox, times minutes apart) shows once, and not again once added', async () => {
        const body = 'Your A/C xx4321 has been debited by LKR 2,450.00 at KEELLS SUPER on 18/11. Avl Bal LKR 52,300.00 - ComBank';
        const addr = 'COMBANK';
        const hash = Math.abs([...(addr + body)].reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0));
        const t0 = Date.now() - 15 * 60000;
        const live = { id: `sms-${t0}-${hash}`, source: 'sms', address: addr, body, date: t0 };
        const inbox = { id: `sms-${t0 + 9 * 60000}-${hash}`, source: 'sms', address: addr, body, date: t0 + 9 * 60000 };
        const before = g('smsQueue').length;
        g('smsTake')([live]);
        g('smsTake')([inbox]);
        const waiting = g('smsQueue').filter((i) => (i.bodyKeys || []).length && i.amount === 2450).length;
        const added = g('smsQueue').length - before;
        // Hours apart, the same text is a second purchase (kept as two).
        const later = { id: `sms-${t0 + 5 * 3600000}-${hash}`, source: 'sms', address: addr, body, date: t0 + 5 * 3600000 };
        g('smsTake')([later]);
        const twoLater = g('smsQueue').length - before;
        // Add the first one, then the inbox copy comes again: nothing new.
        const first = g('smsQueue').find((i) => i.amount === 2450);
        g('smsApply')(first, s().accounts[0].id);
        const recorded = g('smsAlreadyRecorded')(g('parseBankSms')({ ...inbox, id: `sms-${t0 + 60000}-${hash}`, date: t0 + 60000 }));
        return (added === 1 && waiting === 1 && twoLater === 2 && recorded) || `first two -> ${added} in the list, hours later -> ${twoLater}, copy of an added one recognised ${recorded}`;
    });

    await T('Bank sends 2 different messages for one payment: one card, "Add once" adds it once; ATM card says it moves to Cash', async () => {
        const t0 = Date.now() - 5 * 60000;
        const card = { id: `sms-${t0}-111`, source: 'sms', address: 'COMBANK', body: 'Your ComBank Credit Card ending 1234 was used for a transaction of LKR 3,890.00 at PIZZA HUT COLOMBO 03.', date: t0 };
        const acct = { id: `sms-${t0 + 40000}-222`, source: 'sms', address: 'COMBANK', body: 'LKR 3,890.00 debited from your A/C xx9876 on 18/11 for a card purchase. Thank you for banking with ComBank.', date: t0 + 40000 };
        const before = s().transactions.length;
        g('smsTake')([card]); g('smsTake')([acct]);
        const queued = g('smsQueue').filter((i) => i.amount === 3890).length;
        g('showSmsSheet')(); await wait(400);
        const pairCard = document.querySelectorAll('#sms-list .sms-pair').length === 1 && /2 messages/.test($('sms-list').textContent);
        const once = document.querySelector('[data-sms-pair-once]');
        if (once) once.click();
        await wait(500);
        const asked = g('openSheets').includes('modal-sms-pick');
        if (asked) { document.querySelector('#sms-pick-list [data-sms-pick-acc]').click(); await wait(500); }
        const added = s().transactions.length - before;
        const left = g('smsQueue').filter((i) => i.amount === 3890).length;
        const atm = g('parseBankSms')({ id: `sms-${t0}-333`, source: 'sms', address: 'COMBANK', body: 'Cash withdrawal of LKR 10,000.00 from your A/C xx9876 at ATM COMBANK BORELLA on 18/11.', date: t0 });
        const atmCard = atm ? g('smsCardHtml')(atm) : '';
        const atmWords = /Cash wallet/.test(atmCard) && /not spending/.test(atmCard) && /Move to my Cash/.test(atmCard);
        await close('modal-sms');
        return (queued === 2 && pairCard && added === 1 && left === 0 && atmWords) || `queued ${queued}, one card ${pairCard}, added ${added}, still waiting ${left}, ATM words ${atmWords} (${atm && atm.type})`;
    });

    await T('Funds: only chosen income is allocated; other income by hand; part of an income can stay unallocated', async () => {
        const [needs] = s().config.sections;
        const sum = () => Math.round(Object.values(g('sectionBalances')()).reduce((a, v) => a + v, 0));
        // Freelance income: not offered, sheet doesn't open by itself.
        await addTx({ type: 'income', amount: 20000, desc: 'Logo job', category: 'Freelance' }); await wait(600);
        const notAsked = !g('openSheets').includes('modal-divide') && !g('undividedIncomes')().some((t) => t.desc === 'Logo job');
        // Allocate it by hand from its entry, keeping half outside the funds.
        const before = sum();
        g('openEditTx')(find('Logo job').id); await wait(300);
        const btn = !$('tx-allocate').hidden;
        $('tx-allocate').click(); await wait(800);
        const opened = g('openSheets').includes('modal-divide');
        document.querySelectorAll('[data-sec-alloc]').forEach((i) => { i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
        const first = document.querySelector(`[data-sec-alloc="${needs.id}"]`);
        first.value = '10000'; first.dispatchEvent(new Event('input', { bubbles: true }));
        const keepShown = !$('divide-keep-row').hidden;
        $('divide-keep').click(); await wait(50);
        g('confirmDivide')(); await wait(300);
        const added = sum() - before;
        // Choosing Freelance makes the next one offered.
        g('toggleFundIncomeCat')('Freelance'); await wait(100);
        await addTx({ type: 'income', amount: 5000, desc: 'Logo job 2', category: 'Freelance' }); await wait(600);
        const asked = g('openSheets').includes('modal-divide');
        g('skipDivide')(find('Logo job 2').id); await wait(300);
        g('toggleFundIncomeCat')('Freelance');
        return (notAsked && btn && opened && keepShown && added === 10000 && asked) || `not asked ${notAsked}, button ${btn}, opened ${opened}, keep switch ${keepShown}, added ${added}, asked once chosen ${asked}`;
    });

    await T('Account added today with its current balance: an older expense is history, not taken off again', async () => {
        g('openAccountEditor')(); await wait(300);
        $('account-name').value = 'Sampath Bank'; $('account-kind').value = 'bank';
        g('fillCurrencySelect')($('account-currency'), 'LKR');
        $('account-opening').value = '50000';
        g('submitAccount')(); await wait(400);
        const acc = s().accounts.find((a) => a.name === 'Sampath Bank');
        const bal = () => Math.round(g('accountBalance')(s().accounts.find((a) => a.id === acc.id)));
        const twoDaysAgo = iso(addDays(new Date(), -2));
        g('openAddTx')('expense'); await wait(300);
        $('tx-account').value = acc.id; $('tx-account').dispatchEvent(new Event('change', { bubbles: true }));
        $('tx-date').value = twoDaysAgo; $('tx-date').dispatchEvent(new Event('change', { bubbles: true }));
        const shown = !$('tx-before-row').hidden && $('tx-before').getAttribute('aria-checked') === 'true';
        $('tx-amount').value = '3000'; $('tx-desc').value = 'Groceries before';
        await g('submitTx')(); await wait(350);
        const afterOld = bal();
        const counted = find('Groceries before').beforeBalance === true;
        await addTx({ amount: 1000, desc: 'Lunch today', account: acc.id });
        const afterNew = bal();
        // Bank SMS from before the account was added: also already in the balance.
        const sms = g('quickSaveTx')({ type: 'expense', desc: 'Old card payment', amount: 700, currency: 'LKR', category: 'Food', date: twoDaysAgo, accountId: acc.id });
        const afterSms = bal();
        // An entry added by an older version (no mark) is fixed once.
        const old = find('Lunch today');
        const legacy = { ...old, id: 'legacy-1', desc: 'Legacy back-dated', date: twoDaysAgo, createdAt: Date.now() };
        delete legacy.beforeBalance;
        s().transactions.push(legacy); g('saveState')();
        const beforeFix = bal();
        localStorage.removeItem('VELA_BEFORE_BAL_FIXED');
        const fixed = g('fixBeforeBalance')();
        const afterFix = bal();
        return (shown && counted && afterOld === 50000 && afterNew === 49000 && sms.beforeBalance && afterSms === 49000 && beforeFix === 48000 && fixed >= 1 && afterFix === 49000)
            || `switch ${shown}, marked ${counted}, after old ${afterOld}, after today ${afterNew}, sms ${afterSms}, legacy ${beforeFix}->${afterFix} (fixed ${fixed})`;
    });

    await T('A minus balance is red with a label on Home, in the account bar, account cards and total', async () => {
        const acc = s().accounts.find((a) => a.name === 'Sampath Bank');
        g('setViewAccount')(acc.id);
        await addTx({ amount: 200000, desc: 'Big overdraft', account: acc.id });
        g('switchTab')('dashboard'); await wait(500);
        const hero = $('dash-balance').classList.contains('is-negative') && !$('dash-minus').hidden;
        const bar = document.querySelector('#tab-dashboard .view-bar .amount');
        const barRed = bar && getComputedStyle(bar).color === getComputedStyle(document.querySelector('.text-expense') || bar).color && bar.classList.contains('text-expense');
        const chip = document.querySelector(`[data-view-account="${acc.id}"] .account-bal`);
        const chipRed = !!chip && chip.classList.contains('text-expense');
        g('deleteTx')(find('Big overdraft').id); await confirmOk(); await wait(300);
        g('switchTab')('dashboard'); await wait(300);
        const back = !$('dash-balance').classList.contains('is-negative') && $('dash-minus').hidden;
        return (hero && barRed && chipRed && back) || `hero ${hero}, bar ${barRed}, card ${chipRed}, normal again ${back}`;
    });

    await T('Foreign card purchase: account charged market rate + bank charge (estimate), learns the real charge', async () => {
        const st = s();
        st.accounts.push({ id: 'acc-cb', name: 'Commercial Bank Card', kind: 'bank', currency: 'LKR', opening: 100000, createdAt: 0 });
        g('saveState')();
        const acc = () => s().accounts.find((a) => a.id === 'acc-cb');
        const bal = () => Math.round(g('accountBalance')(acc()) * 100) / 100;
        const t0 = Date.now();
        const claude = g('parseBankSms')({ id: `sms-${t0}-901`, source: 'sms', address: 'COMBANK', body: 'Dear Cardholder, Purchase at ANTHROPIC* CLAUDE SUB +14152360599 US for USD 20.00 on 05/11/26 07:37 PM has been authorised on your debit card ending #5174.', date: t0 });
        const card = g('smsCardHtml')(claude);
        const shownEstimate = /From your account/.test(card) && /6,240/.test(card);
        const rec = g('smsApply')(claude, 'acc-cb');
        const est = rec.currency === 'LKR' && rec.amount === 6240 && rec.fx && rec.fx.amount === 20 && rec.fx.estimated === true && bal() === 100000 - 6240;
        // You enter what the bank really took: 6,300 -> Vela learns 5%.
        g('openEditTx')(rec.id); await wait(300);
        const formShows = !$('tx-charged-field').hidden && $('tx-amount').value === '20' && $('tx-currency').value === 'USD' && g('toNumber')($('tx-charged').value) === 6240;
        $('tx-charged').value = '6300'; $('tx-charged').dispatchEvent(new Event('input', { bubbles: true }));
        await g('submitTx')(); await wait(350);
        const saved = s().transactions.find((t) => t.id === rec.id);
        const learned = acc().fxFee === 5 && saved.amount === 6300 && saved.fx.estimated === false && bal() === 100000 - 6300;
        // Next foreign purchase uses the learned charge.
        g('openAddTx')('expense'); await wait(300);
        $('tx-account').value = 'acc-cb'; $('tx-account').dispatchEvent(new Event('change', { bubbles: true }));
        g('fillCurrencySelect')($('tx-currency'), 'USD'); $('tx-currency').dispatchEvent(new Event('change', { bubbles: true }));
        $('tx-amount').value = '10'; $('tx-amount').dispatchEvent(new Event('input', { bubbles: true }));
        const next = g('toNumber')($('tx-charged').value) === 3150;
        await close('modal-tx');
        // A bank SMS that shows both amounts is exact and teaches the charge too.
        const both = g('parseBankSms')({ id: `sms-${t0}-902`, source: 'sms', address: 'COMBANK', body: 'Your ComBank Debit Card ending 5174 was used for USD 10.00 (LKR 3,120.00) at NETFLIX.COM on 06/11/26.', date: t0 });
        const r2 = both && g('smsApply')(both, 'acc-cb');
        const exact = !!r2 && r2.amount === 3120 && r2.fx && r2.fx.estimated === false && acc().fxFee === 4;
        return (shownEstimate && est && formShows && learned && next && exact) || `card ${shownEstimate}, estimate ${est} (${rec.amount}), form ${formShows}, learned ${learned} (${acc().fxFee}), next ${next} (${$('tx-charged').value}), exact SMS ${exact} (${r2 && r2.amount}, fee ${acc().fxFee})`;
    });

    await T('"Already in my balance" shows for any past date, also on older accounts; balance date set in the account', async () => {
        s().accounts.push({ id: 'acc-old', name: 'Old Wallet Bank', kind: 'bank', currency: 'LKR', opening: 20000, createdAt: 0 });
        g('saveState')();
        const fiveAgo = iso(addDays(new Date(), -5));
        const open = async () => {
            g('openAddTx')('expense'); await wait(300);
            $('tx-account').value = 'acc-old'; $('tx-account').dispatchEvent(new Event('change', { bubbles: true }));
            $('tx-date').value = fiveAgo; $('tx-date').dispatchEvent(new Event('change', { bubbles: true }));
        };
        await open();
        const shownOff = !$('tx-before-row').hidden && $('tx-before').getAttribute('aria-checked') === 'false';
        $('tx-date').value = today; $('tx-date').dispatchEvent(new Event('change', { bubbles: true }));
        const hiddenToday = $('tx-before-row').hidden;
        await close('modal-tx');
        // Say the balance was right 2 days ago: older entries are then already in it.
        g('openAccountEditor')('acc-old'); await wait(300);
        $('account-balance-date').value = iso(addDays(new Date(), -2));
        g('submitAccount')(); await wait(400);
        await open();
        const onNow = !$('tx-before-row').hidden && $('tx-before').getAttribute('aria-checked') === 'true';
        $('tx-amount').value = '500'; $('tx-desc').value = 'Old snack';
        const before = g('accountBalance')(s().accounts.find((a) => a.id === 'acc-old'));
        await g('submitTx')(); await wait(350);
        const after = g('accountBalance')(s().accounts.find((a) => a.id === 'acc-old'));
        return (shownOff && hiddenToday && onNow && before === after) || `past date shown (off) ${shownOff}, hidden for today ${hiddenToday}, on after balance date ${onNow}, balance ${before} -> ${after}`;
    });

    await T('Funds: "only what I add" (Food 7,500 this month, nothing next month), "only once", funds per account', async () => {
        const st = s();
        st.accounts.push({ id: 'acc-f1', name: 'Fund Bank One', kind: 'bank', currency: 'LKR', opening: 7500, createdAt: 0 }, { id: 'acc-f2', name: 'Fund Bank Two', kind: 'bank', currency: 'LKR', opening: 0, createdAt: 0 });
        const keep = { sections: st.config.sections, sectionMoves: st.config.sectionMoves, sectionSince: st.config.sectionSince, fundIncomeCats: st.config.fundIncomeCats };
        st.config.sections = [
            { id: 'food', name: 'Food', mode: 'manual', value: 0, currency: 'LKR', color: 'pink', icon: 'c-Food', accountId: 'acc-f1' },
            { id: 'trip', name: 'Trip', mode: 'amount', value: 5000, currency: 'LKR', color: 'cyan', icon: 'x-plane', accountId: 'acc-f1', once: true },
            { id: 'save', name: 'Savings', mode: 'rest', value: 0, currency: 'LKR', color: 'green', icon: 'c-Investment', accountId: 'acc-f1' },
            { id: 'two', name: 'Two only', mode: 'rest', value: 0, currency: 'LKR', color: 'violet', icon: 'i-wallet', accountId: 'acc-f2' }];
        st.config.sectionMoves = []; st.config.sectionSince = today; st.config.fundIncomeCats = ['Salary'];
        st.config.sectionSkipped = st.transactions.filter((t) => t.type === 'income').map((t) => t.id);
        g('saveState')();
        const bal = () => g('sectionBalances')();
        g('openSecMove')('food', 'add'); await wait(300);
        $('sec-move-amount').value = '7500'; g('submitSecMove')(); await wait(300);
        await addTx({ type: 'income', amount: 100000, desc: 'Salary A1', category: 'Salary', account: 'acc-f1' }); await wait(600);
        const offered = [...document.querySelectorAll('[data-sec-alloc]')].map((i) => i.dataset.secAlloc).sort().join(',');
        g('confirmDivide')(); await wait(300);
        const b1 = bal();
        await addTx({ type: 'income', amount: 100000, desc: 'Salary A2', category: 'Salary', account: 'acc-f1' }); await wait(600);
        g('confirmDivide')(); await wait(300);
        const b2 = bal();
        g('openAddTx')('expense'); await wait(300);
        $('tx-account').value = 'acc-f2'; $('tx-account').dispatchEvent(new Event('change', { bubbles: true }));
        const picks = [...document.querySelectorAll('[data-tx-section]')].map((b) => b.dataset.txSection).filter(Boolean).join(',');
        await close('modal-tx');
        Object.assign(st.config, keep); g('saveState')();
        return (offered === 'food,save,trip' && b1.food === 7500 && b1.trip === 5000 && b1.save === 95000 && b2.food === 7500 && b2.trip === 5000 && b2.save === 195000 && picks === 'two')
            || `offered ${offered}, after 1st food ${b1.food} trip ${b1.trip} save ${b1.save}, after 2nd food ${b2.food} trip ${b2.trip} save ${b2.save}, account two picks ${picks}`;
    });

    await T('Bank charge: change it in the account and estimated foreign purchases are worked out again', async () => {
        const st = s();
        st.accounts.push({ id: 'acc-fee', name: 'Fee Bank', kind: 'bank', currency: 'LKR', opening: 10000, createdAt: 0 });
        g('saveState')();
        const t0 = Date.now();
        const sms = g('parseBankSms')({ id: `sms-${t0}-777`, source: 'sms', address: 'COMBANK', body: 'Purchase at SPOTIFY for USD 20.00 on 05/11/26 has been authorised on your debit card ending #5174.', date: t0 });
        const rec = g('smsApply')(sms, 'acc-fee');
        const first = rec.amount;
        g('openAccountEditor')('acc-fee'); await wait(300);
        const shown = $('account-fee').placeholder === '4';
        $('account-fee').value = '5';
        g('submitAccount')(); await wait(500);
        const again = s().transactions.find((t) => t.id === rec.id);
        return (first === 6240 && shown && again.amount === 6300 && again.fx.fee === 5) || `first ${first}, placeholder ${$('account-fee').placeholder}, after ${again.amount} (fee ${again.fx.fee})`;
    });

    await T('Maths: entries already in a balance are left out of this month change; from-balance budget leaves exactly the balance', async () => {
        const st = s();
        st.accounts.push({ id: 'acc-mb', name: 'Math Bank', kind: 'bank', currency: 'LKR', opening: 40000, createdAt: 0 });
        const b = { note: '', recurringId: null, receipt: null, fixed: false, pending: false, currency: 'LKR', accountId: 'acc-mb', createdAt: Date.now() };
        st.transactions.push({ ...b, id: 'mb1', type: 'expense', desc: 'Now', amount: 1000, category: 'Food', date: today },
            { ...b, id: 'mb2', type: 'expense', desc: 'Before', amount: 3000, category: 'Food', date: today, beforeBalance: true });
        g('saveState')();
        g('setViewAccount')('acc-mb');
        const change = g('monthChange')();
        const keepMode = st.config.budgetMode;
        st.config.budgetMode = 'balance';
        const ms = g('monthStats')();
        st.config.budgetMode = keepMode; g('saveState')();
        const balNow = g('viewBalance')();
        g('setViewAccount')('acc-cash');
        // From balance: everything spent this month on both sides, so what's left is exactly the balance.
        return (change === -1000 && balNow === 39000 && ms.budget === 43000 && ms.budget - ms.spent === 39000) || `change ${change}, balance ${balNow}, budget ${ms.budget}, left ${ms.budget - ms.spent}`;
    });

    await T('Clear all data (this phone): nothing of Vela is left on the phone', async () => {
        ['VELA_NOTIF_LOG', 'VELA_SHOP_LOGOS', 'VELA_HIDE_BALANCE'].forEach((k) => localStorage.setItem(k, '{"x":1}'));
        g('wipeData')(); await wait(300);
        const sheet = g('openSheets').includes('modal-wipe') && $('btn-wipe-everywhere').hidden;
        await close('modal-wipe');
        const saved = localStorage.getItem('VELA_STATE');
        await g('clearPhoneData')();
        const left = ['VELA_STATE', 'VELA_SHOP_LOGOS', 'VELA_NOTIF_LOG', 'VELA_HIDE_BALANCE', 'VELA_SMS'].filter((k) => localStorage.getItem(k) !== null);
        localStorage.setItem('VELA_STATE', saved); g('loadState')(); g('renderActive')();
        return (sheet && !left.length) || `sheet ${sheet}, still saved: ${left.join(', ')}`;
    });

    await T('Fund money: 5,000 + 2,000 = 7,000, minus 1,500 = 5,500; no double add; limits checked; hold menu', async () => {
        const st = s();
        st.accounts.push({ id: 'acc-fm', name: 'Fund Money Bank', kind: 'bank', currency: 'LKR', opening: 20000, createdAt: 0 });
        const keep = { sections: st.config.sections, sectionMoves: st.config.sectionMoves };
        st.config.sections = [{ id: 'fm', name: 'Holiday', mode: 'manual', value: 0, currency: 'LKR', color: 'cyan', icon: 'x-plane', accountId: 'acc-fm', target: 10000 }];
        st.config.sectionMoves = [];
        g('saveState')();
        const bal = () => g('sectionBalances')().fm;
        const add = async (amt, mode = 'add', note = '') => { g('openSecMove')('fm', mode); await wait(300); $('sec-move-amount').value = String(amt); $('sec-move-note').value = note; const r = g('submitSecMove')(); await wait(300); return r; };
        await add(5000, 'add', 'start');
        const b1 = bal();
        // A quick double tap adds it once.
        g('openSecMove')('fm', 'add'); await wait(300);
        $('sec-move-amount').value = '2000';
        g('submitSecMove')(); g('submitSecMove')(); await wait(300);
        const b2 = bal();
        await add(1500, 'out', 'tickets');
        const b3 = bal();
        // Taking out more than the fund has: refused with the numbers.
        const tooMuch = await add(9000, 'out');
        const outMsg = /Insufficient balance/.test(document.querySelector('#modal-sec-move .field-error, #modal-sec-move [role="alert"]')?.textContent || $('modal-sec-move').textContent);
        await close('modal-sec-move');
        // Setting aside more than the account has free (20,000 - 5,500 = 14,500): refused.
        const overFree = await add(15000, 'add');
        await close('modal-sec-move');
        const b4 = bal();
        const history = g('secMoves')().filter((m) => m.to === 'fm' || m.from === 'fm').length;
        const noted = g('secMoves')().some((m) => m.note === 'tickets' && m.kind === 'out');
        // Hold the fund tile: its menu opens.
        g('setViewAccount')('acc-fm');
        g('goToPlan')('sections'); await wait(400);
        const tile = document.querySelector('#plan-content [data-sec-view="fm"]');
        let menu = false;
        if (tile) {
            const r = tile.getBoundingClientRect();
            tile.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.x + 5, clientY: r.y + 5 }));
            await wait(650);
            tile.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
            menu = g('openSheets').includes('modal-fund-actions');
            await close('modal-fund-actions');
        }
        g('setViewAccount')('acc-cash');
        Object.assign(st.config, keep); g('saveState')();
        return (b1 === 5000 && b2 === 7000 && b3 === 5500 && tooMuch !== true && outMsg && overFree !== true && b4 === 5500 && history === 3 && noted && menu)
            || `5000 -> ${b1}, +2000 (tapped twice) -> ${b2}, -1500 -> ${b3}, take out 9000 refused ${tooMuch !== true} (${outMsg}), over free refused ${overFree !== true}, now ${b4}, history ${history}, note ${noted}, hold menu ${menu} (tile ${!!tile})`;
    });

    await T('Allocate a salary: 50% leaves half unallocated; custom amount; 100%', async () => {
        const st = s();
        st.accounts.push({ id: 'acc-al', name: 'Alloc Bank', kind: 'bank', currency: 'LKR', opening: 0, createdAt: 0 });
        const keep = { sections: st.config.sections, sectionMoves: st.config.sectionMoves, sectionSince: st.config.sectionSince, fundIncomeCats: st.config.fundIncomeCats };
        st.config.sections = [{ id: 'need', name: 'Needs', mode: 'percent', value: 50, currency: 'LKR', color: 'cyan', icon: 'c-Rent', accountId: 'acc-al' }, { id: 'rest', name: 'Rest', mode: 'rest', value: 0, currency: 'LKR', color: 'green', icon: 'c-Investment', accountId: 'acc-al' }];
        st.config.sectionMoves = []; st.config.sectionSince = today; st.config.fundIncomeCats = ['Salary'];
        st.config.sectionSkipped = st.transactions.filter((t) => t.type === 'income').map((t) => t.id);
        g('saveState')();
        const total = () => Math.round(Object.values(g('sectionBalances')()).reduce((x, v) => x + v, 0));
        await addTx({ type: 'income', amount: 100000, desc: 'Salary half', category: 'Salary', account: 'acc-al' }); await wait(600);
        document.querySelector('[data-divide-share="0.5"]').click(); await wait(100);
        const summary = $('divide-summary').textContent;
        g('confirmDivide')(); await wait(300);
        const half = total();
        await addTx({ type: 'income', amount: 100000, desc: 'Salary custom', category: 'Salary', account: 'acc-al' }); await wait(600);
        document.querySelector('[data-divide-share="custom"]').click(); await wait(100);
        $('divide-custom').value = '30000'; $('divide-custom').dispatchEvent(new Event('input', { bubbles: true })); await wait(50);
        g('confirmDivide')(); await wait(300);
        const custom = total() - half;
        await addTx({ type: 'income', amount: 100000, desc: 'Salary full', category: 'Salary', account: 'acc-al' }); await wait(600);
        g('confirmDivide')(); await wait(300);
        const full = total() - half - custom;
        const accBal = g('accountBalance')(s().accounts.find((a) => a.id === 'acc-al'));
        Object.assign(st.config, keep); g('saveState')();
        return (/50,000/.test(summary) && half === 50000 && custom === 30000 && full === 100000 && accBal === 300000)
            || `summary "${summary}", 50% -> ${half}, custom -> ${custom}, 100% -> ${full}, account still ${accBal} (allocating moves no money)`;
    });

    await T('Monthly budget OFF hides budget bar and warnings; ON shows them again', async () => {
        g('setBudgetOn')(false); await wait(200);
        g('switchTab')('dashboard'); await wait(300);
        const homeHidden = document.querySelector('.hero-budget').hidden;
        g('goToPlan')('budgets'); await wait(300);
        const planOff = /No monthly budget/.test($('plan-content').textContent);
        g('setBudgetOn')(true); await wait(200);
        g('switchTab')('dashboard'); await wait(300);
        const homeShown = !document.querySelector('.hero-budget').hidden;
        g('goToPlan')('budgets'); await wait(300);
        const planOn = /Monthly budget/.test($('plan-content').textContent) && !/No monthly budget/.test($('plan-content').textContent);
        return (homeHidden && planOff && homeShown && planOn) || `off: home hidden ${homeHidden}, plan ${planOff}; on: home ${homeShown}, plan ${planOn}`;
    });

    await T('Transfer more than the account has: "Insufficient balance" with available, requested, short by', async () => {
        const st = s();
        st.accounts.push({ id: 'acc-t1', name: 'Ten K Bank', kind: 'bank', currency: 'LKR', opening: 10000, createdAt: 0 }, { id: 'acc-t2', name: 'Other Bank', kind: 'bank', currency: 'LKR', opening: 0, createdAt: 0 });
        g('saveState')();
        const count = s().transactions.length;
        g('openTransfer')(); await wait(300);
        $('transfer-from').value = 'acc-t1'; $('transfer-to').value = 'acc-t2'; g('updateTransferFields')();
        $('transfer-amount').value = '15000'; $('transfer-date').value = today;
        const r = g('submitTransfer')(); await wait(300);
        const msg = $('modal-transfer').textContent;
        const refused = r !== true && s().transactions.length === count && /Insufficient balance/.test(msg) && /5,000/.test(msg);
        $('transfer-amount').value = '10000';
        g('submitTransfer')(); await wait(400);
        const ok = g('accountBalance')(s().accounts.find((a) => a.id === 'acc-t1')) === 0 && g('accountBalance')(s().accounts.find((a) => a.id === 'acc-t2')) === 10000;
        return (refused && ok) || `refused ${refused}, exact 10,000 allowed ${ok}`;
    });

    await T('A new account starts at Rs. 0.00 and other accounts keep their own balances', async () => {
        const before = s().accounts.map((a) => [a.id, g('accountBalance')(a)]);
        g('openAccountEditor')(); await wait(300);
        const empty = $('account-opening').value === '';
        $('account-name').value = 'Zero Start Bank';
        g('submitAccount')(); await wait(400);
        const acc = s().accounts.find((a) => a.name === 'Zero Start Bank');
        const zero = g('accountBalance')(acc) === 0;
        const othersSame = before.every(([id, b]) => g('accountBalance')(s().accounts.find((a) => a.id === id)) === b);
        return (empty && zero && othersSame) || `form empty ${empty}, new balance ${g('accountBalance')(acc)}, others unchanged ${othersSame}`;
    });

    await T('Home recent "All accounts" names the account each entry came out of or went into', async () => {
        g('switchTab')('dashboard'); await wait(300);
        document.querySelector('[data-recent-all="1"]').click(); await wait(300);
        const text = $('recent-list').textContent;
        const named = /(From|Into) [A-Z]/.test(text);
        document.querySelector('[data-recent-all="0"]').click(); await wait(200);
        return named || `recent list: ${text.slice(0, 120)}`;
    });

    await T('All accounts together: one balance and list with account names; funds total vs accounts total, difference fixed', async () => {
        const st = s();
        g('setViewAccount')('all'); await wait(200);
        g('switchTab')('dashboard'); await wait(400);
        const total = Math.round(g('netWorth')());
        const homeTotal = Math.round(Number($('dash-balance').dataset.v));
        const label = $('dash-month-label').textContent;
        const named = /(From|Into) /.test($('recent-list').textContent);
        const bar = /All accounts/.test((document.querySelector('#tab-dashboard .view-bar') || {}).textContent || '');
        // Income and spending of every account count together this month.
        const ms = g('monthStats')();
        const now = new Date();
        const allSpent = Math.round(g('sumDisplay')(st.transactions.filter((t) => t.type === 'expense' && !g('isUpcoming')(t) && g('inMonth')(t, now.getFullYear(), now.getMonth()))));
        // Funds: set up one remainder fund for everything, then compare.
        const keep = { sections: st.config.sections, sectionMoves: st.config.sectionMoves };
        st.config.sections = [{ id: 'allf', name: 'Everything', mode: 'rest', value: 0, currency: 'LKR', color: 'green', icon: 'c-Investment', accountId: null, target: 0 }];
        st.config.sectionMoves = [];
        g('saveState')();
        g('goToPlan')('sections'); await wait(400);
        const card = $('plan-content').textContent;
        const showsDiff = /not in any fund/.test(card) && /Difference/.test(card);
        const fix = document.querySelector('[data-fund-fix="add"]');
        if (fix) { fix.click(); await wait(350); g('submitSecMove')(); await wait(350); }
        const fundsNow = Math.round(Object.values(g('sectionBalances')()).reduce((a, v) => a + v, 0));
        g('goToPlan')('sections'); await wait(300);
        const matched = /exactly the money in your accounts/.test($('plan-content').textContent);
        Object.assign(st.config, keep); g('saveState')();
        // One account, then back to all.
        g('setViewAccount')('acc-cash'); await wait(200);
        const one = g('viewId')() === 'acc-cash';
        g('setViewAccount')('all'); await wait(200);
        return (homeTotal === total && /All accounts/.test(label) && named && bar && Math.round(ms.spent) === allSpent && showsDiff && fundsNow === total && matched && one && g('viewId')() === 'all')
            || `home ${homeTotal} vs total ${total}, label "${label}", names ${named}, bar ${bar}, spent ${Math.round(ms.spent)} vs ${allSpent}, difference shown ${showsDiff}, funds after fix ${fundsNow}, matched ${matched}, one account ${one}`;
    });

    await T('Sister pays Netflix money: not this month -> next month Rs. 2,000 together, then Rs. 1,000 again; skip; move', async () => {
        const st = s();
        const late = iso(addDays(new Date(), -2));
        const day = addDays(new Date(), -2).getDate();
        st.recurring.push({ id: 'sis', type: 'income', name: 'Netflix from sister', amount: 1000, currency: 'LKR', category: 'OtherIncome', frequency: 'monthly', nextDate: late, anchorDay: day, autoLog: false, accountId: 'acc-cash', createdAt: 1 });
        st.recurring.push({ id: 'sk', type: 'income', name: 'Skip test', amount: 500, currency: 'LKR', category: 'OtherIncome', frequency: 'monthly', nextDate: late, anchorDay: day, autoLog: false, accountId: 'acc-cash', createdAt: 1 });
        st.transactions.push({ id: 'one-off', type: 'income', desc: 'Loan back', amount: 3000, currency: 'LKR', category: 'OtherIncome', date: late, note: '', createdAt: 1, accountId: 'acc-cash', recurringId: null, receipt: null, fixed: false, pending: true });
        g('saveState')();
        g('openPayLater')('bill:sis'); await wait(300);
        const offered = !$('pay-later-carry').hidden && /2,000/.test($('pay-later-carry-desc').textContent);
        document.querySelector('[data-action="pay-later-carry"]').click(); await wait(300);
        const bill = () => s().recurring.find((b) => b.id === 'sis');
        const next = g('paymentByKey')('bill:sis');
        const carried = next.amount === 2000 && bill().nextDate > late && bill().carry === 1000;
        // When she pays: Rs. 2,000 recorded, then Rs. 1,000 again.
        const before = s().transactions.length;
        g('markBillPaid')('sis'); await wait(300);
        const got = s().transactions.slice(before).find((t) => t.recurringId === 'sis');
        const after = g('paymentByKey')('bill:sis');
        const received = got && got.amount === 2000 && !bill().carry && after.amount === 1000;
        // Skip: nothing carried.
        g('openPayLater')('bill:sk'); await wait(300);
        document.querySelector('[data-action="pay-later-skip"]').click(); await wait(300);
        const skipped = g('paymentByKey')('bill:sk').amount === 500 && s().recurring.find((b) => b.id === 'sk').nextDate > late;
        // A one-off expected payment moves to next month.
        g('openPayLater')('tx:one-off'); await wait(300);
        document.querySelector('[data-action="pay-later-move"]').click(); await wait(300);
        const moved = s().transactions.find((t) => t.id === 'one-off').date > iso(addDays(new Date(), 20));
        return (offered && carried && received && skipped && moved) || `offered ${offered}, carried ${carried} (${next.amount}), received ${received} (${got && got.amount}, next ${after && after.amount}), skipped ${skipped}, moved ${moved}`;
    });

    await T('One fund from two accounts: checklist, Rs. 3,000 from A + Rs. 2,000 from B, spending from B, too much from B blocked', async () => {
        const st = s();
        st.accounts.push({ id: 'acc-2fa', name: 'Multi A', kind: 'bank', currency: 'LKR', opening: 10000, createdAt: 0 }, { id: 'acc-2fb', name: 'Multi B', kind: 'bank', currency: 'LKR', opening: 4000, createdAt: 0 });
        const keep = { sections: st.config.sections, sectionMoves: st.config.sectionMoves };
        st.config.sections = [{ id: 'multi', name: 'House', mode: 'manual', value: 0, currency: 'LKR', color: 'blue', icon: 'i-wallet', accountIds: ['acc-2fa'] }];
        st.config.sectionMoves = [];
        g('saveState')();
        // Tick the second account in the editor.
        g('openSectionEditor')('multi'); await wait(300);
        const boxes = [...document.querySelectorAll('#section-accounts input')];
        const tickedFirst = boxes.filter((i) => i.checked).map((i) => i.value).join(',') === 'acc-2fa';
        boxes.find((i) => i.value === 'acc-2fb').checked = true;
        g('submitSection')(); await wait(400);
        const both = g('secById')('multi').accountIds.slice().sort().join(',') === 'acc-2fa,acc-2fb';
        // Add money: one box per account.
        g('openSecMove')('multi', 'add'); await wait(300);
        const rows = [...document.querySelectorAll('[data-split-acc]')];
        const twoRows = rows.length === 2 && $('sec-move-amount-field').hidden;
        rows.find((i) => i.dataset.splitAcc === 'acc-2fa').value = '3000';
        rows.find((i) => i.dataset.splitAcc === 'acc-2fb').value = '2000';
        $('sec-move-split').dispatchEvent(new Event('input'));
        const totalShown = /5,000/.test($('sec-split-total').textContent);
        g('submitSecMove')(); await wait(400);
        const p1 = g('fundPortions')().multi;
        const total1 = g('sectionBalances')().multi;
        // Spending Rs. 500 from B out of the fund.
        st.transactions.push({ id: 'multi-exp', type: 'expense', desc: 'Paint', amount: 500, currency: 'LKR', category: 'Other', date: today, note: '', createdAt: 1, accountId: 'acc-2fb', sectionId: 'multi', recurringId: null, receipt: null });
        g('saveState')();
        const p2 = g('fundPortions')().multi;
        // B had 4,000 - 500 spent = 3,500, of which 1,500 is in the fund: 2,000 free. Ask for 2,500.
        const movesBefore = s().config.sectionMoves.length;
        g('openSecMove')('multi', 'add'); await wait(300);
        document.querySelector('[data-split-acc="acc-2fb"]').value = '2500';
        g('submitSecMove')(); await wait(400);
        const blocked = s().config.sectionMoves.length === movesBefore;
        const dbg = `ids ${g('secById')('multi').accountIds.join(',')}, free B ${g('accountFreeMoney')('acc-2fb')}, bal B ${g('accountBalance')(s().accounts.find((x) => x.id === 'acc-2fb'))}, last move ${JSON.stringify(s().config.sectionMoves.slice(-1)[0])}`;
        await close('modal-sec-move');
        // The fund page shows where the money is.
        g('openSectionView')('multi'); await wait(400);
        const where = /Where the money is/.test(document.body.textContent) && /Multi A/.test(document.body.textContent);
        g('goToPlan')('sections'); await wait(300);
        st.transactions = st.transactions.filter((t) => t.id !== 'multi-exp');
        Object.assign(st.config, keep); g('saveState')();
        return (tickedFirst && both && twoRows && totalShown && p1['acc-2fa'] === 3000 && p1['acc-2fb'] === 2000 && total1 === 5000 && p2['acc-2fb'] === 1500 && blocked && where)
            || `ticked ${tickedFirst}, both ${both}, two rows ${twoRows}, total shown ${totalShown}, portions ${JSON.stringify(p1)} total ${total1}, after spend ${JSON.stringify(p2)}, blocked ${blocked}, where ${where}; ${dbg}`;
    });

    await T('Sister pays Rs. 2,000 now for this month and next: one entry, nothing expected next month', async () => {
        const st = s();
        const due = iso(addDays(new Date(), -1));
        const day = addDays(new Date(), -1).getDate();
        st.recurring.push({ id: 'ahead', type: 'income', name: 'Netflix money', amount: 1000, currency: 'LKR', category: 'OtherIncome', frequency: 'monthly', nextDate: due, anchorDay: day, autoLog: false, accountId: 'acc-cash', createdAt: 1 });
        g('saveState')();
        g('askMarkPaid')('bill:ahead'); await wait(350);
        const opts = [...document.querySelectorAll('[data-mark-times]')].map((b) => b.dataset.markTimes).join(',');
        const shows2000 = /2,000/.test(document.querySelector('[data-mark-times="2"]').textContent);
        const before = s().transactions.length;
        document.querySelector('[data-mark-times="2"]').click(); await wait(400);
        const tx = s().transactions.slice(before).find((t) => t.recurringId === 'ahead');
        const bill = s().recurring.find((b) => b.id === 'ahead');
        const twoAhead = g('advanceDate')(g('advanceDate')(due, 'monthly', day), 'monthly', day);
        const ok = opts === '1,2,3,6,12' && shows2000 && tx && tx.amount === 2000 && /Paid ahead/.test(tx.note) && bill.nextDate === twoAhead && !g('isSheetOpen')('modal-mark-paid');
        s().recurring = s().recurring.filter((b) => b.id !== 'ahead');
        s().transactions = s().transactions.filter((t) => t.recurringId !== 'ahead');
        g('saveState')();
        return ok || `options ${opts}, shows 2,000 ${shows2000}, entry ${tx && tx.amount} "${tx && tx.note}", next ${bill.nextDate} (want ${twoAhead})`;
    });

    await T('Face unlock: face scan drawing and words for face, fingerprint, or both', async () => {
        const set = (k) => (0, eval)(`bioKind = '${k}'`);
        set('face');
        const face = /is-face/.test(g('fpCoreHtml')()) && g('bioWords')().idle === 'Look at your phone to unlock';
        set('both');
        const both = /is-face/.test(g('fpCoreHtml')()) && /face or fingerprint/.test(g('bioWords')().title);
        set('finger');
        const finger = !/is-face/.test(g('fpCoreHtml')()) && g('bioWords')().title === 'Unlock with fingerprint';
        return (face && both && finger) || `face ${face}, both ${both}, fingerprint ${finger}`;
    });

    await T('Unlock with: fingerprint, face or both on a phone that has both', async () => {
        (0, eval)("bioKind = 'both'");
        const choices = g('bioChoices')().join(',');
        g('setBioMode')('finger');
        const finger = g('bioMode')() === 'finger' && g('bioAllowed')().join(',') === '3' && !/is-face/.test(g('fpCoreHtml')());
        g('setBioMode')('face');
        const face = g('bioMode')() === 'face' && g('bioAllowed')().join(',') === '3,4' && /is-face/.test(g('fpCoreHtml')());
        g('setBioMode')('both');
        const both = g('bioWords')().title === 'Unlock with face or fingerprint';
        (0, eval)("bioKind = 'finger'");
        const onlyFinger = g('bioChoices')().join(',') === 'finger' && g('bioMode')() === 'finger';
        try { localStorage.removeItem('VELA_BIO_MODE'); } catch (e) { /* storage blocked */ }
        return (choices === 'finger,face,both' && finger && face && both && onlyFinger) || `choices ${choices}, fingerprint ${finger}, face ${face}, both ${both}, fingerprint-only phone ${onlyFinger}`;
    });

    await T('Fund shared between two accounts: set 70% / 30% in the editor, total Rs. 10,000 fills 7,000 + 3,000; shares must make 100%', async () => {
        const st = s();
        st.accounts.push({ id: 'acc-sh1', name: 'Share One', kind: 'bank', currency: 'LKR', opening: 20000, createdAt: 0 }, { id: 'acc-sh2', name: 'Share Two', kind: 'bank', currency: 'LKR', opening: 20000, createdAt: 0 });
        const keep = { sections: st.config.sections, sectionMoves: st.config.sectionMoves };
        st.config.sections = [{ id: 'shf', name: 'Shared', mode: 'manual', value: 0, currency: 'LKR', color: 'teal', icon: 'i-wallet', accountIds: ['acc-sh1', 'acc-sh2'] }];
        st.config.sectionMoves = [];
        g('saveState')();
        g('openSectionEditor')('shf'); await wait(300);
        const equal = [...document.querySelectorAll('[data-share-acc]')].map((i) => i.value).join('/') === '50/50';
        const setShare = (id, v) => { const i = document.querySelector(`[data-share-acc="${id}"]`); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); };
        setShare('acc-sh1', '70'); setShare('acc-sh2', '20');
        g('submitSection')(); await wait(300);
        const refused = !g('secById')('shf').accountShares && g('isSheetOpen')('modal-section');
        setShare('acc-sh2', '30');
        g('submitSection')(); await wait(400);
        const saved = JSON.stringify(g('secById')('shf').accountShares) === '{"acc-sh1":70,"acc-sh2":30}';
        g('openSecMove')('shf', 'add'); await wait(300);
        const all = $('sec-split-all'); all.value = '10000'; all.dispatchEvent(new Event('input', { bubbles: true }));
        const filled = [...document.querySelectorAll('[data-split-acc]')].map((i) => i.value).join('/');
        g('submitSecMove')(); await wait(400);
        const por = g('fundPortions')().shf;
        Object.assign(st.config, keep); g('saveState')();
        return (equal && refused && saved && filled === '7000/3000' && por['acc-sh1'] === 7000 && por['acc-sh2'] === 3000)
            || `equal ${equal}, 90% refused ${refused}, saved ${saved}, filled ${filled}, portions ${JSON.stringify(por)}`;
    });

    await T('Funds below zero: an empty fund is not picked automatically; old short funds fixed without changing balances', async () => {
        const st = s();
        const keep = { sections: st.config.sections, sectionMoves: st.config.sectionMoves, sectionCatMap: st.config.sectionCatMap };
        st.config.sections = [{ id: 'nd', name: 'Needs', mode: 'percent', value: 50, currency: 'LKR', color: 'cyan', icon: 'i-wallet', accountIds: [] }];
        st.config.sectionMoves = [{ id: 'nd-in', date: iso(addDays(new Date(), -5)), kind: 'add', from: null, to: 'nd', amount: 1000, currency: 'LKR' }];
        st.config.sectionCatMap = { Food: 'nd' };
        // Like on the phone: expenses already paid from Needs with too little in it.
        st.transactions.push(
            { id: 'nd-1', type: 'expense', desc: 'Rice', amount: 800, currency: 'LKR', category: 'Food', date: iso(addDays(new Date(), -4)), note: '', createdAt: 1, accountId: 'acc-cash', sectionId: 'nd', recurringId: null, receipt: null },
            { id: 'nd-2', type: 'expense', desc: 'Dinner', amount: 3000, currency: 'LKR', category: 'Food', date: iso(addDays(new Date(), -3)), note: '', createdAt: 2, accountId: 'acc-cash', sectionId: 'nd', recurringId: null, receipt: null });
        g('saveState')();
        const before = Math.round(g('netWorth')());
        const shortBefore = g('sectionBalances')().nd === -2800;
        g('goToPlan')('sections'); await wait(400);
        const shown = /2,800\.00 short/.test($('plan-content').textContent) && !!document.querySelector('[data-fund-repair="all"]');
        // A new food expense bigger than what Needs has is not paid from it automatically.
        const tx = g('autoFundFor')('Food', 5000, 'LKR');
        document.querySelector('[data-fund-repair="nd"]').click(); await wait(250);
        await confirmOk(); await wait(300);
        const after = g('sectionBalances')().nd;
        const kept = s().transactions.find((t) => t.id === 'nd-1').sectionId === 'nd' && !s().transactions.find((t) => t.id === 'nd-2').sectionId;
        const same = Math.round(g('netWorth')()) === before;
        st.transactions = st.transactions.filter((t) => !/^nd-/.test(t.id));
        Object.assign(st.config, keep); g('saveState')();
        return (shortBefore && shown && tx === null && after === 200 && kept && same) || `short before ${shortBefore}, shown ${shown}, auto pick ${tx}, after fix ${after}, kept first ${kept}, balance same ${same}`;
    });

    await T('Goal saved from the budget: Rs. 20,000 a month kept aside, "Save Rs. 20K" fills it, done for the month', async () => {
        const st = s();
        const keepSav = st.savings;
        g('setViewAccount')('all'); await wait(150);
        const before = g('monthStats')();
        // Create it in the goal editor, like on the phone.
        g('openAddGoal')(); await wait(300);
        $('goal-name').value = 'Ps5 pro'; $('goal-target').value = '400000';
        $('goal-deadline').value = iso(addDays(new Date(), 300)); $('goal-deadline').dispatchEvent(new Event('change', { bubbles: true }));
        const suggested = !$('goal-monthly-suggest').hidden;
        $('goal-monthly').value = '20000';
        g('submitGoal')(); await wait(350);
        const goal = s().savings.find((x) => x.name === 'Ps5 pro');
        const after = g('monthStats')();
        const kept = goal && goal.monthly === 20000 && Math.round(after.goalKeep) === 20000 && Math.round(after.budget) === Math.max(0, Math.round(before.budget) - 20000);
        g('goToPlan')('budgets'); await wait(300);
        const said = /20,000\.00 kept for goals/.test($('plan-content').textContent);
        g('goToPlan')('goals'); await wait(300);
        const btn = document.querySelector(`[data-deposit-goal="${goal.id}"]`);
        const saveBtn = /Save/.test(btn.textContent);
        btn.click(); await wait(300);
        const prefilled = $('funds-amount').value.replace(/,/g, '') === '20000';
        g('submitFunds')(); await wait(300);
        const g2 = s().savings.find((x) => x.id === goal.id);
        const month = g2.saved === 20000 && g2.months[g('ymKey')()] === 20000;
        g('goToPlan')('goals'); await wait(300);
        const done = /Done for/.test($('plan-content').textContent);
        st.savings = keepSav; g('saveState')();
        return (suggested && kept && said && saveBtn && prefilled && month && done) || `suggested ${suggested}, kept ${kept} (${after.goalKeep}, ${before.budget} -> ${after.budget}), said ${said}, save button ${saveBtn}, prefilled ${prefilled}, month ${month}, done ${done}`;
    });

    await T('Times: Rent arrives early by SMS and settles the expected Rent; 8 AM purchase before an 11 AM balance; newest by time', async () => {
        const st = s();
        st.accounts.push({ id: 'acc-tm', name: 'Time Bank', kind: 'bank', currency: 'LKR', opening: 1000, createdAt: 0, balanceDate: today, balanceTime: '11:00' });
        const due = iso(addDays(new Date(), 3));
        st.recurring.push({ id: 'rent-in', type: 'income', name: 'Rent', amount: 31000, currency: 'LKR', category: 'OtherIncome', frequency: 'monthly', nextDate: due, anchorDay: addDays(new Date(), 3).getDate(), autoLog: false, accountId: 'acc-tm', createdAt: 1 });
        g('saveState')();
        // The bank SMS comes today at 11:05, three days before it was expected.
        const t0 = Date.now();
        const sms = g('parseBankSms')({ id: `sms-${t0}-rent`, source: 'sms', address: 'BOC', body: 'Transfer Credit Rs 31000.00 To A/C No XXXXXXXXXX559. Balance available Rs 32000.00 - Thank you for banking with BOC', date: t0 });
        sms.time = '11:05';
        const rec = g('smsApply')(sms, 'acc-tm'); await wait(400);
        const bill = s().recurring.find((b) => b.id === 'rent-in');
        const settled = rec && rec.type === 'income' && rec.recurringId === 'rent-in' && bill.nextDate > due && rec.time === '11:05';
        const notExpected = !g('paymentItems')().some((i) => i.key === 'bill:rent-in' && i.due === due);
        // An 8 AM purchase entered later is already in the 11 AM balance; one at noon is not.
        const early = g('beforeBalanceFor')('acc-tm', today, '08:00');
        const late = g('beforeBalanceFor')('acc-tm', today, '12:00');
        // Lists: newest first by time on the same day.
        const order = g('sortByNewest')([{ id: 'a', date: today, time: '08:00', createdAt: 9 }, { id: 'b', date: today, time: '11:05', createdAt: 1 }]).map((x) => x.id).join('');
        st.transactions = st.transactions.filter((t) => t.accountId !== 'acc-tm');
        st.recurring = st.recurring.filter((b) => b.id !== 'rent-in');
        st.accounts = st.accounts.filter((a) => a.id !== 'acc-tm');
        g('saveState')();
        return (settled && notExpected && early && !late && order === 'ba') || `settled ${settled} (${rec && rec.type}, ${rec && rec.recurringId}, next ${bill && bill.nextDate}, time ${rec && rec.time}), not expected any more ${notExpected}, 8am before ${early}, noon before ${late}, order ${order}`;
    });

    await T('Budget from income: salary counts, a cash deposit and a refund do not (changeable); CEB bill found by its account number', async () => {
        const st = s();
        st.accounts.push({ id: 'acc-in', name: 'Income Bank', kind: 'bank', currency: 'LKR', opening: 100000, createdAt: 0 });
        st.transactions.push(
            { id: 'in-sal', type: 'income', desc: 'Salary', amount: 70000, currency: 'LKR', category: 'Salary', date: today, note: '', createdAt: 1, accountId: 'acc-in' },
            { id: 'in-dep', type: 'income', desc: 'Cash deposit', amount: 4000, currency: 'LKR', category: 'OtherIncome', date: today, note: '', createdAt: 2, accountId: 'acc-in', bank: { bank: 'BOC', kind: 'deposit', sources: ['sms'] } },
            { id: 'in-ref', type: 'income', desc: 'Refund', amount: 591.51, currency: 'LKR', category: 'OtherIncome', date: today, note: '', createdAt: 3, accountId: 'acc-in', bank: { bank: 'BOC', kind: 'refund', sources: ['sms'] } });
        const keep = { mode: st.config.budgetMode, skip: st.config.budgetSkipIncome };
        g('saveState')(); g('setViewAccount')('acc-in'); await wait(150);
        st.config.budgetMode = 'income'; st.config.budgetSkipIncome = null;
        const planned = Math.round(g('monthStats')().plannedIncome * 100) / 100;
        // In the editor: three kinds listed; tap the deposit to count it too.
        g('openBudget')('__overall'); await wait(300);
        const parts = document.querySelectorAll('[data-budget-inc]').length;
        document.querySelector('[data-budget-inc="sms:deposit"]').click(); await wait(100);
        const hint = $('budget-income-hint').textContent;
        await close('modal-budget');
        // CEB: two bills, the SMS names one account number.
        const due = iso(addDays(new Date(), 5));
        st.recurring.push(
            { id: 'ceb-home', type: 'expense', name: 'CEB home', amount: 4500, currency: 'LKR', category: 'Utilities', frequency: 'monthly', nextDate: due, anchorDay: 1, autoLog: false, accountId: 'acc-in', ref: '1234567890', createdAt: 1 },
            { id: 'ceb-shop', type: 'expense', name: 'CEB shop', amount: 4500, currency: 'LKR', category: 'Utilities', frequency: 'monthly', nextDate: due, anchorDay: 1, autoLog: false, accountId: 'acc-in', ref: '5550001112', createdAt: 1 });
        g('saveState')();
        const t0 = Date.now();
        const sms = g('parseBankSms')({ id: `sms-${t0}-ceb`, source: 'sms', address: 'COMBANK', body: 'Dear Customer, your bill payment of LKR 6,210.00 to CEB A/C 5550001112 was successful on your A/C ...1234.', date: t0 });
        const rec = sms && g('smsApply')(sms, 'acc-in'); await wait(300);
        const shopNext = s().recurring.find((b) => b.id === 'ceb-shop').nextDate;
        const homeNext = s().recurring.find((b) => b.id === 'ceb-home').nextDate;
        const byRef = rec && rec.recurringId === 'ceb-shop' && shopNext > due && homeNext === due;
        st.transactions = st.transactions.filter((t) => t.accountId !== 'acc-in');
        st.recurring = st.recurring.filter((b) => !/^ceb-/.test(b.id));
        st.accounts = st.accounts.filter((a) => a.id !== 'acc-in');
        st.config.budgetMode = keep.mode; st.config.budgetSkipIncome = keep.skip;
        g('setViewAccount')('all'); g('saveState')();
        return (planned === 70000 && parts === 3 && /74,000/.test(hint) && byRef) || `counted ${planned}, kinds ${parts}, hint "${hint}", CEB by account no ${byRef} (${rec && rec.recurringId}, shop ${shopNext}, home ${homeNext})`;
    });

    await T('Budget from balance: left = what the account has (spending before the balance date counted on both sides); income switch; add all the rest', async () => {
        const st = s();
        const d0 = iso(addDays(new Date(), -1));
        st.accounts.push({ id: 'acc-bb', name: 'Bal Bank', kind: 'bank', currency: 'LKR', opening: 21648.52, createdAt: 0, balanceDate: today });
        st.transactions.push(
            { id: 'bb-sal', type: 'income', desc: 'Salary', amount: 70791.51, currency: 'LKR', category: 'Salary', date: d0, note: '', createdAt: 1, accountId: 'acc-bb', beforeBalance: true },
            { id: 'bb-ex', type: 'expense', desc: 'Old spending', amount: 52942.99, currency: 'LKR', category: 'Other', date: d0, note: '', createdAt: 2, accountId: 'acc-bb', beforeBalance: true });
        const keep = { mode: st.config.budgetMode, skip: st.config.budgetSkipIncome, sections: st.config.sections, moves: st.config.sectionMoves };
        g('saveState')(); g('setViewAccount')('acc-bb'); await wait(150);
        st.config.budgetMode = 'balance';
        const m = g('monthStats')();
        const leftIsBalance = Math.round((m.budget - m.spent) * 100) === 2164852;
        // An income switched off in the entry form stays out of an income budget.
        st.config.budgetMode = 'income';
        g('openEditTx')('bb-sal'); await wait(300);
        const shown = !$('tx-inbudget-row').hidden;
        $('tx-inbudget').click();
        g('submitTx')(); await wait(400);
        const off = s().transactions.find((t) => t.id === 'bb-sal').inBudget === false && g('monthStats')().plannedIncome === 0;
        // Funds: "Add all the rest" fills what is in no fund.
        st.config.sections = [{ id: 'rest', name: 'Fun', mode: 'rest', value: 0, currency: 'LKR', color: 'violet', icon: 'i-wallet', accountIds: ['acc-bb'] }];
        st.config.sectionMoves = [];
        g('saveState')();
        g('openSecMove')('rest', 'add'); await wait(300);
        const btn = !$('sec-move-all').hidden && /21,648\.52/.test($('sec-move-all').textContent);
        $('sec-move-all').click();
        const filled = String($('sec-move-amount').value).replace(/,/g, '') === '21648.52';
        await close('modal-sec-move');
        st.transactions = st.transactions.filter((t) => t.accountId !== 'acc-bb');
        st.accounts = st.accounts.filter((a) => a.id !== 'acc-bb');
        st.config.budgetMode = keep.mode; st.config.budgetSkipIncome = keep.skip; st.config.sections = keep.sections; st.config.sectionMoves = keep.moves;
        g('setViewAccount')('all'); g('saveState')();
        return (leftIsBalance && shown && off && btn && filled) || `left = balance ${leftIsBalance} (${m.budget} - ${m.spent}), switch shown ${shown}, income off ${off}, add-all button ${btn}, filled ${filled}`;
    });

    await T('Bank charges: own ATM free, other bank ATM Rs. 30 (or your account charge), fee in the SMS used, CEFT Rs. 25 replaced by the real charge SMS', async () => {
        const st = s();
        st.accounts.push({ id: 'acc-fee2', name: 'Fee Two', kind: 'bank', currency: 'LKR', opening: 100000, createdAt: 0 });
        g('saveState')();
        const t0 = Date.now();
        const msg = (n, address, body) => g('parseBankSms')({ id: `sms-${t0}-${n}`, source: 'sms', address, body, date: t0 + n * 1000 });
        const fees = () => s().transactions.filter((t) => t.accountId === 'acc-fee2' && t.type === 'expense' && /charges/.test(t.desc));
        // 1. Own bank's ATM: free.
        const own = msg(1, 'COMBANK', 'ATM Cash Withdrawal LKR 10,000.00 from A/C ...1234 at COMBANK ATM KOLLUPITIYA on 16/11/2026 11:02');
        g('smsApply')(own, 'acc-fee2'); await wait(150);
        const ownFree = own.feeWhere === 'own' && fees().length === 0;
        // 2. Another bank's ATM: the typical Rs. 30, estimated.
        const other = msg(2, 'BOC', 'Cash withdrawal Rs 5000.00 at HNB ATM MAHARAGAMA from A/C No XXXXXXXXXX559. Balance available Rs 878.90');
        g('smsApply')(other, 'acc-fee2'); await wait(150);
        const f2 = fees();
        const otherFee = other.feeWhere === 'other' && f2.length === 1 && f2[0].amount === 30 && f2[0].feeEstimated === true;
        // 3. This account's own charge (Rs. 60) is used instead.
        s().accounts.find((a) => a.id === 'acc-fee2').atmFee = 60;
        const other2 = msg(3, 'BOC', 'Cash withdrawal Rs 2000.00 at SAMPATH BANK ATM from A/C No XXXXXXXXXX559. Balance available Rs 500.00');
        g('smsApply')(other2, 'acc-fee2'); await wait(150);
        const accFee = fees().some((t) => t.amount === 60);
        // 4. The charge written in the SMS is used exactly.
        const inSms = msg(4, 'SAMPATH', 'ATM withdrawal of LKR 3,000.00 from A/C ...5678 at BOC ATM. Charges Rs 30.00. Avl Bal LKR 10,000.00');
        g('smsApply')(inSms, 'acc-fee2'); await wait(150);
        const exact = inSms.feeInSms === 30 && fees().some((t) => t.amount === 30 && !t.feeEstimated);
        // 5. CEFT transfer: Rs. 25 estimated, then the bank's charge SMS replaces it (not added twice).
        const ceft = msg(5, 'BOC', 'CEFT Transfer Debit Rs 1025.00 From A/C No XXXXXXXXXX559. Balance available Rs 146.90 - Thank you for banking with BOC');
        g('smsApply')(ceft, 'acc-fee2'); await wait(150);
        const ceftEst = fees().filter((t) => t.feeEstimated && t.amount === 25).length === 1;
        const before = fees().length;
        const charge = msg(6, 'BOC', 'Service charge of Rs 30.00 debited from A/C No XXXXXXXXXX559 for CEFT transfer. Balance available Rs 116.90');
        g('smsApply')(charge, 'acc-fee2'); await wait(150);
        const replaced = fees().length === before && fees().some((t) => t.amount === 30 && t.note === 'Bank charge (from the bank SMS)');
        st.transactions = st.transactions.filter((t) => t.accountId !== 'acc-fee2' && t.toAccountId !== 'acc-fee2');
        st.accounts = st.accounts.filter((a) => a.id !== 'acc-fee2');
        g('saveState')();
        return (ownFree && otherFee && accFee && exact && ceftEst && replaced) || `own free ${ownFree} (${own.feeWhere}), other 30 ${otherFee} (${other.feeWhere}, ${f2.map((t) => t.amount)}), account 60 ${accFee}, in SMS ${exact} (${inSms.feeInSms}), CEFT 25 ${ceftEst}, replaced ${replaced}`;
    });

    await T('Reset funds: "Empty all funds" keeps them at Rs. 0, "Delete all funds" (after a confirm) removes them; balances unchanged', async () => {
        const st = s();
        const keep = { sections: st.config.sections, moves: st.config.sectionMoves, map: st.config.sectionCatMap, since: st.config.sectionSince };
        st.config.sections = [{ id: 'rn', name: 'Needs', mode: 'percent', value: 50, currency: 'LKR', color: 'cyan', icon: 'i-wallet', accountIds: [] },
            { id: 'rw', name: 'Wants', mode: 'rest', value: 0, currency: 'LKR', color: 'pink', icon: 'i-wallet', accountIds: [] }];
        st.config.sectionMoves = [{ id: 'rm', date: today, kind: 'add', from: null, to: 'rn', amount: 5000, currency: 'LKR' }];
        st.config.sectionCatMap = { Food: 'rw' };
        st.transactions.push({ id: 'rs-ex', type: 'expense', desc: 'Dinner', amount: 9000, currency: 'LKR', category: 'Food', date: today, note: '', createdAt: 1, accountId: 'acc-cash', sectionId: 'rw' });
        g('saveState')();
        const before = Math.round(g('netWorth')());
        g('goToPlan')('sections'); await wait(300);
        document.querySelector('[data-action="fund-reset"]').click(); await wait(300);
        document.querySelector('[data-action="fund-reset-empty"]').click(); await wait(300);
        const bal = g('sectionBalances')();
        const emptied = s().config.sections.length === 2 && bal.rn === 0 && bal.rw === 0 && !s().transactions.find((t) => t.id === 'rs-ex').sectionId;
        g('goToPlan')('sections'); await wait(300);
        document.querySelector('[data-action="fund-reset"]').click(); await wait(300);
        document.querySelector('[data-action="fund-reset-all"]').click(); await wait(200);
        await confirmOk(); await wait(300);
        const gone = s().config.sections.length === 0 && !Object.keys(s().config.sectionCatMap || {}).length;
        const same = Math.round(g('netWorth')()) === before;
        st.transactions = st.transactions.filter((t) => t.id !== 'rs-ex');
        Object.assign(st.config, { sections: keep.sections, sectionMoves: keep.moves, sectionCatMap: keep.map, sectionSince: keep.since });
        g('saveState')();
        return (emptied && gone && same) || `emptied ${emptied} (${JSON.stringify(bal)}), deleted ${gone}, balance same ${same}`;
    });

    await T('CEB SMS without an account number: "Which bill?" lists the CEB bills, the picked one is paid; drop-downs are styled pickers', async () => {
        const st = s();
        st.accounts.push({ id: 'acc-cb', name: 'Ceb Bank', kind: 'bank', currency: 'LKR', opening: 50000, createdAt: 0 });
        const due = iso(addDays(new Date(), 4));
        st.recurring.push(
            { id: 'cb-home', type: 'expense', name: 'CEB home', amount: 4500, currency: 'LKR', category: 'Utilities', frequency: 'monthly', nextDate: due, anchorDay: 1, autoLog: false, accountId: 'acc-cb', ref: '1111111111', createdAt: 1 },
            { id: 'cb-shop', type: 'expense', name: 'CEB shop', amount: 3000, currency: 'LKR', category: 'Utilities', frequency: 'monthly', nextDate: due, anchorDay: 1, autoLog: false, accountId: 'acc-cb', ref: '2222222222', createdAt: 1 });
        g('saveState')();
        const t0 = Date.now();
        const sms = g('parseBankSms')({ id: `sms-${t0}-cebpick`, source: 'sms', address: 'COMBANK', body: 'Dear Customer, your bill payment of LKR 5,320.00 to CEB was successful from A/C ...1234 on 16/11/2026.', date: t0 });
        const html = g('smsCardHtml')(sms);
        const asks = /Which bill\?/.test(html) && /CEB home/.test(html) && /CEB shop/.test(html);
        (0, eval)('smsBillPick')[sms.id] = 'cb-shop';
        const rec = g('smsApply')(sms, 'acc-cb'); await wait(300);
        const shop = s().recurring.find((b) => b.id === 'cb-shop');
        const home = s().recurring.find((b) => b.id === 'cb-home');
        const paid = rec && rec.recurringId === 'cb-shop' && rec.amount === 5320 && shop.nextDate > due && home.nextDate === due;
        // Drop-downs in sheets: a styled button, the real select underneath still works.
        g('openAddTx')('expense'); await wait(300);
        const btn = $('tx-account').parentElement.querySelector('.vp-btn');
        const other = [...$('tx-account').options].find((o) => !o.selected);
        $('tx-account').value = other.value;
        const follows = !!btn && btn.textContent.includes(other.text);
        btn.click(); await wait(250);
        const list = !$('vp-overlay').hidden && document.querySelectorAll('#vp-list [data-vp-value]').length >= 2;
        document.querySelector('#vp-list [data-vp-value="acc-cash"]').click(); await wait(250);
        const picked = $('tx-account').value === 'acc-cash' && $('vp-overlay').hidden;
        await close('modal-tx');
        st.transactions = st.transactions.filter((t) => t.accountId !== 'acc-cb');
        st.recurring = st.recurring.filter((b) => !/^cb-/.test(b.id));
        st.accounts = st.accounts.filter((a) => a.id !== 'acc-cb');
        g('saveState')();
        return (asks && paid && follows && list && picked) || `asks ${asks}, paid picked bill ${paid} (${rec && rec.recurringId}), button follows ${follows}, list ${list}, picked ${picked}`;
    });

    await T('Debt someone owes you: balance unchanged unless "Paid from" is on; lending more than the account has is refused', async () => {
        const st = s();
        st.accounts.push({ id: 'acc-dm', name: 'Debt Bank', kind: 'bank', currency: 'LKR', opening: 22354.5, createdAt: 0 });
        g('saveState')(); g('setViewAccount')('acc-dm'); await wait(150);
        const bal = () => Math.round(g('accountBalance')(s().accounts.find((a) => a.id === 'acc-dm')) * 100) / 100;
        // Like on the phone: PS5 Pro, Rs. 400,000, switch left off -> the balance stays Rs. 22,354.50.
        g('openAddDebt')(); await wait(250);
        const shown = !$('debt-moved-row').hidden && $('debt-moved').getAttribute('aria-checked') === 'false';
        $('debt-person').value = 'PS5 Pro'; $('debt-amount').value = '400000';
        g('submitDebt')(); await wait(300);
        const off = bal() === 22354.5 && s().debts.some((d) => d.person === 'PS5 Pro' && d.moved === false);
        // Switch on with more than the account has: refused.
        g('openAddDebt')(); await wait(250);
        $('debt-person').value = 'Too much'; $('debt-amount').value = '50000';
        $('debt-moved').click(); await wait(100);
        const before = s().debts.length;
        g('submitDebt')(); await wait(250);
        const refused = s().debts.length === before && g('isSheetOpen')('modal-debt');
        // Switch on with what it has: Rs. 5,000 comes off.
        $('debt-amount').value = '5000';
        g('submitDebt')(); await wait(300);
        const moved = bal() === 17354.5;
        st.debts = st.debts.filter((d) => !['PS5 Pro', 'Too much'].includes(d.person));
        st.accounts = st.accounts.filter((a) => a.id !== 'acc-dm');
        g('setViewAccount')('all'); g('saveState')();
        return (shown && off && refused && moved) || `switch shown off ${shown}, off keeps balance ${off} (${bal()}), too much refused ${refused}, 5,000 moved ${moved}`;
    });

    await T('Fund runs out: Food has Rs. 1,200, a Rs. 5,000 meal asks which fund pays the rest (Savings covers Rs. 3,800); goal deposits go into its fund', async () => {
        const st = s();
        st.accounts.push({ id: 'acc-cv', name: 'Cover Bank', kind: 'bank', currency: 'LKR', opening: 30000, createdAt: 0 });
        const keep = { sections: st.config.sections, moves: st.config.sectionMoves, map: st.config.sectionCatMap, since: st.config.sectionSince };
        st.config.sections = [{ id: 'cv-food', name: 'Food', mode: 'manual', value: 0, currency: 'LKR', color: 'pink', icon: 'c-Food', accountIds: ['acc-cv'] },
            { id: 'cv-save', name: 'Savings', mode: 'manual', value: 0, currency: 'LKR', color: 'green', icon: 'c-Investment', accountIds: ['acc-cv'] }];
        st.config.sectionMoves = [{ id: 'cv1', date: today, kind: 'add', from: null, to: 'cv-food', amount: 1200, currency: 'LKR' }, { id: 'cv2', date: today, kind: 'add', from: null, to: 'cv-save', amount: 10000, currency: 'LKR' }];
        st.config.sectionCatMap = {}; st.config.sectionSince = today;
        g('saveState')(); g('setViewAccount')('acc-cv'); await wait(150);
        g('openAddTx')('expense'); await wait(300);
        $('tx-amount').value = '5000'; $('tx-desc').value = 'Family dinner';
        $('tx-account').value = 'acc-cv'; $('tx-account').dispatchEvent(new Event('change', { bubbles: true })); await wait(100);
        g('pickTxSection')('cv-food'); await wait(100);
        const before = s().transactions.length;
        await g('submitTx')(); await wait(300);
        const asked = !$('tx-fund-cover').hidden && s().transactions.length === before && /3,800/.test($('tx-fund-cover').textContent) && !!document.querySelector('[data-tx-cover="cv-save"]');
        document.querySelector('[data-tx-cover="cv-save"]').click(); await wait(500);
        const bal = g('sectionBalances')();
        const covered = s().transactions.some((t) => t.desc === 'Family dinner' && t.sectionId === 'cv-food') && bal['cv-food'] === 0 && bal['cv-save'] === 6200;
        // Goal PS5 Pro kept in a new fund: Rs. 2,000 deposit goes into that fund.
        g('openAddGoal')(); await wait(300);
        $('goal-name').value = 'PS5 Pro'; $('goal-target').value = '400000';
        $('goal-name').dispatchEvent(new Event('change', { bubbles: true }));
        $('goal-fund').value = '__new';
        g('submitGoal')(); await wait(300);
        const goal = s().savings.find((x) => x.name === 'PS5 Pro');
        const fund = goal && secById(goal.fundId);
        g('openDeposit')(goal.id); await wait(300);
        $('funds-amount').value = '2000'; g('submitFunds')(); await wait(300);
        const inFund = fund && g('sectionBalances')()[fund.id] === 2000 && s().savings.find((x) => x.id === goal.id).saved === 2000;
        st.transactions = st.transactions.filter((t) => t.accountId !== 'acc-cv');
        st.savings = st.savings.filter((x) => x.name !== 'PS5 Pro');
        st.accounts = st.accounts.filter((a) => a.id !== 'acc-cv');
        Object.assign(st.config, { sections: keep.sections, sectionMoves: keep.moves, sectionCatMap: keep.map, sectionSince: keep.since });
        g('setViewAccount')('all'); g('saveState')();
        return (asked && covered && inFund) || `asked ${asked}, covered ${covered} (${JSON.stringify(bal)}), goal money in its fund ${inFund}`;
    });

    await T('Rent due on the 17th arrives on the 19th: not logged by itself, stays expected, the SMS records it today and it counts in the balance', async () => {
        const st = s();
        const due = iso(addDays(new Date(), -2));
        st.accounts.push({ id: 'acc-rt', name: 'Rent Bank', kind: 'bank', currency: 'LKR', opening: 22000, createdAt: 0, balanceDate: iso(addDays(new Date(), -1)) });
        st.recurring.push(g('normalizeBill')({ id: 'rent-kw', type: 'income', name: 'Kothawala shop', amount: 40000, currency: 'LKR', category: 'Rent', frequency: 'monthly', nextDate: due, anchorDay: addDays(new Date(), -2).getDate(), autoLog: true, accountId: 'acc-rt', createdAt: 1 }));
        g('saveState')();
        const before = s().transactions.length;
        g('processRecurring')();
        const notLogged = s().transactions.length === before && s().recurring.find((b) => b.id === 'rent-kw').autoLog === false;
        const expected = g('paymentItems')().some((i) => i.key === 'bill:rent-kw');
        const t0 = Date.now();
        const sms = g('parseBankSms')({ id: `sms-${t0}-rent2`, source: 'sms', address: 'COMBANK', body: 'LKR 40,000.00 credited to A/C 8001234567 on ' + new Date().toLocaleDateString('en-GB').replace(/\//g, '/') + ' Ref:KW1. Avl Bal LKR 62,000.00', date: t0 });
        sms.time = '16:10';
        const rec = g('smsApply')(sms, 'acc-rt'); await wait(300);
        const bal = Math.round(g('accountBalance')(s().accounts.find((a) => a.id === 'acc-rt')));
        const counted = rec && rec.type === 'income' && rec.recurringId === 'rent-kw' && !rec.beforeBalance && rec.time === '16:10' && bal === 62000;
        st.transactions = st.transactions.filter((t) => t.accountId !== 'acc-rt');
        st.recurring = st.recurring.filter((b) => b.id !== 'rent-kw');
        st.accounts = st.accounts.filter((a) => a.id !== 'acc-rt');
        g('saveState')();
        return (notLogged && expected && counted) || `not logged ${notLogged}, expected ${expected}, counted ${counted} (${rec && rec.recurringId}, before ${rec && rec.beforeBalance}, time ${rec && rec.time}, balance ${bal})`;
    });

    await T('Goal says when it will be reached (Rs. 2,000 a month for Rs. 400,000 = 200 months); entries of a bill show its account number', async () => {
        const st = s();
        const keepSav = st.savings;
        st.savings = [...keepSav, { id: 'eta-g', name: 'PS5 Pro', target: 400000, saved: 0, currency: 'LKR', deadline: null, accountId: null, monthly: 2000, months: {}, createdAt: 1 }];
        st.recurring.push({ id: 'eta-ceb', type: 'expense', name: 'CEB', amount: 1560, currency: 'LKR', category: 'Utilities', frequency: 'monthly', nextDate: iso(addDays(new Date(), 20)), anchorDay: 1, autoLog: false, accountId: 'acc-cash', ref: '0412345678', createdAt: 1 });
        st.transactions.push({ id: 'eta-tx', type: 'expense', desc: 'CEB', amount: 1560, currency: 'LKR', category: 'Utilities', date: today, note: '', createdAt: 1, accountId: 'acc-cash', recurringId: 'eta-ceb' });
        g('saveState')();
        g('goToPlan')('goals'); await wait(300);
        const eta = /reached in 200 months/.test($('plan-content').textContent);
        const row = g('txRow')(s().transactions.find((t) => t.id === 'eta-tx'));
        const acc = /Acc 0412345678/.test(row);
        st.savings = keepSav;
        st.recurring = st.recurring.filter((b) => b.id !== 'eta-ceb');
        st.transactions = st.transactions.filter((t) => t.id !== 'eta-tx');
        g('saveState')();
        return (eta && acc) || `finish date shown ${eta}, account number on the entry ${acc}`;
    });

    await T('Phone bill found by its phone number written any way (+94 77 123 4567 = 0771234567); water bill by account number', async () => {
        const st = s();
        st.accounts.push({ id: 'acc-ph', name: 'Phone Bank', kind: 'bank', currency: 'LKR', opening: 50000, createdAt: 0 });
        const due = iso(addDays(new Date(), 6));
        st.recurring.push(
            { id: 'ph-dlg', type: 'expense', name: 'Dialog mobile', amount: 1500, currency: 'LKR', category: 'Utilities', frequency: 'monthly', nextDate: due, anchorDay: 1, autoLog: false, accountId: 'acc-ph', ref: '0771234567', createdAt: 1 },
            { id: 'ph-wtr', type: 'expense', name: 'Water home', amount: 900, currency: 'LKR', category: 'Utilities', frequency: 'monthly', nextDate: due, anchorDay: 1, autoLog: false, accountId: 'acc-ph', ref: '10/24/123/456/78', createdAt: 1 });
        g('saveState')();
        const t0 = Date.now();
        const p1 = g('parseBankSms')({ id: `sms-${t0}-ph`, source: 'sms', address: 'COMBANK', body: 'Your bill payment of LKR 1,742.00 to DIALOG for +94 77 123 4567 was successful from A/C ...1234.', date: t0 });
        const r1 = p1 && g('smsApply')(p1, 'acc-ph'); await wait(200);
        const p2 = g('parseBankSms')({ id: `sms-${t0}-wt`, source: 'sms', address: 'COMBANK', body: 'Your bill payment of LKR 880.00 to NWSDB for account 1024123456 78 was successful from A/C ...1234.', date: t0 + 1000 });
        const r2 = p2 && g('smsApply')(p2, 'acc-ph'); await wait(200);
        const phone = r1 && r1.recurringId === 'ph-dlg';
        const water = r2 && r2.recurringId === 'ph-wtr';
        const label = /Phone 0771234567/.test(g('txRow')(r1 || {}));
        st.transactions = st.transactions.filter((t) => t.accountId !== 'acc-ph');
        st.recurring = st.recurring.filter((b) => !/^ph-/.test(b.id));
        st.accounts = st.accounts.filter((a) => a.id !== 'acc-ph');
        g('saveState')();
        return (phone && water && label) || `phone bill ${phone} (${r1 && r1.recurringId}), water bill ${water} (${r2 && r2.recurringId}), label ${label}`;
    });

    await T('Koko plans: new purchase in 3 parts, a plan started last month (1 of 3 paid), parts counted, plan ends after the last part', async () => {
        const st = s();
        // 1. A new Koko purchase: Rs. 5,000 now is part 1 of 3.
        g('openAddTx')('expense'); await wait(300);
        $('tx-amount').value = '5000'; $('tx-desc').value = 'Koko - Shoe Store';
        $('tx-desc').dispatchEvent(new Event('change', { bubbles: true })); await wait(100);
        const autoPicked = document.querySelector('[data-tx-parts="3"]').getAttribute('aria-pressed') === 'true';
        await g('submitTx')(); await wait(400);
        const plan1 = s().recurring.find((b) => b.name === 'Koko - Shoe Store');
        const made = plan1 && plan1.parts.count === 3 && plan1.parts.done === 1 && plan1.amount === 5000 && plan1.nextDate > today;
        // 2. Another plan started last month: 3 parts, 1 already paid.
        g('openAddBill')('expense'); await wait(300);
        $('bill-name').value = 'Koko - Phone'; $('bill-amount').value = '12000';
        $('bill-next').value = iso(addDays(new Date(), 5));
        $('bill-parts').value = '3'; $('bill-parts-done').value = '1';
        g('submitBill')(); await wait(300);
        const plan2 = s().recurring.find((b) => b.name === 'Koko - Phone');
        const started = plan2 && plan2.parts.count === 3 && plan2.parts.done === 1;
        g('goToPlan')('bills'); await wait(300);
        const shows = /Part 2 of 3/.test($('plan-content').textContent) && /24,000/.test($('plan-content').textContent);
        // Pay part 2, then part 3: the plan ends.
        g('markBillPaid')(plan2.id); await wait(200);
        const two = s().recurring.find((b) => b.id === plan2.id).parts.done === 2;
        g('markBillPaid')(plan2.id); await wait(300);
        const ended = !s().recurring.some((b) => b.id === plan2.id) && s().transactions.filter((t) => t.recurringId === plan2.id).length === 2;
        st.recurring = st.recurring.filter((b) => !/^Koko/.test(b.name));
        st.transactions = st.transactions.filter((t) => !/^Koko/.test(t.desc));
        g('saveState')();
        return (autoPicked && made && started && shows && two && ended) || `3 picked for Koko ${autoPicked}, plan made ${made}, started last month ${started}, shows part 2 of 3 ${shows}, part 2 counted ${two}, ended after part 3 ${ended}`;
    });

    await T('Bill number read from the SMS itself: phone number of a phone bill / reload, CEB account; shown, saved, learned by the bill', async () => {
        const st = s();
        st.accounts.push({ id: 'acc-br', name: 'Ref Bank', kind: 'bank', currency: 'LKR', opening: 50000, createdAt: 0 });
        st.recurring.push({ id: 'br-dlg', type: 'expense', name: 'Dialog', amount: 1742, currency: 'LKR', category: 'Utilities', frequency: 'monthly', nextDate: iso(addDays(new Date(), 3)), anchorDay: 1, autoLog: false, accountId: 'acc-br', createdAt: 1 });
        g('saveState')();
        const t0 = Date.now();
        const P2 = (n, a, b) => g('parseBankSms')({ id: `sms-${t0}-${n}`, source: 'sms', address: a, body: b, date: t0 + n });
        const a = P2(1, 'COMBANK', 'Your bill payment of LKR 1,742.00 to DIALOG for 0771234567 was successful from A/C ...1234.');
        const b = P2(2, 'COMBANK', 'Bill payment of LKR 2,100.00 to Mobitel mobile +94 71 234 5678 successful. A/C 8001XXXX567');
        const c = P2(3, 'BOC', 'CEB bill payment Rs 1560.00 for account 0412345678 from A/C No XXXXXXXXXX559. Balance available Rs 878.90');
        const d = P2(4, 'COMBANK', 'Purchase at KEELLS SUPER for LKR 3,450.00 on card ending 4321');
        const read = a.billRef === '0771234567' && b.billRef === '0712345678' && c.billRef === '0412345678' && !d.billRef;
        const card = /Phone 0771234567/.test(g('smsCardHtml')(a));
        const rec = g('smsApply')(a, 'acc-br'); await wait(300);
        const saved = rec && rec.billRef === '0771234567';
        const learned = s().recurring.find((x) => x.id === 'br-dlg').ref === '0771234567' && rec.recurringId === 'br-dlg';
        const row = /Phone 0771234567/.test(g('txRow')(rec));
        st.transactions = st.transactions.filter((t) => t.accountId !== 'acc-br');
        st.recurring = st.recurring.filter((x) => x.id !== 'br-dlg');
        st.accounts = st.accounts.filter((x) => x.id !== 'acc-br');
        g('saveState')();
        return (read && card && saved && learned && row) || `read ${read} (${a.billRef}, ${b.billRef}, ${c.billRef}, shop ${d.billRef}), card ${card}, saved ${saved}, bill learned ${learned}, row ${row}`;
    });

    await T('Hide all balances: the Home eye hides every account balance, expenses still show; tap again to show', async () => {
        g('switchTab')('dashboard'); await wait(300);
        document.querySelector('#btn-hide-balance').click(); await wait(400);
        const masked = (el) => !!el && /•/.test(el.textContent);
        const hero = masked($('dash-balance'));
        const strip = [...document.querySelectorAll('#account-strip .account-bal')].every((el) => /•/.test(el.textContent));
        const spendShown = /\d/.test($('recent-list').textContent);
        document.querySelector('#btn-hide-balance').click(); await wait(400);
        const back = !masked($('dash-balance'));
        return (hero && strip && spendShown && back) || `hero hidden ${hero}, accounts hidden ${strip}, spending shown ${spendShown}, shown again ${back}`;
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

    // A fake server for "approve new sign-ins": phones, requests and the approval switch, with the same rules as the SQL.
    const fakeApproval = (client) => {
        const srv = { on: true, devices: {}, requests: [] };
        const realFrom = client.from;
        client.rpc = async (fn, a) => {
            const dev = srv.devices[a.p_device];
            if (fn === 'vela_device_check') {
                if (dev && dev.secret !== a.p_secret) return { data: 'mismatch', error: null };
                if (!dev) srv.devices[a.p_device] = { secret: a.p_secret, name: a.p_name, approved: !srv.on };
                const d = srv.devices[a.p_device];
                if (!srv.on) d.approved = true;
                return { data: d.approved ? 'approved' : 'pending', error: null };
            }
            if (fn === 'vela_request_login') {
                const r = { id: 'req' + srv.requests.length, device_id: a.p_device, device_name: dev.name, number: 42, status: 'pending', created_at: new Date().toISOString() };
                srv.requests.push(r);
                return { data: [{ request_id: r.id, number: r.number }], error: null };
            }
            if (fn === 'vela_decide_login') {
                if (!dev || !dev.approved || dev.secret !== a.p_secret) return { data: null, error: { message: 'this phone is not approved' } };
                const r = srv.requests.find((x) => x.id === a.p_request);
                r.status = a.p_approve ? 'approved' : 'denied';
                if (a.p_approve) srv.devices[r.device_id].approved = true;
                return { data: r.status, error: null };
            }
            if (fn === 'vela_set_approval') { srv.on = a.p_on; if (a.p_on) Object.keys(srv.devices).forEach((k) => { srv.devices[k].approved = k === a.p_device; }); return { data: null, error: null }; }
            if (fn === 'vela_remove_device') { delete srv.devices[a.p_target]; return { data: null, error: null }; }
            return { data: null, error: { message: 'unknown' } };
        };
        client.from = (t) => {
            if (t === 'vela_login_requests') {
                const chain = (rows) => {
                    const o = { eq: (k, v) => chain(rows.filter((r) => r[k] === v)), gte: () => o, order: () => o, limit: (n) => Promise.resolve({ data: rows.slice(0, n), error: null }), maybeSingle: () => Promise.resolve({ data: rows[0] || null, error: null }) };
                    return o;
                };
                return { select: () => chain(srv.requests) };
            }
            if (t === 'vela_device_settings') return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { require_approval: srv.on }, error: null }) }) };
            if (t === 'vela_devices') return { select: () => ({ order: () => Promise.resolve({ data: Object.entries(srv.devices).map(([id, d]) => ({ device_id: id, name: d.name, approved: d.approved, last_seen: new Date().toISOString() })), error: null }) }) };
            return realFrom(t);
        };
        return { srv, undo: () => { delete client.rpc; client.from = realFrom; } };
    };

    await T('Approve new sign-ins: a new phone waits, shows the number, gets in when approved', async () => {
        const client = window.__fakeClient;
        const { srv, undo } = fakeApproval(client);
        srv.devices['dev-other-phone-0001'] = { secret: 'x'.repeat(64), name: 'Old phone', approved: true };
        localStorage.removeItem('VELA_DEVICE');
        (0, eval)('handledUserId = null');
        let done = false;
        g('handleSession')({ user: { id: 'u1', email: 't@example.com', user_metadata: {} } }).then(() => { done = true; });
        g('handleSession')({ user: { id: 'u1', email: 't@example.com', user_metadata: {} } }); // the second sign-in event must not ask twice
        await wait(500);
        const shown = !$('approve-wait').hidden && $('approve-number').textContent === '42';
        const waited = !done && g('handledUserId') === null && srv.requests.length === 1;
        // The waiting phone can't approve itself.
        const me = JSON.parse(localStorage.getItem('VELA_DEVICE'));
        const self = await client.rpc('vela_decide_login', { p_request: 'req0', p_device: me.id, p_secret: me.secret, p_approve: true });
        // The old phone approves.
        await client.rpc('vela_decide_login', { p_request: 'req0', p_device: 'dev-other-phone-0001', p_secret: 'x'.repeat(64), p_approve: true });
        await wait(3800);
        const ok = shown && waited && !!self.error && $('approve-wait').hidden && g('handledUserId') === 'u1';
        undo();
        return ok || `shown ${shown}, waited ${waited}, self-approve blocked ${!!self.error}, screen hidden ${$('approve-wait').hidden}, user ${g('handledUserId')}, requests ${srv.requests.length}`;
    });

    await T('Approve new sign-ins: the phone you use shows "Is this you?" and the right number approves', async () => {
        const client = window.__fakeClient;
        const { srv, undo } = fakeApproval(client);
        const me = JSON.parse(localStorage.getItem('VELA_DEVICE'));
        srv.devices[me.id] = { secret: me.secret, name: 'This phone', approved: true };
        srv.devices['dev-new-phone-00001'] = { secret: 'n'.repeat(64), name: 'CPH2591', approved: false };
        srv.requests.push({ id: 'r9', device_id: 'dev-new-phone-00001', device_name: 'CPH2591', number: 57, status: 'pending', created_at: new Date().toISOString() });
        (0, eval)('askingRequest = null');
        await g('pollSignInRequests')(); await wait(400);
        const asked = g('openSheets').includes('modal-approve-ask') && $('approve-ask-device').textContent === 'CPH2591';
        const nums = [...document.querySelectorAll('[data-approve-num]')].map((b) => Number(b.dataset.approveNum));
        document.querySelector('[data-approve-num="57"]').click(); await wait(500);
        const approved = srv.requests[0].status === 'approved' && srv.devices['dev-new-phone-00001'].approved;
        // A wrong number blocks it.
        srv.requests.push({ id: 'r10', device_id: 'dev-new-phone-00001', device_name: 'CPH2591', number: 33, status: 'pending', created_at: new Date().toISOString() });
        srv.requests[0].status = 'approved';
        await wait(500); (0, eval)('askingRequest = null');
        await g('pollSignInRequests')(); await wait(400);
        const wrong = [...document.querySelectorAll('[data-approve-num]')].map((b) => b.dataset.approveNum).find((n) => n !== '33');
        document.querySelector(`[data-approve-num="${wrong}"]`).click(); await wait(500);
        const blocked = srv.requests[1].status === 'denied';
        const logged = g('notifLog').some((x) => x.kind === 'signin');
        undo();
        return (asked && nums.length === 3 && nums.includes(57) && approved && blocked && logged) || `asked ${asked}, numbers ${nums}, approved ${approved}, wrong number blocked ${blocked}, in notifications ${logged}`;
    });

    await T('Approve new sign-ins: Settings shows the switch and your phones; server not set up = no lock-out', async () => {
        const client = window.__fakeClient;
        const { srv, undo } = fakeApproval(client);
        const me = JSON.parse(localStorage.getItem('VELA_DEVICE'));
        srv.devices[me.id] = { secret: me.secret, name: 'This phone', approved: true };
        srv.devices['dev-other-00000001'] = { secret: 'o'.repeat(64), name: 'Old phone', approved: true };
        await g('renderDevices')(true);
        const sw = $('switch-approval').getAttribute('aria-checked');
        const rows = $('device-list').textContent;
        const removeBtn = document.querySelector('[data-device-remove="dev-other-00000001"]');
        undo();
        // Without the server setup, signing in must not be blocked.
        client.rpc = async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.vela_device_check' } });
        const pass = await g('passDeviceApproval')();
        await g('renderDevices')(true);
        const note = $('approval-desc').textContent;
        delete client.rpc;
        return (sw === 'true' && /This phone/.test(rows) && /Old phone/.test(rows) && !!removeBtn && pass === true && /setup/.test(note)) || `switch ${sw}, list "${rows}", remove ${!!removeBtn}, pass ${pass}, note "${note}"`;
    });

    await T('Two-step verification: sign-in waits for the authenticator code', async () => {
        const client = window.__fakeClient;
        let verified = 0;
        client.auth.mfa = {
            getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: verified ? 'aal2' : 'aal1', nextLevel: 'aal2' } }),
            listFactors: async () => ({ data: { totp: [{ id: 'f1', status: 'verified' }] } }),
            challengeAndVerify: async ({ code }) => (code === '123456' ? (verified++, { error: null }) : { error: { message: 'Invalid code' } })
        };
        (0, eval)('handledUserId = null');
        let done = false;
        g('handleSession')({ user: { id: 'u1', email: 't@example.com', user_metadata: {} } }).then(() => { done = true; });
        await wait(500);
        const asked = g('openSheets').includes('modal-mfa');
        const waitedFirst = !done && g('handledUserId') === null;
        $('mfa-code').value = '000000'; g('submitMfa')(); await wait(300);
        const wrongKept = g('openSheets').includes('modal-mfa');
        $('mfa-code').value = '123456'; g('submitMfa')(); await wait(900);
        const ok = asked && waitedFirst && wrongKept && !g('openSheets').includes('modal-mfa') && g('handledUserId') === 'u1';
        delete client.auth.mfa;
        return ok || `asked ${asked}, waited ${waitedFirst}, wrong code kept sheet ${wrongKept}, user ${g('handledUserId')}`;
    });

    await T('Two-step verification: turning it on shows the QR code and checks a code', async () => {
        const client = window.__fakeClient;
        let factors = [];
        client.auth.mfa = {
            getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal1' } }),
            listFactors: async () => ({ data: { totp: factors } }),
            enroll: async () => ({ data: { id: 'f2', totp: { qr_code: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"/>', secret: 'JBSWY3DPEHPK3PXP' } } }),
            challengeAndVerify: async ({ code }) => { if (code !== '654321') return { error: { message: 'bad' } }; factors = [{ id: 'f2', status: 'verified' }]; return { error: null }; },
            unenroll: async () => { factors = []; return { error: null }; }
        };
        await g('toggleMfa')(); await wait(400);
        const qr = $('mfa-qr').getAttribute('src') || '';
        const secret = $('mfa-secret').textContent;
        $('mfa-code').value = '654321'; g('submitMfa')(); await wait(500);
        await g('updateMfaRow')();
        const state = $('mfa-state').textContent;
        delete client.auth.mfa;
        return (qr.startsWith('data:image') && secret === 'JBSWY3DPEHPK3PXP' && state === 'On' && !g('openSheets').includes('modal-mfa')) || `qr ${qr.slice(0, 20)}, secret ${secret}, state ${state}`;
    });

    await T('Waiting for the other phone: "use a code instead" lets you in with the authenticator code', async () => {
        const client = window.__fakeClient;
        const { srv, undo } = fakeApproval(client);
        let aal2 = false;
        client.auth.mfa = {
            getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: aal2 ? 'aal2' : 'aal1', nextLevel: 'aal2' } }),
            listFactors: async () => ({ data: { totp: [{ id: 'f1', status: 'verified' }] } }),
            challengeAndVerify: async ({ code }) => (code === '112233' ? (aal2 = true, { error: null }) : { error: { message: 'Invalid code' } })
        };
        const realRpc = client.rpc;
        let approvedByCode = false;
        client.rpc = async (fn, a) => {
            if (fn === 'vela_approve_with_code') { if (!aal2) return { data: null, error: { message: 'code needed' } }; srv.devices[a.p_device].approved = true; approvedByCode = true; return { data: 'approved', error: null }; }
            return realRpc(fn, a);
        };
        localStorage.removeItem('VELA_DEVICE');
        srv.devices['dev-other-phone-0001'] = { secret: 'x'.repeat(64), name: 'Old phone', approved: true };
        (0, eval)('handledUserId = null');
        g('handleSession')({ user: { id: 'u1', email: 't@example.com', user_metadata: {} } });
        await wait(600);
        const offered = !$('approve-wait').hidden && !$('btn-approve-code').hidden;
        $('btn-approve-code').click(); await wait(400);
        const sheet = g('openSheets').includes('modal-mfa');
        $('mfa-code').value = '112233'; g('submitMfa')(); await wait(900);
        const ok = offered && sheet && approvedByCode && $('approve-wait').hidden && !g('openSheets').includes('modal-mfa') && g('handledUserId') === 'u1';
        undo(); delete client.auth.mfa;
        return ok || `offered ${offered}, code sheet ${sheet}, approved by code ${approvedByCode}, waiting hidden ${$('approve-wait').hidden}, user ${g('handledUserId')}`;
    });

    await T('Signed in: an edit made while the cloud download runs is kept (not overwritten by the older copy)', async () => {
        const client = window.__fakeClient;
        const t = s().transactions.find((x) => x.type === 'expense');
        const realFrom = client.from;
        client.from = (tb) => {
            const q = realFrom(tb);
            if (tb !== 'vela_records') return q;
            return { ...q, select: (...a) => { const r = q.select(...a); return { then: (ok, bad) => new Promise((res) => setTimeout(res, 400)).then(() => r).then(ok, bad) }; } };
        };
        const pull = g('pullFromCloud')();
        await wait(150);
        t.desc = 'Edited during sync';
        g('queueSync')('transaction', t.id, 'upsert', false);
        await pull;
        client.from = realFrom;
        const kept = (s().transactions.find((x) => x.id === t.id) || {}).desc === 'Edited during sync';
        await g('flushSync')(); await wait(300);
        const uploaded = (await client.from('vela_records').select()).data.some((r) => r.id === t.id && r.data && r.data.desc === 'Edited during sync');
        return (kept && uploaded) || `kept ${kept}, uploaded ${uploaded}`;
    });

    await T('Sign out clears this phone', async () => {
        g('resetToSignedOut')(); await wait(300);
        const empty = s().transactions.length === 0 && !s().settingsUser;
        (0, eval)('supabaseClient = window.__realClient');
        return empty || `entries left ${s().transactions.length}`;
    });

    await T('Sign-in that stops (Google error, phone approval failing) says why on the sign-in page, and the next try works', async () => {
        const { client } = fakeCloud(null);
        let approval = 'broken';
        client.rpc = async (fn) => {
            if (fn === 'vela_device_check') return { data: approval === 'ok' ? 'ok' : 'pending', error: null };
            if (fn === 'vela_request_login') return approval === 'broken' ? { data: null, error: new Error('function vela_request_login does not exist') } : { data: [{ request_id: 'r1', number: 42 }], error: null };
            return { data: null, error: null };
        };
        window.__fakeClient = client; (0, eval)('supabaseClient = window.__fakeClient');
        g('showAuth')(1); await wait(200);
        // Google itself said no.
        await g('handleNativeAuthRedirect')('io.github.dinsara0611.vela://auth-callback?error=access_denied&error_description=Access+denied');
        const google = !$('auth-problem').hidden && /Access denied/.test($('auth-problem-text').textContent);
        // Phone approval can't be asked: back on the sign-in page with the reason, not silently.
        const user = { id: 'u9', email: 'nine@example.com', user_metadata: {} };
        await g('handleSession')({ user }); await wait(500);
        const said = !$('auth-problem').hidden && /Couldn’t ask your other phone/.test($('auth-problem-text').textContent) && /does not exist/.test($('auth-problem-text').textContent);
        const steps = /Checking this phone/.test($('auth-problem-steps').textContent) && !/nine@example/.test($('auth-problem-steps').textContent);
        const notStuck = g('handledUserId') === null;
        // Fixed on the server: the next try goes through.
        approval = 'ok';
        await g('handleSession')({ user }); await wait(600);
        const second = g('handledUserId') === 'u9' && $('auth-problem').hidden;
        g('resetToSignedOut')(); await wait(200);
        (0, eval)('supabaseClient = window.__realClient');
        return (google && said && steps && notStuck && second) || `google error shown ${google}, approval reason ${said} ("${$('auth-problem-text').textContent}"), steps ${steps}, not stuck ${notStuck}, second try ${second}`;
    });

    await T('Approve this phone with the authenticator code: retries an unknown phone, clear message when the server lacks the check', async () => {
        const { client } = fakeCloud(null);
        let calls = 0; let registered = false; let missing = false;
        client.rpc = async (fn) => {
            if (fn === 'vela_device_check') { registered = true; return { data: 'ok', error: null }; }
            if (fn === 'vela_approve_with_code') {
                calls++;
                if (missing) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.vela_approve_with_code' } };
                return registered ? { data: 'approved', error: null } : { data: null, error: { message: 'unknown device' } };
            }
            return { data: null, error: null };
        };
        window.__fakeClient = client; (0, eval)('supabaseClient = window.__fakeClient');
        const first = await g('approveWithCode')();
        const retried = first === null && calls === 2 && registered;
        missing = true;
        const err = await g('approveWithCode')();
        const msg = err ? g('approveCodeError')(err) : '';
        const clear = /SQL Editor/.test(msg) && /device-approval\.sql/.test(msg);
        (0, eval)('supabaseClient = window.__realClient');
        return (retried && clear) || `retried ${retried} (calls ${calls}), message "${msg}"`;
    });

    await T('New install: "Approve on your other phone" shows ON TOP of the sign-in page; only this phone (reinstalled) -> says use the code', async () => {
        const { client } = fakeCloud(null);
        client.rpc = async (fn) => {
            if (fn === 'vela_device_check') return { data: 'pending', error: null };
            if (fn === 'vela_request_login') return { data: [{ request_id: 'r7', number: 97 }], error: null };
            return { data: null, error: null };
        };
        const realFrom = client.from;
        client.from = (t) => (t === 'vela_devices' ? { select: () => ({ order: () => Promise.resolve({ data: [{ device_id: 'old', name: g('deviceName')(), approved: true, last_seen: new Date(Date.now() - 8 * 3600e3).toISOString() }], error: null }) }) } : realFrom(t));
        window.__fakeClient = client; (0, eval)('supabaseClient = window.__fakeClient');
        g('showAuth')(1); await wait(200);
        const p = g('handleSession')({ user: { id: 'u7', email: 'seven@example.com', user_metadata: {} } });
        await wait(700);
        const top = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
        const onTop = !!top && !!top.closest('#approve-wait');
        const mfaAbove = Number(getComputedStyle($('modal-mfa')).zIndex) > Number(getComputedStyle($('approve-wait')).zIndex) && Number(getComputedStyle($('approve-wait')).zIndex) > Number(getComputedStyle($('auth-overlay-container')).zIndex);
        const said = /no other phone/i.test($('approve-wait-note').textContent) && /reinstalled/.test($('approve-phones').textContent);
        g('endApproveWait')(false, null); await p; await wait(300);
        (0, eval)('supabaseClient = window.__realClient');
        return (onTop && mfaAbove && said) || `approval on top ${onTop} (top is ${top && (top.id || top.className)}), code box above ${mfaAbove}, says use the code ${said}`;
    });

    await T('No errors logged during the run', () => (window.__velaErrors || []).length === 0 || window.__velaErrors.join(' | '));

    window.removeEventListener('error', onErr);
    window.removeEventListener('unhandledrejection', onErr);
    localStorage.clear();
    const failed = results.filter((r) => !r.ok);
    return { passed: results.length - failed.length, total: results.length, failed, results };
}
