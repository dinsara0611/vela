/**
 * Vela 3.0 — money tracker (phone first): expenses, income, budgets, bills,
 * savings goals, debts, reports, app lock. Runs as a website and as the
 * Android app (Capacitor) from the same code.
 */
'use strict';

/* =========================================================================
   1. Constants
   ========================================================================= */
const APP_VERSION = '4.63.0';
const STORAGE_KEY = 'VELA_STATE';
const RATE_URL = 'https://open.er-api.com/v6/latest/USD';
const JSPDF_CDN = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';

// Supabase project (the publishable key is safe in client code; access is enforced by RLS).
const SUPABASE_URL = 'https://qtgkbpfqrcczrdmhglhq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_6douRkevjI23Thss5TjhnQ_thm-qkHt';

// Deep link the Android app registers; Supabase returns here after Google sign-in.
const NATIVE_AUTH_REDIRECT = 'io.github.dinsara0611.vela://auth-callback';

const PALETTE = ['pink', 'violet', 'orange', 'green', 'cyan', 'yellow', 'magenta', 'indigo', 'teal', 'slate'];
const ICON_CHOICES = [
    'c-Food', 'c-Utilities', 'c-Rent', 'c-Entertainment', 'c-Travel', 'c-Health', 'c-Shopping', 'c-Other',
    'c-Salary', 'c-Freelance', 'c-Business', 'c-Gift', 'c-Investment', 'c-OtherIncome',
    'x-book', 'x-school', 'x-coffee', 'x-paw', 'x-gym', 'x-plane', 'x-tools', 'x-music', 'x-fuel', 'x-phone'
];
const DEFAULT_CATEGORIES = [
    { id: 'Food', name: 'Food', type: 'expense', icon: 'c-Food', color: 'pink' },
    { id: 'Utilities', name: 'Utilities', type: 'expense', icon: 'c-Utilities', color: 'violet' },
    { id: 'Rent', name: 'Rent', type: 'expense', icon: 'c-Rent', color: 'orange' },
    { id: 'Entertainment', name: 'Fun', type: 'expense', icon: 'c-Entertainment', color: 'green' },
    { id: 'Travel', name: 'Transport', type: 'expense', icon: 'c-Travel', color: 'cyan' },
    { id: 'Health', name: 'Health', type: 'expense', icon: 'c-Health', color: 'yellow' },
    { id: 'Shopping', name: 'Shopping', type: 'expense', icon: 'c-Shopping', color: 'magenta' },
    { id: 'Other', name: 'Other', type: 'expense', icon: 'c-Other', color: 'slate' },
    { id: 'Salary', name: 'Salary', type: 'income', icon: 'c-Salary', color: 'green' },
    { id: 'Freelance', name: 'Freelance', type: 'income', icon: 'c-Freelance', color: 'cyan' },
    { id: 'Business', name: 'Business', type: 'income', icon: 'c-Business', color: 'indigo' },
    { id: 'Gift', name: 'Gifts', type: 'income', icon: 'c-Gift', color: 'magenta' },
    { id: 'Investment', name: 'Investments', type: 'income', icon: 'c-Investment', color: 'teal' },
    { id: 'OtherIncome', name: 'Other income', type: 'income', icon: 'c-OtherIncome', color: 'slate' }
];
const FALLBACK_CATEGORY = { expense: 'Other', income: 'OtherIncome' };
const TAB_TITLES = { dashboard: 'Home', activity: 'Activity', plan: 'Plan', analytics: 'Insights', settings: 'Settings' };
const RANGE_LABELS = { '30': 'Last 30 days', '12m': 'Last 12 months', all: 'All time' };
const FREQ_LABELS = { weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };
const LOCK_AFTER_MS = 60 * 1000;

/* =========================================================================
   2. Native helpers (Android app)
   ========================================================================= */
const isNative = () => !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
const nativePlugin = (name) => (isNative() && window.Capacitor.Plugins ? window.Capacitor.Plugins[name] : null);
// Screen privacy (Android app): black in screenshots, screen recording, recent apps and Circle to Search.
let secureScreenOn = true;
const updateSecureScreenRow = async () => {
    const sp = nativePlugin('ScreenPrivacy');
    const row = document.getElementById('secure-screen-row');
    if (!row) return;
    row.hidden = !sp;
    if (!sp) return;
    try { secureScreenOn = !!(await sp.get()).on; } catch (e) { /* older app build */ row.hidden = true; return; }
    setSwitch($('switch-secure-screen'), secureScreenOn);
};
const toggleSecureScreen = async () => {
    const sp = nativePlugin('ScreenPrivacy');
    if (!sp) return;
    try {
        secureScreenOn = !!(await sp.set({ on: !secureScreenOn })).on;
        setSwitch($('switch-secure-screen'), secureScreenOn);
        showToast(secureScreenOn ? 'Vela is hidden in screenshots and recent apps' : 'Screenshots allowed. Turn it back on when you’re done.', secureScreenOn ? 'success' : 'info');
    } catch (e) { showToast('Couldn’t change it on this phone.', 'error'); }
};
const authRedirectUrl = () => (isNative() ? NATIVE_AUTH_REDIRECT : window.location.origin + window.location.pathname);
const haptic = (style = 'LIGHT') => {
    const h = nativePlugin('Haptics');
    if (h) h.impact({ style }).catch(() => {});
};

/* =========================================================================
   3. State
   ========================================================================= */
const prefersLight = () => !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);

const createDefaultState = () => ({
    version: 3,
    transactions: [], // { id, type, desc, amount, currency, category, date, note, createdAt, recurringId? }
    savings: [],      // { id, name, target, currency, saved, deadline, createdAt }
    recurring: [],    // { id, type, name, amount, currency, category, frequency, nextDate, anchorDay, autoLog, createdAt }
    debts: [],        // { id, direction: lent|borrowed, person, amount, currency, repaid, dueDate, note, createdAt }
    accounts: [],     // { id, name, kind, currency, opening, createdAt }
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c, builtIn: true })),
    config: {
        rates: {},                 // currency -> units per 1 USD (live)
        rateOverrides: {},         // currency -> your own rate
        ratesUpdatedAt: null,
        currency: 'USD',           // amounts are shown in this currency
        currencies: ['USD', 'LKR'],
        theme: prefersLight() ? 'light' : 'dark',
        budget: 1000,              // overall monthly budget, in budgetCurrency
        categoryBudgets: {},       // categoryId -> monthly limit, in budgetCurrency
        budgetCurrency: null,      // currency the budgets were typed in (null = old data, US dollars)
        budgetMode: 'fixed',       // 'fixed' = the amount typed in; 'income' = this month's income; 'balance' = the money in the account
        budgetSavePct: 0,          // with 'income': the part of income kept aside for saving
        budgetSkipIncome: null,    // with 'income': income kinds not counted (null = refunds and cash deposits left out)
        lastCategory: { expense: 'Food', income: 'Salary' },
        priceBook: {},             // currency -> item name -> { price, added?, category? } (your own prices)
        lock: { enabled: false, hash: null, salt: null, biometric: false },
        reminders: false,
        reminderIds: [],
        trips: [],                 // { id, name, budget, currency, start, end, endedAt } - one at a time is on
        budgetOn: false,           // the monthly budget is only used when you turn it on (old data: on)
        sections: [],              // { id, name, mode: 'percent' | 'amount' | 'rest', value, currency, color, icon }
        sectionMoves: [],          // money into / out of sections: { id, date, kind, incomeId, from, to, amount, currency }
        sectionSince: null,        // incomes from this date on are offered for dividing
        sectionSkipped: [],        // incomes left out of the sections
        sectionCatMap: {},         // category -> the section its expenses usually come out of
        fundIncomeCats: null       // income categories allocated to funds (null = Salary only)
    },
    auth: { user: null, isMock: true, completedOnboarding: false },
    sync: {},            // id -> { kind, op: 'upsert' | 'delete' }
    syncSettings: false, // settings changed and not yet sent
    settingsUser: null,  // account whose cloud settings are loaded on this phone (before that, nothing is sent)
    settingsSig: null    // the settings as last sent or loaded, to spot changes
});

let state = createDefaultState();
let dataVersion = 0; // goes up with every save: lists worked out before a change are never reused after it
let supabaseClient = null;
let currentTab = 'dashboard';
let planTab = 'budgets';
let activityType = 'all';
let activityStatus = 'all'; // all | paid | unpaid | upcoming | overdue | bank
let activityCategory = 'all';
let activityAccount = 'all'; // set to the switched account at start (see init)
let activityView = 'list';
let activityDay = null;
let activityMonth = { y: new Date().getFullYear(), m: new Date().getMonth() };
let dashboardRange = '30';
let analyticsRange = '30';
let deferredInstallPrompt = null;
let handledUserId = null;
let confirmHandler = null;
let storageWarningShown = false;
let biometricAvailable = false;
let bioKind = 'finger'; // what the phone unlocks with: 'finger', 'face' or 'both'
const openSheets = [];
const charts = { trend: null, history: null, category: null };

const $ = (id) => document.getElementById(id);

/* =========================================================================
   4. Utilities
   ========================================================================= */
const storage = {
    get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); return true; } catch (e) { return false; } },
    remove(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }
};

const toNumber = (value, fallback = 0) => {
    const n = typeof value === 'number' ? value : parseFloat(typeof value === 'string' ? value.replace(/,/g, '') : value);
    return Number.isFinite(n) ? n : fallback;
};

const round2 = (n) => Math.round(n * 100) / 100;

const generateId = () => {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
};

const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
}[c]));

const icon = (id, cls = 'ic') => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
const plural = (n, word, many = word + 's') => `${n} ${n === 1 ? word : many}`;

/* ---- Dates: "YYYY-MM-DD" strings are local calendar days ---- */
const pad2 = (n) => String(n).padStart(2, '0');
const toISODate = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const isISODate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const parsedDates = new Map();
const parseDate = (s) => {
    let t = parsedDates.get(s);
    if (t === undefined) {
        if (!isISODate(s)) return new Date(NaN);
        const [y, m, d] = s.split('-').map(Number);
        t = new Date(y, m - 1, d).getTime();
        if (parsedDates.size > 20000) parsedDates.clear();
        parsedDates.set(s, t);
    }
    return new Date(t);
};
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
const monthKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
const monthName = (y, m, opts = { month: 'long', year: 'numeric' }) => new Date(y, m, 1).toLocaleDateString('en-US', opts);
const todayISO = () => toISODate();
// An entry dated after today hasn't happened yet: it's listed as Upcoming and counts from its date.
let todayCache = '';
let todayCacheUntil = 0;
const todayFast = () => {
    const now = Date.now();
    if (now >= todayCacheUntil) {
        const d = new Date();
        todayCache = toISODate(d);
        todayCacheUntil = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    }
    return todayCache;
};
// Not counted yet: dated in the future, or waiting for you to confirm it arrived / was paid.
const isUpcoming = (t) => !!t && (t.pending === true || t.date > todayFast());
const isWaiting = (t) => !!t && t.pending === true && t.date <= todayFast();
// Where an unpaid payment stands today.
const payStatus = (due) => { const t = todayFast(); return due > t ? 'upcoming' : due === t ? 'due' : 'overdue'; };
const payStatusLabel = (status, type) => (type === 'income'
    ? { upcoming: 'Expected', due: 'Expected today', overdue: 'Late' }[status]
    : { upcoming: 'Upcoming', due: 'Due today', overdue: 'Overdue' }[status]);

// Date formatters are made once (making one per call was a large part of drawing long lists).
const FMT_DAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const FMT_DAY_YEAR = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const FMT_MONTH_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const FMT_MONTH = new Intl.DateTimeFormat('en-US', { month: 'short' });
const FMT_MONTH_YEAR = new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit' });
let dayLabelCache = { day: '', map: new Map() };
const relativeDayLabel = (dateStr) => {
    const today = todayFast();
    if (dayLabelCache.day !== today) dayLabelCache = { day: today, map: new Map() };
    const hit = dayLabelCache.map.get(dateStr);
    if (hit !== undefined) return hit;
    const d = parseDate(dateStr);
    let out = '';
    if (!isNaN(d)) {
        const diff = daysBetween(d, new Date());
        out = diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : diff === -1 ? 'Tomorrow'
            : (d.getFullYear() === new Date().getFullYear() ? FMT_DAY : FMT_DAY_YEAR).format(d);
    }
    dayLabelCache.map.set(dateStr, out);
    return out;
};
const shortDateCache = new Map();
const shortDate = (s) => {
    const year = new Date().getFullYear();
    const key = `${year}|${s}`;
    const hit = shortDateCache.get(key);
    if (hit !== undefined) return hit;
    const d = parseDate(s);
    const out = isNaN(d) ? '' : (d.getFullYear() === year ? FMT_MONTH_DAY : FMT_DAY_YEAR).format(d);
    if (shortDateCache.size > 4000) shortDateCache.clear();
    shortDateCache.set(key, out);
    return out;
};
const dueLabel = (s) => {
    const diff = daysBetween(new Date(), parseDate(s));
    if (diff < -1) return { text: `${-diff} days overdue`, tone: 'late' };
    if (diff === -1) return { text: 'Due yesterday', tone: 'late' };
    if (diff === 0) return { text: 'Due today', tone: 'soon' };
    if (diff === 1) return { text: 'Due tomorrow', tone: 'soon' };
    if (diff <= 7) return { text: `Due in ${diff} days`, tone: 'soon' };
    return { text: `Due ${shortDate(s)}`, tone: '' };
};

/* ---- Money: any currency; rates are units per 1 USD ---- */
const CURRENCIES = {
    USD: { symbol: '$', name: 'US dollar' },
    LKR: { symbol: 'Rs. ', name: 'Sri Lankan rupee' },
    EUR: { symbol: '€', name: 'Euro' },
    GBP: { symbol: '£', name: 'British pound' },
    INR: { symbol: '₹', name: 'Indian rupee' },
    AED: { symbol: 'AED ', name: 'UAE dirham' },
    SAR: { symbol: 'SAR ', name: 'Saudi riyal' },
    QAR: { symbol: 'QAR ', name: 'Qatari riyal' },
    KWD: { symbol: 'KWD ', name: 'Kuwaiti dinar' },
    OMR: { symbol: 'OMR ', name: 'Omani rial' },
    AUD: { symbol: 'A$', name: 'Australian dollar' },
    CAD: { symbol: 'C$', name: 'Canadian dollar' },
    SGD: { symbol: 'S$', name: 'Singapore dollar' },
    MYR: { symbol: 'RM ', name: 'Malaysian ringgit' },
    JPY: { symbol: '¥', name: 'Japanese yen' },
    CNY: { symbol: 'CN¥', name: 'Chinese yuan' },
    MVR: { symbol: 'Rf ', name: 'Maldivian rufiyaa' }
};
// Used until the first live update; approximate.
const FALLBACK_RATES = { USD: 1, LKR: 300, EUR: 0.92, GBP: 0.79, INR: 84, AED: 3.6725, SAR: 3.75, QAR: 3.64, KWD: 0.307, OMR: 0.385, AUD: 1.52, CAD: 1.38, SGD: 1.34, MYR: 4.6, JPY: 150, CNY: 7.2, MVR: 15.4 };
const isCurrency = (c) => typeof c === 'string' && Object.prototype.hasOwnProperty.call(CURRENCIES, c);
const normCur = (c) => (isCurrency(c) ? c : 'USD');
const fmtCache = {};
const decimalsFor = (cur) => {
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).resolvedOptions().maximumFractionDigits; } catch (e) { return 2; }
};
const numberFmt = (cur) => fmtCache[cur] || (fmtCache[cur] = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimalsFor(cur), maximumFractionDigits: decimalsFor(cur) }));
const money2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyCompact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const symbolFor = (cur) => (CURRENCIES[cur] ? CURRENCIES[cur].symbol : `${cur} `);
const rateFor = (cur) => {
    if (cur === 'USD') return 1;
    const own = state.config.rateOverrides[cur];
    if (own > 0) return own;
    const live = state.config.rates[cur];
    return live > 0 ? live : (FALLBACK_RATES[cur] || 1);
};
const formatRate = (r) => (r >= 100 ? r.toFixed(2) : r >= 1 ? r.toFixed(3) : r.toFixed(4));
const convertAmount = (amount, from, to) => (from === to ? amount : (amount / rateFor(from)) * rateFor(to));
const toDisplay = (amount, cur) => convertAmount(amount, cur, state.config.currency);
const formatCurrency = (amount, cur) => `${amount < 0 ? '-' : ''}${symbolFor(cur)}${numberFmt(cur).format(Math.abs(amount))}`;
const formatSigned = (amount, cur) => `${amount > 0 ? '+' : amount < 0 ? '−' : ''}${symbolFor(cur)}${numberFmt(cur).format(Math.abs(amount))}`;
const formatCompact = (amount, cur) => {
    const sym = symbolFor(cur);
    return `${amount < 0 ? '-' : ''}${sym.trim()}${/\s$/.test(sym) ? ' ' : ''}${moneyCompact.format(Math.abs(amount))}`;
};
const formatDisplay = (amount, cur) => formatCurrency(toDisplay(amount, cur), state.config.currency);
// The amount as entered, shown small beside the converted one when its currency isn't the one you chose.
const origNote = (amount, cur) => (normCur(cur) !== dcur() ? `<span class="tx-orig-inline">${escapeHtml(formatCurrency(amount, cur))}</span>` : '');
const dcur = () => state.config.currency;
const myCurrencies = () => state.config.currencies.filter(isCurrency);
const fillCurrencySelect = (sel, value) => {
    if (!sel) return;
    const v = normCur(value);
    const list = [...new Set([...myCurrencies(), v])];
    sel.innerHTML = list.map((c) => `<option value="${c}">${c}</option>`).join('');
    sel.value = v;
};
// Small boxes on phones: full amount when it fits, "Rs. 599.3K" when it doesn't (full value in the tooltip).
const wholeFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const formatWhole = (amount, cur, signed = false) => `${amount < 0 ? (signed ? '−' : '-') : (signed && amount > 0 ? '+' : '')}${symbolFor(cur)}${wholeFmt.format(Math.abs(amount))}`;
// Small boxes: the full amount (with commas) when it fits, then the same without cents, and only for
// very large numbers the short form ("Rs. 1.2M"); the full value is always in the tooltip.
const fitMoney = (v, cur, max = 11) => {
    const full = formatCurrency(v, cur);
    if (full.length <= max + 3) return full;
    const whole = formatWhole(v, cur);
    return whole.length <= max + 3 ? whole : formatCompact(v, cur);
};
// Fits amounts into their boxes: the full amount with commas, then slightly smaller, then without cents, and only
// if it still doesn't fit the short form ("Rs. 1.2M"). Boxes that aren't visible yet keep the full amount.
// Speed: the text is measured with a canvas (no page layout per try), and all amounts on a screen are fitted in
// one batch: write the full text, read every box once, then write the results. Trying sizes one by one and asking
// the page to re-measure after each was the biggest cause of lag on big histories.
const fitCanvas = (() => { try { return document.createElement('canvas').getContext('2d'); } catch (e) { return null; } })();
const fitTries = (el) => {
    const v = Number(el.dataset.v);
    const cur = el.dataset.cur;
    const signed = el.dataset.signed === 'true';
    const full = signed ? formatSigned(v, cur) : formatCurrency(v, cur);
    const whole = formatWhole(v, cur, signed);
    const short = `${signed && v > 0 ? '+' : ''}${formatCompact(v, cur)}`;
    return { full, tries: [[full, 1], [full, 0.86], [whole, 1], [whole, 0.86], [whole, 0.74], [short, 1], [short, 0.8], [short, 0.66]] };
};
const fitAmountsSlow = (el, tries) => {
    const box = el.clientWidth ? el : el.parentElement;
    for (const [text, scale] of tries) {
        el.textContent = text;
        el.style.fontSize = scale === 1 ? '' : `${scale}em`;
        if (el.clientWidth ? el.scrollWidth <= el.clientWidth + 1 : el.getBoundingClientRect().width <= box.clientWidth + 1) return;
    }
};
const fitAmounts = (els) => {
    const items = [];
    // 1. write: every amount back to its full text and normal size
    els.forEach((el) => {
        if (!el || !el.isConnected || el.dataset.v === undefined || el.classList.contains('hero-amount')) return;
        const t = fitTries(el);
        el.style.fontSize = '';
        if (el.textContent !== t.full) el.textContent = t.full;
        items.push({ el, ...t });
    });
    if (!items.length) return;
    // 2. read: box widths and fonts, all at once (one layout). Amounts in the same kind of box share their font
    // and padding, so each style is read once per kind (reading it for every row was most of the cost).
    const padOf = new Map();
    const fontOf = new Map();
    items.forEach((it) => {
        const el = it.el;
        const own = el.clientWidth > 0;
        const box = own ? el : el.parentElement;
        if (!box || !box.clientWidth) { it.avail = 0; return; }
        const bk = `${box.tagName}.${box.className}`;
        let pad = padOf.get(bk);
        if (pad === undefined) { const bs = getComputedStyle(box); pad = (parseFloat(bs.paddingLeft) || 0) + (parseFloat(bs.paddingRight) || 0); padOf.set(bk, pad); }
        it.avail = box.clientWidth - pad;
        const fk = `${el.tagName}.${el.className}|${el.parentElement ? el.parentElement.className : ''}|${el.style.cssText}`;
        let f = fontOf.get(fk);
        if (!f) {
            const cs = getComputedStyle(el);
            f = { font: `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`, ls: parseFloat(cs.letterSpacing) || 0, tabular: /tabular/.test(cs.fontVariantNumeric || '') };
            fontOf.set(fk, f);
        }
        it.font = f.font;
        it.ls = f.ls;
        it.tabular = f.tabular;
    });
    // 3. work out and write the result for each
    items.forEach((it) => {
        if (!(it.avail > 0)) return;
        if (!fitCanvas) { fitAmountsSlow(it.el, it.tries); return; }
        fitCanvas.font = it.font;
        const width = (text) => {
            // Tabular figures are all as wide as a 0; the canvas draws proportional ones.
            const t = it.tabular ? text.replace(/[0-9]/g, '0') : text;
            return fitCanvas.measureText(t).width + it.ls * t.length;
        };
        const pick = it.tries.find(([text, scale]) => width(text) * scale <= it.avail - 1) || it.tries[it.tries.length - 1];
        if (it.el.textContent !== pick[0]) it.el.textContent = pick[0];
        it.el.style.fontSize = pick[1] === 1 ? '' : `${pick[1]}em`;
    });
};
const fitAmount = (el) => fitAmounts([el]);
// Amounts set while a screen is being drawn are fitted together right after (one batch, not one each).
const fitQueue = new Set();
let fitQueued = false;
const queueFit = (el) => {
    fitQueue.add(el);
    if (fitQueued) return;
    fitQueued = true;
    queueMicrotask(() => { fitQueued = false; const els = [...fitQueue]; fitQueue.clear(); fitAmounts(els); });
};
const refitAmounts = (root = document) => {
    const els = [...root.querySelectorAll('[data-v]')];
    els.forEach((el) => fitQueue.delete(el));
    fitAmounts(els);
    root.querySelectorAll('.hero-amount').forEach((el) => shrinkToFit(el));
};
const moneyAttrs = (v, cur, signed = false) => `data-v="${Number(v)}" data-cur="${escapeHtml(cur)}"${signed ? ' data-signed="true"' : ''}`;
const setMoney = (el, v, cur, max = 11, signed = false) => {
    if (!el) return;
    el.dataset.v = String(v);
    el.dataset.cur = cur;
    el.dataset.signed = String(!!signed);
    el.title = signed ? formatSigned(v, cur) : formatCurrency(v, cur);
    el.textContent = el.title;
    queueFit(el);
};

/* ---- Amount boxes: commas appear while typing (1000 -> 1,000) ---- */
const NATIVE_VALUE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
const groupDigits = (raw, allowNegative) => {
    const s = String(raw == null ? '' : raw);
    const neg = allowNegative && s.trim().startsWith('-');
    let clean = s.replace(/[^\d.]/g, '');
    const dot = clean.indexOf('.');
    if (dot >= 0) clean = clean.slice(0, dot + 1) + clean.slice(dot + 1).replace(/\./g, '').slice(0, 2);
    const [intPart, decPart] = clean.split('.');
    const int = intPart.replace(/^0+(?=\d)/, '');
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + grouped + (decPart !== undefined ? `.${decPart}` : '');
};
const formatMoneyField = (el, keepCaret) => {
    const raw = NATIVE_VALUE.get.call(el);
    const out = groupDigits(raw, el.dataset.negative === 'true');
    if (out === raw) return;
    let caretDigits = 0;
    if (keepCaret) caretDigits = raw.slice(0, el.selectionStart == null ? raw.length : el.selectionStart).replace(/[^\d.]/g, '').length;
    NATIVE_VALUE.set.call(el, out);
    if (keepCaret && document.activeElement === el) {
        let pos = out.startsWith('-') ? 1 : 0;
        for (let seen = 0; pos < out.length && seen < caretDigits; pos++) if (/[\d.]/.test(out[pos])) seen++;
        try { el.setSelectionRange(pos, pos); } catch (e) { /* not supported */ }
    }
};
const initMoneyInputs = () => {
    document.querySelectorAll('input.money-input').forEach((el) => {
        // Values set by the app (editing an entry, a quick pick) are formatted too.
        Object.defineProperty(el, 'value', {
            configurable: true,
            get() { return NATIVE_VALUE.get.call(this); },
            set(v) { NATIVE_VALUE.set.call(this, v); formatMoneyField(this, false); }
        });
        el.addEventListener('input', () => formatMoneyField(el, true));
    });
};

/* ---- Categories ---- */
const catById = (id, type = 'expense') => state.categories.find((c) => c.id === id)
    || state.categories.find((c) => c.id === FALLBACK_CATEGORY[type])
    || { id, name: id, type, icon: 'c-Other', color: 'slate' };
const catsOfType = (type) => state.categories.filter((c) => c.type === type);
const catColor = (cat) => `var(--pal-${PALETTE.includes(cat.color) ? cat.color : 'slate'})`;
const catBadge = (catId, type) => {
    const c = catById(catId, type);
    const iconId = ICON_CHOICES.includes(c.icon) ? c.icon : 'c-Other';
    return `<span class="cat-badge" style="--cat:${catColor(c)}">${icon(iconId)}</span>`;
};

/* ---- Accounts ---- */
const ACCOUNT_KINDS = {
    cash: { label: 'Cash', icon: 'i-cash' },
    bank: { label: 'Bank account', icon: 'i-bank' },
    card: { label: 'Card', icon: 'i-card' },
    mobile: { label: 'Mobile wallet', icon: 'x-phone' },
    savings: { label: 'Savings', icon: 'i-target' }
};
const accountById = (id) => state.accounts.find((a) => a.id === id) || state.accounts[0];
const accountIcon = (a) => (ACCOUNT_KINDS[a && a.kind] || ACCOUNT_KINDS.cash).icon;
// Named after a bank ("Commercial bank", "BOC"): never treated as your cash wallet, whatever type it was given.
function isBankNamed(a) { const b = a && accountBrand(a); return !!(b && b.cat === null && !/frimi|ez ?cash|mcash/i.test(b.name)); }
function cashWallet(exceptId) { return state.accounts.find((a) => a.kind === 'cash' && a.id !== exceptId && !isBankNamed(a)) || null; }
// An ATM withdrawal moves money from the bank into your cash wallet; without one, a "Cash" wallet is made.
function ensureCashWallet(currency, exceptId) {
    const have = cashWallet(exceptId);
    if (have) return have;
    const wallet = { id: generateId(), name: 'Cash', kind: 'cash', currency: normCur(currency), opening: 0, createdAt: Date.now() };
    state.accounts.push(wallet);
    state.syncSettings = true;
    return wallet;
}
// Accounts named after a bank but saved as "Cash" are bank accounts; ATM withdrawals that went into one of them
// (instead of your cash wallet) are moved to the cash wallet. Runs on start; changes nothing when all is right.
function repairAccountKinds() {
    let changed = false;
    state.accounts.forEach((a) => { if (a.kind === 'cash' && isBankNamed(a)) { a.kind = 'bank'; changed = true; } });
    state.transactions.forEach((t) => {
        if (t.type !== 'transfer' || t.desc !== 'ATM withdrawal' || !t.bank) return;
        const to = state.accounts.find((a) => a.id === t.toAccountId);
        if (to && isBankNamed(to)) {
            const wallet = ensureCashWallet(t.currency, t.accountId);
            t.toAccountId = wallet.id;
            t.toCurrency = wallet.currency;
            t.toAmount = round2(convertAmount(t.amount, t.currency, wallet.currency));
            queueSync('transaction', t.id, 'upsert', false);
            changed = true;
        }
    });
    if (changed) { state.syncSettings = true; saveState(); }
    return changed;
}
// An account named after a bank, card or wallet ("Commercial Bank", "Boc", "FriMi", "Koko") shows that brand's logo.
function accountBrand(a) {
    if (!a || !a.name) return null;
    const b = brandFor(a.name);
    return b && (b.cat === null || logoSlug(b.slug)) ? b : null;
}
// The account's logo, or its type icon (cash, bank, card...) in Vela's usual tile.
function accountBadge(a, size, plainClass) {
    const own = a && customBadge(a.name, ` ${size}`);
    if (own) return own;
    const b = accountBrand(a);
    return b ? brandBadge(b, ` ${size}`) : `<span class="${plainClass}">${icon(accountIcon(a))}</span>`;
}
// Account pickers show the chosen account's logo inside the box, so switching accounts shows which bank it is.
const ACCOUNT_SELECTS = ['tx-account', 'sms-account', 'transfer-from', 'transfer-to', 'activity-account'];
function syncAccountLogos() {
    ACCOUNT_SELECTS.forEach((id) => {
        const sel = $(id);
        const box = sel && sel.parentElement;
        if (!box || !box.classList.contains('select')) return;
        let slot = box.querySelector(':scope > .select-logo');
        if (!slot) { slot = document.createElement('span'); slot.className = 'select-logo'; slot.setAttribute('aria-hidden', 'true'); box.insertBefore(slot, sel); }
        const a = state.accounts.find((x) => x.id === sel.value);
        slot.innerHTML = a ? accountBadge(a, 'is-pick', 'account-icon') : '';
        box.classList.toggle('has-logo-pad', !!a);
    });
}
let balanceMemo = null; // only while a screen is being drawn (see renderActive)
const accountBalance = (acc) => {
    if (balanceMemo && balanceMemo.has(acc)) return balanceMemo.get(acc);
    let bal = acc.opening;
    state.transactions.forEach((t) => {
        if (isUpcoming(t)) return;
        if (t.type === 'transfer') {
            if (t.accountId === acc.id) bal -= convertAmount(t.amount, t.currency, acc.currency);
            if (t.toAccountId === acc.id) bal += convertAmount(t.toAmount, t.toCurrency, acc.currency);
        } else if (t.accountId === acc.id && !t.beforeBalance) {
            bal += (t.type === 'income' ? 1 : -1) * convertAmount(t.amount, t.currency, acc.currency);
        }
    });
    state.debts.forEach((d) => {
        if (!d.moved || d.accountId !== acc.id) return;
        const open = convertAmount(Math.max(0, d.amount - d.repaid), d.currency, acc.currency);
        bal += d.direction === 'lent' ? -open : open;
    });
    if (balanceMemo) balanceMemo.set(acc, bal);
    return bal;
};
/* ---- Paying in another currency: what the bank really takes ----
   A card or bank account charges more than the market rate for a foreign purchase (its exchange margin plus a
   foreign transaction fee). Until Vela has seen what your bank charged, it uses a typical charge for the account's
   country (shown as an estimate); once you enter (or an SMS shows) the real amount, it learns that bank's charge. */
const FX_FEE_TYPICAL = { LKR: 4, INR: 3.5, PKR: 4, BDT: 3, NPR: 3, AED: 2.5, SAR: 2.5, QAR: 2.5, KWD: 2.5, OMR: 2.5, MYR: 1, SGD: 3.25, GBP: 2.99, EUR: 2, USD: 3, AUD: 3, CAD: 2.5, JPY: 2.2, CNY: 1.5, MVR: 3 };
const fxApplies = (acc) => !!acc && acc.kind !== 'cash';
// Banks' own published charge on card payments in a foreign currency (LKR cards), checked November 2026:
// Commercial Bank's Rates & Tariff page: 4% cross-border fee on debit and credit cards; Sampath Bank's
// Service Charges PDF: 3.5% markup on foreign-currency debit card transactions. Other banks: the typical 4%.
const BANK_FX_FEE = { 'Commercial Bank': 4, 'Sampath Bank': 3.5 };
// Which bank an account belongs to, from its name ("Commercial Bank", "ComBank", "Boc", "Sampath savings").
const accountBankName = (acc) => {
    const name = String((acc && acc.name) || '');
    if (!name) return null;
    const b = SMS_BANKS.find((x) => x.body.test(name) || name.toLowerCase().includes(x.name.toLowerCase()));
    return b ? b.name : null;
};
const bankFxFee = (acc) => (acc && acc.currency === 'LKR' ? BANK_FX_FEE[accountBankName(acc)] : undefined);
const fxFeeFor = (acc) => (!fxApplies(acc) ? 0 : Number.isFinite(acc.fxFee) ? acc.fxFee : (bankFxFee(acc) ?? FX_FEE_TYPICAL[acc.currency] ?? 3));
const fxFeeLearned = (acc) => !!acc && Number.isFinite(acc.fxFee);
// What a foreign amount costs from this account: market rate plus the bank's charge.
const fxCharge = (amount, cur, acc) => round2(convertAmount(amount, cur, acc.currency) * (1 + fxFeeFor(acc) / 100));
// From a real charge: the bank's charge in % (kept for the next foreign purchase). Ignores impossible values.
const learnFxFee = (acc, amount, cur, charged) => {
    if (!fxApplies(acc)) return null;
    const mid = convertAmount(amount, cur, acc.currency);
    if (!(mid > 0) || !(charged > 0)) return null;
    const pct = round2((charged / mid - 1) * 100);
    if (pct < -3 || pct > 15) return null;
    acc.fxFee = pct;
    state.syncSettings = true;
    return pct;
};
const reestimateFx = (acc) => {
    let n = 0;
    state.transactions.forEach((t) => {
        if (t.accountId !== acc.id || !t.fx || !t.fx.estimated) return;
        const rate = t.fx.rate || convertAmount(1, t.fx.currency, acc.currency);
        const amount = round2(t.fx.amount * rate * (1 + fxFeeFor(acc) / 100));
        if (Math.abs(amount - t.amount) < 0.005) return;
        t.amount = amount;
        t.fx.fee = fxFeeFor(acc);
        t.fx.rate = rate;
        queueSync('transaction', t.id, 'upsert', false);
        n++;
    });
    return n;
};
const fxNote = (t) => (t.fx ? `${formatCurrency(t.fx.amount, t.fx.currency)}${t.fx.estimated ? ' · estimated charge' : ''}` : '');
// The day an account's balance was typed in (when it was added, or when its balance was last corrected).
const cleanTime = (v) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null);
const nowTime = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
// When an entry happened in the day: its own time, or the time on the bank SMS.
const txTime = (t) => (t && (cleanTime(t.time) || (t.bank && cleanTime(t.bank.time)))) || null;
const fmtTime = (hm) => { if (!hm) return ''; const [hh, mm] = hm.split(':').map(Number); return new Date(2000, 0, 1, hh, mm).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
const balanceDateOf = (acc) => (acc ? acc.balanceDate || (acc.createdAt ? toISODate(new Date(acc.createdAt)) : null) : null);
// An entry dated before that day is already inside that balance.
const beforeBalanceFor = (accountId, date, time = null) => {
    const acc = state.accounts.find((a) => a.id === accountId);
    const d = balanceDateOf(acc);
    if (!(d && date)) return false;
    if (date < d) return true;
    // Same day as the balance: an entry from earlier that day (8 AM purchase, balance typed at 11 AM) is already in it.
    const bt = acc && (cleanTime(acc.balanceTime) || (!acc.balanceDate && acc.createdAt ? new Date(acc.createdAt).toTimeString().slice(0, 5) : null));
    return !!(date === d && time && bt && time < bt);
};
// Entries added (by hand, from bank SMS, ...) after an account was set up but dated before it were taken off the
// balance a second time. Fixed once: they're marked as already in the balance. Only accounts given a balance.
const fixBeforeBalance = () => {
    if (storage.get('VELA_BEFORE_BAL_FIXED') === '1') return 0;
    let n = 0;
    state.transactions.forEach((t) => {
        if (t.type === 'transfer' || t.beforeBalance) return;
        const a = state.accounts.find((x) => x.id === t.accountId);
        if (!a || !a.createdAt || !a.opening || !t.createdAt) return;
        if (t.createdAt > a.createdAt && t.date < toISODate(new Date(a.createdAt))) { t.beforeBalance = true; queueSync('transaction', t.id, 'upsert', false); n++; }
    });
    storage.set('VELA_BEFORE_BAL_FIXED', '1');
    if (n) saveState();
    return n;
};
const netWorth = () => state.accounts.reduce((s, a) => s + toDisplay(accountBalance(a), a.currency), 0);
// How much the account you're in changed this month (income, spending and transfers in or out; waiting ones not
// yet). With all accounts together, transfers between them cancel out.
const monthChange = (y = new Date().getFullYear(), m = new Date().getMonth()) => {
    const v = scopeId();
    return viewTx().reduce((sum, t) => {
        if (!inMonth(t, y, m) || isUpcoming(t) || t.beforeBalance) return sum; // already in the balance you typed
        if (t.type === 'income') return sum + toDisplay(t.amount, t.currency);
        if (t.type === 'expense') return sum - toDisplay(t.amount, t.currency);
        if (t.type === 'transfer' && v !== 'all') {
            if (t.accountId === v) sum -= toDisplay(t.amount, t.currency);
            if (t.toAccountId === v) sum += toDisplay(t.toAmount, t.toCurrency || t.currency);
        }
        return sum;
    }, 0);
};
// The money you have right now in the account you're in: its starting balance plus every income, minus every
// expense and transfer out (waiting ones not yet). In the display currency.
const viewBalance = () => {
    if (scopeAll || viewId() === 'all') return netWorth();
    const a = viewAccountObj();
    return a ? toDisplay(accountBalance(a), a.currency) : netWorth();
};
const fillAccountSelect = (sel, value, { all = false } = {}) => {
    if (!sel) return;
    sel.innerHTML = (all ? ['<option value="all">All accounts</option>'] : [])
        .concat(state.accounts.map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)} (${a.currency})</option>`)).join('');
    sel.value = value && (value === 'all' || state.accounts.some((a) => a.id === value)) ? value : (all ? 'all' : state.accounts[0].id);
    syncAccountLogos();
};

/* =========================================================================
   5. Persistence & migration
   ========================================================================= */
const cleanDate = (v) => (isISODate(v) ? v : (typeof v === 'string' && isISODate(v.slice(0, 10)) ? v.slice(0, 10) : null));
const stamp = (v) => toNumber(v, 0) || (typeof v === 'string' ? Date.parse(v) || 0 : 0);

const normalizeTx = (t, forcedType) => {
    if (!t || typeof t !== 'object') return null;
    const amount = toNumber(t.amount, NaN);
    if (!(amount > 0)) return null;
    const type = forcedType || (t.type === 'income' ? 'income' : t.type === 'transfer' ? 'transfer' : 'expense');
    const desc = String(t.desc != null ? t.desc : (t.description != null ? t.description : '')).trim().slice(0, 120);
    const transfer = type === 'transfer'
        ? { toAccountId: t.toAccountId ? String(t.toAccountId) : null, toCurrency: normCur(t.toCurrency || t.currency), toAmount: toNumber(t.toAmount, amount) > 0 ? toNumber(t.toAmount, amount) : amount }
        : {};
    return {
        ...transfer,
        id: String(t.id || generateId()),
        type,
        accountId: t.accountId ? String(t.accountId) : null,
        receipt: t.receipt && t.receipt.id ? { id: String(t.receipt.id), path: t.receipt.path ? String(t.receipt.path) : null } : null,
        desc: desc || (type === 'income' ? 'Income' : type === 'transfer' ? 'Transfer' : 'Expense'),
        amount,
        currency: normCur(t.currency),
        category: type === 'transfer' ? 'Transfer' : String(t.category || FALLBACK_CATEGORY[type]),
        date: cleanDate(t.date) || toISODate(),
        note: t.note ? String(t.note).slice(0, 500) : '',
        createdAt: stamp(t.createdAt) || stamp(t.created_at),
        recurringId: t.recurringId ? String(t.recurringId) : null,
        // Fixed: the same every month (rent, internet / salary, allowance). Entries logged from a bill are always fixed.
        fixed: type !== 'transfer' && (t.fixed === true || !!t.recurringId),
        // Money that hasn't come in / gone out yet: counts once confirmed. Old future-dated entries become waiting.
        pending: type !== 'transfer' && (t.pending === true || (t.pending === undefined && (cleanDate(t.date) || '') > toISODate())),
        // Kept across restarts and sync: when it was due and actually paid, and the bank details it was matched with
        // (without these, a restart forgot an entry came from a bank SMS and the same SMS could be added again).
        ...(cleanDate(t.dueDate) ? { dueDate: cleanDate(t.dueDate) } : {}),
        ...(cleanTime(t.time) ? { time: cleanTime(t.time) } : {}),
        ...(type === 'expense' && t.feeFor ? { feeFor: String(t.feeFor).slice(0, 64) } : {}),
        ...(type === 'expense' && typeof t.billRef === 'string' && t.billRef.trim() ? { billRef: t.billRef.trim().slice(0, 40) } : {}),
        ...(type === 'expense' && t.feeEstimated === true ? { feeEstimated: true } : {}),
        ...(type === 'income' && typeof t.inBudget === 'boolean' ? { inBudget: t.inBudget } : {}),
        ...(type === 'income' && t.shareOf ? { shareOf: String(t.shareOf).slice(0, 64) } : {}),
        ...(typeof t.paidAt === 'string' && !isNaN(Date.parse(t.paidAt)) ? { paidAt: t.paidAt } : {}),
        ...(normalizeBankMeta(t.bank) ? { bank: normalizeBankMeta(t.bank) } : {}),
        ...(type === 'expense' && t.tripId ? { tripId: String(t.tripId).slice(0, 64) } : {}),
        ...(type === 'expense' && t.sectionId ? { sectionId: String(t.sectionId).slice(0, 64) } : {}),
        // Dated before the account's balance was entered: already in that balance, so it doesn't change it again.
        ...(type !== 'transfer' && t.beforeBalance === true ? { beforeBalance: true } : {}),
        // Paid in another currency: what it was in that currency, the bank's charge used, and whether the account
        // amount is Vela's estimate or what the bank really took.
        ...(type !== 'transfer' && t.fx && toNumber(t.fx.amount, 0) > 0 ? { fx: { amount: toNumber(t.fx.amount, 0), currency: normCur(t.fx.currency), fee: Number.isFinite(Number(t.fx.fee)) ? round2(Number(t.fx.fee)) : null, estimated: t.fx.estimated === true, ...(toNumber(t.fx.rate, 0) > 0 ? { rate: toNumber(t.fx.rate, 0) } : {}) } } : {})
    };
};
// Bank details on an entry: only known fields, short strings, no message text.
const normalizeBankMeta = (b) => {
    if (!b || typeof b !== 'object' || !b.bank) return null;
    const str = (v, n = 80) => (v === null || v === undefined || v === '' ? null : String(v).slice(0, n));
    const strs = (v, n) => (Array.isArray(v) ? v.slice(0, 20).map((x) => String(x).slice(0, n)) : []);
    return {
        bank: str(b.bank, 40), kind: str(b.kind, 20), ref: str(b.ref, 40), last4: str(b.last4, 4), merchant: str(b.merchant) || '',
        smsId: str(b.smsId, 120), dedupe: str(b.dedupe, 200), time: str(b.time, 5),
        sources: strs(b.sources, 20).length ? strs(b.sources, 20) : ['sms'], sourceIds: strs(b.sourceIds, 120),
        bodyKeys: Array.isArray(b.bodyKeys) ? b.bodyKeys.slice(0, 20).filter((k) => Number.isFinite(k)) : [],
        shape: Number.isFinite(b.shape) ? b.shape : null,
        arrivedAt: Number.isFinite(b.arrivedAt) ? b.arrivedAt : null, confidence: str(b.confidence, 10), verifiedAt: str(b.verifiedAt, 40)
    };
};

const normalizeGoal = (g) => {
    if (!g || typeof g !== 'object') return null;
    const target = toNumber(g.target, NaN);
    if (!(target > 0)) return null;
    return {
        id: String(g.id || generateId()),
        name: String(g.name || 'Savings goal').trim().slice(0, 80) || 'Savings goal',
        target,
        currency: normCur(g.currency),
        saved: Math.max(0, toNumber(g.saved, 0)),
        deadline: cleanDate(g.deadline),
        accountId: g.accountId ? String(g.accountId) : null,
        monthly: Math.max(0, round2(toNumber(g.monthly, 0))),
        ...(g.fundId ? { fundId: String(g.fundId).slice(0, 64) } : {}),
        months: g.months && typeof g.months === 'object' ? Object.fromEntries(Object.entries(g.months).filter(([k]) => /^\d{4}-\d{2}$/.test(k)).sort().slice(-24).map(([k, v]) => [k, round2(toNumber(v, 0))])) : {},
        createdAt: stamp(g.createdAt) || stamp(g.created_at)
    };
};

const normalizeBill = (b) => {
    if (!b || typeof b !== 'object') return null;
    const amount = toNumber(b.amount, NaN);
    const nextDate = cleanDate(b.nextDate);
    if (!(amount > 0) || !nextDate) return null;
    const type = b.type === 'income' ? 'income' : 'expense';
    return {
        id: String(b.id || generateId()),
        type,
        name: String(b.name || 'Bill').trim().slice(0, 60) || 'Bill',
        amount,
        currency: normCur(b.currency),
        category: String(b.category || FALLBACK_CATEGORY[type]),
        frequency: FREQ_LABELS[b.frequency] ? b.frequency : 'monthly',
        nextDate,
        anchorDay: Math.min(31, Math.max(1, toNumber(b.anchorDay, parseDate(nextDate).getDate()))),
        accountId: b.accountId ? String(b.accountId) : null,
        // Income never logs itself (it waits until it's received); bills can.
        autoLog: type === 'expense' && b.autoLog !== false,
        createdAt: stamp(b.createdAt),
        ...(typeof b.ref === 'string' && b.ref.trim() ? { ref: b.ref.trim().slice(0, 40) } : {}),
        ...(b.parts && toNumber(b.parts.count, 0) >= 2 ? { parts: { count: Math.min(60, Math.round(toNumber(b.parts.count, 0))), done: Math.max(0, Math.min(Math.round(toNumber(b.parts.count, 0)), Math.round(toNumber(b.parts.done, 0)))) } } : {}),
        ...(toNumber(b.carry, 0) > 0 ? { carry: round2(toNumber(b.carry, 0)), ...(cleanDate(b.carryFrom) ? { carryFrom: cleanDate(b.carryFrom) } : {}) } : {}),
        ...(b.sub === true ? { sub: true } : {})
    };
};

const normalizeDebt = (d) => {
    if (!d || typeof d !== 'object') return null;
    const amount = toNumber(d.amount, NaN);
    if (!(amount > 0)) return null;
    return {
        id: String(d.id || generateId()),
        direction: d.direction === 'borrowed' ? 'borrowed' : 'lent',
        person: String(d.person || 'Someone').trim().slice(0, 60) || 'Someone',
        amount,
        currency: normCur(d.currency),
        repaid: Math.min(amount, Math.max(0, toNumber(d.repaid, 0))),
        dueDate: cleanDate(d.dueDate),
        note: d.note ? String(d.note).slice(0, 500) : '',
        accountId: d.accountId ? String(d.accountId) : null,
        // Lent or borrowed through the account (made in Vela 4.32 or later): the money left or came into it.
        moved: d.moved === true,
        createdAt: stamp(d.createdAt)
    };
};

const normalizeAccount = (a) => {
    if (!a || typeof a !== 'object' || !a.id) return null;
    return {
        id: String(a.id),
        name: String(a.name || 'Account').trim().slice(0, 40) || 'Account',
        kind: ACCOUNT_KINDS[a.kind] ? a.kind : 'cash',
        currency: normCur(a.currency),
        opening: toNumber(a.opening, 0),
        createdAt: stamp(a.createdAt),
        ...(cleanDate(a.balanceDate) ? { balanceDate: cleanDate(a.balanceDate) } : {}),
        ...(cleanTime(a.balanceTime) ? { balanceTime: cleanTime(a.balanceTime) } : {}),
        ...(Number.isFinite(Number(a.atmFee)) && a.atmFee !== null && a.atmFee !== '' ? { atmFee: round2(Math.max(0, Number(a.atmFee))) } : {}),
        ...(Number.isFinite(Number(a.ceftFee)) && a.ceftFee !== null && a.ceftFee !== '' ? { ceftFee: round2(Math.max(0, Number(a.ceftFee))) } : {}),
        ...(Number.isFinite(Number(a.fxFee)) && a.fxFee !== null && a.fxFee !== '' ? { fxFee: round2(Number(a.fxFee)) } : {})
    };
};

// Every entry belongs to an account; older data gets a "Cash" account.
const fixAccountCurrencies = () => {
    let changed = false;
    state.accounts.forEach((a) => {
        if (toNumber(a.opening, 0) !== 0) return;
        const curs = new Set();
        state.transactions.forEach((t) => {
            if (t.accountId === a.id) curs.add(t.currency);
            if (t.type === 'transfer' && t.toAccountId === a.id) curs.add(t.toCurrency || t.currency);
        });
        state.recurring.forEach((b) => { if (b.accountId === a.id) curs.add(b.currency); });
        const target = curs.size === 0 ? (a.id === 'acc-cash' ? dcur() : null) : curs.size === 1 ? [...curs][0] : null;
        if (target && isCurrency(target) && target !== a.currency) { a.currency = target; changed = true; }
    });
    if (changed) saveState();
    return changed;
};

const ensureAccounts = (st) => {
    if (!st.accounts.length) st.accounts = [{ id: 'acc-cash', name: 'Cash', kind: 'cash', currency: st.config.currency || 'USD', opening: 0, createdAt: 0 }];
    const ids = new Set(st.accounts.map((a) => a.id));
    const first = st.accounts[0].id;
    st.transactions.forEach((t) => {
        if (!ids.has(t.accountId)) t.accountId = first;
        if (t.type === 'transfer' && !ids.has(t.toAccountId)) t.toAccountId = first;
    });
    st.recurring.forEach((b) => { if (!ids.has(b.accountId)) b.accountId = first; });
    // Goals and debts made before accounts were kept apart belong to the first account.
    (st.savings || []).forEach((g) => { if (!ids.has(g.accountId)) g.accountId = first; });
    (st.debts || []).forEach((d) => { if (!ids.has(d.accountId)) d.accountId = first; });
};

const normalizeCategory = (c) => {
    if (!c || typeof c !== 'object' || !c.id) return null;
    return {
        id: String(c.id),
        name: String(c.name || 'Category').trim().slice(0, 24) || 'Category',
        type: c.type === 'income' ? 'income' : 'expense',
        icon: ICON_CHOICES.includes(c.icon) ? c.icon : 'c-Other',
        color: PALETTE.includes(c.color) ? c.color : 'slate',
        builtIn: false
    };
};

// Built-ins always exist; `custom` may also carry a changed look (name/colour/icon) for a built-in id.
const mergeCategories = (custom) => {
    const builtIns = DEFAULT_CATEGORIES.map((c) => ({ ...c, builtIn: true }));
    const extra = [];
    (custom || []).forEach((raw) => {
        const c = normalizeCategory(raw);
        if (!c) return;
        const base = builtIns.find((b) => b.id === c.id);
        if (base) { base.name = c.name; base.icon = c.icon; base.color = c.color; return; }
        if (!extra.some((e) => e.id === c.id)) extra.push(c);
    });
    return builtIns.concat(extra);
};

function normalizeSectionConfig(cfg) {
    const sections = (Array.isArray(cfg.sections) ? cfg.sections : []).map((x) => (x && x.id && x.name ? {
        id: String(x.id).slice(0, 64), name: String(x.name).slice(0, 40),
        mode: ['percent', 'amount', 'rest', 'manual'].includes(x.mode) ? x.mode : 'percent',
        value: Math.max(0, toNumber(x.value, 0)), currency: normCur(x.currency),
        once: x.once === true,
        accountIds: (Array.isArray(x.accountIds) ? x.accountIds : x.accountId ? [x.accountId] : []).map((a) => String(a).slice(0, 64)).filter((a, i, l) => l.indexOf(a) === i).slice(0, 20),
        ...(x.accountShares && typeof x.accountShares === 'object' ? { accountShares: Object.fromEntries(Object.entries(x.accountShares).map(([k, v]) => [String(k).slice(0, 64), Math.max(0, Math.min(100, round2(toNumber(v, 0))))]).slice(0, 20)) } : {}),
        target: toNumber(x.target, 0) > 0 ? round2(toNumber(x.target, 0)) : 0,
        color: PALETTE.includes(x.color) ? x.color : 'slate', icon: String(x.icon || 'i-wallet').slice(0, 32)
    } : null)).filter(Boolean).slice(0, 30);
    const ids = new Set(sections.map((x) => x.id));
    const moves = (Array.isArray(cfg.sectionMoves) ? cfg.sectionMoves : []).map((m) => (m && m.id && toNumber(m.amount, -1) >= 0 ? {
        id: String(m.id).slice(0, 64), date: cleanDate(m.date) || toISODate(), kind: ['income', 'fill', 'move', 'add', 'out'].includes(m.kind) ? m.kind : 'move',
        ...(m.note ? { note: String(m.note).slice(0, 120) } : {}),
        ...(m.accountId ? { accountId: String(m.accountId).slice(0, 64) } : {}),
        incomeId: m.incomeId ? String(m.incomeId).slice(0, 64) : null,
        from: m.from && ids.has(String(m.from)) ? String(m.from) : null, to: m.to && ids.has(String(m.to)) ? String(m.to) : null,
        amount: round2(toNumber(m.amount, 0)), currency: normCur(m.currency)
    } : null)).filter(Boolean).slice(-5000);
    const map = {};
    Object.entries(cfg.sectionCatMap && typeof cfg.sectionCatMap === 'object' ? cfg.sectionCatMap : {}).forEach(([k, v]) => { if (ids.has(String(v))) map[String(k).slice(0, 64)] = String(v); });
    return {
        fundIncomeCats: Array.isArray(cfg.fundIncomeCats) ? cfg.fundIncomeCats.map((x) => String(x).slice(0, 64)).slice(0, 40) : null,
        sections, sectionMoves: moves, sectionCatMap: map,
        sectionSince: sections.length ? (cleanDate(cfg.sectionSince) || null) : null,
        sectionSkipped: (Array.isArray(cfg.sectionSkipped) ? cfg.sectionSkipped : []).map(String).slice(-500)
    };
}
function normalizeTrips(list) {
    return (Array.isArray(list) ? list : []).map((t) => (t && t.id && t.name ? {
        id: String(t.id).slice(0, 64),
        name: String(t.name).slice(0, 60),
        budget: toNumber(t.budget, 0) > 0 ? toNumber(t.budget, 0) : 0,
        currency: normCur(t.currency),
        start: cleanDate(t.start) || toISODate(),
        end: cleanDate(t.end) || null,
        endedAt: t.endedAt ? String(t.endedAt).slice(0, 40) : null
    } : null)).filter(Boolean).slice(-50);
}
const normalizeState = (raw) => {
    const base = createDefaultState();
    if (!raw || typeof raw !== 'object') return base;

    const cfg = raw.config && typeof raw.config === 'object' ? raw.config : {};
    const copyRates = (src) => {
        const outRates = {};
        if (src && typeof src === 'object') Object.keys(src).forEach((k) => { const v = toNumber(src[k], 0); if (isCurrency(k) && v > 0) outRates[k] = v; });
        return outRates;
    };
    base.config.rates = copyRates(cfg.rates);
    base.config.rateOverrides = copyRates(cfg.rateOverrides);
    const legacyRate = toNumber(cfg.rate, 0); // v1-v3 kept a single USD -> LKR rate
    if (legacyRate > 0 && !base.config.rates.LKR) {
        if (cfg.rateLocked) base.config.rateOverrides.LKR = legacyRate;
        else base.config.rates.LKR = legacyRate;
    }
    base.config.ratesUpdatedAt = cfg.ratesUpdatedAt || cfg.rateUpdatedAt || null;
    base.config.currency = normCur(cfg.currency);
    const curList = Array.isArray(cfg.currencies) ? cfg.currencies.filter(isCurrency) : [];
    base.config.currencies = [...new Set((curList.length ? curList : ['USD', 'LKR']).concat(base.config.currency))];
    if (cfg.theme === 'light' || cfg.theme === 'dark') base.config.theme = cfg.theme;
    const budget = toNumber(cfg.budget, 1000);
    base.config.budget = budget > 0 ? budget : 1000;
    base.config.budgetCurrency = isCurrency(cfg.budgetCurrency) ? cfg.budgetCurrency : null;
    base.config.budgetMode = ['income', 'balance'].includes(cfg.budgetMode) ? cfg.budgetMode : 'fixed';
    base.config.budgetSavePct = Math.min(90, Math.max(0, Math.round(toNumber(cfg.budgetSavePct, 0))));
    base.config.budgetSkipIncome = Array.isArray(cfg.budgetSkipIncome) ? cfg.budgetSkipIncome.map((x) => String(x).slice(0, 64)).slice(0, 60) : null;
    if (cfg.categoryBudgets && typeof cfg.categoryBudgets === 'object') {
        Object.keys(cfg.categoryBudgets).forEach((k) => {
            const v = toNumber(cfg.categoryBudgets[k], 0);
            if (v > 0) base.config.categoryBudgets[k] = v;
        });
    }
    base.config.accountBudgets = cleanAccountBudgets(cfg.accountBudgets);
    base.config.trips = normalizeTrips(cfg.trips);
    // Saved before the switch existed: the budget was on. A new start: off until you turn it on.
    base.config.budgetOn = cfg.budgetOn === undefined ? !!(raw && raw.transactions && raw.transactions.length) : cfg.budgetOn === true;
    Object.assign(base.config, normalizeSectionConfig(cfg));
    if (cfg.lastCategory && typeof cfg.lastCategory === 'object') {
        base.config.lastCategory = { ...base.config.lastCategory, ...cfg.lastCategory };
    } else if (typeof cfg.lastCategory === 'string') {
        base.config.lastCategory.expense = cfg.lastCategory;
    }
    if (cfg.lock && typeof cfg.lock === 'object' && cfg.lock.hash && cfg.lock.salt) {
        base.config.lock = { enabled: !!cfg.lock.enabled, hash: String(cfg.lock.hash), salt: String(cfg.lock.salt), biometric: !!cfg.lock.biometric };
    }
    base.config.lastAccount = cfg.lastAccount ? String(cfg.lastAccount) : null;
    if (cfg.priceBook && typeof cfg.priceBook === 'object') {
        Object.keys(cfg.priceBook).forEach((cur) => {
            const src = cfg.priceBook[cur];
            if (!isCurrency(cur) || !src || typeof src !== 'object') return;
            const out = {};
            Object.keys(src).slice(0, 200).forEach((name) => {
                const e = src[name];
                const price = e && toNumber(e.price, 0);
                if (!name || !(price > 0)) return;
                out[String(name).slice(0, 40)] = { price, ...(e.added ? { added: true } : {}), ...(e.category ? { category: String(e.category) } : {}) };
            });
            base.config.priceBook[cur] = out;
        });
    }
    base.config.reminders = !!cfg.reminders;
    base.config.reminderIds = Array.isArray(cfg.reminderIds) ? cfg.reminderIds.filter(Number.isInteger) : [];

    base.categories = mergeCategories(Array.isArray(raw.categories) ? raw.categories : []);

    // v1/v2 stored expenses only.
    const txs = [];
    if (Array.isArray(raw.transactions)) raw.transactions.forEach((t) => txs.push(normalizeTx(t)));
    if (Array.isArray(raw.expenses)) raw.expenses.forEach((t) => txs.push(normalizeTx(t, 'expense')));
    base.transactions = txs.filter(Boolean);
    base.savings = Array.isArray(raw.savings) ? raw.savings.map(normalizeGoal).filter(Boolean) : [];
    base.recurring = Array.isArray(raw.recurring) ? raw.recurring.map(normalizeBill).filter(Boolean) : [];
    base.debts = Array.isArray(raw.debts) ? raw.debts.map(normalizeDebt).filter(Boolean) : [];
    base.accounts = Array.isArray(raw.accounts) ? raw.accounts.map(normalizeAccount).filter(Boolean) : [];
    ensureAccounts(base);

    if (raw.auth && typeof raw.auth === 'object') {
        const u = raw.auth.user;
        base.auth.user = u && typeof u === 'object' ? {
            id: u.id ? String(u.id) : 'local',
            email: u.email ? String(u.email) : null,
            full_name: u.full_name ? String(u.full_name) : null,
            avatar_url: u.avatar_url ? String(u.avatar_url) : null
        } : null;
        base.auth.isMock = raw.auth.isMock !== false;
        base.auth.completedOnboarding = !!raw.auth.completedOnboarding;
        if (base.auth.user && /^(mock-|guest-local)/.test(base.auth.user.id)) base.auth.isMock = true;
    }

    if (raw.sync && typeof raw.sync === 'object') {
        // v3: { id: {kind, op} } · v2: { expenses: {id: op}, savings: {id: op} }
        Object.keys(raw.sync).forEach((key) => {
            const v = raw.sync[key];
            if (v && typeof v === 'object' && v.kind && (v.op === 'upsert' || v.op === 'delete')) base.sync[key] = { kind: v.kind, op: v.op };
            else if ((key === 'expenses' || key === 'savings') && v && typeof v === 'object') {
                Object.keys(v).forEach((id) => {
                    if (v[id] === 'upsert' || v[id] === 'delete') base.sync[id] = { kind: key === 'expenses' ? 'transaction' : 'goal', op: v[id] };
                });
            }
        });
    }
    base.syncSettings = !!raw.syncSettings;
    base.settingsUser = raw.settingsUser ? String(raw.settingsUser) : null;
    base.settingsSig = typeof raw.settingsSig === 'string' ? raw.settingsSig : null;
    return base;
};

/* ---- Account settings: everything below is saved to the signed-in account ---- */
const settingsPayload = () => {
    const c = state.config;
    return {
        budget: c.budget,
        categoryBudgets: c.categoryBudgets,
        budgetCurrency: c.budgetCurrency,
        budgetMode: c.budgetMode,
        budgetSavePct: c.budgetSavePct,
        budgetSkipIncome: c.budgetSkipIncome,
        accountBudgets: c.accountBudgets || {},
        currency: c.currency,
        currencies: c.currencies,
        rateOverrides: c.rateOverrides,
        theme: c.theme,
        priceBook: c.priceBook,
        lastCategory: c.lastCategory,
        lastAccount: c.lastAccount,
        reminders: !!c.reminders,
        trips: c.trips || [],
        budgetOn: c.budgetOn !== false,
        sections: c.sections || [],
        sectionMoves: c.sectionMoves || [],
        sectionSince: c.sectionSince || null,
        sectionSkipped: c.sectionSkipped || [],
        sectionCatMap: c.sectionCatMap || {},
        fundIncomeCats: c.fundIncomeCats || null,
        // The PIN goes with the account; fingerprint stays per phone.
        lock: c.lock && c.lock.enabled ? { enabled: true, hash: c.lock.hash, salt: c.lock.salt } : { enabled: false },
        accounts: state.accounts
    };
};
const settingsSigNow = () => JSON.stringify(settingsPayload());
let settingsTimer = null;
// Called on every save: once this phone has the account's settings, any change is queued for upload.
const watchSettings = () => {
    if (!canSync() || state.settingsUser !== state.auth.user.id || state.syncSettings) return;
    if (settingsSigNow() === state.settingsSig) return;
    state.syncSettings = true;
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => flushSync(), 800);
};
const applyCloudSettings = (d) => {
    const c = state.config;
    if (toNumber(d.budget, 0) > 0) c.budget = toNumber(d.budget, 1000);
    if (d.categoryBudgets && typeof d.categoryBudgets === 'object') c.categoryBudgets = { ...d.categoryBudgets };
    c.budgetCurrency = isCurrency(d.budgetCurrency) ? d.budgetCurrency : null;
    if (['income', 'fixed', 'balance'].includes(d.budgetMode)) c.budgetMode = d.budgetMode;
    if (d.budgetSavePct !== undefined) c.budgetSavePct = Math.min(90, Math.max(0, Math.round(toNumber(d.budgetSavePct, 0))));
    if (Array.isArray(d.budgetSkipIncome)) c.budgetSkipIncome = d.budgetSkipIncome.map((x) => String(x).slice(0, 64)).slice(0, 60);
    if (d.accountBudgets && typeof d.accountBudgets === 'object') c.accountBudgets = cleanAccountBudgets(d.accountBudgets);
    if (Array.isArray(d.trips)) c.trips = normalizeTrips(d.trips);
    if (typeof d.budgetOn === 'boolean') c.budgetOn = d.budgetOn;
    if (Array.isArray(d.sections)) Object.assign(c, normalizeSectionConfig(d));
    if (isCurrency(d.currency)) c.currency = d.currency;
    if (Array.isArray(d.currencies) && d.currencies.some(isCurrency)) c.currencies = [...new Set(d.currencies.filter(isCurrency).concat(dcur()))];
    if (d.rateOverrides && typeof d.rateOverrides === 'object') {
        c.rateOverrides = {};
        Object.keys(d.rateOverrides).forEach((k) => { const v = toNumber(d.rateOverrides[k], 0); if (isCurrency(k) && v > 0) c.rateOverrides[k] = v; });
    }
    if (d.theme === 'light' || d.theme === 'dark') c.theme = d.theme;
    if (d.priceBook && typeof d.priceBook === 'object') c.priceBook = normalizeState({ config: { priceBook: d.priceBook } }).config.priceBook;
    if (d.lastCategory && typeof d.lastCategory === 'object') c.lastCategory = { ...c.lastCategory, ...d.lastCategory };
    if (typeof d.lastAccount === 'string') c.lastAccount = d.lastAccount;
    if (typeof d.reminders === 'boolean') c.reminders = d.reminders;
    if (d.lock && typeof d.lock === 'object') {
        c.lock = d.lock.enabled && d.lock.hash && d.lock.salt
            ? { enabled: true, hash: String(d.lock.hash), salt: String(d.lock.salt), biometric: !!(c.lock && c.lock.biometric) }
            : { enabled: false, hash: null, salt: null, biometric: false };
    }
    if (Array.isArray(d.accounts)) state.accounts = d.accounts.map(normalizeAccount).filter(Boolean);
    // Per-account budgets from the cloud: use this phone's account's. Settings saved by an older Vela have one
    // budget only: it becomes the budget of the account this phone is in.
    if (d.accountBudgets && typeof d.accountBudgets === 'object' && Object.keys(d.accountBudgets).length) applyViewBudget();
    else stashBudget();    repairAccountKinds(); // accounts from the cloud too: bank-named ones aren't the cash wallet
};

const saveState = () => {
    dataVersion++;
    if (state.accounts.length) stashBudget();
    watchSettings();
    const ok = storage.set(STORAGE_KEY, JSON.stringify(state));
    if (!ok && !storageWarningShown) {
        storageWarningShown = true;
        showToast("This device isn't letting Vela save. Check that storage is allowed and not full.", 'error');
    }
    return ok;
};
// Saves a change the user just made. If the phone refuses to store it, the change is undone (what was saved
// before comes back), an error is shown, and the caller must not say "Saved".
const commitState = (what = 'That change') => {
    if (saveState()) return true;
    loadState();
    applyViewBudget();
    showToast(`${what} couldn't be saved on this phone, so nothing was changed. Free up some space and try again.`, 'error');
    renderActive();
    return false;
};

/* ---- Region: a new install starts in the local currency ---- */
const TZ_CURRENCY = {
    'Asia/Colombo': 'LKR', 'Asia/Kolkata': 'INR', 'Asia/Calcutta': 'INR', 'Asia/Dubai': 'AED', 'Asia/Riyadh': 'SAR', 'Asia/Qatar': 'QAR',
    'Asia/Kuwait': 'KWD', 'Asia/Muscat': 'OMR', 'Asia/Singapore': 'SGD', 'Asia/Kuala_Lumpur': 'MYR', 'Asia/Tokyo': 'JPY',
    'Asia/Shanghai': 'CNY', 'Asia/Chongqing': 'CNY', 'Indian/Maldives': 'MVR', 'Europe/London': 'GBP'
};
const COUNTRY_CURRENCY = {
    LK: 'LKR', IN: 'INR', AE: 'AED', SA: 'SAR', QA: 'QAR', KW: 'KWD', OM: 'OMR', SG: 'SGD', MY: 'MYR', JP: 'JPY', CN: 'CNY', MV: 'MVR',
    GB: 'GBP', AU: 'AUD', CA: 'CAD', US: 'USD', DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR', IE: 'EUR', PT: 'EUR', BE: 'EUR',
    AT: 'EUR', FI: 'EUR', GR: 'EUR'
};
const regionCurrency = () => {
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
        if (TZ_CURRENCY[tz]) return TZ_CURRENCY[tz];
        if (tz.startsWith('Australia/')) return 'AUD';
        const langs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || '']);
        for (const l of langs) {
            const m = /[-_]([A-Za-z]{2})$/.exec(l || '');
            if (m && COUNTRY_CURRENCY[m[1].toUpperCase()]) return COUNTRY_CURRENCY[m[1].toUpperCase()];
        }
        if (tz.startsWith('Europe/')) return 'EUR';
    } catch (e) { /* no Intl */ }
    return 'USD';
};
const applyRegionDefaults = (st) => {
    const cur = regionCurrency();
    st.config.currency = cur;
    st.config.currencies = [...new Set([cur, 'USD', cur === 'LKR' ? 'INR' : 'LKR'])];
    st.config.budgetCurrency = cur;
    const b = 1000 * (FALLBACK_RATES[cur] || 1);
    st.config.budget = b >= 10000 ? Math.round(b / 1000) * 1000 : Math.round(b / 10) * 10;
    st.accounts = [];
    ensureAccounts(st);
};

const loadState = () => {
    dataVersion++;
    const raw = storage.get(STORAGE_KEY);
    if (!raw) { state = createDefaultState(); applyRegionDefaults(state); return; }
    try {
        state = normalizeState(JSON.parse(raw));
    } catch (e) {
        console.error('Stored Vela data was unreadable; starting fresh.', e);
        state = createDefaultState();
    }
};

/* =========================================================================
   6. Feedback: toasts, confirm dialog, busy buttons
   ========================================================================= */
const TOAST_ICONS = { success: 'i-check', error: 'i-x', warning: 'i-alert', info: 'i-info' };

const showToast = (message, type = 'success') => {
    const container = $('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${TOAST_ICONS[type] ? type : 'info'}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.innerHTML = `<span class="toast-icon">${icon(TOAST_ICONS[type] || 'i-info')}</span><span class="toast-text"></span>`;
    toast.querySelector('.toast-text').textContent = message;
    container.appendChild(toast);
    while (container.children.length > 3) container.firstElementChild.remove();
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('visible')));
    const dismiss = () => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    };
    toast.addEventListener('click', dismiss);
    setTimeout(dismiss, type === 'error' || type === 'warning' ? 5000 : 3200);
};

const showConfirm = ({ title, message, confirmLabel = 'Delete', cancelLabel = 'Cancel', danger = true, onConfirm }) => {
    const overlay = $('modal-confirm');
    $('confirm-title').textContent = title;
    $('confirm-message').textContent = message;
    $('btn-confirm-cancel').textContent = cancelLabel;
    const ok = $('btn-confirm-ok');
    ok.textContent = confirmLabel;
    ok.className = danger ? 'btn btn-danger-solid' : 'btn btn-primary';
    confirmHandler = onConfirm;
    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
    setTimeout(() => $('btn-confirm-cancel').focus({ preventScroll: true }), 50);
};

const closeConfirm = () => {
    const overlay = $('modal-confirm');
    overlay.classList.remove('active');
    overlay.setAttribute('aria-hidden', 'true');
    confirmHandler = null;
};

const isConfirmOpen = () => $('modal-confirm').classList.contains('active');

const withBusy = async (btn, task) => {
    if (!btn) return task();
    btn.setAttribute('aria-busy', 'true');
    btn.disabled = true;
    try {
        return await task();
    } finally {
        btn.removeAttribute('aria-busy');
        btn.disabled = false;
    }
};

const fieldError = (input, message) => {
    showToast(message, 'error');
    if (!input) return false;
    input.setAttribute('aria-invalid', 'true');
    const field = input.closest('.field');
    if (field) {
        let err = field.querySelector('.field-error.js-error');
        if (!err) {
            err = document.createElement('span');
            err.className = 'field-error js-error';
            err.id = `${input.id || 'field'}-error-msg`;
            err.setAttribute('role', 'alert');
            field.appendChild(err);
        }
        err.hidden = false;
        err.innerHTML = `${icon('i-alert')}<span></span>`;
        err.querySelector('span').textContent = message;
        input.setAttribute('aria-describedby', err.id);
    }
    input.focus();
    const clear = () => {
        input.removeAttribute('aria-invalid');
        const e = field && field.querySelector('.field-error.js-error');
        if (e) e.hidden = true;
    };
    input.addEventListener('input', clear, { once: true });
    input.addEventListener('change', clear, { once: true });
    return false;
};

// Forms are reused, so stale inline errors must go when a sheet opens.
const clearFieldErrors = (root) => {
    root.querySelectorAll('.field-error.js-error').forEach((e) => { e.hidden = true; });
    root.querySelectorAll('[aria-invalid="true"]').forEach((e) => e.removeAttribute('aria-invalid'));
};

const setPressed = (selector, matchFn) => {
    document.querySelectorAll(selector).forEach((b) => b.setAttribute('aria-pressed', String(!!matchFn(b))));
};

const setSwitch = (el, on) => { if (el) el.setAttribute('aria-checked', String(!!on)); };
const isOn = (el) => !!el && el.getAttribute('aria-checked') === 'true';

/* =========================================================================
   7. Sheets (bottom sheets on phones, dialogs on desktop) + Back button
   ========================================================================= */
const isSheetOpen = (id) => openSheets.includes(id);
const finePointer = () => !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);

const showSheetElement = (id) => {
    const overlay = $(id);
    clearFieldErrors(overlay);
    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
    openSheets.push(id);
    document.body.classList.add('sheet-open');
    if (finePointer()) {
        const first = overlay.querySelector('.sheet-body input:not([type=hidden]):not([hidden]), .sheet-body select, .action-tile');
        if (first) setTimeout(() => first.focus({ preventScroll: true }), 80);
    }
};

const hideSheet = (id) => {
    const overlay = $(id);
    if (!overlay) return;
    overlay.classList.remove('active');
    overlay.setAttribute('aria-hidden', 'true');
    const sheet = overlay.querySelector('.sheet');
    if (sheet) requestAnimationFrame(() => { sheet.style.transform = ''; });
    const idx = openSheets.indexOf(id);
    if (idx !== -1) openSheets.splice(idx, 1);
    if (!openSheets.length) document.body.classList.remove('sheet-open');
};

const openSheet = (id) => {
    if (isSheetOpen(id)) return;
    history.pushState({ vela: 'sheet', id, tab: currentTab }, '');
    showSheetElement(id);
    requestAnimationFrame(syncAccountLogos); // forms set the chosen account after filling the list
};

// Replace the open sheet with another without touching history (avoids Back-button races).
const swapSheet = (fromId, toId) => {
    if (!isSheetOpen(fromId)) { openSheet(toId); return; }
    hideSheet(fromId);
    history.replaceState({ vela: 'sheet', id: toId, tab: currentTab }, '');
    showSheetElement(toId);
};

const closeSheet = (id) => {
    if (!isSheetOpen(id)) return;
    const st = history.state;
    if (st && st.vela === 'sheet' && st.id === id) history.back();
    else hideSheet(id);
};

const openOrSwap = (id) => {
    const top = openSheets[openSheets.length - 1];
    if (top && top !== id) swapSheet(top, id);
    else openSheet(id);
};

const initSheetDrag = () => {
    document.querySelectorAll('.sheet-overlay').forEach((overlay) => {
        const sheet = overlay.querySelector('.sheet');
        let startY = 0;
        let dy = 0;
        let startT = 0;
        let dragging = false;
        const onDown = (e) => {
            if (window.innerWidth >= 640 || e.target.closest('button')) return;
            dragging = true;
            startY = e.clientY;
            dy = 0;
            startT = performance.now();
            sheet.classList.add('dragging');
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        };
        const onMove = (e) => {
            if (!dragging) return;
            dy = Math.max(0, e.clientY - startY);
            sheet.style.transform = `translateY(${dy}px)`;
        };
        const onUp = () => {
            if (!dragging) return;
            dragging = false;
            sheet.classList.remove('dragging');
            const velocity = dy / Math.max(1, performance.now() - startT);
            if (dy > 110 || (dy > 30 && velocity > 0.6)) closeSheet(overlay.id);
            else sheet.style.transform = '';
        };
        sheet.querySelectorAll('.sheet-grabber, .sheet-head').forEach((h) => {
            h.addEventListener('pointerdown', onDown);
            h.addEventListener('pointermove', onMove);
            h.addEventListener('pointerup', onUp);
            h.addEventListener('pointercancel', onUp);
        });
    });
};

/* =========================================================================
   8. Theme
   ========================================================================= */
const cssVarCache = new Map();
const cssVar = (name) => {
    const key = `${document.documentElement.getAttribute('data-theme')}|${name}`;
    let v = cssVarCache.get(key);
    if (v === undefined) { v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); cssVarCache.set(key, v); }
    return v;
};

const updateThemeChrome = () => {
    const bg = cssVar('--bg') || '#000000';
    const meta = $('meta-theme-color');
    if (meta) meta.setAttribute('content', bg);
    setPressed('[data-theme-choice]', (b) => b.dataset.themeChoice === state.config.theme);
    const statusBar = nativePlugin('StatusBar');
    if (statusBar) {
        statusBar.setStyle({ style: state.config.theme === 'light' ? 'LIGHT' : 'DARK' }).catch(() => {});
        statusBar.setBackgroundColor({ color: bg }).catch(() => {});
    }
};

// Only the charts read their colours in JavaScript; everything else follows the CSS variables by itself.
// So a theme switch redraws the charts on screen (without their grow-in animation) instead of rebuilding the tab.
const recolorCharts = () => {
    chartsInstant = true;
    try {
        if (currentTab === 'dashboard') renderTrendChart();
        else if (currentTab === 'analytics') renderAnalytics();
    } catch (e) { /* charts not ready yet */ } finally { chartsInstant = false; }
};

const applyTheme = (theme) => {
    const root = document.documentElement;
    state.config.theme = theme === 'light' ? 'light' : 'dark';
    // While the whole palette changes, per-element colour transitions are switched off: hundreds of them
    // running at once is what made the switch stutter. They come back two frames later.
    root.classList.add('theme-switching');
    root.setAttribute('data-theme', state.config.theme);
    updateThemeChrome();
    recolorCharts();
    const done = () => root.classList.remove('theme-switching');
    requestAnimationFrame(() => requestAnimationFrame(done));
    setTimeout(done, 400);
    // Saving (and syncing the setting) can wait until the screen has changed.
    setTimeout(saveState, 0);
};

let themeSwitchNo = 0;
const setTheme = (theme, originEvent) => {
    if (theme === state.config.theme) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || reduce) { applyTheme(theme); return; }
    // The new theme spreads out in a circle from the button you tapped. Only two snapshots of the screen are
    // animated (per-element colour transitions are off during the switch), so it stays smooth on phones too.
    const circle = true;
    const root = document.documentElement;
    // The animation needs the browser to draw a frame. If it can't (busy or background tab),
    // switch the theme anyway so the button never appears to do nothing.
    let applied = false;
    const run = () => { if (!applied) { applied = true; applyTheme(theme); } };
    const mine = ++themeSwitchNo;
    root.classList.toggle('theme-fade', !circle);
    const transition = document.startViewTransition(run);
    setTimeout(run, 400);
    const cleanup = () => { if (mine === themeSwitchNo) root.classList.remove('theme-fade'); };
    transition.finished.then(cleanup, cleanup);
    // A second tap or a background tab skips the animation (the theme is still applied): that is not an error.
    const ready = transition.ready.then(() => true, () => false);
    if (!circle) return;
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    if (originEvent && originEvent.clientX) { x = originEvent.clientX; y = originEvent.clientY; }
    const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    ready.then((ok) => {
        if (!ok) return;
        try {
            root.animate(
                { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`] },
                { duration: 340, easing: 'cubic-bezier(0.33, 1, 0.68, 1)', pseudoElement: '::view-transition-new(root)' }
            );
        } catch (e) { /* the plain cross-fade is used instead */ }
    });
};

/* =========================================================================
   9. Exchange rate
   ========================================================================= */
let rateStatus = 'offline';

// The currency the app bar compares with the dollar: the display currency, or your first other one.
const chipCurrency = () => (dcur() !== 'USD' ? dcur() : myCurrencies().find((c) => c !== 'USD') || null);

const setRateStatus = (status) => {
    rateStatus = status;
    const dot = $('connection-indicator');
    const text = $('current-rate-display');
    const c = chipCurrency();
    if (text) text.textContent = status === 'syncing' ? 'Updating rates…' : (c ? `$1 = ${symbolFor(c).trim()}${/\s$/.test(symbolFor(c)) ? ' ' : ''}${formatRate(rateFor(c))}` : 'Exchange rates');
    const shown = c && state.config.rateOverrides[c] > 0 ? 'manual' : status;
    if (dot) dot.dataset.status = shown;
    const chip = $('rate-chip');
    const titles = { live: 'Live exchange rate', syncing: 'Updating exchange rates', manual: 'Your own exchange rate', offline: 'Saved exchange rate (offline)' };
    if (chip) chip.title = `${titles[shown] || ''}. Tap to change.`;
    renderRateSetting();
};

const fetchLiveExchangeRate = async ({ manual = false } = {}) => {
    setRateStatus('syncing');
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 9000) : null;
    try {
        const res = await fetch(RATE_URL, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const rates = (data && data.rates) || {};
        if (!(Number(rates.LKR) > 0)) throw new Error('Rates missing from response');
        Object.keys(CURRENCIES).forEach((c) => { const v = Number(rates[c]); if (v > 0) state.config.rates[c] = v; });
        if (manual) state.config.rateOverrides = {};
        state.config.ratesUpdatedAt = Date.now();
        saveState();
        if (migrateBudgets()) flushSync();
        setRateStatus('live');
        renderActive();
        if (manual) showToast('Live exchange rates updated', 'success');
    } catch (err) {
        console.warn('Live exchange rates unavailable:', err);
        setRateStatus('offline');
        if (manual) showToast("Couldn't reach the rate service. Using the last saved rates.", 'warning');
    } finally {
        if (timer) clearTimeout(timer);
    }
};

/* =========================================================================
   10. Navigation
   ========================================================================= */
const switchTab = (tab, { fromHistory = false } = {}) => {
    if (!TAB_TITLES[tab]) tab = 'dashboard';
    if (!fromHistory) {
        const st = history.state || {};
        if (tab === currentTab) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            renderActive();
            return;
        }
        if (currentTab === 'dashboard') {
            history.pushState({ vela: 'tab', tab, fromHome: true }, '');
        } else if (tab === 'dashboard' && st.fromHome) {
            history.back();
            return;
        } else {
            history.replaceState({ vela: 'tab', tab, fromHome: !!st.fromHome }, '');
        }
    }
    currentTab = tab;
    document.body.dataset.view = tab;
    document.querySelectorAll('.tab[data-tab], .side-link[data-tab]').forEach((el) => {
        const active = el.dataset.tab === tab;
        el.classList.toggle('active', active);
        if (active) el.setAttribute('aria-current', 'page');
        else el.removeAttribute('aria-current');
    });
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `tab-${tab}`));
    $('page-title').textContent = TAB_TITLES[tab];
    document.title = tab === 'dashboard' ? 'Vela · Money' : `${TAB_TITLES[tab]} · Vela`;
    window.scrollTo(0, 0);
    renderActive();
};

// The account bar at the top of Home, Activity and Insights: which account you're in, its balance, and Switch.
const renderViewBar = () => {
    document.querySelectorAll('.view-bar').forEach((el) => el.remove());
    const a = viewAccountObj();
    const view = $(`tab-${currentTab}`);
    if (!view || !['dashboard', 'activity', 'plan', 'analytics'].includes(currentTab)) return;
    if (!a) {
        if (state.accounts.length < 2) return;
        const total = netWorth();
        const bar = document.createElement('button');
        bar.type = 'button';
        bar.className = 'view-bar';
        bar.dataset.action = 'switch-account';
        bar.setAttribute('aria-label', `All accounts, ${hideAll ? 'balances hidden' : formatCurrency(total, dcur())}. Switch account`);
        bar.innerHTML = `<span class="account-icon">${icon('i-wallet')}</span><span class="view-bar-text"><strong>All accounts</strong><span class="amount ${!hideAll && total < 0 ? 'text-expense' : ''}">${escapeHtml(hideAll ? maskedMoney() : formatCurrency(total, dcur()))}</span></span><span class="view-bar-switch">One account${icon('i-chevron-down', 'ic ic-sm')}</span>`;
        view.prepend(bar);
        return;
    }
    if (currentTab === 'analytics' && insightsAll()) return; // Insights is showing every account together
    const bal = accountBalance(a);
    const bar = document.createElement('button');
    bar.type = 'button';
    bar.className = 'view-bar';
    bar.dataset.action = 'switch-account';
    bar.setAttribute('aria-label', `${a.name}, ${balanceHidden(a.id) ? 'balance hidden' : formatDisplay(bal, a.currency)}. Switch account`);
    const hid = balanceHidden(a.id);
    bar.innerHTML = `${accountBadge(a, 'is-acc', 'account-icon')}<span class="view-bar-text"><strong>${escapeHtml(a.name)}</strong><span class="amount ${!hid && bal < 0 ? 'text-expense' : ''}">${escapeHtml(hid ? maskedMoney() : formatDisplay(bal, a.currency))}</span></span>${state.accounts.length > 1 ? `<span class="view-bar-switch">Switch${icon('i-chevron-down', 'ic ic-sm')}</span>` : ''}`;
    view.prepend(bar);
};
const renderActive = () => {
    balanceMemo = new Map();
    viewTxMemo = new Map();
    try { renderActiveNow(); } finally { balanceMemo = null; viewTxMemo = null; }
    pushWidget();
};
// The Android home-screen widgets (six kinds): balances, budget, bills coming, goals, recent entries and quick add.
// Each gets its figures already formatted; the widgets hide amounts themselves (eye button, hidden by default).
// Always all accounts together, whatever account the app is switched to. Sent a moment after the screen settles.
let widgetTimer = null;
const widgetData = () => {
    const cur = dcur();
    const money = (v) => formatCurrency(v, cur);
    const keep = scopeAll;
    scopeAll = true;
    try {
        const accs = state.accounts.map((a) => { const v = toDisplay(accountBalance(a), a.currency); return { name: a.name, amount: money(v), minus: v < -0.004, v }; })
            .sort((x, y) => Math.abs(y.v) - Math.abs(x.v)).slice(0, 4).map(({ v, ...r }) => r);
        const total = netWorth();
        const balances = {
            title: state.accounts.length > 1 ? 'All accounts' : ((state.accounts[0] || {}).name || 'Vela'),
            big: money(total), minus: total < -0.004,
            rows: state.accounts.length > 1 ? accs : []
        };
        const st = monthStats();
        const month = new Date().toLocaleDateString('en-US', { month: 'long' });
        const left = st.budget - st.spent;
        const cats = Object.entries(st.byCat || {}).map(([id, v]) => ({ id, v: typeof v === 'number' ? v : (v && v.spent) || 0 }))
            .filter((x) => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 3)
            .map((x) => ({ name: catById(x.id, 'expense').name, amount: money(x.v) }));
        const budget = st.budget > 0
            ? { title: `Budget · ${month}`, big: money(Math.abs(left)), minus: left < 0, sub: left < 0 ? `Over the budget · spent ${Math.round(st.budgetPct)}%` : `Left to spend · ${Math.round(st.budgetPct)}% used`, rows: [{ name: 'Spent', amount: money(st.spent) }, { name: 'Budget', amount: money(st.budget) }, ...cats].slice(0, 4) }
            : { title: `Spent · ${month}`, big: money(st.spent), sub: 'No budget set yet', rows: cats };
        const today = todayISO();
        const soon = state.recurring.filter((b) => b.type === 'expense').sort((a, b) => (a.nextDate > b.nextDate ? 1 : -1));
        const waiting = state.transactions.filter((t) => t.pending && t.type === 'expense' && !t.recurringId);
        const due = [...soon.map((b) => ({ name: b.name, date: b.nextDate, v: toDisplay(billDue(b), b.currency) })), ...waiting.map((t) => ({ name: t.desc, date: t.date, v: toDisplay(t.amount, t.currency) }))]
            .sort((a, b) => (a.date > b.date ? 1 : -1));
        const now = new Date();
        const monthEnd = toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
        const dueMonth = due.filter((x) => x.date <= monthEnd);
        const bills = {
            title: 'Bills coming', big: money(dueMonth.reduce((n, x) => n + x.v, 0)),
            sub: dueMonth.length ? `${dueMonth.length} still to pay this month${dueMonth.some((x) => x.date < today) ? ' · some late' : ''}` : 'Nothing left to pay this month',
            rows: due.slice(0, 4).map((x) => ({ name: `${x.name} · ${x.date < today ? 'late' : x.date === today ? 'today' : shortDate(x.date)}`, amount: money(x.v), minus: x.date < today }))
        };
        const goalsList = state.savings || [];
        const gSaved = goalsList.reduce((n, g) => n + toDisplay(g.saved, g.currency), 0);
        const gTarget = goalsList.reduce((n, g) => n + toDisplay(g.target, g.currency), 0);
        const goals = {
            title: 'Goals', big: money(gSaved),
            sub: goalsList.length ? `saved of ${money(gTarget)}` : 'No goals yet · open Vela to add one',
            rows: goalsList.slice(0, 4).map((g) => ({ name: `${g.name} · ${g.target > 0 ? Math.min(100, Math.round((g.saved / g.target) * 100)) : 0}%`, amount: money(toDisplay(g.saved, g.currency)) }))
        };
        const done = sortByNewest(state.transactions.filter((t) => !t.pending && !isUpcoming(t)));
        const spentToday = done.filter((t) => t.type === 'expense' && t.date === today).reduce((n, t) => n + toDisplay(t.amount, t.currency), 0);
        const recent = {
            title: 'Recent', big: money(spentToday), sub: `spent today · ${money(st.spent)} this month`,
            rows: done.slice(0, 4).map((t) => { const v = toDisplay(t.amount, t.currency); return { name: `${t.type === 'transfer' && t.desc === 'ATM withdrawal' ? 'Cash from ATM' : t.desc} · ${t.date === today ? (txTime(t) ? fmtTime(txTime(t)) : 'today') : shortDate(t.date)}`, amount: t.type === 'transfer' ? money(v) : formatSigned(t.type === 'income' ? v : -v, cur), plus: t.type === 'income' }; })
        };
        budget.subHidden = budget.sub; bills.subHidden = bills.sub;
        goals.subHidden = goalsList.length ? `${goalsList.length} goal${goalsList.length === 1 ? '' : 's'}` : goals.sub;
        recent.subHidden = 'spent today';
        return { balances, budget, bills, goals, recent, updated: `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` };
    } finally { scopeAll = keep; }
};
const pushWidget = () => {
    const w = nativePlugin('BalanceWidget');
    if (!w) return;
    clearTimeout(widgetTimer);
    widgetTimer = setTimeout(() => {
        try {
            if (state.auth.isMock && !state.auth.completedOnboarding) { w.clear().catch(() => {}); return; }
            w.update({ data: JSON.stringify(widgetData()) }).catch(() => {});
        } catch (e) { /* the widgets are extra: never break the app */ }
    }, 800);
};
// A tap on a widget opens Vela at the right place (io.github.dinsara0611.vela://widget/<what>). Waits for the lock.
const WIDGET_URL = 'io.github.dinsara0611.vela://widget/';
let widgetPending = null;
const runWidgetAction = (what) => {
    if (isLocked()) { widgetPending = what; return; }
    widgetPending = null;
    [...openSheets].reverse().forEach((id) => closeSheet(id));
    if (what === 'add-expense') openAddTx('expense');
    else if (what === 'add-income') openAddTx('income');
    else if (what === 'add-transfer') openTransfer();
    else if (what === 'activity') goToActivity('all');
    else if (what === 'budget' || what === 'bills' || what === 'goals') goToPlan(what === 'budget' ? 'budgets' : what);
    else switchTab('dashboard');
};
const handleWidgetUrl = (url) => {
    if (!url || !url.startsWith(WIDGET_URL)) return false;
    const what = url.slice(WIDGET_URL.length).split(/[?#/]/)[0];
    setTimeout(() => runWidgetAction(what), 350);
    return true;
};
const renderActiveNow = () => {
    renderViewBar();
    if (currentTab === 'dashboard') renderDashboard();
    else if (currentTab === 'activity') renderActivity();
    else if (currentTab === 'plan') renderPlan();
    else if (currentTab === 'analytics') renderAnalytics();
    else if (currentTab === 'settings') renderSettings();
    refitAmounts($(`tab-${currentTab}`) || document);
};

const goToPlan = (sub) => {
    planTab = sub;
    if (currentTab === 'plan') renderPlan();
    else switchTab('plan');
};

const goToActivity = (type, keepAccount = false) => {
    activityType = type || 'all';
    activityCategory = 'all';
    if (!keepAccount) activityAccount = viewId();
    const now = new Date();
    activityMonth = { y: now.getFullYear(), m: now.getMonth() };
    if (currentTab === 'activity') renderActivity();
    else switchTab('activity');
};

/* =========================================================================
   11. Calculations
   ========================================================================= */
const expenses = () => viewTx().filter((t) => t.type === 'expense' && !isUpcoming(t));
const inAccount = (t, accId) => accId === 'all' || t.accountId === accId || (t.type === 'transfer' && t.toAccountId === accId);
// Accounts are kept apart: Vela always shows one account (its balance, entries, insights, bills and payments)
// and you switch between them (the bar at the top of Home, Activity and Insights, the Accounts list, or an account
// card on Home). The chosen account is remembered on this phone.
const VIEW_KEY = 'VELA_VIEW_ACCOUNT';
const viewId = () => {
    if (!state.accounts.length) return 'all';
    let v = null;
    try { v = localStorage.getItem(VIEW_KEY); } catch (e) { /* storage blocked */ }
    // Every account together (the default since 4.46): one balance, one list, one budget.
    try {
        if (localStorage.getItem('VELA_TOGETHER') !== '1') { localStorage.setItem('VELA_TOGETHER', '1'); if (state.accounts.length > 1) { localStorage.setItem(VIEW_KEY, 'all'); v = 'all'; } }
    } catch (e) { /* storage blocked */ }
    if (v === 'all' && state.accounts.length > 1) return 'all';
    if (v && state.accounts.some((a) => a.id === v)) return v;
    if (state.accounts.length > 1) return 'all';
    // First time (or that account was deleted): the first account, kept until you switch, so saving an entry
    // to another account never moves you there by itself.
    const first = state.accounts[0].id;
    try { localStorage.setItem(VIEW_KEY, first); } catch (e) { /* storage blocked */ }
    return first;
};
const viewAccountObj = () => state.accounts.find((a) => a.id === viewId()) || null;
// Insights can show all accounts together ("All accounts" there); everything else follows the switched account.
let scopeAll = false;
const scopeId = () => (scopeAll ? 'all' : viewId());
const INSIGHTS_ALL_KEY = 'VELA_INSIGHTS_ALL';
const insightsAll = () => { try { return state.accounts.length > 1 && localStorage.getItem(INSIGHTS_ALL_KEY) === '1'; } catch (e) { return false; } };
// Privacy: balances you chose to hide (eye icon) show as "Rs. ••••••" on this phone, per account.
const HIDE_KEY = 'VELA_HIDE_BALANCE';
let hiddenBalances = (() => { try { return new Set(JSON.parse(localStorage.getItem(HIDE_KEY) || '[]')); } catch (e) { return new Set(); } })();
// The eye on Home (All accounts view) hides only the total of all accounts; each account keeps its own eye.
const HIDE_ALL_KEY = 'VELA_HIDE_ALL';
let hideAll = (() => { try { return localStorage.getItem(HIDE_ALL_KEY) === '1'; } catch (e) { return false; } })();
const balanceHidden = (id) => !!id && hiddenBalances.has(id);
const viewBalanceHidden = () => (scopeAll || !viewAccountObj() ? hideAll : balanceHidden(viewId()));
const toggleHideAll = () => {
    hideAll = !hideAll;
    try { localStorage.setItem(HIDE_ALL_KEY, hideAll ? '1' : '0'); } catch (e) { /* storage blocked */ }
    showToast(hideAll ? 'Total of all accounts hidden. Each account still shows.' : 'Total shown', 'info');
    haptic();
    renderActive();
    if (isSheetOpen('modal-accounts')) renderAccountManager();
};
const maskedMoney = (cur) => `${symbolFor(cur || dcur())}••••••`;
const toggleBalanceHidden = (id) => {
    if (!id) return;
    if (hiddenBalances.has(id)) hiddenBalances.delete(id); else hiddenBalances.add(id);
    try { localStorage.setItem(HIDE_KEY, JSON.stringify([...hiddenBalances])); } catch (e) { /* storage blocked */ }
    const a = state.accounts.find((x) => x.id === id);
    showToast(hiddenBalances.has(id) ? `${a ? a.name : 'Balance'} balance hidden` : `${a ? a.name : 'Balance'} balance shown`, 'info');
    haptic();
    renderActive();
    if (isSheetOpen('modal-accounts')) renderAccountManager();
};
// Show an amount, or the mask when that balance is hidden (no count-up, nothing fitted into it).
const showHidden = (el, cur) => {
    if (!el) return;
    cancelAnimationFrame(el._raf);
    clearTimeout(el._done);
    delete el.dataset.v;
    el.style.fontSize = '';
    el.textContent = maskedMoney(cur);
    el.title = 'Hidden';
};
// Recent notifications: what Vela told you about (bank transactions found or added, payments due), newest first.
const NOTIF_KEY = 'VELA_NOTIF_LOG';
let notifLog = (() => { try { const a = JSON.parse(localStorage.getItem(NOTIF_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } })();
const saveNotifLog = () => { try { localStorage.setItem(NOTIF_KEY, JSON.stringify(notifLog.slice(0, 60))); } catch (e) { /* storage blocked */ } };
const logNotif = (n) => {
    if (n.key && notifLog.some((x) => x.key === n.key)) return; // the same event once
    notifLog.unshift({ id: generateId(), at: Date.now(), read: false, ...n });
    notifLog = notifLog.slice(0, 60);
    saveNotifLog();
    updateNotifBell();
};
const updateNotifBell = () => {
    const b = $('btn-notifs');
    if (!b) return;
    const unread = notifLog.filter((x) => !x.read).length;
    b.classList.toggle('has-unread', unread > 0);
    b.setAttribute('aria-label', unread ? `Notifications, ${unread} new` : 'Notifications');
};
const relTime = (ms) => {
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return 'Just now';
    if (m < 60) return `${m} min ago`;
    const hrs = Math.round(m / 60);
    if (hrs < 24) return `${hrs} h ago`;
    return shortDate(toISODate(new Date(ms)));
};
const NOTIF_ICON = { bank: 'i-bank', added: 'i-check', due: 'i-calendar', late: 'i-alert', signin: 'i-lock' };
const openNotifs = () => {
    const list = $('notif-list');
    list.innerHTML = notifLog.length ? notifLog.map((x) => `<li class="notif-row${x.read ? '' : ' is-new'}"><button type="button" class="row-btn" data-notif-open="${escapeHtml(x.id)}">
            <span class="row-icon tint" data-kind="${escapeHtml(x.kind || '')}">${icon(NOTIF_ICON[x.kind] || 'i-bell')}</span>
            <span class="row-label"><span>${escapeHtml(x.title)}</span><span>${escapeHtml(x.text || '')}</span></span>
            <span class="notif-time">${escapeHtml(relTime(x.at))}</span>
        </button></li>`).join('') : `<li>${emptyState({ iconId: 'i-bell', title: 'No notifications yet', text: 'Bank transactions Vela finds and payments that are due show up here.' })}</li>`;
    $('btn-notifs-clear').hidden = !notifLog.length;
    openOrSwap('modal-notifs');
    notifLog.forEach((x) => { x.read = true; });
    saveNotifLog();
    updateNotifBell();
};
const openNotif = (id) => {
    const x = notifLog.find((n) => n.id === id);
    closeSheet('modal-notifs');
    if (!x) return;
    setTimeout(() => {
        if (x.kind === 'signin') { switchTab('settings'); renderDevices(true); }
        else if (x.kind === 'bank' && smsQueue.length) showSmsSheet();
        else if (x.kind === 'due' || x.kind === 'late') { activityType = 'all'; goToActivity('all', true); }
        else switchTab('activity');
    }, 260);
};
let viewTxMemo = null; // during one screen draw, when nothing changes
// Also kept between draws until anything is saved (every change is saved), for the same list of entries.
let viewTxKept = { version: -1, list: null, v: null, src: null };
const viewTx = () => {
    const v = scopeId();
    if (v === 'all') return state.transactions;
    if (viewTxMemo && viewTxMemo.has(v)) return viewTxMemo.get(v);
    if (viewTxKept.version === dataVersion && viewTxKept.v === v && viewTxKept.src === state.transactions && viewTxKept.len === state.transactions.length) return viewTxKept.list;
    const list = state.transactions.filter((t) => inAccount(t, v));
    if (viewTxMemo) viewTxMemo.set(v, list);
    viewTxKept = { version: dataVersion, list, v, src: state.transactions, len: state.transactions.length };
    return list;
};
const ownedBy = (x, v) => (x.accountId || (state.accounts[0] && state.accounts[0].id)) === v;
// Saving for goals each month, kept aside from the budget so it isn't spent.
const ymKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const goalMonthly = (g) => (g.saved >= g.target ? 0 : Math.min(g.monthly || 0, Math.max(0, g.target - g.saved) + ((g.months || {})[ymKey()] || 0)));
const goalSavedThisMonth = (g) => Math.max(0, (g.months || {})[ymKey()] || 0);
const goalsKeep = (list) => round2(list.reduce((a, g) => a + toDisplay(goalMonthly(g), g.currency), 0));
// What to save a month to reach the target by its date.
const goalSuggestMonthly = (target, saved, deadline) => {
    if (!deadline || !(target > saved)) return 0;
    const now = new Date();
    const end = parseDate(deadline);
    const months = Math.max(1, (end.getFullYear() - now.getFullYear()) * 12 + (end.getMonth() - now.getMonth()) + (end.getDate() >= now.getDate() ? 1 : 0));
    return Math.ceil((target - saved) / months / 100) * 100;
};
const viewGoals = () => { const v = scopeId(); return v === 'all' ? state.savings : state.savings.filter((g) => ownedBy(g, v)); };
const viewDebts = () => { const v = scopeId(); return v === 'all' ? state.debts : state.debts.filter((d) => ownedBy(d, v)); };
const viewBills = () => { const v = scopeId(); return v === 'all' ? state.recurring : state.recurring.filter((b) => (b.accountId || (state.accounts[0] && state.accounts[0].id)) === v); };
// Each account has its own budget (amount, category limits, from-income mode). The usual budget settings always
// hold the current account's; switching keeps them aside and brings in the other account's. A new account starts
// with a copy of the one you were in.
const BUDGET_FIELDS = ['budget', 'categoryBudgets', 'budgetCurrency', 'budgetMode', 'budgetSavePct'];
const budgetSnapshot = () => {
    const c = state.config;
    return { budget: c.budget, categoryBudgets: { ...c.categoryBudgets }, budgetCurrency: c.budgetCurrency, budgetMode: c.budgetMode, budgetSavePct: c.budgetSavePct };
};
function stashBudget() {
    const v = viewId();
    state.config.accountBudgets = { ...(state.config.accountBudgets || {}), [v]: budgetSnapshot() };
}
function loadBudget(id) {
    const b = state.config.accountBudgets && state.config.accountBudgets[id];
    if (!b) return false;
    BUDGET_FIELDS.forEach((k) => { if (b[k] !== undefined) state.config[k] = k === 'categoryBudgets' ? { ...b[k] } : b[k]; });
    return true;
}
// On start, after cloud settings arrive and after a restore: the current account's budget in place.
function applyViewBudget() {
    const v = viewId();
    if (!loadBudget(v)) stashBudget();
}
const cleanAccountBudgets = (o) => {
    const out = {};
    if (!o || typeof o !== 'object') return out;
    Object.entries(o).forEach(([id, b]) => {
        if (!b || typeof b !== 'object') return;
        const budget = toNumber(b.budget, 0);
        const cats = {};
        if (b.categoryBudgets && typeof b.categoryBudgets === 'object') Object.entries(b.categoryBudgets).forEach(([k, v]) => { const n = toNumber(v, 0); if (n > 0) cats[k] = n; });
        out[String(id)] = {
            budget: budget > 0 ? budget : 1000, categoryBudgets: cats, budgetCurrency: isCurrency(b.budgetCurrency) ? b.budgetCurrency : null,
            budgetMode: ['income', 'balance'].includes(b.budgetMode) ? b.budgetMode : 'fixed', budgetSavePct: Math.min(90, Math.max(0, Math.round(toNumber(b.budgetSavePct, 0))))
        };
    });
    return out;
};
const setViewAccount = (id) => {
    if (!id || !(id === 'all' || state.accounts.some((a) => a.id === id))) return;
    stashBudget();
    try { localStorage.setItem(VIEW_KEY, id); } catch (e) { /* storage blocked */ }
    if (!loadBudget(id)) stashBudget();
    saveState();
    activityAccount = id;
    renderActive();
    // No pop-up: the account bar at the top already shows which account you're looking at.
    haptic();
};
const sortByNewest = (list) => [...list].sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1
    : (txTime(b) || '') > (txTime(a) || '') ? 1 : (txTime(b) || '') < (txTime(a) || '') ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));
const sumDisplay = (list) => list.reduce((s, e) => s + toDisplay(e.amount, e.currency), 0);
const inMonth = (t, y, m) => { const d = parseDate(t.date); return d.getFullYear() === y && d.getMonth() === m; };

/* ---- Budgets keep the currency you typed them in ---- */
const budgetCur = () => state.config.budgetCurrency || 'USD';
// All accounts together: every account's own monthly budget (from income: that account's income), added up.
function allAccountsBudget(y, m) {
    const cur = dcur();
    const v = viewId();
    return state.accounts.reduce((sum, a) => {
        const b = a.id === v ? budgetSnapshot() : (state.config.accountBudgets || {})[a.id];
        if (!b) return sum;
        const balanceWay = () => {
            const spentHere = sumDisplay(state.transactions.filter((t) => t.type === 'expense' && t.accountId === a.id && inMonth(t, y, m) && !isUpcoming(t))); // everything spent this month: left = what the account has now
            return Math.max(0, toDisplay(accountBalance(a), a.currency) + spentHere);
        };
        if (b.budgetMode === 'balance') return sum + balanceWay();
        if (b.budgetMode === 'income') {
            const inc = sumDisplay(state.transactions.filter((t) => t.type === 'income' && t.accountId === a.id && inMonth(t, y, m) && !isUpcoming(t) && countsForBudget(t)));
            return sum + (inc > 0 ? inc * (1 - (b.budgetSavePct || 0) / 100) : balanceWay());
        }
        return sum + convertAmount(b.budget, b.budgetCurrency || 'USD', cur);
    }, 0);
}
const budgetIn = (value, cur) => convertAmount(value, budgetCur(), cur);
// Old versions stored budgets in US dollars. Move them to the display currency once,
// rounding away the exchange-rate drift (Rs. 30,012.37 -> Rs. 30,000).
const tidyBudget = (v) => (v >= 10000 ? Math.round(v / 100) * 100 : v >= 1000 ? Math.round(v / 10) * 10 : round2(v));
const migrateBudgets = () => {
    if (state.config.budgetCurrency) return false;
    const to = dcur();
    // Needs a real rate to turn old dollar budgets back into what was typed; wait for live rates if missing.
    if (to !== 'USD' && !(state.config.rateOverrides[to] > 0) && !(state.config.rates[to] > 0)) return false;
    state.config.budget = tidyBudget(convertAmount(state.config.budget, 'USD', to));
    Object.keys(state.config.categoryBudgets).forEach((k) => { state.config.categoryBudgets[k] = tidyBudget(convertAmount(state.config.categoryBudgets[k], 'USD', to)); });
    state.config.budgetCurrency = to;
    saveState();
    return true;
};
// Before saving a budget in another currency, move the others to it so all stay in one currency.
const setBudgetCurrency = (to) => {
    const from = budgetCur();
    if (state.config.budgetCurrency === to) return;
    state.config.budget = round2(convertAmount(state.config.budget, from, to));
    Object.keys(state.config.categoryBudgets).forEach((k) => { state.config.categoryBudgets[k] = round2(convertAmount(state.config.categoryBudgets[k], from, to)); });
    state.config.budgetCurrency = to;
};

// From income: income already spent before Vela tracked it (or already part of an older balance) can't be spent again.
// This month, the budget is at most what the account has now plus what was spent from it this month.
// The group an income belongs to for the budget: a refund or a cash deposit (your own money going back in) from a
// bank SMS, otherwise its category.
const incomeGroup = (t) => (t.bank && (t.bank.kind === 'refund' || t.bank.kind === 'deposit') ? `sms:${t.bank.kind}` : t.category);
const DEFAULT_SKIP_INCOME = ['sms:refund', 'sms:deposit'];
const budgetSkips = () => (Array.isArray(state.config.budgetSkipIncome) ? state.config.budgetSkipIncome : DEFAULT_SKIP_INCOME);
const countsForBudget = (t, skip = budgetSkips()) => (typeof t.inBudget === 'boolean' ? t.inBudget : !skip.includes(incomeGroup(t)));
const incomeGroupName = (g) => (g === 'sms:refund' ? 'Refunds' : g === 'sms:deposit' ? 'Cash deposits (your own cash)' : (catById(g) || {}).name || g);
const incomeCap = (y, m, spent, spentList) => {
    const now = new Date();
    if (y !== now.getFullYear() || m !== now.getMonth()) return Infinity;
    return Math.max(0, viewBalance() + spent);
};
const monthStats = (y = new Date().getFullYear(), m = new Date().getMonth()) => {
    const list = viewTx().filter((t) => inMonth(t, y, m) && !isUpcoming(t));
    const spentList = list.filter((t) => t.type === 'expense');
    const incomeList = list.filter((t) => t.type === 'income');
    const spent = sumDisplay(spentList);
    const income = sumDisplay(incomeList);

    const ref = new Date();
    const prevStart = new Date(y, m - 1, 1);
    const prevEnd = new Date(y, m - 1, Math.min(ref.getDate(), daysInMonth(y, m - 1)));
    const prevSpent = sumDisplay(expenses().filter((e) => { const d = parseDate(e.date); return d >= prevStart && d <= prevEnd; }));

    // From income: only income that has arrived this month counts (money you can actually spend). Income still
    // expected is shown beside it and joins the budget once you mark it received or the bank SMS confirms it.
    const plannedIncome = sumDisplay(incomeList.filter((t) => countsForBudget(t)));
    const expectedIncome = sumDisplay(viewTx().filter((t) => t.type === 'income' && inMonth(t, y, m) && isUpcoming(t)));
    const fromIncome = state.config.budgetMode === 'income';
    // From income, but no income in this account this month (yet): the account's balance is used, not nothing.
    const incomeFallback = !scopeAll && fromIncome && plannedIncome <= 0;
    // From the balance: what you can spend this month is what's in the account now plus what you already spent.
    const fromBalance = !scopeAll && (state.config.budgetMode === 'balance' || incomeFallback);
    const baseBudget = scopeAll ? allAccountsBudget(y, m)
        : fromBalance ? Math.max(0, viewBalance() + spent)
        : fromIncome ? Math.min(plannedIncome * (1 - state.config.budgetSavePct / 100), incomeCap(y, m, spent, spentList)) : budgetIn(state.config.budget, dcur());
    // Goals with a monthly saving: that money is kept aside, so the budget to spend is what's left after it.
    const now0 = new Date();
    const goalKeep = y === now0.getFullYear() && m === now0.getMonth() ? goalsKeep(viewGoals()) : 0;
    const budget = Math.max(0, baseBudget - goalKeep);
    const byCat = {};
    spentList.forEach((e) => { byCat[e.category] = (byCat[e.category] || 0) + toDisplay(e.amount, e.currency); });
    return { list, spentList, incomeList, spent, income, net: income - spent, prevSpent, budget, budgetPct: budget > 0 ? (spent / budget) * 100 : (spent > 0 && fromIncome ? 100 : 0), byCat, fromIncome, fromBalance, plannedIncome, incomeFallback, expectedIncome, baseBudget, goalKeep, incomeCapped: fromIncome && !scopeAll && !fromBalance && baseBudget < plannedIncome * (1 - state.config.budgetSavePct / 100) - 0.5 };
};

const rangeBounds = (range) => {
    const today = startOfDay(new Date());
    let start;
    if (range === '30') start = addDays(today, -29);
    else if (range === '12m') start = new Date(today.getFullYear(), today.getMonth() - 11, 1);
    else {
        const dates = viewTx().map((e) => parseDate(e.date)).filter((d) => !isNaN(d) && d <= today);
        start = dates.length ? new Date(Math.min(...dates)) : today;
    }
    return { start, end: today };
};

const txInRange = (range) => {
    const { start, end } = rangeBounds(range);
    // Same rule as Home: entries still waiting to be paid or received don't count yet.
    return viewTx().filter((e) => { const d = parseDate(e.date); return d >= start && d <= end && !isUpcoming(e); });
};

const debtTotals = () => {
    let owedToYou = 0;
    let youOwe = 0;
    viewDebts().forEach((d) => {
        const left = toDisplay(Math.max(0, d.amount - d.repaid), d.currency);
        if (d.direction === 'lent') owedToYou += left;
        else youOwe += left;
    });
    return { owedToYou, youOwe };
};

/* ---- Fixed expenses: worked out per month, each bill counted once per due date ---- */
// Due dates of a bill that fall inside a month.
const billDatesInMonth = (b, y, m) => {
    const nd = parseDate(b.nextDate);
    if (isNaN(nd)) return [];
    const days = daysInMonth(y, m);
    const anchor = b.anchorDay || nd.getDate();
    if (b.frequency === 'weekly') {
        const start = new Date(y, m, 1);
        const end = new Date(y, m, days);
        let d = new Date(nd);
        while (d > start) d = addDays(d, -7);
        while (d < start) d = addDays(d, 7);
        const out = [];
        for (; d <= end; d = addDays(d, 7)) out.push(toISODate(d));
        return out;
    }
    if (b.frequency === 'yearly') return nd.getMonth() === m ? [toISODate(new Date(y, m, Math.min(anchor, days)))] : [];
    return [toISODate(new Date(y, m, Math.min(anchor, days)))];
};
// Income of the month minus its fixed expenses. A bill's due dates before its next due date were
// either logged (an entry exists) or handled before Vela, so only entries and dates from the next
// due date on are counted: nothing is taken off twice.
const fixedForMonth = (y = new Date().getFullYear(), m = new Date().getMonth()) => {
    const items = [];
    viewBills().filter((b) => b.type === 'expense').forEach((b) => {
        viewTx().filter((t) => t.recurringId === b.id && t.type === 'expense' && inMonth(t, y, m)).forEach((t) => {
            items.push({ name: t.desc, amount: toDisplay(t.amount, t.currency), date: t.date, paid: !isUpcoming(t), billId: b.id, txId: t.id });
        });
        billDatesInMonth(b, y, m).filter((d) => d >= b.nextDate).forEach((d) => {
            // The next one includes anything carried over; the ones after are the normal amount.
            items.push({ name: b.name, amount: toDisplay(d === b.nextDate ? billDue(b) : b.amount, b.currency), date: d, paid: false, billId: b.id });
        });
    });
    // One-off fixed entries, and entries whose repeating fixed expense was deleted (they still happened).
    const billIds = new Set(viewBills().map((b) => b.id));
    viewTx().filter((t) => t.type === 'expense' && t.fixed && (!t.recurringId || !billIds.has(t.recurringId)) && inMonth(t, y, m)).forEach((t) => {
        items.push({ name: t.desc, amount: toDisplay(t.amount, t.currency), date: t.date, paid: !isUpcoming(t), txId: t.id });
    });
    items.sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));
    const total = items.reduce((s, i) => s + i.amount, 0);
    // Income actually received this month; money still expected is shown separately and isn't counted yet.
    const monthIncome = viewTx().filter((t) => t.type === 'income' && inMonth(t, y, m));
    const income = sumDisplay(monthIncome.filter((t) => !isUpcoming(t)));
    const expected = sumDisplay(monthIncome.filter((t) => isUpcoming(t)));
    const paid = items.filter((i) => i.paid).reduce((s, i) => s + i.amount, 0);
    // Paid ones have already left the account (they're entries), so only what's still due comes off what you have.
    const balance = viewBalance();
    // Saved toward goals in this account: still in it, but set aside, so it isn't "left for everything else".
    const goals = viewGoals().reduce((sum, g) => sum + toDisplay(g.saved, g.currency), 0);
    return { items, total, paid, due: total - paid, income, expected, balance, goals, left: balance - (total - paid) - goals };
};

const fixedSummaryHtml = ({ list = false, link = false } = {}) => {
    const cur = dcur();
    const f = fixedForMonth();
    const pct = f.balance > 0 ? Math.min(100, (f.due / f.balance) * 100) : (f.due > 0 ? 100 : 0);
    const rows = list && f.items.length ? `<ul class="fx-items">${f.items.map((i) => `<li><span class="fx-item-name">${escapeHtml(i.name)}</span><span class="fx-item-when ${i.paid ? 'is-paid' : ''}">${i.paid ? `${icon('i-check', 'ic ic-sm')} Paid ${escapeHtml(shortDate(i.date))}` : `Due ${escapeHtml(shortDate(i.date))}`}</span><span class="amount">${escapeHtml(formatCurrency(i.amount, cur))}</span></li>`).join('')}</ul>` : '';
    return `<article class="card fx-card glow" style="--glow:var(--pal-cyan)">
        <div class="card-head"><h2 class="card-title">After fixed expenses</h2>${link ? '<button type="button" class="link-btn" data-goto-plan="bills">Details</button>' : `<span class="card-sub">${escapeHtml(monthName(new Date().getFullYear(), new Date().getMonth(), { month: 'long' }))}</span>`}</div>
        <div class="fx-rows">
            <div class="fx-row"><span>In this account now</span><strong class="amount ${viewBalanceHidden() ? '' : f.balance < 0 ? 'text-expense' : 'text-income'}">${escapeHtml(viewBalanceHidden() ? maskedMoney(cur) : formatCurrency(f.balance, cur))}</strong></div>
            ${f.expected > 0 ? `<div class="fx-row fx-expected"><span>Still expected (not counted yet)</span><span class="amount">+${escapeHtml(formatCurrency(f.expected, cur))}</span></div>` : ''}
            <div class="fx-row"><span>Fixed expenses still due${f.items.length ? ` (${f.items.filter((i) => !i.paid).length} of ${f.items.length})` : ''}</span><strong class="amount text-expense">${f.due > 0 ? '−' : ''}${escapeHtml(formatCurrency(f.due, cur))}</strong></div>
            ${f.goals > 0 ? `<div class="fx-row"><span>Set aside for goals</span><strong class="amount">−${escapeHtml(formatCurrency(f.goals, cur))}</strong></div>` : ''}
            <div class="fx-row fx-total"><span>${f.left >= 0 ? 'Left for everything else' : 'Short this month'}</span><strong class="amount ${!viewBalanceHidden() && f.left < 0 ? 'text-expense' : ''}">${escapeHtml(viewBalanceHidden() ? maskedMoney(cur) : formatCurrency(Math.abs(f.left), cur))}</strong></div>
        </div>
        ${meterHtml(pct, pct >= 100 ? 'over' : pct >= 80 ? 'warn' : null, 'Share of your money still needed for fixed expenses')}
        <div class="meter-row" style="margin-top:var(--sp-2)"><span>${f.total > 0 ? `${escapeHtml(formatCurrency(f.paid, cur))} paid of ${escapeHtml(formatCurrency(f.total, cur))} this month` : 'No fixed expenses this month'}</span><span>${f.expected > 0 ? `+${escapeHtml(formatCompact(f.expected, cur))} still expected` : ''}</span></div>
        ${rows}
    </article>`;
};

const monthlyEquivalent = (b) => {
    const v = toDisplay(b.amount, b.currency);
    if (b.frequency === 'weekly') return (v * 52) / 12;
    if (b.frequency === 'yearly') return v / 12;
    return v;
};

/* =========================================================================
   12. Recurring bills & income
   ========================================================================= */
const advanceDate = (dateStr, frequency, anchorDay) => {
    const d = parseDate(dateStr);
    if (frequency === 'weekly') return toISODate(addDays(d, 7));
    if (frequency === 'yearly') {
        const y = d.getFullYear() + 1;
        return toISODate(new Date(y, d.getMonth(), Math.min(anchorDay || d.getDate(), daysInMonth(y, d.getMonth()))));
    }
    const y = d.getMonth() === 11 ? d.getFullYear() + 1 : d.getFullYear();
    const m = (d.getMonth() + 1) % 12;
    return toISODate(new Date(y, m, Math.min(anchorDay || d.getDate(), daysInMonth(y, m))));
};

const billDue = (bill) => round2(bill.amount + (bill.carry || 0)); // this time's amount, with anything carried over
// Plans paid in parts: each payment counts one part; after the last one the plan ends by itself.
const BNPL_RE = /\b(koko|mintpay|payzy|instal+ments?|easy payment|0% plan)\b/i;
const partsLeft = (b) => (b && b.parts ? Math.max(0, b.parts.count - b.parts.done) : 0);
const notePart = (bill, tx, times = 1) => {
    if (!bill.parts) return false;
    const from = bill.parts.done + 1;
    bill.parts.done = Math.min(bill.parts.count, bill.parts.done + times);
    tx.note = [tx.note, from === bill.parts.done ? `Part ${from} of ${bill.parts.count}` : `Parts ${from}-${bill.parts.done} of ${bill.parts.count}`].filter(Boolean).join(' · ');
    return bill.parts.done >= bill.parts.count;
};
const endPlan = (bill) => {
    state.recurring = state.recurring.filter((b) => b.id !== bill.id);
    queueSync('recurring', bill.id, 'delete', false);
    cancelPaymentReminders(`bill:${bill.id}`);
    setTimeout(() => showToast(`${bill.name}: all ${bill.parts.count} parts paid. The plan is finished.`, 'success'), 500);
};
// A new plan: this payment is part `done` (usually 1); the rest come every month from the next month.
const makePlan = ({ name, amount, currency, category, accountId, firstDate, count, done = 1 }) => {
    const day = parseDate(firstDate).getDate();
    let next = firstDate;
    for (let k = 0; k < done; k++) next = advanceDate(next, 'monthly', day);
    const bill = { id: generateId(), type: 'expense', name: name.slice(0, 60), amount: round2(amount), currency, category, frequency: 'monthly', nextDate: next, anchorDay: day, autoLog: false, accountId, parts: { count, done }, createdAt: Date.now() };
    if (done >= count) return null;
    state.recurring.push(bill);
    queueSync('recurring', bill.id, 'upsert', false);
    return bill;
};
const logBill = (bill, date, times = 1) => {
    const carried = bill.carry || 0;
    const tx = {
        id: generateId(),
        type: bill.type,
        desc: bill.name,
        amount: round2(billDue(bill) + bill.amount * (times - 1)),
        currency: bill.currency,
        category: bill.category,
        date,
        note: '',
        createdAt: Date.now(),
        recurringId: bill.id,
        fixed: bill.type === 'expense',
        accountId: bill.accountId || state.accounts[0].id,
        receipt: null
    };
    if (tx.type === 'expense' && autoFundFor(tx.category, tx.amount, tx.currency)) tx.sectionId = autoFundFor(tx.category, tx.amount, tx.currency);
    if (date === todayISO()) tx.time = nowTime();
    if (beforeBalanceFor(tx.accountId, tx.date, tx.time)) tx.beforeBalance = true;
    if (carried) { tx.note = `Includes ${formatCurrency(carried, bill.currency)} carried from ${bill.carryFrom ? shortDate(bill.carryFrom) : 'last time'}`; delete bill.carry; delete bill.carryFrom; }
    notePart(bill, tx, times);
    if (times > 1) {
        const dates = [bill.nextDate];
        for (let k = 1; k < times; k++) dates.push(advanceDate(dates[k - 1], bill.frequency, bill.anchorDay));
        tx.note = [tx.note, `Paid ahead: covers ${dates.map(shortDate).join(', ')}`].filter(Boolean).join('. ');
        tx.covers = times;
    }
    state.transactions.push(tx);
    queueSync('transaction', tx.id, 'upsert', false);
    return tx;
};

// Auto-log every due occurrence (including ones missed while the app was closed).
const processRecurring = () => {
    if (!state.auth.completedOnboarding) return 0;
    const today = todayISO();
    let created = 0;
    state.recurring.forEach((bill) => {
        if (!bill.autoLog || bill.type === 'income') return;
        let guard = 0;
        let changed = false;
        while (bill.nextDate <= today && guard < 60) {
            logBill(bill, bill.nextDate);
            bill.nextDate = advanceDate(bill.nextDate, bill.frequency, bill.anchorDay);
            guard++;
            created++;
            changed = true;
            if (bill.parts && partsLeft(bill) === 0) { endPlan(bill); break; }
        }
        if (changed) queueSync('recurring', bill.id, 'upsert', false);
    });
    if (created) {
        saveState();
        flushSync();
        showToast(`Logged ${plural(created, 'recurring entry', 'recurring entries')} automatically`, 'info');
    }
    return created;
};

const markBillPaid = (id, times = 1) => {
    const bill = state.recurring.find((b) => b.id === id);
    if (!bill) return;
    times = Math.max(1, Math.min(24, Math.round(times) || 1));
    // Recorded on the day it was really paid; the due date is kept on the entry.
    const tx = logBill(bill, todayISO(), times);
    if (bill.type === 'income' && secList().length && allocatesIncome(tx)) setTimeout(() => openDivide(tx.id), 600);
    tx.dueDate = bill.nextDate;
    tx.paidAt = new Date().toISOString();
    cancelPaymentReminders(`bill:${bill.id}`);
    for (let k = 0; k < times; k++) bill.nextDate = advanceDate(bill.nextDate, bill.frequency, bill.anchorDay);
    queueSync('recurring', bill.id, 'upsert', false);
    if (bill.parts && partsLeft(bill) === 0) endPlan(bill);
    saveState();
    flushSync();
    haptic('MEDIUM');
    scheduleReminders();
    showToast(`${bill.name} ${bill.type === 'income' ? 'received' : 'paid'}: ${formatCurrency(tx.amount, bill.currency)}${times > 1 ? ` for ${times} times` : ''}. Next ${shortDate(bill.nextDate)}.`, 'success');
    renderActive();
    if (isSheetOpen('modal-payments')) refreshPaymentsPopup();
};

/* =========================================================================
   13. Bill reminders (Android notifications)
   ========================================================================= */
const hashToInt = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return 1000 + (Math.abs(h) % 1000000);
};

/* ---- Notifications: bill reminders and a daily nudge to log spending ---- */
const NOTIF_CHANNEL = 'vela-reminders';
const DAILY_ID = 900001;
const notifStyle = { channelId: NOTIF_CHANNEL, smallIcon: 'ic_stat_vela', largeIcon: 'ic_notif_large', iconColor: '#9B51E0' };
let notifPermission = 'unknown'; // granted | denied | prompt | unknown
let channelReady = false;

const ensureChannel = async (ln) => {
    if (channelReady || typeof ln.createChannel !== 'function') return;
    try {
        // High importance: shows as a banner with sound, not silently in the tray.
        await ln.createChannel({ id: NOTIF_CHANNEL, name: 'Bills and reminders', description: 'Bills due soon and a daily reminder to log spending', importance: 4, visibility: 1, vibration: true, lights: true, lightColor: '#9B51E0' });
        channelReady = true;
    } catch (e) { /* older Android: the default channel is used */ }
};

// Asks Android for permission when needed (Android 13+ blocks notifications until allowed).
const ensureNotifPermission = async (ln, ask) => {
    try {
        let p = await ln.checkPermissions();
        if (p.display !== 'granted' && ask) p = await ln.requestPermissions();
        notifPermission = p.display;
    } catch (e) {
        notifPermission = 'unknown';
    }
    return notifPermission === 'granted';
};

const scheduleReminders = async ({ ask = false } = {}) => {
    const ln = nativePlugin('LocalNotifications');
    if (!ln) return;
    try {
        if (!state.config.reminders) {
            if (state.config.reminderIds.length) await ln.cancel({ notifications: state.config.reminderIds.map((id) => ({ id })) });
            state.config.reminderIds = [];
            saveState();
            return;
        }
        if (!(await ensureNotifPermission(ln, ask))) { saveState(); if (currentTab === 'settings') renderSettings(); return; }
        await ensureChannel(ln);
        const now = Date.now();
        const notifications = [];
        const nineAm = (iso, addD = 0) => { const d = parseDate(iso); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + addD, 9, 0, 0); };
        // Payments you pay yourself: the day before, on the day, and once overdue. The last two stay
        // (ongoing) until the payment is marked as paid; tapping one asks to confirm.
        paymentItems({ horizonDays: 36500 }).forEach((i) => {
            const [soonId, dueId, lateId] = reminderIdsFor(i.key);
            const money = formatCurrency(i.amount, i.currency);
            const income = i.type === 'income';
            const extra = { payKey: i.key };
            const soon = nineAm(i.due, -1);
            if (soon.getTime() > now) notifications.push({ ...notifStyle, id: soonId, title: income ? `${i.name} expected tomorrow` : `${i.name} is due tomorrow`, body: `${money} · due ${shortDate(i.due)}`, extra, schedule: { at: soon, allowWhileIdle: true } });
            const due = nineAm(i.due);
            if (due.getTime() > now) notifications.push({ ...notifStyle, id: dueId, title: income ? `${i.name}: has ${money} arrived?` : `${i.name}: ${money} due today`, body: 'Open Vela and mark it as paid once it’s done. This reminder stays until then.', ongoing: true, autoCancel: false, extra, schedule: { at: due, allowWhileIdle: true } });
            let late = nineAm(i.due, 1);
            if (late.getTime() <= now) { const t = new Date(); late = new Date(t.getFullYear(), t.getMonth(), t.getDate() + (t.getHours() >= 9 ? 1 : 0), 9, 0, 0); }
            notifications.push({ ...notifStyle, id: lateId, title: `${income ? 'Late' : 'Overdue'}: ${i.name} (${money})`, body: `Was due ${shortDate(i.due)}. Open Vela and mark it as paid when it’s done. This reminder stays until then.`, ongoing: true, autoCancel: false, extra, schedule: { at: late, allowWhileIdle: true } });
        });
        // Fixed expenses Vela logs by itself: a heads-up the day before.
        state.recurring.filter((b) => b.type === 'expense' && b.autoLog).forEach((bill) => {
            const at = nineAm(bill.nextDate, -1);
            if (at.getTime() <= now) return;
            notifications.push({ ...notifStyle, id: hashToInt(bill.id), title: `${bill.name} is due tomorrow`, body: `${formatCurrency(bill.amount, bill.currency)}. Vela will log it automatically.`, schedule: { at, allowWhileIdle: true } });
        });
        // Every evening at 8 pm.
        notifications.push({
            ...notifStyle,
            id: DAILY_ID,
            title: 'Log today’s spending',
            body: 'Take 10 seconds to add what you spent today. Tell Vela AI, like “kottu 1200”.',
            schedule: { on: { hour: 20, minute: 0 }, allowWhileIdle: true }
        });
        // Only remove reminders that no longer apply (paid, deleted, changed). Cancelling everything and
        // scheduling again would wipe a persistent overdue reminder that is already showing.
        const keep = new Set(notifications.map((n) => n.id));
        const stale = state.config.reminderIds.filter((id) => !keep.has(id));
        if (stale.length) await ln.cancel({ notifications: stale.map((id) => ({ id })) });
        await ln.schedule({ notifications });
        state.config.reminderIds = notifications.map((n) => n.id);
        saveState();
    } catch (err) {
        console.warn('Could not schedule reminders:', err);
    }
    if (currentTab === 'settings') renderSettings();
};

const enableReminders = async (on) => {
    const ln = nativePlugin('LocalNotifications');
    if (!ln) {
        showToast('Reminders work in the Android app. Bills due soon also show on Home.', 'info');
        setSwitch($('switch-reminders'), false);
        return;
    }
    if (on && !(await ensureNotifPermission(ln, true))) {
        setSwitch($('switch-reminders'), false);
        showToast('Notifications are blocked. Open Android Settings > Apps > Vela > Notifications and allow them.', 'warning');
        renderSettings();
        return;
    }
    state.config.reminders = on;
    saveState();
    await scheduleReminders();
    showToast(on ? "Reminders on: the day before each bill, and every evening at 8 pm." : 'Reminders off', 'success');
    renderSettings();
};


/* =========================================================================
   14. Rendering — shared pieces
   ========================================================================= */
const transferLine = (t) => `${accountById(t.accountId).name} to ${accountById(t.toAccountId).name}`;

const txRow = (t, { showDate = true, withAccount = viewId() === 'all' && state.accounts.length > 1 } = {}) => {
    const accName = withAccount ? (() => { const a = state.accounts.find((x) => x.id === t.accountId); return a ? a.name : ''; })() : '';
    const when = showDate ? `<span class="tx-when">${escapeHtml(relativeDayLabel(t.date))}${txTime(t) ? ` · ${escapeHtml(fmtTime(txTime(t)))}` : ''}</span>` : (txTime(t) ? `<span class="tx-when">${escapeHtml(fmtTime(txTime(t)))}</span>` : '');
    if (t.type === 'transfer') {
        return `<li><button type="button" class="tx" data-edit-tx="${escapeHtml(t.id)}" data-upcoming="${isUpcoming(t)}">
            <span class="cat-badge" style="--cat:var(--text-2)">${icon('i-swap')}</span>
            <span class="tx-main"><span class="tx-title">${escapeHtml(t.desc === 'ATM withdrawal' ? 'Cash from ATM' : t.desc)}</span><span class="tx-sub"><span>${escapeHtml(transferLine(t))}${t.desc === 'ATM withdrawal' ? ' · not spending' : ''}</span></span></span>
            <span class="tx-amt"><span class="amount is-transfer">${escapeHtml(formatDisplay(t.amount, t.currency))}</span>${origNote(t.amount, t.currency)}${when}</span>
        </button></li>`;
    }
    const cat = catById(t.category, t.type);
    const value = toDisplay(t.amount, t.currency);
    const signed = `${t.fx && t.fx.estimated ? '≈ ' : ''}${formatSigned(t.type === 'income' ? value : -value, dcur())}`;
    const orig = t.fx ? `<span class="tx-orig-inline">${escapeHtml(fxNote(t))}</span>` : t.currency !== dcur() ? `<span class="tx-orig-inline">${escapeHtml(formatCurrency(t.amount, t.currency))}</span>` : '';
    const sec = t.sectionId ? secById(t.sectionId) : null;
    const label = `${accName ? `${t.type === 'income' ? 'Into' : 'From'} ${accName} · ` : ''}${showDate ? cat.name : (t.note || cat.name)}${sec ? ` · ${sec.name}` : ''}${(() => { const b = t.recurringId && state.recurring.find((x) => x.id === t.recurringId); return b && b.ref ? ` · ${refLabel(b.ref)}` : t.billRef ? ` · ${refLabel(t.billRef)}` : ''; })()}${t.beforeBalance ? ' · before balance date' : ''}`;
    const st = t.pending ? payStatus(t.date) : null;
    const waitingStrip = t.pending ? `<div class="tx-confirm" data-status="${st}"><span>${st === 'overdue' ? `${t.type === 'income' ? 'Expected' : 'Was due'} ${escapeHtml(shortDate(t.date))}` : st === 'due' ? (t.type === 'income' ? 'Expected today' : 'Due today') : `Due ${escapeHtml(shortDate(t.date))}`}</span><button type="button" class="btn btn-xs ${t.type === 'income' ? 'btn-income' : 'btn-primary'}" data-pay="tx:${escapeHtml(t.id)}">${icon('i-check', 'ic ic-sm')} ${t.type === 'income' ? 'Mark as received' : 'Mark as paid'}</button></div>` : '';
    return `<li class="${t.pending ? 'tx-li-pending' : ''}"><button type="button" class="tx" data-edit-tx="${escapeHtml(t.id)}" data-upcoming="${isUpcoming(t)}">
        ${entryBadge(t.desc, t.category, t.type)}
        <span class="tx-main"><span class="tx-title">${escapeHtml(t.desc)}</span><span class="tx-sub">${t.pending ? `<span class="tx-upcoming" data-status="${st}">${payStatusLabel(st, t.type)}</span>` : (t.dueDate || t.paidAt ? `<span class="tx-paid">${t.type === 'income' ? 'Received' : 'Paid'}</span>` : '')}${t.bank ? `<span class="tx-bank" title="${escapeHtml(`${t.bank.bank} – ${sourceLabel(t.bank.sources || ['sms'])}`)}">${icon('i-check', 'ic ic-sm')}${escapeHtml(sourceShort(t.bank.sources || ['sms']))}</span>` : ''}${t.fixed ? '<span class="tx-fixed">Fixed</span>' : ''}${t.recurringId ? icon('i-repeat') : ''}${t.receipt ? icon('i-image') : ''}<span>${escapeHtml(label)}</span>${orig}</span></span>
        <span class="tx-amt"><span class="amount ${t.type === 'income' ? 'is-income' : ''}">${escapeHtml(signed)}</span>${when}</span>
    </button>${waitingStrip}</li>`;
};

/* ---- Bank SMS tracking (Android): a structured parser for bank transaction messages ----
   Reads debit and credit alerts from every Sri Lankan bank Vela knows by name and, with a review, from any other
   named sender whose wording is clearly about an account or card. Nothing is added without the user's confirmation
   unless they turn on automatic adding, which only applies to banks whose messages Vela already reads correctly.
   One-time codes, promotions, login alerts, balance messages, reminders and failed payments are never used. */
const SMS_KEY = 'VELA_SMS';
const smsPrefs = () => {
    const base = { enabled: false, paused: false, autoAdd: false, since: 0, seen: [], accountId: null, lastDetected: 0, lastSync: 0, windowMin: 15, trust: {} };
    try { return { ...base, ...(JSON.parse(localStorage.getItem(SMS_KEY) || '{}')) }; } catch (e) { return base; }
};
const saveSmsPrefs = (p) => { try { localStorage.setItem(SMS_KEY, JSON.stringify({ ...p, seen: p.seen.slice(-800) })); } catch (e) { /* storage blocked */ } };
const smsPlugin = () => nativePlugin('SmsReader');
let smsQueue = [];
let smsEditing = null; // the message being edited in the entry form

// Banks, card issuers and wallets whose alerts Vela knows by name. `sender` is tested against the letters of the SMS
// sender ID, `body` against the text (shared or pasted messages have no sender ID). Sender IDs and message shapes
// follow real alerts: the owner's own ComBank messages and samples published in open-source Sri Lankan trackers
// (see tests/feature-check.js). `verified` banks can be added automatically from the start; the others first have
// to be read correctly a few times on this phone (see smsLearn).
const SMS_BANKS = [
    { name: 'Commercial Bank', short: 'ComBank', logo: 'combank', sender: /^(combank|combnk|commercialb|cbc$)/i, body: /\b(combank|com ?bank|commercial bank)\b|\bq\+\s*(?:transaction|payment)/i, verified: true },
    { name: 'Sampath Bank', short: 'Sampath', logo: 'sampath', sender: /^(sampath|samp(cc|txn|bank))/i, body: /\bsampath\b/i },
    { name: 'HNB', short: 'HNB', logo: 'hnb', sender: /^hnb/i, body: /\b(hnb|hatton national)\b/i },
    { name: 'BOC', short: 'BOC', logo: 'boc', sender: /^(boc$|boc(sl|bank|alert|smart)|bankofceylon)/i, body: /\b(boc|bank of ceylon)\b/i },
    { name: "People's Bank", short: "People's", logo: 'peoples', sender: /^(peoplesb|peoplebank|peoples$|pbank$|pplbank)/i, body: /\bpeople'?s bank\b/i },
    { name: 'NSB', short: 'NSB', logo: 'nsb', sender: /^nsb/i, body: /\b(nsb|national savings bank)\b/i },
    { name: 'Nations Trust', short: 'NTB', logo: 'ntb', sender: /^(ntb|nationstrust|nations$|amex)/i, body: /\b(ntb|nations trust|american express|amex)\b/i },
    { name: 'NDB', short: 'NDB', logo: 'ndb', sender: /^ndb/i, body: /\b(ndb|national development bank)\b/i },
    { name: 'Seylan Bank', short: 'Seylan', logo: 'seylan', sender: /^seylan/i, body: /\bseylan\b/i },
    { name: 'DFCC', short: 'DFCC', logo: 'dfcc', sender: /^dfcc/i, body: /\bdfcc\b/i },
    { name: 'Pan Asia Bank', short: 'Pan Asia', logo: 'pabc', sender: /^(pabc|panasia)/i, body: /\b(pabc|pan asia)\b/i },
    { name: 'Union Bank', short: 'Union Bank', logo: 'unionbank', sender: /^(unionb|ubc$)/i, body: /\bunion bank\b/i },
    { name: 'Amana Bank', short: 'Amana', logo: 'amana', sender: /^amana/i, body: /\bamana bank\b/i },
    { name: 'Cargills Bank', short: 'Cargills Bank', logo: 'cargillsbank', sender: /^cargillsb/i, body: /\bcargills bank\b/i },
    { name: 'HSBC', short: 'HSBC', logo: 'hsbc', sender: /^hsbc/i, body: /\bhsbc\b/i },
    { name: 'Standard Chartered', short: 'StanChart', logo: 'scb', sender: /^(scb|stanchart|standardchart)/i, body: /\b(standard chartered|stanchart)\b/i },
    { name: 'MCB', short: 'MCB', logo: 'mcb', sender: /^mcb/i, body: /\bmcb bank\b/i },
    { name: 'SDB', short: 'SDB', logo: 'sdb', sender: /^(sdb|sanasa)/i, body: /\b(sdb bank|sanasa development)\b/i },
    { name: 'RDB', short: 'RDB', logo: 'rdb', sender: /^(rdb|pradeshiya)/i, body: /\b(rdb bank|pradeshiya sanwardhana|regional development bank)\b/i },
    { name: 'HDFC', short: 'HDFC', logo: 'hdfc', sender: /^hdfc/i, body: /\bhdfc bank\b/i },
    { name: 'LOLC', short: 'LOLC', logo: 'lolc', sender: /^lolc/i, body: /\blolc\b/i },
    { name: 'FriMi', short: 'FriMi', logo: 'frimi', sender: /^frimi/i, body: /\bfrimi\b/i },
    { name: 'eZ Cash', short: 'eZ Cash', logo: 'ezcash', sender: /^ezcash/i, body: /\bez ?cash\b/i },
    { name: 'mCash', short: 'mCash', logo: 'mcash', sender: /^mcash/i, body: /\bmcash\b/i }
];
// Named senders that are never bank alerts, even when they talk about money (telecoms, utilities, shops, apps).
const SMS_NOT_BANKS = /^(dialog|mobitel|sltmobitel|slt$|hutch|airtel|etisalat|lankabell|ceb|leco|nwsdb|waterboard|litro|laugfs|pickme|uber|daraz|kapruka|keells|cargills$|cargillsfood|glomark|arpico|spar|pizzahut|kfc|dominos|mcdonalds|burgerking|koko|mintpay|netflix|spotify|google|facebook|whatsapp|instagram|tiktok|youtube|amazon|temu|aliexpress|govlk|health|police|election)/i;

// A real one-time code message carries the code itself. A transaction alert that only says "Do not share OTP"
// in its footer (Sampath and HNB do) is not one.
const SMS_OTP = [
    /(otp|one[ -]?time ?(pass(word|code)?|pin|code)?|verification ?code|security ?code|passcode|auth(entication)? ?code)[\s\S]{0,90}?(\bis\b|:|=)\s*\d{4,8}\b(?![.,]\d)/i,
    /(otp|one[ -]?time password)\s*[:\-=]?\s*\d{4,8}\b(?![.,]\d)/i,
    /\b\d{4,8}\b\s*(is|as) (your|the) (otp|one[ -]?time|verification|security|pin|password|code)/i
];
// Never transactions, whatever else the text says.
const SMS_HARD_IGNORE = [
    [/\b(declined|was not successful|unsuccessful|not successful|failed|rejected|could not be (processed|completed)|insufficient (funds|balance))\b/i, 'failed or declined'],
    [/\b(log(ged)?[- ]?in|sign(ed)?[- ]?in|login attempt|new device|password (was )?changed|pin (was )?changed)\b/i, 'login or security alert'],
    [/\b(will be debited|is due on|payment due|due date|minimum (payment|due|amount)|min\.? ?(amt|amount|payment)? ?due|e-?statement|statement (is )?(ready|generated))\b/i, 'reminder or statement, not a transaction']
];
// Marketing and announcements: ignored unless the text is also worded like a real, completed transaction.
const SMS_SOFT_IGNORE = [
    [/(\d+ ?% ?off|\boffer\b|\bdiscount\b|\bcashback\b|\bwin\b|\bcongratulations\b|\bapply now\b|\binstalment plan\b|\bpromo|\bt&c\b|conditions apply|\benjoy\b)/i, 'promotion'],
    [/\b(security (alert|warning)|beware of|scheduled maintenance|system maintenance|will be unavailable|temporarily unavailable)\b/i, 'security warning or announcement']
];
const SMS_CONDITIONAL = /\b(will be (credited|debited|given|added)|when you|if you|up ?to|stand a chance|valid (till|until|thru|through|from)|t&c|conditions apply|offer valid)\b/i;
// Wording only a real transaction alert uses.
const SMS_STRONG = /\b(debited|credited|purchase (at|of)|withdrawal (at|of|from)|cash withdrawal|transaction (approved|of|alert)|txn (of|at)|auth(orised|orized)? pmt|has been authori[sz]ed|paid to|transferred|transfer (to|from|of)|payment of|deposit(ed)? (to|of|in|at)|used (for|at)|spent|reversal|reversed|refund(ed)?|sms alert|debit (for|of)|credit (for|of)|cefts?|slips|pos)\b/i;
// For senders Vela doesn't know: the text must be about an account or card being debited or credited.
// "Credit for Rs. 3,000.00 to 8024585190" (an account number) counts too.
const SMS_ACCOUNT_WORDING = /\b(a\/c|acc?|account|acct|card|crd|savings|current)\b[\s\S]{0,80}\b(debited|credited)\b|\b(debited|credited)\b[\s\S]{0,60}\b(a\/c|acc?|account|acct|card|crd)\b|\b(credit|debit)\s+(for|of)\b[\s\S]{0,40}\b(to|from)\s+(a\/c\s*)?[x*\d]{6,}|\b(purchase|payment|withdrawal|transaction|txn)\b[\s\S]{0,160}\b(authori[sz]ed|approved|successful)\b[\s\S]{0,80}\b(dc-card|cc-card|card|a\/c|account)\b|\b(purchase|payment|withdrawal|transaction|txn)\b[\s\S]{0,160}\byour\s+(dc-card|cc-card|card|a\/c|account)\b|\b(purchase|payment|withdrawal|transaction|txn)\b[\s\S]{0,160}\b(dc-card|cc-card|card|a\/c|account)\s+(ending|no\.?|number)\b/i;

// Amounts: "LKR 1,500.00", "Rs.1,500", "USD 12.99" and (HNB) "670.59 LKR".
const SMS_CODES = Object.keys(CURRENCIES).join('|');
// Lakh grouping (30,00,000.00 is three million) is tried before the usual 3-digit grouping.
const SMS_NUM = '([0-9]{1,3}(?:,[0-9]{2})+,[0-9]{3}(?:\\.[0-9]{1,2})?|[0-9]{1,3}(?:,[0-9]{3})+(?:\\.[0-9]{1,2})?|[0-9]+(?:\\.[0-9]{1,2})?)';
const SMS_AMOUNT_A = new RegExp(`(${SMS_CODES}|SLR|Rs\\.?|US\\$)\\s*[:.]?\\s*${SMS_NUM}`, 'gi');
const SMS_AMOUNT_B = new RegExp(`${SMS_NUM}\\s*(${SMS_CODES}|SLR)\\b`, 'gi');
const smsCurrency = (c) => { const u = String(c).toUpperCase().replace(/\./g, ''); return u === 'RS' || u === 'SLR' ? 'LKR' : u === 'US$' ? 'USD' : u; };
// A number is a balance or a limit (not what moved) when one of these labels sits right before it.
// Whole words only: "HERBAL CARE for LKR 950" is a shop, not a balance.
const SMS_BALANCE_BEFORE = /\b(?:(?:avl|av|avail|available|curr?|current|ledger|closing|a\/c|acc?|account)?\.?\s?bal(?:ance)?|avl|avail(?:able)?(?:\s+(?:credit|limit))?|(?:credit\s+|cr\.?\s*)?limit|outstanding|o\/s|ledger)\b[\s.:\-]*(?:is|of|now|amt|amount)?[\s.:\-]*$/i;
const smsAmounts = (body) => {
    const out = [];
    let m;
    SMS_AMOUNT_A.lastIndex = 0;
    while ((m = SMS_AMOUNT_A.exec(body))) {
        if (/[A-Za-z]/.test(body[m.index - 1] || '')) continue; // "ORDERS 12" is not "Rs 12"
        out.push({ cur: smsCurrency(m[1]), value: toNumber(m[2], NaN), at: m.index, end: m.index + m[0].length });
    }
    SMS_AMOUNT_B.lastIndex = 0;
    while ((m = SMS_AMOUNT_B.exec(body))) {
        const at = m.index;
        const end = at + m[0].length;
        if (out.some((o) => at < o.end && end > o.at)) continue; // already read as "LKR 500.00"
        if (/[\d.,]/.test(body[at - 1] || '')) continue;
        out.push({ cur: smsCurrency(m[2]), value: toNumber(m[1], NaN), at, end });
    }
    out.sort((a, b) => a.at - b.at);
    out.forEach((a) => { a.balance = SMS_BALANCE_BEFORE.test(body.slice(Math.max(0, a.at - 34), a.at)); });
    return out.filter((a) => a.value > 0);
};

// Kinds of transaction. dir: 'out' expense, 'in' income, 'move' cash withdrawal (bank to Cash),
// 'rev' reversal of an earlier payment, 'card' a payment to the user's own card (a transfer, never income).
const SMS_KIND = {
    reversal: { kind: 'reversal', dir: 'rev', label: 'Reversal' },
    refund: { kind: 'refund', dir: 'in', label: 'Refund' },
    card_payment: { kind: 'card_payment', dir: 'card', label: 'Card payment' },
    fee: { kind: 'fee', dir: 'out', label: 'Bank charge' },
    interest: { kind: 'interest', dir: 'in', label: 'Interest' },
    salary: { kind: 'salary', dir: 'in', label: 'Salary' },
    deposit: { kind: 'deposit', dir: 'in', label: 'Deposit' },
    atm: { kind: 'atm', dir: 'move', label: 'ATM withdrawal' },
    transfer_in: { kind: 'transfer_in', dir: 'in', label: 'Transfer in' },
    transfer_out: { kind: 'transfer_out', dir: 'out', label: 'Transfer out' },
    bill: { kind: 'bill', dir: 'out', label: 'Bill payment' },
    online: { kind: 'online', dir: 'out', label: 'Online payment' },
    card: { kind: 'card', dir: 'out', label: 'Card payment' },
    debit: { kind: 'debit', dir: 'out', label: 'Debit', generic: true },
    credit: { kind: 'credit', dir: 'in', label: 'Credit', generic: true }
};
const SMS_KINDS = Object.values(SMS_KIND);
// Lower case, with "credit card" / "debit card" / "credit limit" taken out of the way so they are never read
// as money being credited or debited ("Cr Crd … Auth Pmt" is a purchase on a credit card).
const smsNorm = (body) => body.toLowerCase()
    .replace(/credit\s*card|\bcr\.?\s*crd\b|\bcr\.?\s*card\b/g, 'cc-card')
    .replace(/debit\s*card|\bdr\.?\s*crd\b|\bdr\.?\s*card\b/g, 'dc-card')
    .replace(/credit\s*limit/g, 'cc-limit')
    .replace(/available\s*credit/g, 'avl-cc');
// What kind of transaction the (normalised) text describes, most specific first; null when it isn't one.
const smsKindOf = (t) => {
    if (/\b(revers(al|ed)|reverted|void(ed)?|cancell?ed transaction|transaction cancell?ed|(ecom|pos|atm|txn|trx|pur) ?rev)\b/.test(t)) return SMS_KIND.reversal;
    if (/\brefund(ed)?\b/.test(t)) return SMS_KIND.refund;
    if (/\bthank you for (your |the )?payment\b|\bpayment\b.{0,60}\b(to|towards|for) (your )?(cc-card|card)\b|\bcard (re)?payment\b|\bcc-card (bill )?(payment|settlement)\b/.test(t)) return SMS_KIND.card_payment;
    // "Transfer Credit Rs 5000.00 To A/C …" (BOC) is money coming in; "CEFT Transfer Debit Rs …" money going out.
    const cr = t.search(/\b(credited|credit (for|of)|(transfer|ceft|slips|fund|funds|inward|direct|online|ib) credit|credit (rs|lkr|usd|inr)\b)/);
    const dr = t.search(/\b(debited|debit (for|of)|deducted|charged|withdrawn|(transfer|ceft|slips|fund|funds|outward|direct|online|ib) debit|debit (rs|lkr|usd|inr)\b)/);
    const dir = cr >= 0 && (dr < 0 || cr < dr) ? 'in' : dr >= 0 ? 'out' : null;
    if (/\b((service|annual|sms|alert|ledger|maintenance|card|stamp|commission|bank|atm)[ -]?(fee|fees|charge|charges)|charges? (of|debited|levied)|fee (of|debited))\b/.test(t)) return SMS_KIND.fee;
    if (dir !== 'out' && /\b(int\.? ?pd|interest (paid|credited|credit|payment))\b/.test(t)) return SMS_KIND.interest;
    if (dir !== 'out' && /\bsalary\b/.test(t)) return SMS_KIND.salary;
    if (dir !== 'out' && /\b(cash deposit|deposited|deposit (of|to|at|in)|cdm)\b/.test(t)) return SMS_KIND.deposit;
    // "ATM POS Transaction" (NSB) is a card purchase; a withdrawal says so, or mentions an ATM and no purchase.
    if (dir !== 'in' && (/\b(cash withdrawal|cash wdl|atm (cash )?(withdrawal|wdl|w\/d)|withdrawal (at|from|of)|withdrawn (at|from))\b/.test(t)
        || (/\batm\b/.test(t) && !/\b(pos|purchase|e-?com|internet)\b/.test(t)))) return SMS_KIND.atm;
    if (/\b(cefts?|slips|rtgs|(fund|funds|ib|online|inward|outward|bank) ?transfer|transfer(red)?|remittance)\b/.test(t)) {
        if (dir === 'in' || (dir === null && /\b(inward|received|remittance|transfer(red)? from)\b/.test(t))) return SMS_KIND.transfer_in;
        if (dir === 'out' || /\bto\b/.test(t)) return SMS_KIND.transfer_out;
    }
    if (dir !== 'in' && /\b(bill ?pmt|bill payment|utility payment|paid to|payment to)\b/.test(t)) return SMS_KIND.bill;
    if (dir !== 'in' && /\b(online|e-?commerce|internet|card not present|ecom|web)\b.{0,40}\b(purchase|payment|transaction|txn|debited|spent)\b|\b(purchase|payment|transaction)\b.{0,30}\b(online|internet)\b|\bsms alert:\s*internet\b|\bat\s+[a-z0-9 .*]*\.(com|lk|net)\b/.test(t)) return SMS_KIND.online;
    if (dir !== 'in' && /\b(pos|purchase|purchased|card (was )?used|used (for|at)|spent|paid at|payment at|txn at|transaction at|transaction approved|auth(orised|orized)? pmt|has been authori[sz]ed)\b|\b(payment|transaction|txn) of\b.{0,30}\bat\b/.test(t)) return SMS_KIND.card;
    if (dir === 'out') return SMS_KIND.debit;
    if (dir === 'in') return SMS_KIND.credit;
    return null;
};
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const titleCase = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/* ---- Known shops, services and banks: a clean name, the right category and a badge.
   [logo slug, pattern, name, category, badge background, badge text colour, letters]. More specific brands come
   first ("Uber Eats" before "Uber"). The real logo (bundled in logos/, see LOGO_SLUGS) is shown when there is one;
   otherwise a badge in the brand's colours. Banks have no category: they only get the badge. ---- */
const BRANDS = [
    // Sri Lankan shops and services (more specific names first: Softlogic Life before Softlogic, Dialog Pay before Dialog)
    ['softlogiclife', 'softlogic life', 'Softlogic Life', 'Other', '#5B2C83', '#ffffff', 'SL'],
    ['dialogpay', 'dialog ?pay|genie\\b', 'Dialog Pay', 'Other', '#E4002B', '#ffffff', 'DP'],
    ['carnage', 'carnage', 'Carnage', 'Shopping', '#111111', '#ffffff', 'C'],
    ['hameedia', 'hameedia', 'Hameedia', 'Shopping', '#111111', '#ffffff', 'H'],
    ['spaceylon', 'spa ceylon', 'Spa Ceylon', 'Shopping', '#5A4632', '#ffffff', 'SC'],
    ['celltronics', 'celltronics', 'Celltronics', 'Shopping', '#1E88E5', '#ffffff', 'C'],
    ['takas', 'takas', 'takas.lk', 'Shopping', '#1C9AD6', '#ffffff', 'T'],
    ['ikman', 'ikman', 'ikman', 'Shopping', '#149777', '#ffffff', 'i'],
    ['lassana', 'lassana', 'Lassana Flora', 'Shopping', '#E91E63', '#ffffff', 'L'],
    ['wasi', 'wasi\\.lk|wasi\\b', 'Wasi.lk', 'Shopping', '#6A1B9A', '#ffffff', 'W'],
    ['javalounge', 'java (?:lounge|coffee)', 'Java Lounge', 'Food', '#3E2723', '#F5D78E', 'J'],
    ['coffeebean', '(?:the )?coffee bean', 'The Coffee Bean', 'Food', '#5F2C82', '#ffffff', 'CB'],
    ['cinnamon', 'cinnamon (?:grand|lakeside|red|hotels?|bey|wild|life|citadel|bentota|colombo)', 'Cinnamon Hotels', 'Travel', '#6B2C91', '#ffffff', 'C'],
    ['shangrila', 'shangri-?la', 'Shangri-La', 'Travel', '#B8902F', '#ffffff', 'SL'],
    ['busseat', 'busseat', 'BusSeat.lk', 'Travel', '#1E88E5', '#ffffff', 'B'],
    ['lankahospitals', 'lanka hospitals?', 'Lanka Hospitals', 'Health', '#0072BC', '#ffffff', 'LH'],
    ['hemas', 'hemas', 'Hemas Hospitals', 'Health', '#00A0AF', '#ffffff', 'H'],
    ['scope', 'scope cinemas?', 'Scope Cinemas', 'Entertainment', '#111111', '#ffffff', 'S'],
    ['peotv', 'peo ?tv', 'PEOTV', 'Entertainment', '#0D2C6C', '#ffffff', 'PEO'],
    ['helakuru', 'helakuru', 'Helakuru', 'Other', '#E53935', '#ffffff', 'H'],
    ['ceylinco', 'ceylinco', 'Ceylinco Insurance', 'Other', '#FFD200', '#111111', 'C'],
    ['aia', 'aia\\b', 'AIA Insurance', 'Other', '#D31145', '#ffffff', 'AIA'],
    ['unionassurance', 'union assurance', 'Union Assurance', 'Other', '#F26522', '#ffffff', 'UA'],
    ['allianz', 'allianz', 'Allianz', 'Other', '#003781', '#ffffff', 'A'],
    // Supermarkets and groceries
    ['keells', 'keells|jaykay', 'Keells', 'Food', '#00843D', '#ffffff', 'K'],
    ['cargills', 'cargills(?! ?bank)|food ?city', 'Cargills', 'Food', '#E31837', '#ffffff', 'C'],
    ['glomark', 'glomark', 'Glomark', 'Food', '#E2001A', '#ffffff', 'G'],
    ['spar', 'spar\\b', 'SPAR', 'Food', '#DA1F26', '#ffffff', 'S'],
    ['sathosa', 'sathosa', 'Sathosa', 'Food', '#0A7A3D', '#ffffff', 'S'],
    ['arpico', 'arpico', 'Arpico', 'Shopping', '#00529B', '#ffffff', 'A'],
    ['laugfsgas', 'laugfs gas', 'Laugfs Gas', 'Utilities', '#E30613', '#ffffff', 'L'],
    ['laugfs', 'laugfs', 'Laugfs', 'Food', '#E30613', '#ffffff', 'L'],
    // Food and delivery
    ['ubereats', 'uber ?eats', 'Uber Eats', 'Food', '#06C167', '#000000', 'UE'],
    ['pickmefood', 'pick ?me ?food', 'PickMe Food', 'Food', '#FFC72C', '#111111', 'P'],
    ['kfc', 'kfc\\b', 'KFC', 'Food', '#A3080C', '#ffffff', 'KFC'],
    ['mcdonalds', 'mc ?donald', "McDonald's", 'Food', '#DA291C', '#FFC72C', 'M'],
    ['pizzahut', 'pizza ?hut', 'Pizza Hut', 'Food', '#EE3124', '#ffffff', 'PH'],
    ['dominos', 'domino', "Domino's", 'Food', '#006491', '#ffffff', 'D'],
    ['burgerking', 'burger ?king', 'Burger King', 'Food', '#D62300', '#F5EBDC', 'BK'],
    ['subway', 'subway', 'Subway', 'Food', '#008C15', '#FFC600', 'S'],
    ['tacobell', 'taco ?bell', 'Taco Bell', 'Food', '#702082', '#ffffff', 'TB'],
    ['popeyes', 'popeyes', 'Popeyes', 'Food', '#F26722', '#ffffff', 'P'],
    ['barista', 'barista', 'Barista', 'Food', '#5C3317', '#ffffff', 'B'],
    ['dinemore', 'dinemore', 'Dinemore', 'Food', '#E31E24', '#ffffff', 'D'],
    ['pereraandsons', 'perera (?:&|and) sons|p ?& ?s\\b', 'Perera & Sons', 'Food', '#E4002B', '#ffffff', 'P&S'],
    // Shopping
    ['koko', 'koko\\b', 'Koko', 'Shopping', '#1B3FA0', '#ffffff', 'K'],
    ['mintpay', 'mintpay', 'Mintpay', 'Shopping', '#3DDC97', '#0B1F17', 'M'],
    ['daraz', 'daraz', 'Daraz', 'Shopping', '#F57224', '#ffffff', 'D'],
    ['kapruka', 'kapruka', 'Kapruka', 'Shopping', '#E4002B', '#ffffff', 'K'],
    ['odel', 'odel\\b', 'ODEL', 'Shopping', '#111111', '#ffffff', 'O'],
    ['fashionbug', 'fashion ?bug', 'Fashion Bug', 'Shopping', '#E4007C', '#ffffff', 'FB'],
    ['coolplanet', 'cool ?planet', 'Cool Planet', 'Shopping', '#00A3E0', '#ffffff', 'CP'],
    ['nolimit', 'nolimit', 'Nolimit', 'Shopping', '#E30613', '#ffffff', 'N'],
    ['houseoffashions', 'house of fashions?', 'House of Fashions', 'Shopping', '#111111', '#ffffff', 'HF'],
    ['singer', 'singer\\b', 'Singer', 'Shopping', '#E30613', '#ffffff', 'S'],
    ['abans', 'abans', 'Abans', 'Shopping', '#0057A8', '#ffffff', 'A'],
    ['softlogic', 'softlogic', 'Softlogic', 'Shopping', '#ED1C24', '#ffffff', 'S'],
    ['damro', 'damro', 'Damro', 'Shopping', '#E30613', '#ffffff', 'D'],
    ['aliexpress', 'ali ?express', 'AliExpress', 'Shopping', '#E62E04', '#ffffff', 'A'],
    ['temu', 'temu\\b', 'Temu', 'Shopping', '#FB7701', '#ffffff', 'T'],
    ['shein', 'shein', 'SHEIN', 'Shopping', '#111111', '#ffffff', 'S'],
    ['ebay', 'ebay', 'eBay', 'Shopping', '#ffffff', '#0064D2', 'e'],
    // Entertainment and subscriptions
    ['netflix', 'netflix', 'Netflix', 'Entertainment', '#141414', '#E50914', 'N'],
    ['spotify', 'spotify', 'Spotify', 'Entertainment', '#1DB954', '#000000', 'S'],
    ['youtube', 'youtube', 'YouTube', 'Entertainment', '#FF0000', '#ffffff', '▶'],
    ['primevideo', 'prime ?video|amazon prime', 'Prime Video', 'Entertainment', '#00A8E1', '#ffffff', 'P'],
    ['disney', 'disney', 'Disney+', 'Entertainment', '#113CCF', '#ffffff', 'D+'],
    ['steam', 'steam ?(?:games|powered)?\\b|valve\\b', 'Steam', 'Entertainment', '#171A21', '#ffffff', 'S'],
    ['playstation', 'playstation|sony interactive', 'PlayStation', 'Entertainment', '#003791', '#ffffff', 'PS'],
    ['openai', 'openai|chatgpt', 'ChatGPT', 'Other', '#10A37F', '#ffffff', 'AI'],
    ['claude', 'anthropic|claude\\b', 'Claude', 'Other', '#D97757', '#ffffff', 'C'],
    ['adobe', 'adobe', 'Adobe', 'Other', '#FA0F00', '#ffffff', 'A'],
    ['canva', 'canva', 'Canva', 'Other', '#00C4CC', '#ffffff', 'C'],
    ['microsoft', 'microsoft|msft\\b', 'Microsoft', 'Other', '#ffffff', '#737373', 'M'],
    ['github', 'github', 'GitHub', 'Other', '#181717', '#ffffff', 'GH'],
    ['meta', 'meta ?(?:ads|platforms)|^meta$', 'Meta', 'Other', '#0866FF', '#ffffff', 'M'],
    ['paypal', 'paypal', 'PayPal', 'Other', '#003087', '#ffffff', 'PP'],
    ['apple', 'apple\\.com|itunes|apple(?: (?:music|tv|store|one|pay|services|icloud))?$', 'Apple', 'Entertainment', '#1D1D1F', '#ffffff', ''],
    ['amazon', 'amazon|amzn', 'Amazon', 'Shopping', '#232F3E', '#FF9900', 'a'],
    ['google', 'google', 'Google', 'Entertainment', '#ffffff', '#4285F4', 'G'],
    // Transport and travel
    ['uber', 'uber\\b', 'Uber', 'Travel', '#000000', '#ffffff', 'U'],
    ['pickme', 'pick ?me', 'PickMe', 'Travel', '#FFC72C', '#111111', 'P'],
    ['srilankan', 'srilankan|sri lankan air', 'SriLankan Airlines', 'Travel', '#00529B', '#ffffff', 'UL'],
    ['booking', 'booking\\.com', 'Booking.com', 'Travel', '#003580', '#ffffff', 'B.'],
    ['agoda', 'agoda', 'Agoda', 'Travel', '#ffffff', '#5392F9', 'a'],
    ['airbnb', 'airbnb', 'Airbnb', 'Travel', '#FF5A5F', '#ffffff', 'A'],
    ['lankaioc', 'lanka ?ioc|ioc\\b', 'Lanka IOC', 'Travel', '#F37021', '#ffffff', 'IOC'],
    ['ceypetco', 'ceypetco|ceylon petroleum', 'Ceypetco', 'Travel', '#00539F', '#ffffff', 'C'],
    ['sinopec', 'sinopec', 'Sinopec', 'Travel', '#E60012', '#ffffff', 'S'],
    // Phone, internet and utilities
    ['dialog', 'dialog\\b', 'Dialog', 'Utilities', '#E4002B', '#ffffff', 'D'],
    ['mobitel', 'slt[- ]?mobitel|mobitel', 'SLT-Mobitel', 'Utilities', '#0054A6', '#ffffff', 'M'],
    ['slt', 'slt\\b|sri lanka telecom', 'SLT', 'Utilities', '#0054A6', '#ffffff', 'SLT'],
    ['hutch', 'hutch\\b', 'Hutch', 'Utilities', '#F58220', '#ffffff', 'H'],
    ['airtel', 'airtel', 'Airtel', 'Utilities', '#E40000', '#ffffff', 'A'],
    ['ceb', 'ceb\\b|ceylon electricity', 'CEB', 'Utilities', '#FDB913', '#111111', 'CEB'],
    ['leco', 'leco\\b', 'LECO', 'Utilities', '#00843D', '#ffffff', 'L'],
    ['waterboard', 'nwsdb|water ?board', 'Water Board', 'Utilities', '#0072BC', '#ffffff', 'W'],
    ['litro', 'litro', 'Litro Gas', 'Utilities', '#0054A6', '#ffffff', 'L'],
    // Health
    ['healthguard', 'healthguard', 'Healthguard', 'Health', '#00A651', '#ffffff', 'H'],
    ['asiri', 'asiri\\b', 'Asiri Hospitals', 'Health', '#00A0AF', '#ffffff', 'A'],
    ['nawaloka', 'nawaloka', 'Nawaloka', 'Health', '#0054A6', '#ffffff', 'N'],
    ['durdans', 'durdans', 'Durdans', 'Health', '#00529B', '#ffffff', 'D'],
    ['osusala', 'osu ?sala|state pharm', 'Osu Sala', 'Health', '#00843D', '#ffffff', 'O'],
    // Worldwide brands (logos: each one's official app icon)
    ['hbomax', 'hbo ?max|max\\.com|wbd ?max', 'HBO Max', 'Entertainment', '#002BE7', '#ffffff', 'HBO'],
    ['crunchyroll', 'crunchyroll', 'Crunchyroll', 'Entertainment', '#F47521', '#ffffff', 'CR'],
    ['deezer', 'deezer', 'Deezer', 'Entertainment', '#A238FF', '#ffffff', 'D'],
    ['soundcloud', 'soundcloud', 'SoundCloud', 'Entertainment', '#FF5500', '#ffffff', 'SC'],
    ['twitch', 'twitch', 'Twitch', 'Entertainment', '#9146FF', '#ffffff', 'T'],
    ['audible', 'audible', 'Audible', 'Entertainment', '#F7991C', '#ffffff', 'A'],
    ['xbox', 'xbox', 'Xbox', 'Entertainment', '#107C10', '#ffffff', 'X'],
    ['nintendo', 'nintendo', 'Nintendo', 'Entertainment', '#E60012', '#ffffff', 'N'],
    ['roblox', 'roblox', 'Roblox', 'Entertainment', '#111111', '#ffffff', 'R'],
    ['pubg', 'pubg', 'PUBG Mobile', 'Entertainment', '#F2A900', '#111111', 'PUBG'],
    ['freefire', 'free ?fire|garena', 'Free Fire', 'Entertainment', '#FF6A00', '#ffffff', 'FF'],
    ['facebook', 'facebk|facebook|fb\\.me', 'Facebook', 'Other', '#0866FF', '#ffffff', 'f'],
    ['instagram', 'instagram', 'Instagram', 'Other', '#E1306C', '#ffffff', 'IG'],
    ['tiktok', 'tiktok', 'TikTok', 'Entertainment', '#000000', '#ffffff', 'T'],
    ['twitter', 'twitter|x corp|x\\.com', 'X', 'Other', '#000000', '#ffffff', 'X'],
    ['snapchat', 'snapchat|snap inc', 'Snapchat', 'Other', '#FFFC00', '#111111', 'S'],
    ['discord', 'discord', 'Discord', 'Entertainment', '#5865F2', '#ffffff', 'D'],
    ['telegram', 'telegram', 'Telegram', 'Other', '#26A5E4', '#ffffff', 'T'],
    ['linkedin', 'linkedin', 'LinkedIn', 'Other', '#0A66C2', '#ffffff', 'in'],
    ['pinterest', 'pinterest', 'Pinterest', 'Other', '#E60023', '#ffffff', 'P'],
    ['reddit', 'reddit', 'Reddit', 'Other', '#FF4500', '#ffffff', 'R'],
    ['tinder', 'tinder', 'Tinder', 'Entertainment', '#FE3C72', '#ffffff', 'T'],
    ['gemini', 'gemini|google one ai', 'Gemini', 'Other', '#1A73E8', '#ffffff', 'G'],
    ['perplexity', 'perplexity', 'Perplexity', 'Other', '#20808D', '#ffffff', 'P'],
    ['zoom', 'zoom\\.us|zoom video|zoom com|^zoom$', 'Zoom', 'Other', '#0B5CFF', '#ffffff', 'Z'],
    ['dropbox', 'dropbox', 'Dropbox', 'Other', '#0061FF', '#ffffff', 'D'],
    ['notion', 'notion', 'Notion', 'Other', '#ffffff', '#111111', 'N'],
    ['grammarly', 'grammarly', 'Grammarly', 'Other', '#15C39A', '#ffffff', 'G'],
    ['figma', 'figma', 'Figma', 'Other', '#1E1E1E', '#ffffff', 'F'],
    ['capcut', 'capcut', 'CapCut', 'Other', '#000000', '#ffffff', 'CC'],
    ['duolingo', 'duolingo', 'Duolingo', 'Other', '#58CC02', '#ffffff', 'D'],
    ['coursera', 'coursera', 'Coursera', 'Other', '#0056D2', '#ffffff', 'C'],
    ['udemy', 'udemy', 'Udemy', 'Other', '#A435F0', '#ffffff', 'U'],
    ['shopify', 'shopify', 'Shopify', 'Other', '#95BF47', '#ffffff', 'S'],
    ['fiverr', 'fiverr', 'Fiverr', 'Other', '#1DBF73', '#ffffff', 'fi'],
    ['upwork', 'upwork', 'Upwork', 'Other', '#14A800', '#ffffff', 'Up'],
    ['aws', 'aws|amazon web services', 'AWS', 'Other', '#232F3E', '#FF9900', 'AWS'],
    ['cloudflare', 'cloudflare', 'Cloudflare', 'Other', '#F38020', '#ffffff', 'CF'],
    ['alibaba', 'alibaba', 'Alibaba', 'Shopping', '#FF6A00', '#ffffff', 'A'],
    ['etsy', 'etsy', 'Etsy', 'Shopping', '#F1641E', '#ffffff', 'E'],
    ['ikea', 'ikea', 'IKEA', 'Shopping', '#0058A3', '#FFDB00', 'IKEA'],
    ['hm', 'h ?& ?m\\b|hennes', 'H&M', 'Shopping', '#E50010', '#ffffff', 'H&M'],
    ['nike', 'nike\\b', 'Nike', 'Shopping', '#111111', '#ffffff', 'N'],
    ['adidas', 'adidas', 'adidas', 'Shopping', '#000000', '#ffffff', 'a'],
    ['walmart', 'walmart', 'Walmart', 'Shopping', '#0071CE', '#FFC220', 'W'],
    ['lazada', 'lazada', 'Lazada', 'Shopping', '#0F146D', '#ffffff', 'L'],
    ['flipkart', 'flipkart', 'Flipkart', 'Shopping', '#2874F0', '#FFE500', 'F'],
    ['myntra', 'myntra', 'Myntra', 'Shopping', '#FF3F6C', '#ffffff', 'M'],
    ['starbucks', 'starbucks', 'Starbucks', 'Food', '#00704A', '#ffffff', 'S'],
    ['foodpanda', 'food ?panda', 'foodpanda', 'Food', '#D70F64', '#ffffff', 'fp'],
    ['deliveroo', 'deliveroo', 'Deliveroo', 'Food', '#00CCBC', '#ffffff', 'D'],
    ['talabat', 'talabat', 'talabat', 'Food', '#FF5A00', '#ffffff', 't'],
    ['swiggy', 'swiggy', 'Swiggy', 'Food', '#FC8019', '#ffffff', 'S'],
    ['zomato', 'zomato', 'Zomato', 'Food', '#E23744', '#ffffff', 'Z'],
    ['grab', 'grab\\b|grabtaxi', 'Grab', 'Travel', '#00B14F', '#ffffff', 'G'],
    ['bolt', 'bolt\\b|bolt\\.eu', 'Bolt', 'Travel', '#34D186', '#111111', 'B'],
    ['careem', 'careem', 'Careem', 'Travel', '#4BA647', '#ffffff', 'C'],
    ['expedia', 'expedia', 'Expedia', 'Travel', '#FDDB32', '#191E3B', 'E'],
    ['tripcom', 'trip\\.com|ctrip', 'Trip.com', 'Travel', '#287DFA', '#ffffff', 'T'],
    ['skyscanner', 'skyscanner', 'Skyscanner', 'Travel', '#0062E3', '#ffffff', 'S'],
    ['emirates', 'emirates', 'Emirates', 'Travel', '#D71921', '#ffffff', 'EK'],
    ['qatarairways', 'qatar air', 'Qatar Airways', 'Travel', '#5C0632', '#ffffff', 'QR'],
    ['airasia', 'air ?asia', 'AirAsia', 'Travel', '#FF0000', '#ffffff', 'AA'],
    ['indigo', 'indigo\\b|interglobe', 'IndiGo', 'Travel', '#001B94', '#ffffff', '6E'],
    ['marriott', 'marriott', 'Marriott', 'Travel', '#8B1D41', '#ffffff', 'M'],
    ['hilton', 'hilton', 'Hilton', 'Travel', '#104C97', '#ffffff', 'H'],
    ['wise', 'wise\\b|transferwise', 'Wise', 'Other', '#9FE870', '#163300', 'W'],
    ['revolut', 'revolut', 'Revolut', 'Other', '#191C1F', '#ffffff', 'R'],
    ['payoneer', 'payoneer', 'Payoneer', 'Other', '#FF4800', '#ffffff', 'P'],
    ['binance', 'binance', 'Binance', 'Other', '#F0B90B', '#111111', 'B'],
    // Banks and wallets (badge only)
    ['combank', 'combank|commercial bank', 'Commercial Bank', null, '#0B4EA2', '#ffffff', 'CB'],
    ['sampath', 'sampath', 'Sampath Bank', null, '#F58220', '#ffffff', 'S'],
    ['hnb', 'hnb\\b|hatton national', 'HNB', null, '#FDB913', '#111111', 'HNB'],
    ['boc', 'boc\\b|bank of ceylon', 'BOC', null, '#FFC20E', '#111111', 'BOC'],
    ['peoples', "people'?s bank", "People's Bank", null, '#D71920', '#ffffff', 'PB'],
    ['nsb', 'nsb\\b|national savings bank', 'NSB', null, '#F58220', '#ffffff', 'NSB'],
    ['ntb', 'ntb\\b|nations trust', 'Nations Trust', null, '#00843D', '#ffffff', 'NTB'],
    ['ndb', 'ndb\\b|national development bank', 'NDB', null, '#00529B', '#ffffff', 'NDB'],
    ['seylan', 'seylan', 'Seylan Bank', null, '#C8102E', '#ffffff', 'S'],
    ['dfcc', 'dfcc', 'DFCC', null, '#E4002B', '#ffffff', 'DFCC'],
    ['pabc', 'pabc\\b|pan asia', 'Pan Asia Bank', null, '#0D47A1', '#ffffff', 'PABC'],
    ['unionbank', 'union bank', 'Union Bank', null, '#1565C0', '#ffffff', 'UB'],
    ['amana', 'amana', 'Amana Bank', null, '#00897B', '#ffffff', 'A'],
    ['cargillsbank', 'cargills ?bank', 'Cargills Bank', null, '#D32F2F', '#ffffff', 'CB'],
    ['hsbc', 'hsbc', 'HSBC', null, '#DB0011', '#ffffff', 'HSBC'],
    ['scb', 'standard chartered|stanchart', 'Standard Chartered', null, '#0072AA', '#ffffff', 'SC'],
    ['frimi', 'frimi', 'FriMi', null, '#E91E63', '#ffffff', 'F'],
    ['ezcash', 'ez ?cash', 'eZ Cash', null, '#FF6F00', '#ffffff', 'eZ'],
    ['mcash', 'mcash', 'mCash', null, '#0054A6', '#ffffff', 'm'],
    ['mcb', 'mcb\\b', 'MCB', null, '#006A4E', '#ffffff', 'MCB'],
    ['sdb', 'sdb\\b|sanasa', 'SDB', null, '#00843D', '#ffffff', 'SDB'],
    ['rdb', 'rdb\\b|pradeshiya', 'RDB', null, '#0A7A8C', '#ffffff', 'RDB'],
    ['hdfc', 'hdfc', 'HDFC', null, '#004C8F', '#ffffff', 'HDFC'],
    ['lolc', 'lolc', 'LOLC', null, '#C8102E', '#ffffff', 'LOLC'],
    // More brands (scripts/brands-extra.txt); logos from each brand's own site (scripts/fetch-logos-extra.mjs)
    ['elephanthouse', 'elephant house', 'Elephant House', 'Food', '#5B5B66', '#ffffff', 'EH'],
    ['munchee', 'munchee', 'Munchee', 'Food', '#5B5B66', '#ffffff', 'M'],
    ['maliban', 'maliban', 'Maliban', 'Food', '#080808', '#ffffff', 'M'],
    ['dilmah', 'dilmah', 'Dilmah', 'Food', '#087878', '#ffffff', 'D'],
    ['highland', 'highland (?:milk|yoghurt|yogurt|ice)|milco|^highland$', 'Highland', 'Food', '#5B5B66', '#ffffff', 'H'],
    ['pelwatte', 'pelwatte', 'Pelwatte', 'Food', '#1848A8', '#ffffff', 'P'],
    ['harischandra', 'harischandra', 'Harischandra', 'Food', '#5B5B66', '#ffffff', 'H'],
    ['prima', 'prima (?:ceylon|flour|bread|kottumee|noodles)|^prima$', 'Prima', 'Food', '#080808', '#ffffff', 'P'],
    ['caravanfresh', 'caravan fresh', 'Caravan Fresh', 'Food', '#087818', '#ffffff', 'CF'],
    ['paanpaan', 'paan ?paan', 'Paan Paan', 'Food', '#5B5B66', '#ffffff', 'PP'],
    ['creperunner', 'crepe ?runner', 'Crepe Runner', 'Food', '#080808', '#ffffff', 'CR'],
    ['chinesedragon', 'chinese dragon', 'Chinese Dragon Cafe', 'Food', '#5B5B66', '#ffffff', 'CD'],
    ['ministryofcrab', 'ministry of crab', 'Ministry of Crab', 'Food', '#F8B818', '#111111', 'MO'],
    ['upalis', 'upali\'?s', 'Upali\'s', 'Food', '#5B5B66', '#ffffff', 'US'],
    ['fabbakery', 'the fab\\b|fab bakery', 'The FAB', 'Food', '#5B5B66', '#ffffff', 'TF'],
    ['thilakawardhana', 'thilakawardhana', 'Thilakawardhana', 'Shopping', '#5B5B66', '#ffffff', 'T'],
    ['mondy', 'mondy', 'Mondy', 'Shopping', '#5B5B66', '#ffffff', 'M'],
    ['avirate', 'avirate', 'Avirate', 'Shopping', '#5B5B66', '#ffffff', 'A'],
    ['springsummer', 'spring (?:and|&) summer', 'Spring & Summer', 'Shopping', '#5B5B66', '#ffffff', 'SS'],
    ['glitz', 'glitz', 'Glitz', 'Shopping', '#5B5B66', '#ffffff', 'G'],
    ['dsi', 'dsi\\b|d\\.s\\.i', 'DSI', 'Shopping', '#F8F8F8', '#111111', 'D'],
    ['bata', 'bata\\b', 'Bata', 'Shopping', '#080808', '#ffffff', 'B'],
    ['wishque', 'wishque', 'Wishque', 'Shopping', '#5B5B66', '#ffffff', 'W'],
    ['lankabell', 'lanka ?bell', 'Lanka Bell', 'Utilities', '#5B5B66', '#ffffff', 'LB'],
    ['payhere', 'payhere', 'PayHere', 'Other', '#1848D8', '#ffffff', 'P'],
    ['upay', 'upay\\b', 'Upay', 'Other', '#080808', '#ffffff', 'U'],
    ['kangaroocabs', 'kangaroo cabs?', 'Kangaroo Cabs', 'Travel', '#080808', '#ffffff', 'KC'],
    ['fitsair', 'fits ?air', 'FitsAir', 'Travel', '#F80808', '#ffffff', 'F'],
    ['jetwing', 'jetwing', 'Jetwing', 'Travel', '#5B5B66', '#ffffff', 'J'],
    ['gallefacehotel', 'galle face hotel', 'Galle Face Hotel', 'Travel', '#F8F8F8', '#111111', 'GF'],
    ['heritance', 'heritance', 'Heritance Hotels', 'Travel', '#5B5B66', '#ffffff', 'HH'],
    ['ninewells', 'ninewells', 'Ninewells Hospital', 'Health', '#5B5B66', '#ffffff', 'NH'],
    ['kingshospital', 'kings hospital', 'Kings Hospital', 'Health', '#F8F8F8', '#111111', 'KH'],
    ['slinsurance', 'sri lanka insurance|slic\\b', 'Sri Lanka Insurance', 'Other', '#5B5B66', '#ffffff', 'SL'],
    ['hnbassurance', 'hnb assurance', 'HNB Assurance', 'Other', '#F8F8F8', '#111111', 'HA'],
    ['janashakthi', 'janashakthi', 'Janashakthi', 'Other', '#5B5B66', '#ffffff', 'J'],
    ['fairfirst', 'fairfirst', 'Fairfirst Insurance', 'Other', '#5B5B66', '#ffffff', 'FI'],
    ['icbt', 'icbt', 'ICBT Campus', 'Other', '#F8F8F8', '#111111', 'IC'],
    ['nsbm', 'nsbm', 'NSBM', 'Other', '#F8F8F8', '#111111', 'N'],
    ['sliit', 'sliit', 'SLIIT', 'Other', '#080808', '#ffffff', 'S'],
    ['iit', 'iit campus|informatics institute|^iit$', 'IIT', 'Other', '#5B5B66', '#ffffff', 'I'],
    ['apiit', 'apiit', 'APIIT', 'Other', '#5B5B66', '#ffffff', 'A'],
    ['esoft', 'esoft', 'ESOFT', 'Other', '#5B5B66', '#ffffff', 'E'],
    ['britishcouncil', 'british council', 'British Council', 'Other', '#F8F8F8', '#111111', 'BC'],
    ['cima', 'cima\\b', 'CIMA', 'Other', '#080808', '#ffffff', 'C'],
    ['acca', 'acca\\b', 'ACCA', 'Other', '#C80808', '#ffffff', 'A'],
    ['ielts', 'ielts', 'IELTS', 'Other', '#080808', '#ffffff', 'I'],
    ['lbfinance', 'lb finance', 'LB Finance', null, '#080808', '#ffffff', 'LF'],
    ['centralfinance', 'central finance', 'Central Finance', null, '#F89828', '#111111', 'CF'],
    ['peoplesleasing', 'people\'?s leasing', 'People\'s Leasing', null, '#080808', '#ffffff', 'PS'],
    ['cdb', 'cdb\\b|citizens development', 'CDB', null, '#F8F8F8', '#111111', 'C'],
    ['singerfinance', 'singer finance', 'Singer Finance', null, '#E81828', '#ffffff', 'SF'],
    ['icici', 'icici', 'ICICI Bank', null, '#080808', '#ffffff', 'IB'],
    ['sbi', 'state bank of india|sbi\\b', 'State Bank of India', null, '#5B5B66', '#ffffff', 'SB'],
    ['citibank', 'citi ?bank|citi\\b', 'Citibank', null, '#080808', '#ffffff', 'C'],
    ['cocacola', 'coca[- ]?cola|coke\\b', 'Coca-Cola', 'Food', '#5B5B66', '#ffffff', 'CC'],
    ['pepsi', 'pepsi', 'Pepsi', 'Food', '#080808', '#ffffff', 'P'],
    ['redbull', 'red ?bull', 'Red Bull', 'Food', '#F8F8F8', '#111111', 'RB'],
    ['nestle', 'nestl[eé]', 'Nestlé', 'Food', '#F8F8F8', '#111111', 'N'],
    ['cadbury', 'cadbury', 'Cadbury', 'Food', '#480888', '#ffffff', 'C'],
    ['anchor', 'anchor (?:milk|newdale|butter|full cream)|^anchor$', 'Anchor', 'Food', '#5B5B66', '#ffffff', 'A'],
    ['texaschicken', 'texas chicken', 'Texas Chicken', 'Food', '#080808', '#ffffff', 'TC'],
    ['hardees', 'hardee\'?s', 'Hardee\'s', 'Food', '#080808', '#ffffff', 'HS'],
    ['carlsjr', 'carl\'?s jr', 'Carl\'s Jr.', 'Food', '#080808', '#ffffff', 'CS'],
    ['nandos', 'nando\'?s', 'Nando\'s', 'Food', '#E8E8E8', '#111111', 'NS'],
    ['baskinrobbins', 'baskin ?robbins', 'Baskin Robbins', 'Food', '#080808', '#ffffff', 'BR'],
    ['dunkin', 'dunkin', 'Dunkin\'', 'Food', '#F8F8F8', '#111111', 'D'],
    ['gloriajeans', 'gloria jean\'?s', 'Gloria Jean\'s', 'Food', '#5B5B66', '#ffffff', 'GJ'],
    ['timhortons', 'tim hortons', 'Tim Hortons', 'Food', '#5B5B66', '#ffffff', 'TH'],
    ['costa', 'costa coffee|costa\\b', 'Costa Coffee', 'Food', '#681838', '#ffffff', 'CC'],
    ['krispykreme', 'krispy ?kreme', 'Krispy Kreme', 'Food', '#5B5B66', '#ffffff', 'KK'],
    ['wendys', 'wendy\'?s', 'Wendy\'s', 'Food', '#F8F8F8', '#111111', 'WS'],
    ['fiveguys', 'five guys', 'Five Guys', 'Food', '#D80838', '#ffffff', 'FG'],
    ['shakeshack', 'shake ?shack', 'Shake Shack', 'Food', '#080808', '#ffffff', 'SS'],
    ['chipotle', 'chipotle', 'Chipotle', 'Food', '#A82818', '#ffffff', 'C'],
    ['pandaexpress', 'panda express', 'Panda Express', 'Food', '#080808', '#ffffff', 'PE'],
    ['papajohns', 'papa john\'?s', 'Papa John\'s', 'Food', '#D82818', '#ffffff', 'PJ'],
    ['littlecaesars', 'little caesars', 'Little Caesars', 'Food', '#F86808', '#ffffff', 'LC'],
    ['dairyqueen', 'dairy queen', 'Dairy Queen', 'Food', '#F8F8F8', '#111111', 'DQ'],
    ['chickfila', 'chick-?fil-?a', 'Chick-fil-A', 'Food', '#D80828', '#ffffff', 'CF'],
    ['jollibee', 'jollibee', 'Jollibee', 'Food', '#F8F8F8', '#111111', 'J'],
    ['pret', 'pret a manger|pret\\b', 'Pret A Manger', 'Food', '#080808', '#ffffff', 'PA'],
    ['parisbaguette', 'paris baguette', 'Paris Baguette', 'Food', '#081848', '#ffffff', 'PB'],
    ['doordash', 'doordash', 'DoorDash', 'Food', '#F8F8F8', '#111111', 'D'],
    ['samsung', 'samsung', 'Samsung', 'Shopping', '#5B5B66', '#ffffff', 'S'],
    ['xiaomi', 'xiaomi|redmi\\b|\\bmi store', 'Xiaomi', 'Shopping', '#F8F8F8', '#111111', 'X'],
    ['huawei', 'huawei', 'Huawei', 'Shopping', '#080808', '#ffffff', 'H'],
    ['oppo', 'oppo\\b', 'OPPO', 'Shopping', '#5B5B66', '#ffffff', 'O'],
    ['vivo', 'vivo\\b', 'vivo', 'Shopping', '#5B5B66', '#ffffff', 'V'],
    ['realme', 'realme', 'realme', 'Shopping', '#F8C818', '#111111', 'R'],
    ['oneplus', 'one ?plus', 'OnePlus', 'Shopping', '#5B5B66', '#ffffff', 'O'],
    ['nokia', 'nokia', 'Nokia', 'Shopping', '#0858F8', '#ffffff', 'N'],
    ['sony', 'sony', 'Sony', 'Shopping', '#5B5B66', '#ffffff', 'S'],
    ['lg', 'lg\\b|lg electronics', 'LG', 'Shopping', '#A80838', '#ffffff', 'L'],
    ['lenovo', 'lenovo', 'Lenovo', 'Shopping', '#5B5B66', '#ffffff', 'L'],
    ['hp', 'hp\\b|hewlett', 'HP', 'Shopping', '#0848D8', '#ffffff', 'H'],
    ['dell', 'dell\\b', 'Dell', 'Shopping', '#0878C8', '#ffffff', 'D'],
    ['asus', 'asus\\b', 'ASUS', 'Shopping', '#080808', '#ffffff', 'A'],
    ['acer', 'acer\\b', 'Acer', 'Shopping', '#080808', '#ffffff', 'A'],
    ['canon', 'canon\\b', 'Canon', 'Shopping', '#F8F8F8', '#111111', 'C'],
    ['jbl', 'jbl\\b', 'JBL', 'Shopping', '#F84818', '#ffffff', 'J'],
    ['philips', 'philips', 'Philips', 'Shopping', '#F8F8F8', '#111111', 'P'],
    ['panasonic', 'panasonic', 'Panasonic', 'Shopping', '#5B5B66', '#ffffff', 'P'],
    ['haier', 'haier', 'Haier', 'Shopping', '#5B5B66', '#ffffff', 'H'],
    ['casio', 'casio', 'Casio', 'Shopping', '#083888', '#ffffff', 'C'],
    ['razer', 'razer\\b', 'Razer', 'Shopping', '#080808', '#ffffff', 'R'],
    ['anker', 'anker\\b', 'Anker', 'Shopping', '#080808', '#ffffff', 'A'],
    ['zara', 'zara\\b', 'Zara', 'Shopping', '#F8F8F8', '#111111', 'Z'],
    ['uniqlo', 'uniqlo', 'Uniqlo', 'Shopping', '#F80808', '#ffffff', 'U'],
    ['puma', 'puma\\b', 'Puma', 'Shopping', '#F8F8F8', '#111111', 'P'],
    ['reebok', 'reebok', 'Reebok', 'Shopping', '#5B5B66', '#ffffff', 'R'],
    ['underarmour', 'under armour', 'Under Armour', 'Shopping', '#5B5B66', '#ffffff', 'UA'],
    ['newbalance', 'new balance', 'New Balance', 'Shopping', '#F8F8F8', '#111111', 'NB'],
    ['converse', 'converse\\b', 'Converse', 'Shopping', '#5B5B66', '#ffffff', 'C'],
    ['levis', 'levi\'?s', 'Levi\'s', 'Shopping', '#080808', '#ffffff', 'LS'],
    ['gap', 'gap (?:store|kids|inc)|gap\\.com|^gap$', 'Gap', 'Shopping', '#5B5B66', '#ffffff', 'G'],
    ['marksspencer', 'marks (?:and|&) spencer|m&s\\b', 'Marks & Spencer', 'Shopping', '#5B5B66', '#ffffff', 'MS'],
    ['lacoste', 'lacoste', 'Lacoste', 'Shopping', '#080808', '#ffffff', 'L'],
    ['tommy', 'tommy hilfiger', 'Tommy Hilfiger', 'Shopping', '#F8F8F8', '#111111', 'TH'],
    ['calvinklein', 'calvin klein', 'Calvin Klein', 'Shopping', '#F8F8F8', '#111111', 'CK'],
    ['gucci', 'gucci', 'Gucci', 'Shopping', '#F8F8F8', '#111111', 'G'],
    ['louisvuitton', 'louis vuitton', 'Louis Vuitton', 'Shopping', '#F8F8F8', '#111111', 'LV'],
    ['chanel', 'chanel', 'Chanel', 'Shopping', '#080808', '#ffffff', 'C'],
    ['fossil', 'fossil\\b', 'Fossil', 'Shopping', '#080808', '#ffffff', 'F'],
    ['sephora', 'sephora', 'Sephora', 'Shopping', '#080808', '#ffffff', 'S'],
    ['bodyshop', '(?:the )?body shop', 'The Body Shop', 'Shopping', '#5B5B66', '#ffffff', 'TB'],
    ['bathbodyworks', 'bath (?:and|&) body works', 'Bath & Body Works', 'Shopping', '#5B5B66', '#ffffff', 'BB'],
    ['victoriassecret', 'victoria\'?s secret', 'Victoria\'s Secret', 'Shopping', '#F8C8C8', '#111111', 'VS'],
    ['lego', 'lego\\b', 'LEGO', 'Shopping', '#F80808', '#ffffff', 'L'],
    ['bestbuy', 'best ?buy', 'Best Buy', 'Shopping', '#183878', '#ffffff', 'BB'],
    ['costco', 'costco', 'Costco', 'Shopping', '#F8F8F8', '#111111', 'C'],
    ['carrefour', 'carrefour', 'Carrefour', 'Shopping', '#F8F8F8', '#111111', 'C'],
    ['lulu', 'lulu hypermarket|lulu\\b', 'LuLu Hypermarket', 'Shopping', '#5B5B66', '#ffffff', 'LH'],
    ['noon', 'noon\\.com|noon (?:shopping|food)|^noon$', 'noon', 'Shopping', '#F8E808', '#111111', 'N'],
    ['nykaa', 'nykaa', 'Nykaa', 'Shopping', '#F898C8', '#111111', 'N'],
    ['tesco', 'tesco', 'Tesco', 'Shopping', '#F8F8F8', '#111111', 'T'],
    ['lidl', 'lidl', 'Lidl', 'Shopping', '#F8F808', '#111111', 'L'],
    ['decathlon', 'decathlon', 'Decathlon', 'Shopping', '#5B5B66', '#ffffff', 'D'],
    ['miniso', 'miniso', 'Miniso', 'Shopping', '#D82838', '#ffffff', 'M'],
    ['muji', 'muji\\b', 'MUJI', 'Shopping', '#780818', '#ffffff', 'M'],
    ['shopee', 'shopee', 'Shopee', 'Shopping', '#F8F8F8', '#111111', 'S'],
    ['asos', 'asos\\b', 'ASOS', 'Shopping', '#080808', '#ffffff', 'A'],
    ['toyota', 'toyota', 'Toyota', 'Travel', '#D81818', '#ffffff', 'T'],
    ['honda', 'honda', 'Honda', 'Travel', '#F8F8F8', '#111111', 'H'],
    ['nissan', 'nissan', 'Nissan', 'Travel', '#F8F8F8', '#111111', 'N'],
    ['suzuki', 'suzuki', 'Suzuki', 'Travel', '#5B5B66', '#ffffff', 'S'],
    ['hyundai', 'hyundai', 'Hyundai', 'Travel', '#082858', '#ffffff', 'H'],
    ['kia', 'kia\\b|kia motors', 'Kia', 'Travel', '#F8F8F8', '#111111', 'K'],
    ['bmw', 'bmw\\b', 'BMW', 'Travel', '#686868', '#ffffff', 'B'],
    ['mercedes', 'mercedes|benz\\b', 'Mercedes-Benz', 'Travel', '#080808', '#ffffff', 'MB'],
    ['audi', 'audi\\b', 'Audi', 'Travel', '#080808', '#ffffff', 'A'],
    ['tesla', 'tesla', 'Tesla', 'Travel', '#080808', '#ffffff', 'T'],
    ['tatamotors', 'tata motors|tata\\b', 'Tata Motors', 'Travel', '#5B5B66', '#ffffff', 'TM'],
    ['bajaj', 'bajaj', 'Bajaj', 'Travel', '#5B5B66', '#ffffff', 'B'],
    ['tvs', 'tvs motor|tvs (?:apache|ntorq|jupiter)|^tvs$', 'TVS', 'Travel', '#080808', '#ffffff', 'T'],
    ['yamaha', 'yamaha', 'Yamaha', 'Travel', '#080808', '#ffffff', 'Y'],
    ['ford', 'ford\\b', 'Ford', 'Travel', '#080858', '#ffffff', 'F'],
    ['volkswagen', 'volkswagen|vw\\b', 'Volkswagen', 'Travel', '#F8F8F8', '#111111', 'V'],
    ['mazda', 'mazda', 'Mazda', 'Travel', '#080808', '#ffffff', 'M'],
    ['byd', 'byd\\b', 'BYD', 'Travel', '#5B5B66', '#ffffff', 'B'],
    ['shell', 'shell (?:fuel|petrol|station|lubricants|gas|select)|^shell$', 'Shell', 'Travel', '#F8C808', '#111111', 'S'],
    ['lyft', 'lyft', 'Lyft', 'Travel', '#080808', '#ffffff', 'L'],
    ['ola', 'ola cabs|ola\\b', 'Ola', 'Travel', '#080808', '#ffffff', 'O'],
    ['indrive', 'in ?drive\\b', 'inDrive', 'Travel', '#C8F818', '#111111', 'I'],
    ['etihad', 'etihad', 'Etihad Airways', 'Travel', '#080808', '#ffffff', 'EA'],
    ['flydubai', 'fly ?dubai', 'flydubai', 'Travel', '#1898D8', '#ffffff', 'F'],
    ['singaporeair', 'singapore airlines', 'Singapore Airlines', 'Travel', '#081848', '#ffffff', 'SA'],
    ['cathay', 'cathay pacific', 'Cathay Pacific', 'Travel', '#F8F8F8', '#111111', 'CP'],
    ['turkish', 'turkish airlines', 'Turkish Airlines', 'Travel', '#C80808', '#ffffff', 'TA'],
    ['airindia', 'air india', 'Air India', 'Travel', '#C80828', '#ffffff', 'AI'],
    ['saudia', 'saudia\\b', 'Saudia', 'Travel', '#5B5B66', '#ffffff', 'S'],
    ['omanair', 'oman air', 'Oman Air', 'Travel', '#080808', '#ffffff', 'OA'],
    ['gulfair', 'gulf air', 'Gulf Air', 'Travel', '#080808', '#ffffff', 'GA'],
    ['malaysiaairlines', 'malaysia airlines', 'Malaysia Airlines', 'Travel', '#F8F8F8', '#111111', 'MA'],
    ['thai', 'thai airways', 'Thai Airways', 'Travel', '#5B5B66', '#ffffff', 'TA'],
    ['britishairways', 'british airways', 'British Airways', 'Travel', '#F8F8F8', '#111111', 'BA'],
    ['lufthansa', 'lufthansa', 'Lufthansa', 'Travel', '#F8A808', '#111111', 'L'],
    ['airarabia', 'air arabia', 'Air Arabia', 'Travel', '#5B5B66', '#ffffff', 'AA'],
    ['jazeera', 'jazeera airways', 'Jazeera Airways', 'Travel', '#5B5B66', '#ffffff', 'JA'],
    ['hyatt', 'hyatt', 'Hyatt', 'Travel', '#5B5B66', '#ffffff', 'H'],
    ['accor', 'accor\\b|novotel|ibis\\b|sofitel', 'Accor', 'Travel', '#080808', '#ffffff', 'A'],
    ['ihg', 'ihg\\b|holiday inn|crowne plaza|intercontinental', 'IHG Hotels', 'Travel', '#184858', '#ffffff', 'IH'],
    ['taj', 'taj (?:samudra|hotels?|bentota)|tajhotels', 'Taj Hotels', 'Travel', '#A88838', '#ffffff', 'TH'],
    ['trivago', 'trivago', 'trivago', 'Travel', '#F8F8F8', '#111111', 'T'],
    ['hotelscom', 'hotels\\.com', 'Hotels.com', 'Travel', '#E81808', '#ffffff', 'HC'],
    ['klook', 'klook', 'Klook', 'Travel', '#F8F8F8', '#111111', 'K'],
    ['tripadvisor', 'trip ?advisor', 'Tripadvisor', 'Travel', '#08E858', '#ffffff', 'T'],
    ['dhl', 'dhl\\b', 'DHL', 'Other', '#F8C808', '#111111', 'D'],
    ['fedex', 'fedex', 'FedEx', 'Other', '#481888', '#ffffff', 'F'],
    ['ups', 'ups\\b(?! ?and)|ups store', 'UPS', 'Other', '#F8F8F8', '#111111', 'U'],
    ['aramex', 'aramex', 'Aramex', 'Other', '#5B5B66', '#ffffff', 'A'],
    ['visa', 'visa (?:card|inc)|visa\\.com', 'Visa', null, '#5B5B66', '#ffffff', 'V'],
    ['mastercard', 'master ?card', 'Mastercard', null, '#F8F8F8', '#111111', 'M'],
    ['amex', 'american express|amex\\b', 'American Express', null, '#0868C8', '#ffffff', 'AE'],
    ['skrill', 'skrill', 'Skrill', null, '#980888', '#ffffff', 'S'],
    ['westernunion', 'western union', 'Western Union', null, '#080808', '#ffffff', 'WU'],
    ['moneygram', 'money ?gram', 'MoneyGram', null, '#F8F8F8', '#111111', 'M'],
    ['remitly', 'remitly', 'Remitly', null, '#284858', '#ffffff', 'R'],
    ['stripe', 'stripe\\b', 'Stripe', 'Other', '#5838F8', '#ffffff', 'S'],
    ['coinbase', 'coinbase', 'Coinbase', 'Other', '#2878B8', '#ffffff', 'C'],
    ['bybit', 'bybit', 'Bybit', 'Other', '#080808', '#ffffff', 'B'],
    ['okx', 'okx\\b', 'OKX', 'Other', '#080808', '#ffffff', 'O'],
    ['cryptocom', 'crypto\\.com', 'Crypto.com', 'Other', '#080808', '#ffffff', 'CC'],
    ['hulu', 'hulu', 'Hulu', 'Entertainment', '#5B5B66', '#ffffff', 'H'],
    ['paramount', 'paramount\\+?|paramount plus', 'Paramount+', 'Entertainment', '#0868F8', '#ffffff', 'P'],
    ['tidal', 'tidal\\b', 'TIDAL', 'Entertainment', '#080808', '#ffffff', 'T'],
    ['scribd', 'scribd', 'Scribd', 'Entertainment', '#F8F858', '#111111', 'S'],
    ['viu', 'viu\\b', 'Viu', 'Entertainment', '#F8B808', '#111111', 'V'],
    ['zee5', 'zee ?5', 'ZEE5', 'Entertainment', '#181828', '#ffffff', 'Z'],
    ['hotstar', 'hotstar', 'Hotstar', 'Entertainment', '#0898F8', '#ffffff', 'H'],
    ['sonyliv', 'sony ?liv', 'SonyLIV', 'Entertainment', '#080808', '#ffffff', 'S'],
    ['anghami', 'anghami', 'Anghami', 'Entertainment', '#080808', '#ffffff', 'A'],
    ['patreon', 'patreon', 'Patreon', 'Entertainment', '#080808', '#ffffff', 'P'],
    ['epicgames', 'epic games|fortnite', 'Epic Games', 'Entertainment', '#383838', '#ffffff', 'EG'],
    ['ea', 'electronic arts|ea (?:app|play|sports)|ea\\.com|^ea$', 'EA', 'Entertainment', '#5B5B66', '#ffffff', 'E'],
    ['riot', 'riot games|valorant|league of legends', 'Riot Games', 'Entertainment', '#080808', '#ffffff', 'RG'],
    ['minecraft', 'minecraft', 'Minecraft', 'Entertainment', '#58A838', '#ffffff', 'M'],
    ['mobilelegends', 'mobile legends|mlbb', 'Mobile Legends', 'Entertainment', '#080808', '#ffffff', 'ML'],
    ['supercell', 'supercell|clash of clans|clash royale|brawl stars', 'Supercell', 'Entertainment', '#581878', '#ffffff', 'S'],
    ['callofduty', 'call of duty|cod mobile', 'Call of Duty', 'Entertainment', '#5B5B66', '#ffffff', 'CO'],
    ['hoyoverse', 'hoyoverse|genshin|honkai', 'HoYoverse', 'Entertainment', '#080808', '#ffffff', 'H'],
    ['king', 'candy crush|king\\.com', 'Candy Crush', 'Entertainment', '#080808', '#ffffff', 'CC'],
    ['ubisoft', 'ubisoft', 'Ubisoft', 'Entertainment', '#5B5B66', '#ffffff', 'U'],
    ['blizzard', 'blizzard|battle\\.net', 'Blizzard', 'Entertainment', '#181818', '#ffffff', 'B'],
    ['codashop', 'coda ?shop', 'Codashop', 'Entertainment', '#6848F8', '#ffffff', 'C'],
    ['bookmyshow', 'book ?my ?show', 'BookMyShow', 'Entertainment', '#F8F8F8', '#111111', 'B'],
    ['ticketmaster', 'ticketmaster', 'Ticketmaster', 'Entertainment', '#5B5B66', '#ffffff', 'T'],
    ['vox', 'vox cinemas?', 'VOX Cinemas', 'Entertainment', '#080808', '#ffffff', 'VC'],
    ['whatsapp', 'whatsapp', 'WhatsApp', 'Other', '#080808', '#ffffff', 'W'],
    ['viber', 'viber', 'Viber', 'Other', '#080808', '#ffffff', 'V'],
    ['imo', 'imo\\b', 'imo', 'Other', '#F8F8F8', '#111111', 'I'],
    ['skype', 'skype', 'Skype', 'Other', '#5B5B66', '#ffffff', 'S'],
    ['truecaller', 'truecaller', 'Truecaller', 'Other', '#0828F8', '#ffffff', 'T'],
    ['slack', 'slack\\b', 'Slack', 'Other', '#080808', '#ffffff', 'S'],
    ['trello', 'trello', 'Trello', 'Other', '#1858B8', '#ffffff', 'T'],
    ['atlassian', 'atlassian|jira\\b|confluence\\b', 'Atlassian', 'Other', '#080808', '#ffffff', 'A'],
    ['gitlab', 'gitlab', 'GitLab', 'Other', '#E84828', '#ffffff', 'G'],
    ['vercel', 'vercel', 'Vercel', 'Other', '#080808', '#ffffff', 'V'],
    ['netlify', 'netlify', 'Netlify', 'Other', '#F8F8F8', '#111111', 'N'],
    ['heroku', 'heroku', 'Heroku', 'Other', '#9878B8', '#ffffff', 'H'],
    ['digitalocean', 'digital ?ocean', 'DigitalOcean', 'Other', '#080808', '#ffffff', 'D'],
    ['hostinger', 'hostinger', 'Hostinger', 'Other', '#6848C8', '#ffffff', 'H'],
    ['godaddy', 'go ?daddy', 'GoDaddy', 'Other', '#181818', '#ffffff', 'G'],
    ['namecheap', 'namecheap', 'Namecheap', 'Other', '#E85808', '#ffffff', 'N'],
    ['wix', 'wix\\b|wix\\.com', 'Wix', 'Other', '#F8F8F8', '#111111', 'W'],
    ['squarespace', 'squarespace', 'Squarespace', 'Other', '#080808', '#ffffff', 'S'],
    ['wordpress', 'wordpress', 'WordPress.com', 'Other', '#3858E8', '#ffffff', 'WC'],
    ['mailchimp', 'mailchimp', 'Mailchimp', 'Other', '#F8D818', '#111111', 'M'],
    ['zoho', 'zoho', 'Zoho', 'Other', '#F8F8F8', '#111111', 'Z'],
    ['evernote', 'evernote', 'Evernote', 'Other', '#F8F8F8', '#111111', 'E'],
    ['onepassword', '1 ?password', '1Password', 'Other', '#283838', '#ffffff', '1'],
    ['bitwarden', 'bitwarden', 'Bitwarden', 'Other', '#F8F8F8', '#111111', 'B'],
    ['nordvpn', 'nord ?vpn|nord ?security', 'NordVPN', 'Other', '#080808', '#ffffff', 'N'],
    ['expressvpn', 'express ?vpn', 'ExpressVPN', 'Other', '#D83838', '#ffffff', 'E'],
    ['surfshark', 'surfshark', 'Surfshark', 'Other', '#18B8B8', '#ffffff', 'S'],
    ['proton', 'proton (?:mail|vpn|ag|pass|drive)|proton\\.me|^proton$', 'Proton', 'Other', '#F8F8F8', '#111111', 'P'],
    ['kaspersky', 'kaspersky', 'Kaspersky', 'Other', '#5B5B66', '#ffffff', 'K'],
    ['norton', 'norton\\b', 'Norton', 'Other', '#F8F8F8', '#111111', 'N'],
    ['mcafee', 'mcafee', 'McAfee', 'Other', '#F8F8F8', '#111111', 'M'],
    ['avast', 'avast', 'Avast', 'Other', '#F87808', '#ffffff', 'A'],
    ['midjourney', 'midjourney', 'Midjourney', 'Other', '#F8F8F8', '#111111', 'M'],
    ['deepseek', 'deepseek', 'DeepSeek', 'Other', '#4868F8', '#ffffff', 'D'],
    ['cursor', 'cursor (?:ai|pro)|cursor\\.com|anysphere|^cursor$', 'Cursor', 'Other', '#F8F8F8', '#111111', 'C'],
    ['replit', 'replit', 'Replit', 'Other', '#080808', '#ffffff', 'R'],
    ['jetbrains', 'jetbrains', 'JetBrains', 'Other', '#080808', '#ffffff', 'J'],
    ['autodesk', 'autodesk|autocad', 'Autodesk', 'Other', '#080808', '#ffffff', 'A'],
    ['unityengine', 'unity (?:technologies|pro|engine|asset)|^unity$', 'Unity', 'Other', '#5B5B66', '#ffffff', 'U'],
    ['envato', 'envato', 'Envato', 'Other', '#88E848', '#111111', 'E'],
    ['freepik', 'freepik', 'Freepik', 'Other', '#080808', '#ffffff', 'F'],
    ['shutterstock', 'shutterstock', 'Shutterstock', 'Other', '#F86838', '#ffffff', 'S'],
    ['picsart', 'picsart', 'Picsart', 'Other', '#080808', '#ffffff', 'P'],
    ['edx', 'edx\\b', 'edX', 'Other', '#080808', '#ffffff', 'E'],
    ['skillshare', 'skillshare', 'Skillshare', 'Other', '#082838', '#ffffff', 'S'],
    ['quizlet', 'quizlet', 'Quizlet', 'Other', '#4858F8', '#ffffff', 'Q'],
    ['chegg', 'chegg', 'Chegg', 'Other', '#E86808', '#ffffff', 'C'],
    ['strava', 'strava', 'Strava', 'Health', '#F84808', '#ffffff', 'S'],
    ['headspace', 'headspace', 'Headspace', 'Health', '#F87808', '#ffffff', 'H'],
    ['calmapp', 'calm (?:app|premium|\\.com)|^calm$', 'Calm', 'Health', '#38A8E8', '#ffffff', 'C'],
    ['vodafone', 'vodafone', 'Vodafone', 'Utilities', '#5B5B66', '#ffffff', 'V'],
    ['jio', 'jio\\b', 'Jio', 'Utilities', '#E80818', '#ffffff', 'J'],
    ['etisalat', 'etisalat|e&', 'etisalat', 'Utilities', '#080808', '#ffffff', 'E'],
    ['stc', 'stc\\b', 'stc', 'Utilities', '#F8F8F8', '#111111', 'S'],
    ['ooredoo', 'ooredoo', 'Ooredoo', 'Utilities', '#080808', '#ffffff', 'O'],
    ['verizon', 'verizon', 'Verizon', 'Utilities', '#F8E8E8', '#111111', 'V'],
    ['att', 'at&t', 'AT&T', 'Utilities', '#08C8F8', '#ffffff', 'AT'],
    ['tmobile', 't-?mobile', 'T-Mobile', 'Utilities', '#5B5B66', '#ffffff', 'TM'],
    ['starlink', 'starlink', 'Starlink', 'Utilities', '#080808', '#ffffff', 'S'],
    // 4.57: more brands paid often in Sri Lanka
    ['siyapatha', 'siyapatha', 'Siyapatha Finance', null, '#F87818', '#ffffff', 'SF'],
    ['vallibelfinance', 'vallibel finance', 'Vallibel Finance', null, '#F8F8F8', '#ffffff', 'VF'],
    ['hnbfinance', 'hnb finance', 'HNB Finance', null, '#080808', '#ffffff', 'HF'],
    ['senkadagala', 'senkadagala|senfin', 'Senkadagala Finance', null, '#F8F8F8', '#ffffff', 'SF'],
    ['alliancefinance', 'alliance finance', 'Alliance Finance', null, '#080808', '#ffffff', 'AF'],
    ['mercantileinv', 'mercantile investments', 'Mercantile Investments', null, '#083878', '#ffffff', 'MI'],
    ['commercialcredit', 'commercial credit', 'Commercial Credit', null, '#080808', '#ffffff', 'CC'],
    ['mbsl', 'mbsl\\b|merchant bank of sri lanka', 'MBSL', null, '#5B5B6B', '#ffffff', 'M'],
    ['softlogicfinance', 'softlogic finance', 'Softlogic Finance', null, '#080808', '#ffffff', 'SF'],
    ['ipay', 'ipay\\b', 'iPay', null, '#5B5B6B', '#ffffff', 'I'],
    ['peoplesinsurance', 'people\'?s insurance', 'People\'s Insurance', 'Other', '#080808', '#ffffff', 'PS'],
    ['lolclife', 'lolc life', 'LOLC Life', 'Other', '#5B5B6B', '#ffffff', 'LL'],
    ['arpicoinsurance', 'arpico insurance', 'Arpico Insurance', 'Other', '#F8F8F8', '#ffffff', 'AI'],
    ['continentalins', 'continental insurance', 'Continental Insurance', 'Other', '#5B5B6B', '#ffffff', 'CI'],
    ['amanatakaful', 'amana takaful', 'Amana Takaful', 'Other', '#F8F8F8', '#ffffff', 'AT'],
    ['medihelp', 'medihelp', 'Medihelp Hospitals', 'Health', '#080808', '#ffffff', 'MH'],
    ['oasishospital', 'oasis hospital', 'Oasis Hospital', 'Health', '#5B5B6B', '#ffffff', 'OH'],
    ['cottoncollection', 'cotton collection', 'Cotton Collection', 'Shopping', '#5B5B6B', '#ffffff', 'CC'],
    ['kellyfelder', 'kelly felder', 'Kelly Felder', 'Shopping', '#080808', '#ffffff', 'KF'],
    ['beverlystreet', 'beverly street', 'Beverly Street', 'Shopping', '#5B5B6B', '#ffffff', 'BS'],
    ['moose', 'moose clothing', 'Moose', 'Shopping', '#5B5B6B', '#ffffff', 'M'],
    ['barefoot', 'barefoot ceylon|barefoot gallery', 'Barefoot', 'Shopping', '#5B5B6B', '#ffffff', 'B'],
    ['vijithayapa', 'vijitha yapa', 'Vijitha Yapa', 'Shopping', '#282828', '#ffffff', 'VY'],
    ['sarasavi', 'sarasavi', 'Sarasavi Bookshop', 'Shopping', '#5B5B6B', '#ffffff', 'SB'],
    ['wowlk', 'wow\\.lk', 'WOW.lk', 'Shopping', '#5B5B6B', '#ffffff', 'WL'],
    ['singhagiri', 'singhagiri', 'Singhagiri', 'Shopping', '#0848A8', '#ffffff', 'S'],
    ['isso', 'isso\\b', 'Isso', 'Food', '#080808', '#ffffff', 'I'],
    ['teaavenue', 'tea avenue', 'Tea Avenue', 'Food', '#5B5B6B', '#ffffff', 'TA'],
    ['shanmugas', 'shanmugas', 'Shanmugas', 'Food', '#5B5B6B', '#ffffff', 'S'],
    ['greencabin', 'green cabin', 'Green Cabin', 'Food', '#086858', '#ffffff', 'GC'],
    ['delifrance', 'delifrance', 'Delifrance', 'Food', '#F8F8F8', '#ffffff', 'D'],
    ['cinnabon', 'cinnabon', 'Cinnabon', 'Food', '#48D8C8', '#ffffff', 'C'],
    ['garena', 'garena', 'Garena', 'Entertainment', '#F8F8F8', '#ffffff', 'G'],
    ['infinix', 'infinix', 'Infinix', 'Shopping', '#5B5B6B', '#ffffff', 'I'],
    ['tecno', 'tecno mobile|tecno\\b', 'Tecno', 'Shopping', '#0868F8', '#ffffff', 'T'],
    ['skechers', 'skechers', 'Skechers', 'Shopping', '#080808', '#ffffff', 'S'],
    ['crocs', 'crocs\\b', 'Crocs', 'Shopping', '#78A848', '#ffffff', 'C'],
    ['gymshark', 'gymshark', 'Gymshark', 'Shopping', '#080808', '#ffffff', 'G']
].map(([slug, src, name, cat, bg, fg, mark]) => ({
    slug, name, cat, bg, fg, mark,
    // At the start of a name, optionally after "The" or a payment processor's prefix ("GOOGLE *YouTube", "PAYPAL *NETFLIX").
    start: new RegExp(`^(?:the\\s+|[a-z0-9]{2,8}\\s?\\*\\s?)?(?:${src})`, 'i'),
    any: new RegExp(`\\b(?:${src})`, 'i')
}));
// The brand a name belongs to. Names read from bank SMS must start with it ("BARISTA - CARGILLS SQUARE" is Barista,
// not Cargills). Short hand-written names may mention it anywhere ("Lunch at KFC"); the first one mentioned wins.
const brandMemo = new Map();
const brandFor = (text, startOnly = false) => {
    const s = String(text || '').trim();
    if (!s) return null;
    const key = (startOnly ? '1' : '0') + s;
    if (brandMemo.has(key)) return brandMemo.get(key);
    if (brandMemo.size > 3000) brandMemo.clear();
    // Banks write "&" in many ways: "PERERA - SONS", "PERERA AND SONS", "PERERA N SONS", "PERERA+SONS".
    const found = findBrand(s, startOnly) || (/[-+]|\bn\b/i.test(s) ? findBrand(s.replace(/\s*[-+]\s*|\s+n\s+/gi, ' & '), startOnly) : null);
    brandMemo.set(key, found);
    return found;
};
// One combined test first: most names typed by hand are no brand at all, and skip the per-brand scan.
const BRAND_ANY = new RegExp(BRANDS.map((b) => b.any.source).join('|'), 'i');
function findBrand(s, startOnly) {
    if (!BRAND_ANY.test(s)) return null;
    // When several brands start the name, the longest match is the most specific ("HNB Assurance" over "HNB").
    let first = null;
    let len = 0;
    for (const b of BRANDS) { const m = b.start.exec(s); if (m && m[0].length > len) { first = b; len = m[0].length; } }
    if (first || startOnly || s.split(/\s+/).length > 3) return first || null;
    let best = null;
    let at = Infinity;
    BRANDS.forEach((b) => { const m = b.any.exec(s); if (m && m.index < at) { best = b; at = m.index; } });
    return best;
}
// Town, country, company and terminal codes that bank SMS add after a shop name:
// "KOKO COLOMBO 03 LK" -> "Koko", "Google One 650-2530000 US" -> "Google One", "UBER EATS 852 LK" -> "Uber Eats".
const SL_PLACES = 'colombo|col|kandy|galle|negombo|maharagama|nugegoda|dehiwala|mount lavinia|moratuwa|kotte|battaramulla|kollupitiya|wellawatte|bambalapitiya|rajagiriya|malabe|kadawatha|kiribathgoda|wattala|ja-?ela|gampaha|panadura|kurunegala|matara|jaffna|anuradhapura|kaduwela|homagama|piliyandala|boralesgamuwa|pannipitiya|ratmalana|kelaniya|kalutara|horana|chilaw|badulla|ratnapura|trincomalee|batticaloa';
const SMS_COUNTRY = /[\s,*#\-]+(LK|LKA|SL|US|USA|SE|IE|GB|UK|SG|IN|AE|AU|NL|DE|FR|HK|CA|JP|LU|CY|MT|CH|MY|TH|CN)$/i;
const cleanMerchant = (raw) => {
    let s = String(raw || '').replace(/\s+/g, ' ').trim();
    s = s.replace(/^(the|merchant|m\/s)\s+/i, '').replace(/[\s.,:;\-*#]+$/, '');
    // The country code comes last, once ("TOYS R US LK" keeps its "US").
    s = s.replace(SMS_COUNTRY, '');
    for (let i = 0; i < 6; i++) {
        const before = s;
        s = s.replace(/[\s.,:;\-*#]+$/, '')
            .replace(/[\s,]+\+?\d[\d\s\-]{6,}\d$/, '') // phone numbers
            .replace(/\s*@\s*\d+$/, '')
            .replace(/[\s,]+\(?(pvt|private)\)?\.?(\s*\(?(ltd|limited)\)?\.?)?$/i, '')
            .replace(/[\s,]+(ltd|limited|plc|llc|inc|sarl|pte|gmbh)\.?$/i, '')
            .replace(new RegExp(`[\\s,\\-]+(${SL_PLACES})(\\s*0?\\d{1,2})?$`, 'i'), '')
            .replace(/(\s+#?\d{2,8})+$/, '') // shop or terminal numbers
            .replace(/\s+-\s*\d{4,}$/, '')
            .trim();
        if (s === before) break;
    }
    // A payment processor's code, with the city after it: "Spotify P47EA6D4BC STOCKHOLM" -> "Spotify".
    s = s.replace(/\s+(?=[a-z*]*\d)(?=\d*[a-z])[a-z0-9*]{4,12}(\s+[a-z]+)?$/i, '').replace(/[\s.,:;\-*#]+$/, '').trim();
    if (s.length < 2) return '';
    if (s.length > 48) s = s.slice(0, 48).trim();
    // SHOUTED names are tidied; names the bank already wrote in mixed case are kept as they are.
    return s === s.toUpperCase() ? titleCase(s) : s;
};
// Entries added from bank SMS before shop names were cleaned ("Koko Colombo 03 Lk"): tidy the ones the user hasn't
// renamed (name still equals the shop name Vela read). Runs on start; changes nothing it isn't sure about.
const tidyBankEntryNames = () => {
    let changed = 0;
    (state.transactions || []).forEach((t) => {
        // Entries that lost their bank details to the old loading bug: the note Vela wrote still says where they came from.
        const from = !t.bank && /^From (.{2,40}?) \((SMS|Shared|SMS \+ Shared|Notification|SMS \+ Notification)\)$/.exec(t.note || '');
        if (from) {
            t.bank = { bank: from[1], kind: null, ref: null, last4: null, merchant: t.desc, smsId: null, dedupe: null, time: null, sources: from[2].toLowerCase().includes('shared') ? ['sms', 'shared'] : ['sms'], sourceIds: [], bodyKeys: [], arrivedAt: null, confidence: null, verifiedAt: null };
            changed++;
        }
        if (!t.bank || !t.bank.merchant || t.desc !== t.bank.merchant) {
            if (from) queueSync('transaction', t.id, 'upsert', false);
            return;
        }
        const clean = cleanMerchant(t.bank.merchant);
        const b = brandFor(clean, true);
        const name = b ? b.name : clean;
        if (!name || name === t.desc) return;
        t.desc = name;
        t.bank.merchant = name;
        if (b && b.cat && t.type === 'expense' && t.category === 'Other' && expenseCatExists(b.cat)) t.category = b.cat;
        changed++;
        queueSync('transaction', t.id, 'upsert', false);
    });
    if (changed) saveState();
};
// Real logos bundled with the app in logos/: each brand's official Google Play app icon (or its site icon when it has
// no app), fetched once by scripts/fetch-logos.mjs and checked by eye, so showing them never contacts anyone.
// Brands without a verified logo get a badge in their colours.
const LOGO_SLUGS = new Set(['abans', 'acca', 'accor', 'acer', 'adidas', 'adobe', 'agoda', 'aia', 'airasia', 'airbnb', 'airindia', 'airtel', 'alibaba', 'aliexpress', 'alliancefinance', 'allianz', 'amana', 'amanatakaful', 'amazon', 'amex', 'anghami', 'anker', 'apple', 'arpico', 'arpicoinsurance', 'asiri', 'asos', 'asus', 'atlassian', 'att', 'audi', 'audible', 'autodesk', 'avast', 'aws', 'barista', 'baskinrobbins', 'bata', 'bestbuy', 'binance', 'bitwarden', 'blizzard', 'bmw', 'boc', 'bolt', 'booking', 'bookmyshow', 'britishairways', 'britishcouncil', 'burgerking', 'busseat', 'bybit', 'cadbury', 'calmapp', 'calvinklein', 'canon', 'canva', 'capcut', 'caravanfresh', 'careem', 'cargills', 'cargillsbank', 'carlsjr', 'carnage', 'carrefour', 'casio', 'cathay', 'cdb', 'ceb', 'celltronics', 'centralfinance', 'ceylinco', 'ceypetco', 'chanel', 'chegg', 'chickfila', 'chipotle', 'cima', 'cinnabon', 'cinnamon', 'citibank', 'claude', 'cloudflare', 'codashop', 'coffeebean', 'coinbase', 'combank', 'commercialcredit', 'costa', 'costco', 'coursera', 'creperunner', 'crocs', 'crunchyroll', 'cryptocom', 'cursor', 'dairyqueen', 'damro', 'daraz', 'deepseek', 'deezer', 'delifrance', 'deliveroo', 'dell', 'dfcc', 'dhl', 'dialog', 'dialogpay', 'digitalocean', 'dilmah', 'dinemore', 'discord', 'disney', 'dominos', 'doordash', 'dropbox', 'dsi', 'dunkin', 'duolingo', 'durdans', 'ebay', 'edx', 'emirates', 'envato', 'epicgames', 'etihad', 'etisalat', 'etsy', 'evernote', 'expedia', 'expressvpn', 'facebook', 'fashionbug', 'fedex', 'figma', 'fitsair', 'fiveguys', 'fiverr', 'flipkart', 'flydubai', 'foodpanda', 'ford', 'fossil', 'freefire', 'freepik', 'frimi', 'gallefacehotel', 'garena', 'gemini', 'github', 'gitlab', 'glomark', 'gloriajeans', 'godaddy', 'google', 'grab', 'grammarly', 'greencabin', 'gucci', 'gulfair', 'gymshark', 'hameedia', 'hardees', 'hbomax', 'hdfc', 'headspace', 'healthguard', 'helakuru', 'hemas', 'heroku', 'highland', 'hilton', 'hm', 'hnb', 'hnbassurance', 'hnbfinance', 'honda', 'hostinger', 'hotelscom', 'hotstar', 'houseoffashions', 'hoyoverse', 'hp', 'hsbc', 'huawei', 'hutch', 'hyundai', 'icbt', 'icici', 'ielts', 'ihg', 'ikea', 'ikman', 'imo', 'indigo', 'indrive', 'instagram', 'isso', 'javalounge', 'jbl', 'jetbrains', 'jio', 'jollibee', 'kangaroocabs', 'kapruka', 'keells', 'kellyfelder', 'kfc', 'kia', 'king', 'kingshospital', 'klook', 'koko', 'krispykreme', 'lacoste', 'lankahospitals', 'lankaioc', 'lassana', 'laugfs', 'laugfsgas', 'lazada', 'lbfinance', 'leco', 'lego', 'levis', 'lg', 'lidl', 'linkedin', 'litro', 'littlecaesars', 'lolc', 'louisvuitton', 'lufthansa', 'lyft', 'mailchimp', 'malaysiaairlines', 'maliban', 'marriott', 'mastercard', 'mazda', 'mcafee', 'mcash', 'mcb', 'mcdonalds', 'medihelp', 'mercantileinv', 'mercedes', 'meta', 'microsoft', 'midjourney', 'minecraft', 'miniso', 'ministryofcrab', 'mintpay', 'mobilelegends', 'mobitel', 'moneygram', 'muji', 'myntra', 'namecheap', 'nandos', 'nawaloka', 'ndb', 'nestle', 'netflix', 'netlify', 'newbalance', 'nike', 'nintendo', 'nissan', 'nokia', 'nolimit', 'noon', 'nordvpn', 'norton', 'notion', 'nsb', 'nsbm', 'ntb', 'nykaa', 'okx', 'ola', 'omanair', 'onepassword', 'ooredoo', 'openai', 'oppo', 'pabc', 'pandaexpress', 'papajohns', 'paramount', 'parisbaguette', 'patreon', 'payhere', 'payoneer', 'paypal', 'pelwatte', 'peoples', 'peoplesinsurance', 'peoplesleasing', 'peotv', 'pepsi', 'pereraandsons', 'perplexity', 'philips', 'pickme', 'pickmefood', 'picsart', 'pinterest', 'pizzahut', 'playstation', 'pret', 'prima', 'primevideo', 'proton', 'pubg', 'puma', 'qatarairways', 'quizlet', 'razer', 'rdb', 'realme', 'redbull', 'reddit', 'remitly', 'replit', 'revolut', 'riot', 'roblox', 'sampath', 'scb', 'scope', 'scribd', 'sdb', 'senkadagala', 'sephora', 'seylan', 'shakeshack', 'shangrila', 'shein', 'shell', 'shopee', 'shopify', 'shutterstock', 'singaporeair', 'singer', 'singerfinance', 'singhagiri', 'siyapatha', 'skechers', 'skillshare', 'skrill', 'skyscanner', 'slack', 'sliit', 'slt', 'snapchat', 'softlogic', 'softlogicfinance', 'softlogiclife', 'sonyliv', 'soundcloud', 'spaceylon', 'spar', 'spotify', 'squarespace', 'srilankan', 'standardchartered', 'starbucks', 'starlink', 'stc', 'steam', 'strava', 'stripe', 'subway', 'supercell', 'surfshark', 'swiggy', 'tacobell', 'taj', 'takas', 'talabat', 'tecno', 'telegram', 'temu', 'tesco', 'tesla', 'texaschicken', 'tidal', 'tiktok', 'tinder', 'tommy', 'toyota', 'trello', 'tripadvisor', 'tripcom', 'trivago', 'truecaller', 'turkish', 'tvs', 'twitch', 'twitter', 'uber', 'ubereats', 'udemy', 'unionassurance', 'unionbank', 'uniqlo', 'unityengine', 'upalis', 'upay', 'ups', 'upwork', 'vallibelfinance', 'vercel', 'verizon', 'viber', 'victoriassecret', 'vijithayapa', 'viu', 'volkswagen', 'vox', 'walmart', 'wasi', 'waterboard', 'wendys', 'westernunion', 'whatsapp', 'wise', 'wix', 'wordpress', 'xbox', 'xiaomi', 'yamaha', 'youtube', 'zara', 'zee5', 'zoho', 'zomato', 'zoom']);
const LOGO_ALIAS = { pickmefood: 'pickme' };
const logoSlug = (slug) => { const k = LOGO_SLUGS.has(slug) ? slug : LOGO_ALIAS[slug]; return k && LOGO_SLUGS.has(k) ? k : null; };
const logoImg = (slug, alt = '') => `<img src="logos/${slug}.webp" alt="${escapeHtml(alt)}" decoding="async" draggable="false" onerror="this.parentNode.classList.remove('has-logo');this.remove()">`;
const brandBadge = (b, extra = '') => {
    const slug = logoSlug(b.slug);
    const mark = b.mark ? `<span class="brand-letters${b.mark.length > 2 ? ' is-long' : ''}">${escapeHtml(b.mark)}</span>` : icon('c-Shopping');
    return `<span class="cat-badge brand-badge${slug ? ' has-logo' : ''}${extra}" style="--brand-bg:${b.bg};--brand-fg:${b.fg}" title="${escapeHtml(b.name)}">${slug ? logoImg(slug) : ''}${mark}</span>`;
};
/* ---- Your own shop logos: for shops Vela doesn't know, a photo or screenshot you pick once (Add logo in the
   entry form). Kept only on this phone (and in backups), cropped to a small square; never uploaded. ---- */
const SHOP_LOGO_KEY = 'VELA_SHOP_LOGOS';
const SHOP_LOGO_MAX = 300;
let shopLogos = (() => { try { const o = JSON.parse(localStorage.getItem(SHOP_LOGO_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } })();
const shopLogoKey = (name) => String(name || '').trim().toLowerCase().replace(/[^a-z0-9&+ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const customLogoFor = (name) => { const k = shopLogoKey(name); return k ? shopLogos[k] || null : null; };
const saveShopLogos = () => {
    try { localStorage.setItem(SHOP_LOGO_KEY, JSON.stringify(shopLogos)); return true; } catch (e) { return false; }
};
const setShopLogo = (name, dataUrl) => {
    const k = shopLogoKey(name);
    if (!k) return false;
    const before = shopLogos[k];
    if (dataUrl) shopLogos[k] = dataUrl; else delete shopLogos[k];
    const keys = Object.keys(shopLogos);
    if (keys.length > SHOP_LOGO_MAX) delete shopLogos[keys[0]];
    if (saveShopLogos()) return true;
    if (before) shopLogos[k] = before; else delete shopLogos[k];
    return false;
};
const chosenBrand = (name) => {
    const d = customLogoFor(name);
    return d && d.startsWith('brand:') ? BRANDS.find((b) => b.slug === d.slice(6)) || null : null;
};
// The brand of a name: the one you picked for it, else the one its name matches.
const brandOfName = (name) => chosenBrand(name) || brandFor(name);
const customBadge = (name, extra = '') => {
    const picked = chosenBrand(name);
    if (picked) return brandBadge(picked, extra);
    const d = customLogoFor(name);
    return d && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(d)
        ? `<span class="cat-badge brand-badge has-logo${extra}" title="${escapeHtml(name)}"><img src="${d}" alt="" decoding="async" draggable="false"></span>` : '';
};
// A picked photo becomes a 160 px square logo (centre crop, on white like the bundled logos).
const makeShopLogo = (file) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const c = document.createElement('canvas');
        c.width = 160; c.height = 160;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 160, 160);
        ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 160, 160);
        URL.revokeObjectURL(url);
        let d = c.toDataURL('image/webp', 0.86);
        if (!d.startsWith('data:image/webp')) d = c.toDataURL('image/jpeg', 0.86);
        resolve(d);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not an image')); };
    img.src = url;
});
// The badge for an entry: your own logo for that shop, else its real logo when bundled, else its brand colours,
// else its category icon.
const entryBadge = (desc, category, type) => {
    const own = customBadge(desc);
    if (own) return own;
    const b = brandFor(desc);
    return b ? brandBadge(b) : catBadge(category, type);
};
// Account and card numbers are shown as their last 4 digits only.
const maskSms = (body) => String(body || '')
    .replace(/\b(?:[0-9][0-9 *xX#-]{6,}[0-9])\b/g, (m) => { const d = m.replace(/\D/g, ''); return d.length >= 8 ? `••${d.slice(-4)}` : m; })
    .replace(/\b[xX*#]{2,}\s?([0-9]{3,4})\b/g, '••$1');
// The date and time written in the message. Sri Lankan banks write day/month; every date found is checked
// against when the message arrived and the closest plausible one wins (up to 60 days old, at most a day ahead).
const SMS_MONTH = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const smsDateTime = (body, receivedMs) => {
    const got = new Date(receivedMs || Date.now());
    const year4 = (y) => (y < 100 ? 2000 + y : y);
    const cands = [];
    let m;
    const ymd = /\b(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/g;
    while ((m = ymd.exec(body))) cands.push(new Date(+m[1], +m[2] - 1, +m[3]));
    const dmy = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})\b/g;
    while ((m = dmy.exec(body))) {
        const a = +m[1];
        const b = +m[2];
        const y = year4(+m[3]);
        if (b >= 1 && b <= 12 && a >= 1 && a <= 31) cands.push(new Date(y, b - 1, a));
        if (a >= 1 && a <= 12 && b >= 1 && b <= 31 && a !== b) cands.push(new Date(y, a - 1, b));
    }
    const mon = new RegExp(`\\b(\\d{1,2})[\\s\\-]?(${SMS_MONTH})\\b(?:[\\s\\-,]+(\\d{4}|\\d{2})(?![:\\d]))?`, 'gi');
    while ((m = mon.exec(body))) cands.push(new Date(m[3] ? year4(+m[3]) : got.getFullYear(), MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]));
    const valid = cands.filter((d) => !isNaN(d) && d.getTime() - got.getTime() > -60 * 86400000 && d.getTime() - got.getTime() < 86400000);
    valid.sort((x, y) => Math.abs(x - got) - Math.abs(y - got));
    // A time is hh:mm[:ss] [am/pm]; never part of an amount.
    let time = null;
    const tre = /\b(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?\b/g;
    while ((m = tre.exec(body))) {
        if (/(lkr|rs\.?|usd|[,.])\s*$/i.test(body.slice(Math.max(0, m.index - 6), m.index))) continue;
        let hh = +m[1];
        if (m[3] && /p/i.test(m[3]) && hh < 12) hh += 12;
        if (m[3] && /a/i.test(m[3]) && hh === 12) hh = 0;
        if (hh < 24 && +m[2] < 60) { time = `${pad2(hh)}:${m[2]}`; break; }
    }
    return { date: toISODate(valid[0] || got), time, fromMessage: valid.length > 0 };
};
// Last 4 digits of the card or account ("card ending #5370", "A/C No.8001234567", "AC **8758", "Account:2080***2939").
const smsLast4 = (body) => {
    const kw = /(card|\bcrd\b|a\/c|\bac\b|\bacc\b|account|acct)/gi;
    let k;
    while ((k = kw.exec(body))) {
        const m = /^([^\d*xX•]{0,25}?)([0-9Xx*•#.\-]{3,26})/.exec(body.slice(k.index + k[0].length, k.index + k[0].length + 50));
        if (!m || /\b(lkr|rs|usd|on|at|for)\b|rs\./i.test(m[1])) continue;
        const run = m[2].replace(/[.\-]+$/, '');
        if (/^\d+\.\d{1,2}$/.test(run)) continue; // an amount like 2450.00
        const d = /(\d{4})$/.exec(run);
        if (d) return d[1];
    }
    const e = /\bending(?: in| with)?\s*#?\s*([0-9]{4})\b/i.exec(body);
    return e ? e[1] : null;
};
// Who the money went to or came from.
const SMS_NAME_STOP = '(?=\\s+(?:on|for|from|using|with|via|by|card|a\\/c|ac|acc|account|ref|reference|dated|date|avl|available|bal|balance|has|was|amount|amt|txn|successful|credited|debited|into|to|\\d{1,2}[\\/\\-.]\\d{1,2})\\b|\\s*[,;(]|\\.\\s|\\.$|\\s+-\\s+(?:avl|bal|ref)|$)';
const SMS_NOT_A_NAME = /^(your|a\/c|ac\b|acc|account|card|crd|cardholder|customer|x{2,}|\*|\d|lkr|rs\.?\b|usd|any\b|more\b|info|inquir|enquir|further|details|banking|us\b|inq|enq|call\b|get\b|for\b|the\b|an?\b|this\b|atm\b|pos\b|sms\b)/i;
const smsMerchant = (body, kind) => {
    const first = (sources) => {
        for (const src of sources) {
            const g = new RegExp(src, 'gi');
            let m;
            while ((m = g.exec(body))) {
                const c = cleanMerchant(m[1]);
                if (c && !SMS_NOT_A_NAME.test(c)) return c;
                if (m.index === g.lastIndex) g.lastIndex++;
            }
        }
        return '';
    };
    // HNB card alerts: "Location:KEELLS SUPER, COLOMBO 03, LK,Amount(Approx.):..."
    const loc = /\blocation:\s*(.+?)\s*,\s*amount\b/i.exec(body);
    if (loc) return cleanMerchant(loc[1]);
    // HNB account alerts: "Reason:MB BillPmt/Mobitel/0701...", "Reason:CEFT/JOHN/DOE". Other reasons are a kind, not a name.
    const reason = /\breason:\s*(.+?)(?=\s+bal\b|\s+protect\b|\s+hot ?line\b|$)/i.exec(body);
    if (reason) {
        const bill = /bill ?pmt\/([^\/]+)/i.exec(reason[1]);
        if (bill) return cleanMerchant(bill[1]);
        const xfer = /^(?:cefts?|slips|rtgs)\/(.+)$/i.exec(reason[1].trim());
        return xfer ? cleanMerchant(xfer[1].split('/').filter((p) => /[A-Za-z]/.test(p)).join(' ')) : '';
    }
    const who = kind.dir === 'in' || kind.dir === 'rev' ? `\\b(?:from|by)\\s+(.+?)${SMS_NAME_STOP}` : `\\b(?:paid to|transfer(?:red)? to|payment to|to)\\s+(.+?)${SMS_NAME_STOP}`;
    const found = first([`\\bat\\s+(?!\\d{1,2}[:.]\\d{2})(.+?)${SMS_NAME_STOP}`, `@\\s*(?!\\d{1,2}[:.]\\d{2})(.+?)${SMS_NAME_STOP}`]) || first([who]);
    if (found) return found;
    // Sampath: "LKR 4,025.00 debited from AC **8758 for PICKME - 37419306"
    const forWhat = first([`\\bfor\\s+(.+?)${SMS_NAME_STOP}`]);
    return forWhat && !/\b(transaction|payment|purchase|withdrawal|transfer|alerts?|inquir|enquir)/i.test(forWhat) ? forWhat : '';
};

// A bank Vela hasn't read on this phone before is "learned": each detection the user confirms unchanged counts,
// and only after a few does that bank become eligible for automatic adding. A corrected amount, date or
// direction starts the count again.
const SMS_TRUST_NEEDED = 3;
const smsTrustCount = (name) => Math.min(SMS_TRUST_NEEDED, Number((smsPrefs().trust || {})[name]) || 0);
const smsBankTrusted = (bank) => !!bank && (!!bank.verified || smsTrustCount(bank.name) >= SMS_TRUST_NEEDED);
const smsLearn = (i, ok) => {
    const bank = i && SMS_BANKS.find((b) => b.name === i.bank);
    if (!bank || bank.verified || sourceList(i).every((s) => s === 'shared')) return;
    const p = smsPrefs();
    p.trust = { ...(p.trust || {}), [bank.name]: ok ? Math.min(SMS_TRUST_NEEDED, (Number((p.trust || {})[bank.name]) || 0) + 1) : 0 };
    saveSmsPrefs(p);
};

/* Reads one SMS. Returns null (with the reason in smsLastReason) when it isn't a transaction, or
   { type: 'expense' | 'income' | 'atm' | 'reversal' | 'cardpay', kind, amount, currency, bank, desc, merchant, date, time,
     ref, last4, confidence: 'high' | 'medium', checks: [...], dedupe, masked, fx? } */
let smsLastReason = '';
const parseBankSms = (msg) => {
    smsLastReason = '';
    // Some banks' SMS split words across lines ("credit ed", "debit ed", "with drawn"): put them back together.
    const body = String(msg.body || '').replace(/\s+/g, ' ').trim()
        .replace(/\b(credit|debit|deposit|transferr|withdraw|deduct|charg|revers|authoris|authoriz|process)\s+(ed)\b/gi, '$1$2')
        .replace(/\bwith\s+drawn\b/gi, 'withdrawn').replace(/\bwith\s+drawal\b/gi, 'withdrawal');
    const address = String(msg.address || '').trim();
    const no = (why) => { smsLastReason = why; return null; };
    if (!body) return no('empty');
    if (SMS_OTP.some((re) => re.test(body))) return no('one-time code');
    const hard = SMS_HARD_IGNORE.find(([re]) => re.test(body));
    if (hard) return no(hard[1]);
    const t = smsNorm(body);
    const soft = SMS_SOFT_IGNORE.find(([re]) => re.test(body));
    if (soft && (!SMS_STRONG.test(t) || SMS_CONDITIONAL.test(t))) return no(soft[1]);

    const notif = msg.source === 'notification';
    const source = notif ? 'notification' : (msg.shared || msg.source === 'shared' || /^shared|^pasted/i.test(address)) ? 'shared' : 'sms';
    const shared = source === 'shared';
    // A bank or Passbook app's notification: the address is the app (e.g. net.combank.passbook), the bank is that app's.
    const senderLetters = shared || notif ? '' : address.replace(/[^A-Za-z]/g, '');
    const phoneSender = !shared && !notif && !senderLetters && /\d{4,}/.test(address);
    // A bank named only in the text counts for shared or pasted messages and for plain phone numbers (flagged below).
    // A named sender that isn't a bank doesn't become one by mentioning a bank.
    const bank = (notif && msg.bank ? SMS_BANKS.find((b) => b.name === msg.bank) : null)
        || (senderLetters ? SMS_BANKS.find((b) => b.sender.test(senderLetters)) : SMS_BANKS.find((b) => b.body.test(body))) || null;
    let otherSender = '';
    if (!bank && !shared) {
        // A plain phone number that names no bank: only when the text is clearly about an account being debited or
        // credited, and always for review (fake "credited" SMS from phone numbers are a common scam).
        if (!senderLetters) {
            if (!phoneSender || !SMS_ACCOUNT_WORDING.test(t)) return no('not from a bank');
        } else {
            if (SMS_NOT_BANKS.test(senderLetters) || !SMS_ACCOUNT_WORDING.test(t)) return no('not from a known bank');
            otherSender = address.replace(/[^A-Za-z0-9 +&.\-]/g, '').trim().slice(0, 24);
        }
    }

    const all = smsAmounts(body);
    const moved = all.filter((a) => !a.balance);
    if (!moved.length) return no(all.length ? 'only a balance, no transaction' : 'no amount');
    let kind = smsKindOf(t);
    if (!kind) return no('no transaction wording');
    const checks = [];
    let amt = moved[0];
    let fx = null;
    // A foreign purchase with the bank's rupee figure beside it ("USD 9.99 (LKR 3,312.45)"): the rupees are what left the account.
    if (amt.cur !== 'LKR') {
        const lkr = moved.find((a) => a.cur === 'LKR' && a.at > amt.at && a.at - amt.end <= 6);
        if (lkr) { fx = { amount: amt.value, currency: amt.cur }; amt = lkr; }
    }
    if (moved.some((a) => a !== amt && a.cur === amt.cur && Math.abs(a.value - amt.value) > 0.005)) checks.push('more than one amount in the message');

    const when = smsDateTime(body, msg.date);
    // A live SMS arrives as the transaction happens, so its arrival date is the date. Shared text may be old.
    if (!when.fromMessage && shared) checks.push('date taken from when the message was shared');
    const refM = /\b(?:ref(?:erence)?(?: ?no\.?| ?number)?|txn ?(?:id|no)|trx ?(?:id|no)|transaction (?:id|no)|auth(?:orization)? code|approval code|rrn|trace no)\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9\-\/]{3,24})/i.exec(body);
    const ref = refM && /\d/.test(refM[1]) ? refM[1].replace(/[\-\/.]+$/, '') : null;
    const last4 = smsLast4(body);
    let merchant = smsMerchant(body, kind);
    // "Remarks :KOKO." / "Narration: Salary ABC": who it was from or what it was for, when no name was found.
    if (!merchant) {
        const rm = body.match(/\b(?:remarks?|narration|description|desc|details?|purpose)\s*[:\-]\s*([A-Za-z][A-Za-z0-9 &'.\-\/]{1,40}?)\s*(?:\.\s*(?:bal|avl|available)\b|[.;,]\s|[.;,]?$|\s+(?:bal|avl|available)\b)/i);
        if (rm && !/^(n\/?a|nil|none|-+)$/i.test(rm[1].trim())) merchant = titleCase(rm[1].trim().replace(/[.\-\/]+$/, '')).slice(0, 40);
    }
    let brand = merchant ? brandFor(merchant, true) : null;
    // "... from the ComBank Digital" / "via BOC Smart": the bank itself (its app) is how the money moved, not who it was.
    if (brand && bank && brand.slug === bank.logo) { merchant = ''; brand = null; }
    if (brand) merchant = brand.name;
    const ownMove = /\bown\s+accounts?\s+transfer|\btransfer\s+(?:between|to|from)\s+(?:your\s+)?own\s+accounts?\b/i.test(body);
    if (ownMove) checks.push('between your own accounts: if it came from (or went to) another account in Vela, record it as a transfer');
    // Money coming back from a shop is a refund, not income.
    if (kind.kind === 'credit' && brand && brand.cat) kind = SMS_KIND.refund;
    if (!merchant && (kind.kind === 'card' || kind.kind === 'online')) checks.push('no shop name in the message');
    if (kind.generic && !merchant) checks.push('the message does not say what it was for');
    if (!bank) checks.push(otherSender ? `${otherSender} isn’t in Vela’s bank list yet` : phoneSender ? 'it came from a phone number, not a bank, so check your bank app before adding it' : 'sender not recognised as a bank');
    else if (phoneSender) checks.push('it came from a phone number, not the bank’s sender name, so check your bank app first');
    else if (shared) checks.push(SMS_CHECK_SHARED);
    else if (!smsBankTrusted(bank)) checks.push(`Vela is still learning ${bank.name} messages (${smsTrustCount(bank.name)} of ${SMS_TRUST_NEEDED} confirmed)`);

    const bankName = bank ? bank.name : (otherSender || (phoneSender ? 'Unknown sender' : 'Bank'));
    const type = { in: 'income', out: 'expense', move: 'atm', rev: 'reversal', card: 'cardpay' }[kind.dir];
    const desc = kind.kind === 'atm' ? 'ATM withdrawal'
        : kind.kind === 'fee' ? `${bankName} charges`
        : kind.kind === 'card_payment' ? 'Card payment'
        : kind.kind === 'interest' ? `${bankName} interest`
        : kind.kind === 'refund' ? `Refund${merchant ? `: ${merchant}` : ''}`
        : kind.kind === 'reversal' ? `Reversal${merchant ? `: ${merchant}` : ''}`
        : ownMove ? 'Own account transfer'
        : merchant || (kind.kind === 'salary' ? 'Salary' : `${bankName} ${kind.label.toLowerCase()}`);
    let category = type === 'income'
        ? (kind.kind === 'salary' || /\bsalary\b/i.test(body) ? 'Salary' : kind.kind === 'interest' ? 'Investment' : 'OtherIncome')
        : kind.kind === 'fee' ? 'Other' : (brandCategory(brand) || guessCategory(merchant) || (kind.kind === 'bill' ? 'Utilities' : 'Other'));
    const catType = type === 'income' ? 'income' : 'expense';
    if (!state.categories.some((c) => c.id === category && c.type === catType)) category = FALLBACK_CATEGORY[catType];
    const dedupe = ref ? `ref:${bankName}:${ref.toUpperCase()}` : `sig:${bankName}:${kind.dir}:${amt.cur}:${amt.value}:${when.date}:${when.time || ''}:${last4 || ''}`;
    if (type === 'cardpay') checks.push('a payment to your own card is a transfer, not income');
    return {
        id: String(msg.id), type, kind: kind.kind, kindLabel: kind.label, amount: amt.value, currency: amt.cur, fx,
        bank: bankName, desc: desc.slice(0, 80), merchant, category, date: when.date, time: when.time, ref, last4,
        confidence: checks.length ? 'medium' : 'high', checks, dedupe, masked: maskSms(body).slice(0, 400),
        cardSide: /\bdebited\b/.test(t) ? 'from' : 'to',
        source, sources: [source], sourceIds: [String(msg.id)], bodyKeys: [hashToInt(body.toLowerCase())],
        shape: hashToInt(body.toLowerCase().replace(/\d+/g, '#')), // the wording without its numbers
        arrivedAt: Number(msg.date) || Date.now(), fromMessage: when.fromMessage || !shared,
        ...smsFeeFacts(type, kind.kind, t, body, bankName),
        ...(smsBillRef(type, kind.kind, t, body) ? { billRef: smsBillRef(type, kind.kind, t, body) } : {}),
        ...(last4 && smsBillRef(type, kind.kind, t, body) && smsBillRef(type, kind.kind, t, body).replace(/\D/g, '').endsWith(last4) ? { last4: null } : {}),
        refKeys: [...new Set((body.match(/\d[\d -]{4,18}\d/g) || []).map((n) => refDigits(n)).filter((n) => n.length >= 6 && n.length <= 16).map((n) => hashToInt(n)))].slice(0, 8)
    };
};

// Bank charges on cash from an ATM and on transfers to other banks. Many banks don't put the charge in the SMS
// (or send it in another message later), so Vela knows the usual Sri Lankan charges and lets you correct them:
//   your own bank's ATM: free; another bank's ATM: about Rs. 30 on the LankaPay shared network (Rs. 60 through
//   Visa/Mastercard); online CEFT transfer to another bank: at most Rs. 25 (Central Bank cap, March 2025); same bank: free.
const ATM_FEE_TYPICAL = 30;
const CEFT_FEE_TYPICAL = 25;
const smsFeeFacts = (type, kind, t, body, bankName) => {
    if (!(type === 'atm' || kind === 'transfer_out')) return {};
    const m = t.match(/\b(?:charges?|fee|commission|service charge)\s*(?:of|:|-|is)?\s*(?:rs\.?|lkr)\s*([\d,]+(?:\.\d{1,2})?)/) || t.match(/(?:rs\.?|lkr)\s*([\d,]+(?:\.\d{1,2})?)\s*(?:as\s+)?(?:charges?|fee)\b/);
    const feeInSms = m ? round2(toNumber(m[1].replace(/,/g, ''), 0)) : null;
    const others = SMS_BANKS.filter((b) => b.name !== bankName && b.body.test(body));
    const own = SMS_BANKS.find((b) => b.name === bankName);
    let where = null;
    if (type === 'atm') {
        if (/\b(other bank|another bank|shared atm|lankapay|non-?[a-z]* ?atm|foreign atm)\b/.test(t) || others.length) where = 'other';
        else if (own && own.body.test(body.replace(/thank you for banking with [a-z ]+/i, ''))) where = 'own';
    } else {
        if (/\b(cefts?|slips|interbank|inter-bank|other bank|another bank|lankapay)\b/.test(t) || others.length) where = 'other';
        else if (/\b(own (account|a\/c)|same bank|intra[- ]?bank|between your accounts)\b/.test(t)) where = 'own';
    }
    return { feeKind: type === 'atm' ? 'atm' : 'transfer', feeWhere: where, ...(feeInSms > 0 ? { feeInSms } : {}) };
};
// The charge for this ATM withdrawal / transfer: written in the SMS, or the account's (or typical) charge.
const smsFeePick = {};
const feeChoice = (i) => smsFeePick[i.id] || i.feeWhere || (i.feeKind === 'transfer' ? 'other' : 'own');
const accountFee = (acc, kind) => {
    const v = acc && (kind === 'atm' ? acc.atmFee : acc.ceftFee);
    return typeof v === 'number' && v >= 0 ? v : kind === 'atm' ? ATM_FEE_TYPICAL : CEFT_FEE_TYPICAL;
};
const smsFeeFor = (i, acc) => {
    if (!i || !i.feeKind) return null;
    if (i.feeInSms > 0) return { amount: i.feeInSms, exact: true };
    if (feeChoice(i) !== 'other') return { amount: 0, exact: false };
    return { amount: accountFee(acc, i.feeKind), exact: false };
};
// Adds the charge as its own expense (so it shows as a bank charge, not inside the cash or the transfer).
const addBankFee = (i, acc, forId) => {
    const f = smsFeeFor(i, acc);
    if (!f || !(f.amount > 0)) return null;
    // A charge SMS for it already came in: don't add it twice.
    const dup = state.transactions.find((t) => t.type === 'expense' && t.accountId === acc.id && t.bank && t.bank.kind === 'fee' && Math.abs(daysBetween(parseDate(t.date), parseDate(i.date))) <= 2 && Math.abs(t.amount - f.amount) < 0.01);
    if (dup) return null;
    const what = i.feeKind === 'atm' ? 'cash from another bank\'s ATM' : 'transfer to another bank';
    const rec = quickSaveTx({ type: 'expense', desc: `${i.bank} charges`, amount: f.amount, currency: acc.currency, category: 'Other', date: i.date, time: i.time, accountId: acc.id,
        note: f.exact ? `Charge for ${what} (in the bank SMS)` : `Estimated charge for ${what}. Your bank's SMS didn't show it; edit if your bank charged differently.` });
    rec.feeFor = forId;
    if (!f.exact) rec.feeEstimated = true;
    return rec;
};
// A charge SMS that arrives later replaces Vela's estimate instead of being added again.
const replaceEstimatedFee = (i, accountId) => {
    if (!(i.kind === 'fee' && i.type === 'expense')) return null;
    const est = state.transactions.find((t) => t.feeEstimated && t.accountId === accountId && Math.abs(daysBetween(parseDate(t.date), parseDate(i.date))) <= 3);
    if (!est) return null;
    est.amount = i.amount;
    est.currency = i.currency;
    delete est.feeEstimated;
    est.note = 'Bank charge (from the bank SMS)';
    est.bank = bankMeta(i);
    queueSync('transaction', est.id, 'upsert');
    saveState();
    renderActive();
    return est;
};
// The number a bill payment was for: a phone number (reload, Dialog / Mobitel / SLT bill) or the utility's account
// number (CEB, LECO, Water Board). Your own bank account (written with X's) and amounts or dates are never taken.
const BILL_WORDS = /\b(bill|reload|top-?up|recharge|ceb|leco|nwsdb|water ?board|water|electricity|dialog|mobitel|slt|hutch|airtel|telecom|peo ?tv|broadband|utility)\b/i;
const smsBillRef = (type, kind, t, body) => {
    if (type !== 'expense' || !BILL_WORDS.test(t)) return null;
    const ok = (raw) => { const d = String(raw).replace(/\D/g, ''); return d.length >= 6 && d.length <= 16 && !/^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}$/.test(String(raw).trim()); };
    // "CEB Account No - 4205044100", "Water bill A/C 10/24/123/456/78", "Consumer No: 123456789"
    const util = /\b(?:ceb|leco|nwsdb|water(?:\s*board)?|electricity|electric|bill|consumer|customer|connection|premises)\s*(?:a\/?c(?:count)?|acc(?:ount)?|acct|no|number|id)\.?\s*(?:no\.?|number|#)?\s*[:\-]?\s*(\d[\d\s\/-]{4,20}\d)/i.exec(body);
    if (util && ok(util[1]) && !/[xX*]/.test(util[0])) return util[1].trim().replace(/\s+/g, ' ');
    // "... for account 0412345678" / "to A/C 123456789": the account being paid (not "from A/C", which is yours).
    const paid = /\b(?:for|to)\s+(?:the\s+)?(?:a\/?c(?:count)?|acc(?:ount)?|acct)\.?\s*(?:no\.?|number|#)?\s*[:\-]?\s*(\d[\d\s\/-]{4,20}\d)/i.exec(body);
    if (paid && ok(paid[1]) && !/[xX*]/.test(paid[0])) return paid[1].trim().replace(/\s+/g, ' ');
    // A mobile number in any form: 0771234567, 077 123 4567, +94 77 123 4567, 94771234567.
    const ph = body.match(/(?:\+?94[\s-]?|\b0)7\d[\s-]?\d{3}[\s-]?\d{4}\b/);
    if (ph) { const d = ph[0].replace(/\D/g, ''); return `0${d.slice(-9)}`; }
    return null;
};
const SMS_CHECK_SHARED = 'pasted or shared message, so check it matches your bank app';
const SOURCE_NAMES = { sms: 'SMS', notification: 'Bank notification', shared: 'Shared or pasted' };
const sourceList = (i) => (i && i.sources && i.sources.length ? i.sources : [i && i.source ? i.source : 'sms']);
const sourceLabel = (sources) => (sources || ['sms']).map((s) => SOURCE_NAMES[s] || s).join(' + ');
const sourceShort = (sources) => (sources || ['sms']).map((s) => ({ sms: 'SMS', notification: 'Notification', shared: 'Shared' }[s] || s)).join(' + ');

// What a confirmed detection is saved with: enough to show where it came from and to recognise it again.
// The message text itself is not kept.
const bankMeta = (i) => ({
    bank: i.bank, kind: i.kind, ref: i.ref, last4: i.last4, merchant: i.merchant || '', smsId: i.id, dedupe: i.dedupe, time: i.time,
    sources: sourceList(i), sourceIds: i.sourceIds || [i.id], bodyKeys: i.bodyKeys || [], shape: i.shape || null, arrivedAt: i.arrivedAt || null,
    confidence: i.confidence, verifiedAt: new Date().toISOString()
});
const merchantWord = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(' ').filter((w) => w.length > 2)[0] || '';
const merchantsAgree = (a, b) => { const x = merchantWord(a); const y = merchantWord(b); return !x || !y || String(b).toLowerCase().includes(x) || String(a).toLowerCase().includes(y); };
/* Are two detections the same bank transaction?
   'same'  - the same reference; or the same message text (a resent SMS, a notification update);
             or an SMS and a bank notification with the same type, amount and currency, close in time,
             with no card number that disagrees.
   'maybe' - looks like an SMS + notification pair but the shop names differ: the user decides.
   null    - different. Two SMS (or two notifications) with the same amount are two purchases. */
const smsTextHashes = (x) => (x.sourceIds || [x.id]).map((id) => (/^sms-\d+-(\d+)$/.exec(String(id || '')) || [])[1]).filter(Boolean);
const sameDetection = (a, b) => {
    if (!a || !b) return null;
    // The same text is a repeat (resent SMS, inbox + live copy, notification update) only close in time:
    // a shop that sends identical texts for two purchases hours apart is two purchases.
    // A shared or pasted copy is a copy whenever it comes (even when the pasted text doesn't name the bank).
    // Repeated SMS arrive seconds apart; separate notifications already have their own ids on the phone.
    const sameText = (a.bodyKeys || []).some((k) => (b.bodyKeys || []).includes(k));
    const copyShared = sourceList(a).includes('shared') || sourceList(b).includes('shared');
    if (sameText && copyShared) return 'same';
    // One SMS read twice: by the live listener (stamped with the network's send time) and from the inbox (stamped
    // when the phone stored it). Same sender + text, so the same fingerprint in the id; the two times can be
    // minutes apart when the network was slow or the phone was off.
    const ha = smsTextHashes(a);
    if (sameText && ha.length && smsTextHashes(b).some((x) => ha.includes(x)) && a.arrivedAt && b.arrivedAt && Math.abs(a.arrivedAt - b.arrivedAt) <= 30 * 60000) return 'same';
    if (a.bank !== b.bank) return null;
    const onlyNotif = (x) => sourceList(x).every((s) => s === 'notification');
    if (sameText && !(onlyNotif(a) && onlyNotif(b)) && a.arrivedAt && b.arrivedAt && Math.abs(a.arrivedAt - b.arrivedAt) <= 2 * 60000) return 'same';
    // The same text that states its own time is the same transaction whenever it arrives (sent again, read again):
    // a second payment would carry its own time. Identical texts with no time in them are left for you to decide.
    if (sameText && a.time && a.time === b.time) return 'same';
    if (a.ref && b.ref) return a.ref.toUpperCase() === b.ref.toUpperCase() ? 'same' : null;
    const near = (ms) => !!a.arrivedAt && !!b.arrivedAt && Math.abs(a.arrivedAt - b.arrivedAt) <= ms;
    // Some banks announce one reversal twice (an alert and an account credit): one event.
    if (a.type === 'reversal' && b.type === 'reversal' && a.currency === b.currency && Math.abs(a.amount - b.amount) <= 0.005 && near(10 * 60000)) return 'same';
    if (a.type !== b.type || a.currency !== b.currency || Math.abs(a.amount - b.amount) > 0.005) return null;
    const sa = sourceList(a);
    const sb = sourceList(b);
    // Two SMS for the same amount are two purchases... unless they arrive together and are worded differently
    // (a card alert and an account message for one payment; the card and the account have different numbers).
    // Then the later one is flagged for the user to decide, never merged. The same wording with other numbers
    // (two withdrawals in a row) or two different shops are two transactions.
    if (sa.some((s) => sb.includes(s))) {
        if (!near(3 * 60000) || sameText) return null;
        if (a.shape && b.shape && a.shape === b.shape) return null;
        if (a.merchant && b.merchant && !merchantsAgree(a.merchant, b.merchant)) return null;
        return 'maybe';
    }
    if (a.last4 && b.last4 && a.last4 !== b.last4) return null;
    const windowMs = (smsPrefs().windowMin || 15) * 60000;
    if (!a.arrivedAt || !b.arrivedAt || Math.abs(a.arrivedAt - b.arrivedAt) > windowMs) return null;
    if (a.merchant && b.merchant && !merchantsAgree(a.merchant, b.merchant)) return 'maybe';
    return 'same';
};
// A saved transaction seen as a detection, for matching.
const recordedAsDetection = (t) => ({
    bank: t.bank.bank, ref: t.bank.ref, last4: t.bank.last4, merchant: t.bank.merchant, amount: t.amount, currency: t.currency,
    type: t.bank.kind === 'atm' || t.type === 'transfer' ? 'atm' : t.bank.kind === 'reversal' ? 'reversal' : t.type,
    sources: t.bank.sources || ['sms'], bodyKeys: t.bank.bodyKeys || [], shape: t.bank.shape || null, arrivedAt: t.bank.arrivedAt, time: t.bank.time || null,
    sourceIds: (t.bank.sourceIds && t.bank.sourceIds.length ? t.bank.sourceIds : [t.bank.smsId]).filter(Boolean)
});
// The confirmed transaction a detection is already recorded as (by id, reference, same text, or the other source).
const recordedMatch = (i) => state.transactions.find((t) => t.bank && (
    t.bank.smsId === i.id || (t.bank.sourceIds || []).includes(i.id) || (i.dedupe && i.ref && t.bank.dedupe === i.dedupe) || sameDetection(i, recordedAsDetection(t)) === 'same'));
const smsAlreadyRecorded = (i) => !!recordedMatch(i);
// Two detections of one transaction become one: sources are listed together and missing details filled in.
const fxPairFits = (usd, lkr, acc) => {
    if (!usd || !lkr || !acc || !fxApplies(acc) || usd.currency === lkr.currency || lkr.currency !== acc.currency) return false;
    if (usd.bank !== lkr.bank || usd.type !== 'expense' || lkr.type !== 'expense') return false;
    const days = daysBetween(parseDate(usd.date), parseDate(lkr.date));
    if (days < -1 || days > 10) return false;
    if (usd.merchant && lkr.merchant && !merchantsAgree(usd.merchant, lkr.merchant)) return false;
    const est = fxCharge(usd.amount, usd.currency, acc);
    // Both name the same shop: the day's rate can differ a little. No shop named on one side: only very close.
    const named = !!(usd.merchant && lkr.merchant);
    return named ? Math.abs(lkr.amount - est) <= est * 0.06 : (days <= 3 && Math.abs(lkr.amount - est) <= est * 0.015);
};
const fxAccFor = (i) => state.accounts.find((a) => a.id === smsAccountMatch(i).id) || state.accounts.find((a) => fxApplies(a) && accountBankName(a) === i.bank);
// Already in Vela as an estimate: the bank's rupee message makes it exact (and teaches the charge).
const settleRecordedFx = (i) => {
    if (i.type !== 'expense' || i.fx) return null;
    const t = state.transactions.find((x) => x.type === 'expense' && x.bank && x.fx && x.fx.estimated && x.currency === i.currency
        && fxPairFits({ ...recordedAsDetection(x), amount: x.fx.amount, currency: x.fx.currency, type: 'expense', merchant: (x.bank && x.bank.merchant) || x.desc, date: x.date },
            i, state.accounts.find((a) => a.id === x.accountId)));
    if (!t) return null;
    const acc = state.accounts.find((a) => a.id === t.accountId);
    const fee = learnFxFee(acc, t.fx.amount, t.fx.currency, i.amount);
    t.amount = round2(i.amount);
    t.fx = { ...t.fx, fee: fee === null ? t.fx.fee : fee, estimated: false };
    t.bank.sources = [...new Set((t.bank.sources || ['sms']).concat(i.sources))];
    t.bank.sourceIds = [...new Set((t.bank.sourceIds || [t.bank.smsId]).concat(i.id))];
    queueSync('transaction', t.id, 'upsert');
    showToast(`${t.desc}: exact amount from ${i.bank}, ${formatCurrency(t.amount, t.currency)}${fee !== null ? `. Vela learned the charge (${fee}%)` : ''}`, 'success');
    return t;
};
const mergeDetection = (into, i) => {
    into.sources = [...new Set(sourceList(into).concat(sourceList(i)))];
    into.sourceIds = [...new Set((into.sourceIds || [into.id]).concat(i.sourceIds || [i.id]))];
    into.bodyKeys = [...new Set((into.bodyKeys || []).concat(i.bodyKeys || []))];
    if (!into.ref && i.ref) into.ref = i.ref;
    if (!into.last4 && i.last4) into.last4 = i.last4;
    if (!into.time && i.time) into.time = i.time;
    if (!into.merchant && i.merchant) { into.merchant = i.merchant; into.desc = i.desc; into.category = i.category; }
    if (!into.fromMessage && i.fromMessage) { into.date = i.date; into.fromMessage = true; }
    // A generic "debited" message plus a notification that says what it was: use the specific kind.
    const generic = (k) => !!(SMS_KINDS.find((x) => x.kind === k) || {}).generic;
    if (generic(into.kind) && !generic(i.kind)) { into.kind = i.kind; into.kindLabel = i.kindLabel; }
    into.checks = into.checks.filter((c) => !(/^no shop name/.test(c) && into.merchant) && !(/^date taken/.test(c) && into.fromMessage)
        && !(c === SMS_CHECK_SHARED && into.sources.some((s) => s !== 'shared')) && !(/^the message does not say/.test(c) && !generic(into.kind)));
    into.confidence = into.checks.length ? 'medium' : 'high';
    return into;
};
const sameMoney = (a, cur, b, curB, tol = 0.005) => Math.abs(convertAmount(a, cur, 'USD') - convertAmount(b, curB, 'USD')) <= Math.max(0.01, convertAmount(b, curB, 'USD') * tol);

// The account bank messages go into: the one picked last, else one named like the bank, else a bank/card account.
// The account a bank message belongs to:
//  1. the account you chose before for that bank and card/account number (••5370),
//  2. else your only account with that bank (named "BOC", "Commercial Bank"...),
//  3. else, with one account (or one that isn't cash), that one.
// Otherwise it's undecided ({ id: null }) and Vela asks "Which account?" when you confirm, then remembers.
const smsLinkKey = (i) => (i.last4 ? `${i.bank}|${i.last4}` : null);
const smsAccountMatch = (i) => {
    const valid = (id) => !!id && state.accounts.some((a) => a.id === id);
    const all = state.accounts.map((a) => a.id);
    if (i.accountId && valid(i.accountId)) return { id: i.accountId, candidates: [i.accountId] };
    const key = smsLinkKey(i);
    const linked = key && (smsPrefs().links || {})[key];
    if (valid(linked)) return { id: linked, candidates: [linked] };
    const bb = brandFor(i.bank, true);
    const word = String(i.bank || '').toLowerCase().split(' ')[0];
    const same = state.accounts.filter((a) => {
        const ab = accountBrand(a);
        return (bb && ab && ab.name === bb.name) || (word.length > 2 && word !== 'unknown' && a.name.toLowerCase().includes(word));
    }).map((a) => a.id);
    if (same.length === 1) return { id: same[0], candidates: same };
    if (same.length > 1) return { id: null, candidates: same };
    if (all.length === 1) return { id: all[0], candidates: all };
    const notCash = state.accounts.filter((a) => a.kind !== 'cash').map((a) => a.id);
    if (notCash.length === 1) return { id: notCash[0], candidates: notCash };
    return { id: null, candidates: all };
};
const smsAccountFor = (i) => smsAccountMatch(i).id;
// An existing entry this message is about.
//  - a waiting payment (same direction, amount within 1%, due within 7 days): mark it paid, bank-verified
//  - an entry already logged by hand (same direction and amount, within 2 days, not yet linked): link it
//  - for a reversal: the payment it cancels
const smsMatchFor = (i) => {
    if (i.type === 'reversal') {
        const t = state.transactions.filter((x) => x.type === 'expense' && !x.pending && sameMoney(x.amount, x.currency, i.amount, i.currency) && Math.abs(daysBetween(parseDate(x.date), parseDate(i.date))) <= 30)
            .sort((a, b) => Math.abs(daysBetween(parseDate(a.date), parseDate(i.date))) - Math.abs(daysBetween(parseDate(b.date), parseDate(i.date))))[0];
        return t ? { how: 'reverse', tx: t } : null;
    }
    if (i.type === 'atm' || i.type === 'cardpay') return null;
    // A refund belongs to the purchase it pays back (same shop when both are known, not more than was paid,
    // within 60 days before): it lowers that spending instead of counting as new income.
    if (i.kind === 'refund') {
        const t = state.transactions.filter((x) => x.type === 'expense' && !x.pending && x.date <= i.date && daysBetween(parseDate(x.date), parseDate(i.date)) <= 60
            && convertAmount(i.amount, i.currency, x.currency) <= x.amount + 0.005
            && (i.merchant && merchantWord(i.merchant)
                ? `${(x.bank && x.bank.merchant) || ''} ${x.desc}`.toLowerCase().includes(merchantWord(i.merchant))
                : sameMoney(x.amount, x.currency, i.amount, i.currency)))
            .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
        return t ? { how: 'refund', tx: t } : null;
    }
    const shopWord = merchantWord(i.merchant || i.desc);
    const iSlug = (brandFor(i.merchant || i.desc) || {}).slug;
    const sameShop = (p) => (iSlug && (brandFor(p.name) || {}).slug === iSlug) || (shopWord.length >= 3 && merchantWord(p.name) === shopWord);
    const payAcc = state.accounts.find((a) => a.id === smsAccountMatch(i).id) || state.accounts.find((a) => fxApplies(a) && accountBankName(a) === i.bank);
    const moneyFits = (p) => {
        if (i.currency === p.currency || !payAcc || !fxApplies(payAcc) || p.currency !== payAcc.currency) return sameMoney(p.amount, p.currency, i.amount, i.currency, 0.01);
        const est = fxCharge(i.amount, i.currency, payAcc);
        return Math.abs(est - p.amount) <= p.amount * (sameShop(p) ? 0.06 : 0.015);
    };
    const pay = paymentItems({ horizonDays: 7 }).find((p) => p.type === i.type && moneyFits(p) && Math.abs(daysBetween(parseDate(p.due), parseDate(i.date))) <= 7);
    if (pay) return { how: 'pay', pay };
    const t = state.transactions.find((x) => x.type === i.type && !x.pending && !x.bank && sameMoney(x.amount, x.currency, i.amount, i.currency) && Math.abs(daysBetween(parseDate(x.date), parseDate(i.date))) <= 2);
    return t ? { how: 'link', tx: t } : null;
};

const smsBillPick = {};
const smsPartsPick = {};
const smsBillCandidatesBase = (i) => {
    // (bills that wait for you: income always, expenses that don't log themselves)
    if (!i || i.type !== 'expense') return [];
    const word = (x) => String(x || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)[0] || '';
    const bSlug = (brandFor(i.merchant || i.desc) || {}).slug;
    const w = word(i.merchant || i.desc);
    return state.recurring.filter((b) => b.type === 'expense' && !b.autoLog
        && ((bSlug && (brandFor(b.name) || {}).slug === bSlug) || (w.length >= 3 && word(b.name) === w)));
};
const smsBillCandidates = (i) => {
    const list = smsBillCandidatesBase(i);
    const key = i && i.billRef ? billRefKey(i.billRef) : null;
    return key ? list.sort((a, b) => (billRefKey(b.ref) === key) - (billRefKey(a.ref) === key)) : list;
};
const smsCardHtml = (i) => {
    const match = smsMatchFor(i);
    const typeText = i.type === 'atm' ? 'Cash taken out at an ATM' : i.type === 'reversal' ? 'Reversal (cancels an earlier payment)'
        : i.type === 'cardpay' ? 'Payment to your card (a transfer, not income)' : `${i.type === 'income' ? 'Income' : 'Expense'} · ${i.kindLabel}`;
    const amountText = `${i.type === 'income' ? '+' : (i.type === 'reversal' || i.type === 'cardpay') ? '' : '−'}${formatCurrency(i.amount, i.currency)}`;
    const bankBrand = brandFor(i.bank, true);
    const rows = [
        ['Amount', `<strong class="amount ${i.type === 'income' ? 'text-income' : ''}">${escapeHtml(amountText)}</strong>`],
        ['Bank', `<span class="sms-bank">${bankBrand && logoSlug(bankBrand.slug) ? brandBadge(bankBrand, ' is-mini') : ''}${escapeHtml(`${i.bank}${i.last4 ? ` · ••${i.last4}` : ''}`)}</span>`],
        ['Type', escapeHtml(typeText)],
        ...(i.type === 'cardpay' || i.type === 'reversal' ? [] : [['Account', (() => {
            const m = smsAccountMatch(i);
            const opts = state.accounts.map((a) => `<option value="${escapeHtml(a.id)}"${a.id === m.id ? ' selected' : ''}>${escapeHtml(a.name)}</option>`).join('');
            return `<span class="select sms-acc-select${m.id ? '' : ' is-undecided'}"><select class="input" data-sms-acc="${escapeHtml(i.id)}" aria-label="Account for this transaction">${m.id ? '' : '<option value="" selected>Choose account</option>'}${opts}</select></span>`;
        })()]]),
        ['Description', (() => { const shop = i.merchant || i.desc; const own = customBadge(shop, ' is-mini'); const b = !own && (i.type === 'expense' || i.kind === 'refund') ? brandFor(shop) : null; return `<span class="sms-bank">${own || (b ? brandBadge(b, ' is-mini') : '')}${escapeHtml(i.desc)}</span>`; })()],
        ['Date', escapeHtml(`${relativeDayLabel(i.date)}${i.time ? `, ${i.time}` : ''}`)],
        ...(i.fx ? [['Charged in', escapeHtml(formatCurrency(i.fx.amount, i.fx.currency))]] : []),
        ...(() => {
            // The matched account, or until one is picked, the account it most likely is (your last card / bank account).
            const acc = state.accounts.find((a) => a.id === smsAccountMatch(i).id)
                || state.accounts.find((a) => fxApplies(a) && accountBankName(a) === i.bank)
                || state.accounts.find((a) => a.id === state.config.lastAccount && fxApplies(a)) || state.accounts.find(fxApplies);
            if (i.fx || i.type !== 'expense' || !acc || !fxApplies(acc) || i.currency === acc.currency) return [];
            const est = fxCharge(i.amount, i.currency, acc);
            const typed = smsCharged[i.id];
            return [['Taken from your account', `<label class="sms-charged"><span class="sms-charged-cur">${escapeHtml(symbolFor(acc.currency).trim())}</span><input type="text" class="input" inputmode="decimal" autocomplete="off" data-sms-charged="${escapeHtml(i.id)}" value="${escapeHtml(String(typed > 0 ? typed : est))}" aria-label="Amount taken from your account"></label><span class="faint sms-charged-note">${typed > 0 ? (i.sources.length > 1 ? `Exact: what ${escapeHtml(i.bank)} took` : 'What your bank took') : `Estimate: market rate + ${fxFeeFor(acc)}% ${fxFeeLearned(acc) ? 'your bank\'s charge' : bankFxFee(acc) !== undefined ? `${escapeHtml(accountBankName(acc))}'s published charge` : 'typical bank charge'}. When ${escapeHtml(i.bank)} sends the rupee amount, Vela uses it. Or type it from your bank app once and Vela learns the charge.`}</span>`]];
        })(),
        ...(i.feeKind ? (() => {
            const acc = state.accounts.find((a) => a.id === smsAccountMatch(i).id) || state.accounts.find((a) => a.id === state.config.lastAccount);
            if (i.feeInSms > 0) return [['Bank charge', `${escapeHtml(formatCurrency(i.feeInSms, i.currency))} <span class="faint">(in the SMS, added as a bank charge)</span>`]];
            const ch = feeChoice(i);
            const fee = accountFee(acc, i.feeKind);
            const own = i.feeKind === 'atm' ? 'My bank\'s ATM' : 'Same bank';
            const other = i.feeKind === 'atm' ? 'Another bank\'s ATM' : 'Another bank';
            return [['Bank charge', `<span class="fee-pick" role="group" aria-label="Bank charge"><button type="button" class="chip-btn" data-sms-fee="${escapeHtml(i.id)}:own" aria-pressed="${ch === 'own'}">${own} · free</button><button type="button" class="chip-btn" data-sms-fee="${escapeHtml(i.id)}:other" aria-pressed="${ch === 'other'}">${other} · ${escapeHtml(formatCurrency(fee, acc ? acc.currency : i.currency))}</button></span>`]];
        })() : []),
        ...(() => {
            const bills = smsBillCandidates(i);
            if (!bills.length || (i.refKeys || []).some((k) => bills.some((b) => b.ref && billRefKey(b.ref) === k))) return [];
            const pick = smsBillPick[i.id];
            return [['Which bill?', `<span class="fee-pick bill-pick" role="group" aria-label="Which bill was paid">${bills.map((b) => `<button type="button" class="chip-btn" data-sms-bill="${escapeHtml(i.id)}:${escapeHtml(b.id)}" aria-pressed="${pick === b.id}">${escapeHtml(b.name)}${b.ref ? ` <span class="faint">· ${escapeHtml(b.ref)}</span>` : ''}</button>`).join('')}<button type="button" class="chip-btn" data-sms-bill="${escapeHtml(i.id)}:none" aria-pressed="${pick === 'none'}">None of these</button></span>`]];
        })(),
        ...(i.type === 'expense' && BNPL_RE.test(`${i.desc} ${i.merchant || ''}`) && !smsBillCandidates(i).some((b) => b.parts) ? (() => {
            const pick = smsPartsPick[i.id] || 0;
            return [['Paid in parts?', `<span class="fee-pick" role="group" aria-label="Paid in parts">${[0, 3, 4, 6].map((n) => `<button type="button" class="chip-btn" data-sms-parts="${escapeHtml(i.id)}:${n}" aria-pressed="${pick === n}">${n ? `${n} parts` : 'No, one payment'}</button>`).join('')}</span>`]];
        })() : []),
        ...(i.billRef ? [['Paid for', `<strong>${escapeHtml(refLabel(i.billRef))}</strong>`]] : []),
        ...(i.ref ? [['Reference', escapeHtml(i.ref)]] : []),
        ['Detected through', `<span class="sms-sources">${sourceList(i).map((s) => `<span class="sms-source" data-source="${s}">${escapeHtml(SOURCE_NAMES[s] || s)}</span>`).join('<span class="faint" aria-hidden="true">+</span>')}</span>`]
    ];
    const moveBtn = /^transfer_/.test(i.kind) ? `<button type="button" class="link-btn sms-move" data-sms-move="${escapeHtml(i.id)}">Between my own accounts? Record it as a transfer</button>` : '';
    let actions;
    const refundNote = i.kind === 'refund' && !match ? '<p class="sms-note">No matching purchase found, so this is added as income labelled Refund.</p>'
        : i.type === 'atm' ? `<p class="sms-note atm-note">${icon('i-swap', 'ic ic-sm')}<span>The money moves from your bank account to your <strong>Cash wallet</strong>. It is <strong>not spending</strong>: what you buy with the cash is.</span></p>` : '';
    if (i.type === 'cardpay') {
        actions = `<p class="sms-note">Paying your card moves money between your own accounts, so it isn't income or spending.</p><div class="sms-actions"><button type="button" class="btn btn-secondary btn-sm" data-sms-ignore="${escapeHtml(i.id)}">Ignore</button><button type="button" class="btn btn-primary btn-sm" data-sms-move="${escapeHtml(i.id)}">Record as transfer</button></div>`;
    } else if (i.type === 'reversal') {
        actions = match
            ? `<button type="button" class="btn btn-secondary btn-sm" data-sms-ignore="${escapeHtml(i.id)}">Ignore</button><button type="button" class="btn btn-primary btn-sm" data-sms-match="${escapeHtml(i.id)}">Remove “${escapeHtml(match.tx.desc)}”</button>`
            : `<span class="sms-note">No matching payment found to reverse, so nothing is added.</span><button type="button" class="btn btn-secondary btn-sm" data-sms-ignore="${escapeHtml(i.id)}">OK</button>`;
    } else {
        const matchBtn = match ? `<button type="button" class="btn ${i.type === 'income' ? 'btn-income' : 'btn-primary'} btn-sm btn-block" data-sms-match="${escapeHtml(i.id)}">${icon('i-check', 'ic ic-sm')} ${match.how === 'refund' ? `Refund for “${escapeHtml(match.tx.desc)}”: lower that expense` : match.how === 'pay' ? `Mark “${escapeHtml(match.pay.name)}” as ${i.type === 'income' ? 'received' : 'paid'}` : `Link to “${escapeHtml(match.tx.desc)}” (already recorded)`}</button>` : '';
        actions = `${matchBtn}<div class="sms-actions"><button type="button" class="btn btn-secondary btn-sm" data-sms-ignore="${escapeHtml(i.id)}">Ignore</button><button type="button" class="btn btn-secondary btn-sm" data-sms-edit="${escapeHtml(i.id)}">Edit details</button>${match && match.how !== 'refund' ? '' : `<button type="button" class="btn ${i.type === 'income' ? 'btn-income' : 'btn-primary'} btn-sm" data-sms-add="${escapeHtml(i.id)}">${match ? 'Add as income' : i.type === 'atm' ? 'Move to my Cash' : 'Confirm &amp; add'}</button>`}</div>${moveBtn}`;
    }
    return `<li class="sms-card" data-confidence="${i.confidence}">
        ${i.confidence === 'medium' ? `<p class="sms-check">${icon('i-alert', 'ic ic-sm')}<span>Please check these details: ${escapeHtml(i.checks.join('; '))}.</span></p>` : ''}
        <dl class="sms-fields">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
        <details class="sms-original"><summary>Original message (numbers hidden)</summary><p>${escapeHtml(i.masked)}</p></details>
        ${refundNote}${actions}
    </li>`;
};
// Clear enough to add with one tap: read with confidence, not a reversal or card payment, and its account is known.
const smsAddAllReady = (i) => i.confidence === 'high' && i.type !== 'reversal' && i.type !== 'cardpay' && !!(smsMatchFor(i) || smsAccountFor(i));
// Banks often send two different messages for one payment (a card alert and an account debit). Those are shown
// as one card: "Add once" (the usual) or "They're 2 payments". Each message is in at most one pair.
const smsSplitPairs = new Set();
const smsPairs = () => {
    const pairs = [];
    const used = new Set();
    smsQueue.forEach((a, n) => {
        if (used.has(a.id)) return;
        const b = smsQueue.slice(n + 1).find((x) => !used.has(x.id) && !smsSplitPairs.has(`${a.id}|${x.id}`) && sameDetection(a, x) === 'maybe');
        if (b) { pairs.push([a, b]); used.add(a.id); used.add(b.id); }
    });
    return pairs;
};
const smsPairHtml = ([a, b]) => `<li class="sms-pair">
        <p class="sms-pair-head">${icon('i-alert', 'ic ic-sm')}<span>${escapeHtml(a.bank)} sent <strong>2 messages</strong> for ${escapeHtml(formatCurrency(a.amount, a.currency))} close together. Usually that is <strong>one payment</strong>.</span></p>
        <div class="sms-pair-actions">
            <button type="button" class="btn btn-primary btn-sm" data-sms-pair-once="${escapeHtml(`${a.id}|${b.id}`)}">${icon('i-check', 'ic ic-sm')} Add once</button>
            <button type="button" class="btn btn-secondary btn-sm" data-sms-pair-split="${escapeHtml(`${a.id}|${b.id}`)}">They're 2 payments</button>
        </div>
        <ul class="sms-pair-cards">${smsCardHtml(a)}<li class="sms-pair-second"><details><summary>The other message${b.desc && b.desc !== a.desc ? `: ${escapeHtml(b.desc)}` : ''}</summary><p>${escapeHtml(b.masked)}</p></details></li></ul>
    </li>`;
const smsPairOnce = (key) => {
    const [aId, bId] = key.split('|');
    const a = smsQueue.find((x) => x.id === aId);
    const b = smsQueue.find((x) => x.id === bId);
    if (!a) return;
    if (b) {
        // One payment, two messages: keep what each says (shop, reference...), drop the second card.
        mergeDetection(a, b);
        a.checks = a.checks.filter((c) => !/may be the same/.test(c));
        a.confidence = a.checks.length ? 'medium' : 'high';
        smsQueue = smsQueue.filter((x) => x.id !== b.id);
    }
    smsAdd(a.id);
    if (smsQueue.some((x) => x.id === a.id)) renderSmsSheet(); // still waiting (asked which account)
};
const smsPairSplit = (key) => {
    smsSplitPairs.add(key);
    key.split('|').forEach((id) => { const i = smsQueue.find((x) => x.id === id); if (i) { i.checks = i.checks.filter((c) => !/may be the same/.test(c)); i.confidence = i.checks.length ? 'medium' : 'high'; } });
    renderSmsSheet();
    showToast('Shown as 2 payments. Add each one.', 'info');
};
const renderSmsSheet = () => {
    const list = $('sms-list');
    if (!smsQueue.length) { list.innerHTML = ''; return; }
    const shown = smsQueue.length - smsPairs().length;
    $('sms-count').textContent = `${plural(shown, 'transaction', 'transactions')} to review`;
    // "Add all confident" says how many it will add; when none can be added without a check, it says so.
    const confident = smsQueue.filter(smsAddAllReady).length;
    const allBtn = $('btn-sms-all');
    allBtn.disabled = confident === 0;
    allBtn.textContent = confident ? `Add all confident (${confident})` : 'Check each one below';
    const pairs = smsPairs();
    const inPair = new Set([].concat(...pairs.map(([a, b]) => [a.id, b.id])));
    const firstOfPair = new Map(pairs.map((pr) => [pr[0].id, pr]));
    list.innerHTML = smsQueue.map((i) => (firstOfPair.has(i.id) ? smsPairHtml(firstOfPair.get(i.id)) : inPair.has(i.id) ? '' : smsCardHtml(i))).join('');
};
const showSmsSheet = () => {
    if (!smsQueue.length) return;
    renderSmsSheet();
    if (!isSheetOpen('modal-sms')) openOrSwap('modal-sms');
};
const smsHandled = async (given) => {
    const ids = [...new Set([].concat(...given.map((id) => { const i = smsQueue.find((x) => x.id === id); return i ? (i.sourceIds || [id]).concat(id) : [id]; })))];
    const p = smsPrefs();
    p.seen = [...new Set(p.seen.concat(ids))];
    saveSmsPrefs(p);
    smsQueue = smsQueue.filter((i) => !ids.includes(i.id));
    const plugin = smsPlugin();
    if (plugin) { try { await plugin.clearHandled({ ids }); } catch (e) { /* ignore */ } }
    refreshBankStatus();
    if (smsQueue.length) renderSmsSheet(); else closeSheet('modal-sms');
};
// The account to use on confirm (null: ask first). Remembered for that bank and card number.
const smsChosenAccount = (i) => {
    const id = smsAccountFor(i);
    if (!id) return null;
    const key = smsLinkKey(i);
    if (key) { const p = smsPrefs(); p.links = { ...(p.links || {}), [key]: id }; saveSmsPrefs(p); }
    return id;
};
// "Which account?" for a message whose account isn't clear, then carry on with what was tapped.
let smsPick = null;
const askSmsAccount = (i, then) => {
    const { candidates } = smsAccountMatch(i);
    smsPick = { id: i.id, then };
    $('sms-pick-sub').textContent = `${i.bank}${i.last4 ? ` · ••${i.last4}` : ''} · ${formatCurrency(i.amount, i.currency)}${i.last4 ? '. Vela will remember it for this card or account.' : ''}`;
    $('sms-pick-list').innerHTML = (candidates.length ? candidates : state.accounts.map((a) => a.id)).map((id) => {
        const a = state.accounts.find((x) => x.id === id);
        return `<li class="acc-row"><button type="button" class="row-btn" data-sms-pick-acc="${escapeHtml(a.id)}">
            ${accountBadge(a, 'is-row', 'row-icon tint')}
            <span class="row-label"><span>${escapeHtml(a.name)}</span><span>${escapeHtml(ACCOUNT_KINDS[a.kind].label)}, ${a.currency}</span></span>
        </button></li>`;
    }).join('');
    swapSheet('modal-sms', 'modal-sms-pick');
};
const pickSmsAccount = (accId) => {
    const pick = smsPick;
    smsPick = null;
    const i = pick && smsQueue.find((x) => x.id === pick.id);
    if (!i || !state.accounts.some((a) => a.id === accId)) { closeSheet('modal-sms-pick'); return; }
    i.accountId = accId;
    swapSheet('modal-sms-pick', 'modal-sms');
    renderSmsSheet();
    pick.then();
};
// Adds one confirmed message. ATM withdrawals become a move from the bank account to Cash, so the cash
// isn't counted as spent twice (once when withdrawn, again when spent).
const smsCharged = {};
const smsForeignCharge = (i, acc) => {
    const typed = smsCharged[i.id];
    const est = fxCharge(i.amount, i.currency, acc);
    if (typed > 0 && Math.abs(typed - est) > 0.009) {
        const fee = learnFxFee(acc, i.amount, i.currency, typed);
        if (fee !== null) setTimeout(() => showToast(`Exact amount saved. Vela learned ${acc.name} takes about ${fee}% on foreign payments.`, 'success'), 700);
        return { amount: round2(typed), fx: { amount: i.amount, currency: i.currency, rate: convertAmount(1, i.currency, acc.currency), fee: fee === null ? fxFeeFor(acc) : fee, estimated: false } };
    }
    return { amount: est, fx: { amount: i.amount, currency: i.currency, rate: convertAmount(1, i.currency, acc.currency), fee: fxFeeFor(acc), estimated: !(typed > 0) } };
};
const smsApply = (i, accountId) => {
    if (i.type === 'cardpay' || i.type === 'reversal') return null; // never an entry of their own
    const note = `From ${i.bank} (${sourceShort(i.sources)})${i.fx ? ` · ${formatCurrency(i.fx.amount, i.fx.currency)}` : ''}`;
    if (i.type === 'atm') {
        const from = accountById(accountId);
        const hadWallet = !!cashWallet(from.id);
        const cash = ensureCashWallet(from.currency, from.id);
        if (!hadWallet) showToast('Made a "Cash" wallet: cash you take out is kept there', 'info');
        if (cash) {
            const record = { id: generateId(), type: 'transfer', desc: 'ATM withdrawal', amount: i.amount, currency: i.currency, accountId: from.id, toAccountId: cash.id, toAmount: round2(convertAmount(i.amount, i.currency, cash.currency)), toCurrency: cash.currency, category: 'Transfer', date: i.date, note: `From ${i.bank} (${sourceShort(i.sources)})`, createdAt: Date.now(), recurringId: null, receipt: null, bank: bankMeta(i) };
            if (cleanTime(i.time)) record.time = i.time;
            state.transactions.push(record);
            addBankFee(i, from, record.id);
            saveState();
            queueSync('transaction', record.id, 'upsert');
            renderActive();
            return record;
        }
        const rec = quickSaveTx({ type: 'expense', desc: 'ATM withdrawal', amount: i.amount, currency: i.currency, category: 'Other', date: i.date, accountId, note: `From ${i.bank} (${sourceShort(i.sources)})` });
        rec.bank = bankMeta(i);
        addBankFee(i, from, rec.id);
        saveState();
        queueSync('transaction', rec.id, 'upsert');
        return rec;
    }
    const replaced = replaceEstimatedFee(i, accountId);
    if (replaced) { setTimeout(() => showToast(`Bank charge updated to ${formatCurrency(replaced.amount, replaced.currency)} from the bank SMS`, 'success'), 300); return replaced; }
    const acc = state.accounts.find((a) => a.id === accountId);
    let amount = i.amount;
    let currency = i.currency;
    let fx = null;
    if (i.type === 'expense' && acc && fxApplies(acc)) {
        if (i.fx && i.currency === acc.currency) {
            // The bank wrote both amounts: exact, and it teaches Vela this bank's charge.
            fx = { amount: i.fx.amount, currency: i.fx.currency, fee: learnFxFee(acc, i.fx.amount, i.fx.currency, i.amount), estimated: false };
        } else if (i.currency !== acc.currency) {
            const c = smsForeignCharge(i, acc);
            fx = c.fx;
            amount = c.amount;
            currency = acc.currency;
        }
    }
    const rec = quickSaveTx({ type: i.type, desc: i.desc, amount, currency, category: i.category, date: i.date, time: i.time || (i.arrivedAt ? new Date(i.arrivedAt).toTimeString().slice(0, 5) : null), accountId, note });
    if (fx) rec.fx = fx;
    rec.pending = false; // it already happened: the bank says so
    rec.bank = bankMeta(i);
    if (i.feeKind === 'transfer' && acc) addBankFee(i, acc, rec.id);
    if (i.billRef) rec.billRef = i.billRef;
    const matched = settleExpectedWith(rec, i.refKeys || [], smsBillPick[i.id] || null);
    // The bill it paid didn't know its number yet: learn it, so next month's SMS finds it by itself.
    if (i.billRef && rec.recurringId) {
        const b = state.recurring.find((x) => x.id === rec.recurringId);
        if (b && !b.ref) { b.ref = i.billRef; queueSync('recurring', b.id, 'upsert', false); }
    }
    // Koko / Mintpay first part: the rest of the plan is expected every month.
    if (!matched && smsPartsPick[i.id] >= 2 && i.type === 'expense') {
        const plan = makePlan({ name: rec.desc, amount: rec.amount, currency: rec.currency, category: rec.category, accountId, firstDate: rec.date, count: smsPartsPick[i.id], done: 1 });
        if (plan) { rec.recurringId = plan.id; rec.note = [rec.note, `Part 1 of ${plan.parts.count}`].filter(Boolean).join(' · '); }
    }
    if (matched && rec.recurringId) { const b = state.recurring.find((x) => x.id === rec.recurringId); if (b && b.ref) rec.note = [rec.note, refLabel(b.ref)].filter(Boolean).join(' · '); }
    if (matched) setTimeout(() => showToast(`Matched to ${matched}: no longer waiting for it`, 'success'), 300);
    saveState();
    queueSync('transaction', rec.id, 'upsert');
    renderActive();
    return rec;
};
// Same type and amount as an expected payment due within two weeks either side: it's that payment, early or late.
const refDigits = (n) => { const d = String(n || '').replace(/\D/g, ''); return d.length >= 9 && /^(0|94|0094)?7\d{8}$/.test(d) ? d.slice(-9) : d; };
const billRefKey = (ref) => { const n = refDigits(ref); return n.length >= 6 ? hashToInt(n) : null; };
// "Phone 0771234567" for a mobile number, "Acc 1234567890" for any other account number.
const refLabel = (ref) => (/^(0|94|0094)?7\d{8}$/.test(String(ref || '').replace(/\D/g, '')) ? `Phone ${ref}` : `Acc ${ref}`);
const expectedMatchFor = (rec, refKeys = []) => {
    if (!rec || !(rec.type === 'income' || rec.type === 'expense')) return null;
    // A bill with its account number in the bank message (CEB account no.): that bill, whatever the amount.
    if (refKeys.length) {
        const byRef = state.recurring.find((b) => b.type === rec.type && b.ref && refKeys.includes(billRefKey(b.ref)));
        if (byRef) return { kind: 'bill', bill: byRef };
    }
    const near = (due) => Math.abs(daysBetween(parseDate(rec.date), parseDate(due))) <= 14;
    const same = (amt, cur) => Math.abs(toDisplay(amt, cur) - toDisplay(rec.amount, rec.currency)) <= Math.max(1, toDisplay(rec.amount, rec.currency) * 0.01);
    const bill = state.recurring.find((b) => (!b.autoLog || b.type === 'income') && b.type === rec.type && b.nextDate && near(b.nextDate) && same(billDue(b), b.currency)
        && (!b.accountId || b.accountId === rec.accountId));
    if (bill) return { kind: 'bill', bill };
    const tx = state.transactions.find((t) => t.id !== rec.id && t.pending && t.type === rec.type && near(t.date) && same(t.amount, t.currency) && (!t.accountId || t.accountId === rec.accountId));
    return tx ? { kind: 'tx', tx } : null;
};
const settleExpectedWith = (rec, refKeys = [], billId = null) => {
    const forced = billId && state.recurring.find((b) => b.id === billId);
    const m = forced ? { kind: 'bill', bill: forced } : billId === 'none' ? null : expectedMatchFor(rec, refKeys);
    if (!m) return null;
    if (m.kind === 'bill') {
        const b = m.bill;
        rec.recurringId = b.id;
        rec.dueDate = b.nextDate;
        rec.paidAt = new Date().toISOString();
        if (b.type === 'expense') rec.fixed = true;
        if (b.carry) { delete b.carry; delete b.carryFrom; }
        cancelPaymentReminders(`bill:${b.id}`);
        const due = b.nextDate;
        b.nextDate = advanceDate(b.nextDate, b.frequency, b.anchorDay);
        queueSync('recurring', b.id, 'upsert', false);
        if (notePart(b, rec)) endPlan(b);
        return `${b.name} (expected ${shortDate(due)})`;
    }
    const t = m.tx;
    state.transactions = state.transactions.filter((x) => x.id !== t.id);
    queueSync('transaction', t.id, 'delete', false);
    cancelPaymentReminders(`tx:${t.id}`);
    rec.dueDate = t.date;
    rec.paidAt = new Date().toISOString();
    return `${t.desc} (expected ${shortDate(t.date)})`;
};
const smsAdd = (id) => {
    const i = smsQueue.find((x) => x.id === id);
    if (!i) return;
    if (smsAlreadyRecorded(i)) { showToast('That transaction is already in Vela.', 'info'); smsHandled([id]); return; }
    const accountId = smsChosenAccount(i);
    if (!accountId) { askSmsAccount(i, () => smsAdd(id)); return; }
    if (!smsApply(i, accountId)) return;
    smsLearn(i, true); // read correctly: confirmed as it was
    showToast(i.type === 'atm' ? `${formatCurrency(i.amount, i.currency)} cash taken out: moved from ${(accountById(smsChosenAccount(i) || '') || {}).name || i.bank} to your Cash wallet` : `Added from ${i.bank}: ${formatCurrency(i.amount, i.currency)}`, 'success');
    smsHandled([id]);
};
const smsIgnore = (id) => smsHandled([id]);
const smsConfirmMatch = (id) => {
    const i = smsQueue.find((x) => x.id === id);
    const match = i && smsMatchFor(i);
    if (!match) { smsHandled([id]); return; }
    if (match.how === 'pay') {
        markPaid(match.pay.key);
        // The entry that payment created/confirmed is now bank-verified.
        const t = match.pay.kind === 'tx' ? state.transactions.find((x) => x.id === match.pay.id)
            : sortByNewest(state.transactions.filter((x) => x.recurringId === match.pay.id))[0];
        if (t) {
            t.bank = bankMeta(i);
            const acc = state.accounts.find((a) => a.id === (smsChosenAccount(i) || t.accountId));
            if (acc && i.currency !== t.currency && fxApplies(acc) && acc.currency === t.currency) {
                const c = smsForeignCharge(i, acc);
                t.amount = c.amount;
                t.fx = c.fx;
                t.accountId = acc.id;
                const bill = match.pay.kind === 'bill' && state.recurring.find((b) => b.id === match.pay.id);
                if (bill && !bill.parts && bill.currency === t.currency) { bill.amount = t.amount; queueSync('recurring', bill.id, 'upsert', false); }
                if (t.fx.estimated) setTimeout(() => showToast(`${t.desc}: ${formatCurrency(i.amount, i.currency)} ≈ ${formatCurrency(t.amount, t.currency)}. If your bank app shows a different amount, hold the entry and enter it once: Vela learns your bank's charge.`, 'info'), 700);
            } else if (i.currency === t.currency && Math.abs(i.amount - t.amount) > 0.004) t.amount = i.amount;
            if (i.time) t.time = i.time;
            saveState(); queueSync('transaction', t.id, 'upsert');
        }
    } else if (match.how === 'link') {
        match.tx.bank = bankMeta(i);
        saveState();
        queueSync('transaction', match.tx.id, 'upsert');
        showToast(`“${match.tx.desc}” is now bank-verified`, 'success');
    } else if (match.how === 'refund') {
        const t = match.tx;
        const back = round2(convertAmount(i.amount, i.currency, t.currency));
        if (back >= t.amount - 0.005) {
            if (t.receipt) removeReceipt(t.receipt);
            state.transactions = state.transactions.filter((x) => x.id !== t.id);
            queueSync('transaction', t.id, 'delete');
            showToast(`“${t.desc}” was fully refunded, so it's removed`, 'success');
        } else {
            t.amount = round2(t.amount - back);
            t.note = `${t.note ? `${t.note}\n` : ''}Refunded ${formatCurrency(i.amount, i.currency)} on ${i.date}`;
            queueSync('transaction', t.id, 'upsert');
            showToast(`“${t.desc}” lowered by the ${formatCurrency(i.amount, i.currency)} refund`, 'success');
        }
        saveState();
    } else if (match.how === 'reverse') {
        const t = match.tx;
        if (t.receipt) removeReceipt(t.receipt);
        state.transactions = state.transactions.filter((x) => x.id !== t.id);
        saveState();
        queueSync('transaction', t.id, 'delete');
        showToast(`Removed “${t.desc}”: the bank reversed it`, 'success');
    }
    smsLearn(i, true);
    renderActive();
    smsHandled([id]);
};
// Edit before adding: opens the normal form, filled in; saving it marks the message as done.
const smsEdit = (id, asMove = false) => {
    const i = smsQueue.find((x) => x.id === id);
    if (!i) return;
    const accountId = smsChosenAccount(i);
    if (!accountId) { askSmsAccount(i, () => smsEdit(id, asMove)); return; }
    // Money moved between two of the user's own accounts: a transfer, so it's neither income nor spending.
    if (asMove) {
        openTransfer();
        smsEditing = i;
        const other = state.accounts.find((a) => a.id !== accountId);
        // Money that came into the chosen account (a credit, or a payment landing on the card) moves from the other one.
        const into = i.type === 'income' || (i.type === 'cardpay' && i.cardSide !== 'from');
        $('transfer-from').value = into && other ? other.id : accountId;
        $('transfer-to').value = into ? accountId : (other ? other.id : accountId);
        $('transfer-amount').value = i.amount;
        $('transfer-date').value = i.date;
        $('transfer-note').value = i.desc;
        updateTransferFields();
        return;
    }
    if (i.type === 'atm') {
        openTransfer();
        smsEditing = i;
        $('transfer-from').value = accountId;
        const cash = state.accounts.find((a) => a.kind === 'cash' && a.id !== accountId);
        if (cash) $('transfer-to').value = cash.id;
        $('transfer-amount').value = i.amount;
        $('transfer-date').value = i.date;
        $('transfer-note').value = 'ATM withdrawal';
        updateTransferFields();
        return;
    }
    openAddTx(i.type === 'income' ? 'income' : 'expense');
    smsEditing = i;
    $('tx-account').value = accountId;
    fillCurrencySelect($('tx-currency'), i.currency);
    $('tx-amount').value = i.amount;
    $('tx-desc').value = i.desc;
    $('tx-date').value = i.date;
    $('tx-time').value = i.time || '';
    $('tx-note').value = `From ${i.bank} (${sourceShort(i.sources)})`;
    $('tx-billref').value = i.billRef || '';
    updateDescLogo();
    selectTxCategory(i.category);
    txCatTouched = true;
    updateDateHint();
};
// After the form saves an entry that came from a message.
const smsEditSaved = (record) => {
    if (!smsEditing || !record) return;
    const i = smsEditing;
    smsEditing = null;
    record.pending = false;
    record.bank = bankMeta(i);
    // Saved with the amount and date Vela read: the message was understood. Corrected: start learning that bank again.
    smsLearn(i, Math.abs(record.amount - i.amount) <= 0.005 && record.currency === i.currency && record.date === i.date);
    saveState();
    queueSync('transaction', record.id, 'upsert');
    smsHandled([i.id]);
};

const smsTake = (messages) => {
    const p = smsPrefs();
    const known = new Set(p.seen.concat(...smsQueue.map((i) => i.sourceIds || [i.id])));
    const fresh = [];
    const skipped = [];
    let touched = false;
    (messages || []).forEach((m) => {
        if (!m || known.has(String(m.id))) return;
        known.add(String(m.id));
        const i = parseBankSms(m);
        if (!i) { skipped.push(String(m.id)); return; }
        // The bank's rupee message for a dollar payment already in Vela as an estimate: now exact, not a new entry.
        if (settleRecordedFx(i)) { touched = true; skipped.push(i.id); return; }
        // The same pair while both still wait for review: one card, the rupees are what was taken.
        const fxPair = smsQueue.concat(fresh).find((w) => {
            const usd = w.currency !== i.currency ? (w.currency === 'LKR' ? i : w) : null;
            const lkr = usd === w ? i : w;
            return usd && fxPairFits(usd, lkr, fxAccFor(usd));
        });
        if (fxPair) {
            const usd = fxPair.currency !== 'LKR' ? fxPair : i;
            const lkr = usd === fxPair ? i : fxPair;
            if (usd === fxPair) { smsCharged[usd.id] = round2(lkr.amount); mergeDetection(fxPair, i); }
            else {
                // The rupee one came first: it becomes the dollar payment's card, with its exact amount.
                Object.assign(fxPair, { ...usd, id: fxPair.id, sources: fxPair.sources, sourceIds: fxPair.sourceIds, bodyKeys: fxPair.bodyKeys });
                smsCharged[fxPair.id] = round2(lkr.amount);
                mergeDetection(fxPair, i);
            }
            return;
        }
        // Already added to Vela (e.g. the SMS was confirmed, now the notification comes): note the source only.
        const rec = recordedMatch(i);
        if (rec) {
            const had = rec.bank.sources || ['sms'];
            const srcs = [...new Set(had.concat(i.sources))];
            if (srcs.length !== had.length) {
                rec.bank.sources = srcs;
                rec.bank.sourceIds = [...new Set((rec.bank.sourceIds || [rec.bank.smsId]).concat(i.id))];
                rec.bank.bodyKeys = [...new Set((rec.bank.bodyKeys || []).concat(i.bodyKeys))];
                if (!rec.bank.ref && i.ref) rec.bank.ref = i.ref;
                touched = true;
                queueSync('transaction', rec.id, 'upsert');
            }
            skipped.push(i.id);
            return;
        }
        // The same transaction already waiting for review: one entry, both sources.
        const waiting = smsQueue.concat(fresh);
        const same = waiting.filter((w) => sameDetection(w, i) === 'same');
        const maybe = waiting.filter((w) => sameDetection(w, i) === 'maybe');
        // A shared or pasted copy of text that's already waiting is never a new transaction, even if it matches more than one.
        const isCopy = i.sources.includes('shared') && same.some((w) => (w.bodyKeys || []).some((k) => i.bodyKeys.includes(k)));
        if (same.length === 1 || isCopy) { mergeDetection(same[0], i); return; }
        const likeRecorded = !same.length && state.transactions.some((tx) => tx.bank && sameDetection(i, recordedAsDetection(tx)) === 'maybe');
        if (same.length > 1 || maybe.length || likeRecorded) {
            i.checks.push('it may be the same as another detected transaction');
            i.confidence = 'medium';
        }
        fresh.push(i);
    });
    if (touched) { saveState(); renderActive(); }
    if (skipped.length) {
        const q = smsPrefs(); q.seen = [...new Set(q.seen.concat(skipped))]; saveSmsPrefs(q);
        const plugin = smsPlugin();
        if (plugin) plugin.clearHandled({ ids: skipped }).catch(() => {});
    }
    if (fresh.length) { const q = smsPrefs(); q.lastDetected = Date.now(); saveSmsPrefs(q); }
    fresh.sort((x, y) => (x.date < y.date ? 1 : -1));
    // Optional: confident detections with nothing to match are added straight away.
    if (p.autoAdd) {
        const auto = fresh.filter((i) => i.confidence === 'high' && i.type !== 'reversal' && i.type !== 'cardpay' && !smsMatchFor(i) && smsAccountFor(i));
        auto.forEach((i) => smsApply(i, smsAccountFor(i)));
        if (auto.length) {
            showToast(`Added ${plural(auto.length, 'bank transaction')} automatically`, 'success');
            const ids = [].concat(...auto.map((i) => i.sourceIds || [i.id]));
            const q = smsPrefs(); q.seen = [...new Set(q.seen.concat(ids))]; saveSmsPrefs(q);
            const plugin = smsPlugin();
            if (plugin) plugin.clearHandled({ ids }).catch(() => {});
        }
        smsQueue = smsQueue.concat(fresh.filter((i) => !auto.includes(i)));
        auto.forEach((i) => logNotif({ key: `added:${i.id}`, kind: 'added', title: `Added from ${i.bank}`, text: `${i.type === 'income' ? '+' : '−'}${formatCurrency(i.amount, i.currency)} · ${i.desc}` }));
        fresh.filter((i) => !auto.includes(i)).forEach((i) => logNotif({ key: `bank:${i.id}`, kind: 'bank', title: 'Bank transaction detected', text: `${formatCurrency(i.amount, i.currency)} · ${i.bank} · ${i.desc}` }));
        return fresh.length;
    }
    smsQueue = smsQueue.concat(fresh);
    fresh.forEach((i) => logNotif({ key: `bank:${i.id}`, kind: 'bank', title: 'Bank transaction detected', text: `${formatCurrency(i.amount, i.currency)} · ${i.bank} · ${i.desc}` }));
    return fresh.length;
};
// On start and whenever Vela comes back: messages that came while it was closed, plus the inbox since last time.
const scanSms = async (show = true) => {
    const plugin = smsPlugin();
    let added = 0;
    if (plugin) { try { added += smsTake((await plugin.getPending()).messages); } catch (e) { /* ignore */ } }
    const p = smsPrefs();
    if (plugin && p.enabled) {
        try {
            const since = p.since || Date.now() - 3 * 86400000;
            added += smsTake((await plugin.readInbox({ since, limit: 150 })).messages);
            const q = smsPrefs();
            q.since = Date.now();
            saveSmsPrefs(q);
        } catch (e) { /* permission removed */ }
    }
    const q2 = smsPrefs(); q2.lastSync = Date.now(); saveSmsPrefs(q2);
    if (show && smsQueue.length) showSmsSheet();
    refreshBankStatus();
    return added;
};
const enableSmsTracking = async (on) => {
    const plugin = smsPlugin();
    if (!plugin) { showToast('Reading bank SMS works in the Android app. Here you can paste a bank SMS instead.', 'info'); setSwitch($('switch-sms'), false); return; }
    if (on && bankStatus && bankStatus.smsAvailable === false) { setSwitch($('switch-sms'), false); showToast('This version can’t read SMS. Share or paste a bank SMS instead.', 'info'); return; }
    if (on) {
        let perm = 'prompt';
        try { perm = (await plugin.checkPermissions()).sms; } catch (e) { /* ignore */ }
        if (perm !== 'granted') {
            try { perm = (await plugin.requestPermissions({ permissions: ['sms'] })).sms; } catch (e) { perm = 'denied'; }
            const q = smsPrefs(); q.smsRequestedAt = Date.now(); saveSmsPrefs(q);
        }
        if (perm !== 'granted') {
            setSwitch($('switch-sms'), false);
            showSmsHelp();
            return;
        }
        const ln = nativePlugin('LocalNotifications');
        if (ln) await ensureNotifPermission(ln, true);
    }
    const p = smsPrefs();
    p.enabled = on;
    if (on && !p.since) p.since = Date.now() - 3 * 86400000; // also offer the last 3 days
    saveSmsPrefs(p);
    try { await plugin.setEnabled({ enabled: on }); } catch (e) { /* ignore */ }
    await refreshBankStatus();
    showToast(on ? 'SMS tracking is on. Vela asks before adding anything.' : 'SMS tracking is off', 'success');
    if (on) {
        const n = await scanSms();
        if (!n) showToast('No new bank transactions in the last 3 days.', 'info');
    }
};
// When Android won't give SMS access: say how to allow it, and offer sharing or pasting instead.
const showSmsHelp = () => showConfirm({
    title: 'SMS access is off',
    message: 'Android didn’t allow Vela to read SMS. To allow it: Android Settings > Apps > Vela > ⋮ (top right) > Allow restricted settings, then Permissions > SMS > Allow. You can also share a bank SMS to Vela from your Messages app, or paste one in Settings > Check a bank SMS.',
    confirmLabel: 'Paste a bank SMS',
    cancelLabel: 'OK',
    danger: false,
    onConfirm: () => openSmsPaste()
});
// Paste or share a bank SMS (works without SMS permission).
const openSmsPaste = () => {
    $('sms-paste-text').value = '';
    $('sms-paste-result').textContent = '';
    openOrSwap('modal-sms-paste');
};
const checkPastedSms = () => {
    const text = $('sms-paste-text').value.trim();
    if (!text) { fieldError($('sms-paste-text'), 'Paste the bank message here.'); return; }
    const msg = { id: `paste-${hashToInt(text)}`, address: 'Pasted', body: text, date: Date.now(), shared: true };
    const i = parseBankSms(msg);
    if (!i) { $('sms-paste-result').textContent = `This doesn’t look like a bank transaction (${smsLastReason}), so nothing will be added.`; return; }
    if (smsAlreadyRecorded(i)) { $('sms-paste-result').textContent = 'That transaction is already in Vela.'; return; }
    smsQueue = smsQueue.filter((x) => x.id !== i.id).concat(i);
    closeSheet('modal-sms-paste');
    setTimeout(showSmsSheet, 350);
};
// The real system bar sizes from Android (some WebViews report env(safe-area-inset-top) too large when edge to edge).
// style.css reads --safe-area-inset-* first, so setting them here fixes every screen at once.
const applyNativeInsets = async () => {
    const plugin = smsPlugin();
    if (!plugin || !plugin.insets) return;
    try {
        const i = await plugin.insets();
        const root = document.documentElement.style;
        ['top', 'right', 'bottom', 'left'].forEach((k) => { if (Number.isFinite(i[k])) root.setProperty(`--safe-area-inset-${k}`, `${Math.round(i[k] * 10) / 10}px`); });
    } catch (e) { /* the page keeps using env() */ }
};
const initSms = () => {
    const plugin = smsPlugin();
    if (!plugin) return;
    applyNativeInsets();
    setTimeout(applyNativeInsets, 600);
    window.addEventListener('resize', () => setTimeout(applyNativeInsets, 120));
    plugin.addListener('smsReceived', (m) => { const n = smsTake([m]); if (n) haptic('MEDIUM'); if (smsQueue.length) showSmsSheet(); refreshBankStatus(); });
    // Tapped "Bank transaction detected": open the review screen once the app is ready.
    // "Add" on the notification: add that one straight away (the person saw the amount and bank and chose Add);
    // anything that needs a decision (a possible repeat, a card payment, a reversal) opens the review instead.
    plugin.addListener('reviewRequested', async (e) => {
        await splashDone;
        const add = !!(e && e.add);
        await scanSms(!add);
        if (add) {
            const i = smsQueue.find((x) => x.id === e.id || (x.sourceIds || []).includes(e.id));
            const direct = i && (i.type === 'expense' || i.type === 'income' || i.type === 'atm') && !smsMatchFor(i)
                && !i.checks.some((c) => /same as another/.test(c)) && !!smsAccountFor(i);
            if (direct) smsAdd(i.id);
            if (smsQueue.length) showSmsSheet();
            if (!i && !smsQueue.length) showToast('That transaction was already added or ignored.', 'info');
            return;
        }
        if (!smsQueue.length) showToast('That transaction was already added or ignored.', 'info');
    });
    if (smsPrefs().enabled) plugin.setEnabled({ enabled: true }).catch(() => {});
    setTimeout(scanSms, 1800);
};


/* ---- Settings > Bank connections: real status from Android, one control per connection ---- */
let bankStatus = null; // last answer from the phone (null on the web)
const agoLabel = (ms) => {
    if (!ms) return '';
    const min = Math.round((Date.now() - ms) / 60000);
    if (min < 1) return 'Just now';
    if (min < 60) return `${min} min ago`;
    if (min < 24 * 60) return `${Math.round(min / 60)} h ago`;
    return shortDate(toISODate(new Date(ms)));
};
// Android's "Restricted setting" for apps not installed from an app store: numbered unlock steps. Android only
// offers "Allow restricted settings" after one blocked attempt, so step 1 is marked done once Vela has asked.
const smsRestrictedHelp = (s) => {
    const tried = (s.smsRequestedAt || smsPrefs().smsRequestedAt || 0) > 0;
    const step = (n, done, html) => `<li class="bank-step${done ? ' is-done' : ''}"><span class="bank-step-n">${done ? '✓' : n}</span><span>${html}</span></li>`;
    return `<span><strong>Android blocks SMS access for Vela because it wasn't installed from Google Play</strong> (a “Restricted setting”). Vela can't change this for you, but you can allow it once:</span>
        <ol class="bank-steps">
            ${step(1, tried, 'Switch <em>SMS tracking</em> on here. When Android says <em>App was denied access</em>, tap <em>Close</em>. This makes the next option appear.')}
            ${step(2, false, 'Tap <em>Open App info</em>, then <em>⋮</em> (top right) › <em>Allow restricted settings</em>, and confirm with your PIN or fingerprint.')}
            ${step(3, false, 'Still in App info: <em>Permissions</em> › <em>SMS</em> › <em>Allow</em>. Come back and tap <em>Check again</em>.')}
        </ol>
        <span class="bank-step-btns"><button type="button" class="btn btn-secondary btn-sm" data-bank-fix="app">Open App info</button><button type="button" class="btn btn-ghost btn-sm" data-bank-fix="check">Check again</button></span>`;
};
// SMS: Connected only when it's on, not paused, and Android has granted the SMS permission.
const smsConnState = (s) => {
    if (!s || !s.smsEnabled) return { state: 'off', text: 'Off' };
    if (s.paused) return { state: 'paused', text: 'Paused' };
    if (s.smsPermission !== 'granted' && s.restrictedSettings === 'restricted') return { state: 'warn', text: 'Blocked by Android: restricted setting', help: smsRestrictedHelp(s) };
    if (s.smsPermission !== 'granted') {
        return { state: 'warn', text: 'Not allowed yet', help: `<span><strong>Vela doesn’t have SMS access yet.</strong> Allow it in App info › <em>Permissions</em> › <em>SMS</em>. If it’s greyed out, tap <em>⋮</em> (top right) › <em>Allow restricted settings</em> first.</span><span class="bank-step-btns"><button type="button" class="btn btn-secondary btn-sm" data-bank-fix="app">Open App info</button><button type="button" class="btn btn-ghost btn-sm" data-bank-fix="check">Check again</button></span>` };
    }
    return { state: 'on', text: 'Connected' };
};
// Bank / Passbook app notifications: Connected only when Android lists Vela in Notification access, the listener is
// running, and at least one bank app is picked.
const ntfRestrictedHelp = (s) => {
    const tried = (s.notifRequestedAt || 0) > 0;
    const step = (n, done, html) => `<li class="bank-step${done ? ' is-done' : ''}"><span class="bank-step-n">${done ? '✓' : n}</span><span>${html}</span></li>`;
    return `<span><strong>Android blocks notification access for Vela because it wasn't installed from Google Play</strong> (a “Restricted setting”). Vela can't change this for you, but you can allow it once:</span>
        <ol class="bank-steps">
            ${step(1, tried, 'Tap <em>Open Notification access</em>, tap <em>Vela</em> and try to switch it on. Android says it’s restricted: tap <em>OK</em>. This makes the next option appear.')}
            ${step(2, false, 'Tap <em>Open App info</em>, then <em>⋮</em> (top right) › <em>Allow restricted settings</em>, and confirm with your PIN or fingerprint.')}
            ${step(3, false, 'Come back, tap <em>Open Notification access</em> again, switch on <em>Vela</em> and tap <em>Allow</em>.')}
        </ol>
        <span class="bank-step-btns"><button type="button" class="btn btn-secondary btn-sm" data-bank-fix="ntf">Open Notification access</button><button type="button" class="btn btn-secondary btn-sm" data-bank-fix="app">Open App info</button><button type="button" class="btn btn-ghost btn-sm" data-bank-fix="check">Check again</button></span>`;
};
const ntfConnState = (s) => {
    if (!s || !s.notifEnabled) return { state: 'off', text: 'Off' };
    if (s.paused) return { state: 'paused', text: 'Paused' };
    if (s.notifState === 'restricted') return { state: 'warn', text: 'Blocked by Android: restricted setting', help: ntfRestrictedHelp(s) };
    if (s.notifState === 'not_requested' || s.notifState === 'not_granted') {
        return { state: 'warn', text: 'Not allowed yet', help: `<span><strong>Vela doesn’t have notification access yet.</strong> Open Notification access and switch on Vela. This is different from Vela’s own notifications.</span><span class="bank-step-btns"><button type="button" class="btn btn-secondary btn-sm" data-bank-fix="ntf">Open Notification access</button><button type="button" class="btn btn-ghost btn-sm" data-bank-fix="check">Check again</button></span>` };
    }
    if (!s.listenerConnected) {
        return { state: 'warn', text: 'Android stopped it', help: `<span><strong>Access is allowed but Android isn't running Vela's listener.</strong> Turn Vela off and on in Notification access, and set Vela's battery use to <em>Unrestricted</em>.</span><span class="bank-step-btns"><button type="button" class="btn btn-secondary btn-sm" data-bank-fix="ntf">Open Notification access</button><button type="button" class="btn btn-ghost btn-sm" data-bank-fix="check">Check again</button></span>` };
    }
    const apps = s.apps || [];
    if (!apps.length) return { state: 'warn', text: 'No bank app found', help: '<span><strong>No bank or Passbook app was found on this phone.</strong> Install your bank’s app (for example ComBank ePassbook), sign in and turn on its transaction alerts.</span>' };
    if (!apps.some((a) => a.selected)) return { state: 'warn', text: 'Pick a bank app', help: '<span>Tap the bank apps below that Vela should read.</span>' };
    if (s.hiddenAt && s.hiddenAt > (s.lastDetected || 0)) {
        return { state: 'warn', text: 'Connected, but content hidden', help: '<span><strong>A bank app notification had its content hidden</strong>, so Vela couldn’t read it. Allow the bank app to show full notification content (Android Settings › Notifications), and keep its transaction alerts on.</span>' };
    }
    return { state: 'on', text: 'Connected' };
};
const renderBankConnections = () => {
    const plugin = smsPlugin();
    const p = smsPrefs();
    const s = bankStatus;
    // The standard and Google Play editions leave SMS out (Play Protect blocks it for apps installed from WhatsApp
    // or a browser, and Google Play only allows it after approval): explain sharing instead of a switch that can't work.
    const noSms = !!(s && s.smsAvailable === false);
    const noNtf = !s || s.notifAvailable === false;
    const shareOnly = !plugin || (noSms && noNtf);
    $('bank-web-note').hidden = !shareOnly;
    $('bank-web-note').innerHTML = !plugin
        ? 'Automatic SMS detection works in the Vela Android app. Here you can paste a bank SMS to add it.'
        : 'This version of Vela doesn’t read SMS by itself (Google blocks SMS access for apps installed from WhatsApp, a browser or Google Play without approval). Add ComBank transactions by <strong>sharing a bank SMS to Vela</strong> from your Messages app, or tap <strong>Check a bank SMS</strong>. Automatic detection needs <strong>Vela Full</strong>.';
    $('bank-conns').hidden = shareOnly;
    $('bank-options').hidden = shareOnly;
    $('btn-bank-disconnect').hidden = shareOnly;
    const sms = noSms ? { state: 'off', text: 'Not in this version' } : smsConnState(s);
    const ntf = noNtf ? { state: 'off', text: 'Not in this version' } : ntfConnState(s);
    setSwitch($('switch-sms'), !noSms && !!(s ? s.smsEnabled : p.enabled));
    setSwitch($('switch-ntf'), !noNtf && !!(s && s.notifEnabled));
    $('switch-sms').disabled = noSms;
    $('switch-ntf').disabled = noNtf;
    $('bank-ntf-state').dataset.state = ntf.state;
    $('bank-ntf-state').textContent = ntf.text;
    $('bank-ntf-help').hidden = !ntf.help;
    $('bank-ntf-help').innerHTML = ntf.help || '';
    $('bank-apps').innerHTML = s && s.notifEnabled ? (s.apps || []).map((a) => `<button type="button" class="chip" data-bank-app="${escapeHtml(a.pkg)}" aria-pressed="${!!a.selected}">${a.selected ? icon('i-check', 'ic ic-sm') : ''}${escapeHtml(a.name)}</button>`).join('') : '';
    setSwitch($('switch-bank-pause'), !!(s ? s.paused : p.paused));
    setSwitch($('switch-sms-auto'), p.autoAdd);
    $('bank-sms-state').dataset.state = sms.state;
    $('bank-sms-state').textContent = sms.text;
    $('bank-sms-help').hidden = !sms.help;
    $('bank-sms-help').innerHTML = sms.help || '';
    const overall = !plugin ? { state: 'off', text: 'Android only' } : noSms ? { state: 'off', text: 'Share & paste' } : (s && s.paused) ? { state: 'paused', text: 'Paused' }
        : [sms, ntf].some((c) => c.state === 'on') ? { state: 'on', text: sms.state === 'on' && ntf.state === 'on' ? 'SMS + apps' : 'Connected' } : [sms, ntf].some((c) => c.state === 'warn') ? { state: 'warn', text: 'Needs attention' } : { state: 'off', text: 'Not connected' };
    $('bank-overall').dataset.state = overall.state;
    $('bank-overall').textContent = overall.text;
    const last = Math.max(p.lastDetected || 0, (s && s.lastDetected) || 0);
    $('bank-last').textContent = last ? agoLabel(last) : 'Nothing yet';
    $('bank-sync').textContent = p.lastSync ? agoLabel(p.lastSync) : 'Not yet';
    const waiting = smsQueue.length;
    $('bank-pending').textContent = String(waiting);
    $('btn-bank-review').hidden = !waiting;
    $('btn-bank-review').textContent = `Review ${plural(waiting, 'transaction')}`;
    $('sms-auto-row').hidden = shareOnly;
    const warnNotif = s && (s.smsEnabled || s.notifEnabled) && !s.postNotifications;
    $('bank-notif-warn').hidden = !warnNotif;
    $('bank-sub').textContent = warnNotif ? 'Vela’s notifications are off: you’ll see new transactions when you open Vela.' : 'All banks: bank SMS and bank / Passbook app alerts';
    // Every bank Vela knows by name, with its logo; other named banks and cards are read too, with a review.
    $('bank-chips').innerHTML = SMS_BANKS.map((b) => {
        const br = BRANDS.find((x) => x.slug === b.logo);
        return `<span class="bank-chip" title="${escapeHtml(b.name)}">${br ? brandBadge(br, ' is-mini') : ''}<span>${escapeHtml(b.short)}</span></span>`;
    }).join('') + '<span class="bank-chip is-more">+ other banks and cards</span>';
};
const enableNotifTracking = async (on) => {
    const plugin = smsPlugin();
    if (!plugin || !plugin.setNotifTracking) return;
    const s = (await refreshBankStatus()) || {};
    if (!on) {
        await plugin.setNotifTracking({ enabled: false, apps: (s.apps || []).filter((a) => a.selected).map((a) => a.pkg) });
        await refreshBankStatus();
        if (s.notifAccess) {
            showConfirm({ title: 'Bank app tracking is off', message: 'Vela has stopped reading bank app notifications. SMS tracking is not changed. To remove the access completely, also turn Vela off in Android’s Notification access.', confirmLabel: 'Open Notification access', cancelLabel: 'Done', danger: false, onConfirm: () => plugin.openNotificationAccess().catch(() => {}) });
        } else showToast('Bank app tracking is off. SMS tracking is not changed.', 'success');
        return;
    }
    if (s.notifAvailable === false) { setSwitch($('switch-ntf'), false); showToast('This version can’t read bank app notifications.', 'info'); return; }
    const found = s.apps || [];
    if (!found.length) {
        setSwitch($('switch-ntf'), false);
        showConfirm({ title: 'No bank app found', message: 'Vela reads transaction alerts from your bank’s own app, such as ComBank ePassbook, ComBank Digital, BOC Smart Passbook or Sampath Vishwa. Install one, sign in and turn on its transaction alerts, then come back here.', confirmLabel: 'OK', cancelLabel: 'Close', danger: false, onConfirm: () => {} });
        return;
    }
    setSwitch($('switch-ntf'), false);
    showConfirm({
        title: 'Read your bank apps’ transaction alerts?',
        message: `Android will ask you to give Vela “Notification access”. With it, Android lets an app see the notifications on your phone, so only allow it if you’re comfortable.\n\nWhat Vela does with it: it reads notifications from ${found.map((a) => a.name).join(', ')} only (you can untick any of them), ignores every other app and any codes, OTPs or login alerts, keeps only what’s needed for a transaction, encrypted on this phone, and never sends it anywhere. SMS tracking keeps working as before; when the SMS and the app report the same payment, Vela adds it once.\n\nNext: in the screen that opens, turn on Vela.`,
        confirmLabel: 'I agree, open settings',
        cancelLabel: 'Not now',
        danger: false,
        onConfirm: async () => {
            await plugin.setNotifTracking({ enabled: true, apps: found.map((a) => a.pkg) });
            const p = smsPrefs(); p.notifConsentAt = Date.now(); saveSmsPrefs(p);
            const ln = nativePlugin('LocalNotifications');
            if (ln) await ensureNotifPermission(ln, true);
            await refreshBankStatus();
            if (!s.notifAccess) plugin.openNotificationAccess().catch(() => showToast('Open Android Settings › Notifications › Notification access (Device & app notifications), and turn on Vela.', 'info'));
            else { showToast('Bank app tracking is on', 'success'); scanSms(); }
        }
    });
};
const toggleBankApp = async (pkg) => {
    const plugin = smsPlugin();
    const s = bankStatus;
    if (!plugin || !s) return;
    const apps = (s.apps || []).filter((a) => (a.pkg === pkg ? !a.selected : a.selected)).map((a) => a.pkg);
    if (!apps.length) { showToast('Keep at least one bank app, or turn bank app tracking off.', 'info'); return; }
    await plugin.setNotifTracking({ enabled: true, apps });
    refreshBankStatus();
};
// Asks the phone for the real state (SMS permission, restricted setting) and redraws.
const refreshBankStatus = async () => {
    const plugin = smsPlugin();
    if (plugin && plugin.status) {
        try { bankStatus = await plugin.status(); } catch (e) { bankStatus = null; }
    } else bankStatus = null;
    if ($('bank-card')) renderBankConnections();
    return bankStatus;
};
const setBankPaused = async (paused) => {
    const plugin = smsPlugin();
    if (!plugin) return;
    await plugin.setPaused({ paused });
    const p = smsPrefs(); p.paused = paused; saveSmsPrefs(p);
    await refreshBankStatus();
    showToast(paused ? 'Bank tracking paused' : 'Bank tracking resumed', 'success');
    if (!paused) scanSms();
};
// Removes what's waiting for review and the message details kept on added entries (amounts and dates stay).
const deleteDetectionRecords = () => showConfirm({
    title: 'Delete detection records?',
    message: 'This deletes every bank transaction waiting for review and the bank details kept on entries you added (reference, card digits, where it was detected). The entries themselves and your balances stay.',
    confirmLabel: 'Delete records',
    danger: true,
    onConfirm: async () => {
        const plugin = smsPlugin();
        if (plugin) { try { await plugin.deleteDetections(); } catch (e) { /* ignore */ } }
        smsQueue = [];
        state.transactions.forEach((t) => {
            if (!t.bank) return;
            t.bank = { bank: t.bank.bank, sources: t.bank.sources, verifiedAt: t.bank.verifiedAt };
            queueSync('transaction', t.id, 'upsert');
        });
        saveState();
        renderActive();
        refreshBankStatus();
        showToast('Detection records deleted', 'success');
    }
});
const disconnectBank = () => showConfirm({
    title: 'Turn off bank tracking?',
    message: 'Vela stops reading bank SMS and bank app notifications, and deletes everything waiting for review. Transactions you already added stay. To remove Android access too: App info › Permissions › SMS › Don’t allow, and turn Vela off in Notification access.',
    confirmLabel: 'Disconnect',
    danger: true,
    onConfirm: async () => {
        const plugin = smsPlugin();
        if (plugin) { try { await plugin.disconnect(); } catch (e) { /* ignore */ } }
        const p = smsPrefs();
        Object.assign(p, { enabled: false, paused: false, autoAdd: false });
        saveSmsPrefs(p);
        smsQueue = [];
        closeSheet('modal-sms');
        await refreshBankStatus();
        showToast('Bank SMS tracking is off', 'success');
    }
});

/* ---- Payments: entries waiting to be paid, and fixed expenses you pay yourself ---- */
// view: only the account being shown (the screens); without it every account (reminders, matching bank SMS).
const paymentItems = ({ horizonDays = 7, view = false } = {}) => {
    const horizon = toISODate(addDays(new Date(), horizonDays));
    const items = [];
    (view ? viewTx() : state.transactions).filter((t) => t.pending && t.type !== 'transfer').forEach((t) => items.push({
        key: `tx:${t.id}`, kind: 'tx', id: t.id, name: t.desc, type: t.type, amount: t.amount, currency: t.currency, category: t.category, due: t.date, status: payStatus(t.date)
    }));
    (view ? viewBills() : state.recurring).filter((b) => !b.autoLog).forEach((b) => items.push({
        key: `bill:${b.id}`, kind: 'bill', id: b.id, name: b.parts ? `${b.name} (${b.parts.done + 1}/${b.parts.count})` : b.name, type: b.type, amount: billDue(b), carry: b.carry || 0, carryFrom: b.carryFrom || null, currency: b.currency, category: b.category, due: b.nextDate, status: payStatus(b.nextDate)
    }));
    return items.filter((i) => i.status !== 'upcoming' || i.due <= horizon).sort((a, b) => (a.due > b.due ? 1 : a.due < b.due ? -1 : 0));
};
const paymentByKey = (key) => paymentItems({ horizonDays: 36500 }).find((i) => i.key === key);
const reminderIdsFor = (key) => [hashToInt(`soon:${key}`), hashToInt(`due:${key}`), hashToInt(`late:${key}`)];
// Once a payment is paid, its reminders go away (and only then).
const cancelPaymentReminders = (key) => {
    const ln = nativePlugin('LocalNotifications');
    if (!ln) return;
    try { Promise.resolve(ln.cancel({ notifications: reminderIdsFor(key).concat(key.startsWith('tx:') ? [pendingNotifId(key.slice(3))] : []).map((id) => ({ id })) })).catch(() => {}); } catch (e) { /* ignore */ }
};
let markPaidKey = null;
const askMarkPaid = (key) => {
    const i = paymentByKey(key);
    if (!i) return;
    const income = i.type === 'income';
    const bill = i.kind === 'bill' ? state.recurring.find((b) => b.id === i.id) : null;
    if (bill) {
        markPaidKey = key;
        $('mark-paid-title').textContent = income ? `Has ${i.name} arrived?` : `Have you paid ${i.name}?`;
        $('mark-paid-sub').textContent = `${formatDisplay(i.amount, i.currency)} ${income ? 'expected' : 'due'} ${shortDate(i.due)}. It is recorded today and counted in your balance.`;
        const opts = [1, 2, 3, 6, 12].filter((n) => n === 1 || bill.frequency !== 'yearly' || n <= 3);
        $('mark-paid-options').innerHTML = opts.map((n) => {
            let next = bill.nextDate;
            for (let k = 0; k < n; k++) next = advanceDate(next, bill.frequency, bill.anchorDay);
            const total = round2(billDue(bill) + bill.amount * (n - 1));
            const label = n === 1 ? 'This time only' : n === 2 ? 'This time and next time' : `${n} times ahead`;
            return `<button type="button" class="row-btn" data-mark-times="${n}"><span class="row-icon tint">${icon(n === 1 ? 'i-check' : 'i-repeat')}</span><span class="row-label"><span>${label}</span><span>${n === 1 ? `Next one ${shortDate(next)}` : `Nothing more until ${shortDate(next)}`}</span></span><span class="amount ${income ? 'text-income' : ''}">${escapeHtml(formatDisplay(total, i.currency))}</span></button>`;
        }).join('');
        openOrSwap('modal-mark-paid');
        return;
    }
    showConfirm({
        title: income ? 'Has this money arrived?' : 'Have you completed this payment?',
        message: `${i.name} · ${formatDisplay(i.amount, i.currency)} · ${i.status === 'overdue' ? 'was due' : 'due'} ${shortDate(i.due)}. It will be recorded as ${income ? 'received' : 'paid'} today and counted in your balance.`,
        confirmLabel: income ? 'Yes, mark as received' : 'Yes, mark as paid',
        cancelLabel: 'Not yet',
        danger: false,
        onConfirm: () => markPaid(key)
    });
};
let payLaterKey = null;
const openPayLater = (key) => {
    const i = paymentByKey(key);
    if (!i) return;
    payLaterKey = key;
    const income = i.type === 'income';
    const bill = i.kind === 'bill' ? state.recurring.find((b) => b.id === i.id) : null;
    $('pay-later-title').textContent = `${i.name}: not this time`;
    $('pay-later-sub').textContent = `${formatDisplay(i.amount, i.currency)} ${income ? 'expected' : 'due'} ${shortDate(i.due)}.`;
    if (bill) {
        const next = advanceDate(bill.nextDate, bill.frequency, bill.anchorDay);
        $('pay-later-carry-text').textContent = `${income ? 'Paid' : 'Pay'} next time, together`;
        $('pay-later-carry-desc').textContent = `${shortDate(next)}: ${formatDisplay(billDue(bill) + bill.amount, bill.currency)} (this time's ${formatDisplay(billDue(bill), bill.currency)} + ${formatDisplay(bill.amount, bill.currency)}), then ${formatDisplay(bill.amount, bill.currency)} again.`;
        $('pay-later-skip-desc').textContent = `Nothing ${income ? 'comes in' : 'is paid'} this time; next ${shortDate(next)} is ${formatDisplay(bill.amount, bill.currency)}.`;
    }
    $('pay-later-carry').hidden = !bill;
    $('pay-later-skip').hidden = !bill;
    $('pay-later-move').hidden = !!bill;
    $('pay-later-move-desc').textContent = bill ? '' : `It waits until ${shortDate(toISODate(addMonthsSafe(parseDate(i.due), 1)))} instead.`;
    openOrSwap('modal-pay-later');
};
const addMonthsSafe = (d, n) => { const day = d.getDate(); const x = new Date(d.getFullYear(), d.getMonth() + n, 1); x.setDate(Math.min(day, daysInMonth(x.getFullYear(), x.getMonth()))); return x; };
const payLater = (how) => {
    const key = payLaterKey;
    const i = key && paymentByKey(key);
    if (!i) return;
    if (i.kind === 'bill') {
        const bill = state.recurring.find((b) => b.id === i.id);
        if (!bill) return;
        const thisTime = billDue(bill);
        const from = bill.carryFrom || bill.nextDate;
        bill.nextDate = advanceDate(bill.nextDate, bill.frequency, bill.anchorDay);
        if (how === 'carry') { bill.carry = round2(thisTime); bill.carryFrom = from; } else { delete bill.carry; delete bill.carryFrom; }
        if (!commitState('That')) return;
        queueSync('recurring', bill.id, 'upsert');
        cancelPaymentReminders(key);
        showToast(how === 'carry' ? `Next time (${shortDate(bill.nextDate)}): ${formatDisplay(billDue(bill), bill.currency)} together` : `Skipped. Next: ${formatDisplay(bill.amount, bill.currency)} on ${shortDate(bill.nextDate)}`, 'success');
    } else {
        const t = state.transactions.find((x) => x.id === i.id);
        if (!t) return;
        t.date = toISODate(addMonthsSafe(parseDate(t.date), 1));
        if (!commitState('That')) return;
        queueSync('transaction', t.id, 'upsert');
        cancelPaymentReminders(key);
        showToast(`Moved to ${shortDate(t.date)}`, 'success');
    }
    payLaterKey = null;
    closeSheet('modal-pay-later');
    scheduleReminders();
    renderActive();
};
const markPaid = (key) => {
    if (key.startsWith('tx:')) confirmTx(key.slice(3));
    else if (key.startsWith('bill:')) markBillPaid(key.slice(5));
    scheduleReminders();
};
const paymentRowHtml = (i) => {
    const income = i.type === 'income';
    const when = i.status === 'overdue' ? `${income ? 'Expected' : 'Was due'} ${shortDate(i.due)}` : i.status === 'due' ? (income ? 'Expected today' : 'Due today') : `${income ? 'Expected' : 'Due'} ${shortDate(i.due)}`;
    return `<li class="pay-row" data-status="${i.status}">
        ${entryBadge(i.name, i.category, i.type)}
        <div class="pay-main"><span class="pay-name">${escapeHtml(i.name)}</span><span class="pay-meta"><span class="pay-pill" data-status="${i.status}">${payStatusLabel(i.status, i.type)}</span>${escapeHtml(when)}</span>${i.carry ? `<span class="pay-carry">Includes ${escapeHtml(formatDisplay(i.carry, i.currency))} from ${escapeHtml(i.carryFrom ? shortDate(i.carryFrom) : 'last time')}</span>` : ''}</div>
        <div class="pay-end"><span class="amount ${income ? 'text-income' : ''}">${escapeHtml(formatDisplay(i.amount, i.currency))}</span>${origNote(i.amount, i.currency)}
        <button type="button" class="btn btn-xs ${income ? 'btn-income' : 'btn-primary'}" data-pay="${escapeHtml(i.key)}">${income ? 'Mark received' : 'Mark as paid'}</button>
        <button type="button" class="link-btn pay-later-btn" data-pay-later="${escapeHtml(i.key)}">Not this time</button></div>
    </li>`;
};
const paymentSummary = (items) => {
    const n = (s) => items.filter((i) => i.status === s).length;
    return [n('overdue') ? `${n('overdue')} overdue` : '', n('due') ? `${n('due')} due today` : '', n('upcoming') ? `${n('upcoming')} upcoming` : ''].filter(Boolean).join(' · ');
};
const renderPaymentsHome = () => {
    const items = paymentItems({ view: true });
    const day = todayISO();
    paymentItems().filter((i) => i.status === 'due' || i.status === 'overdue').forEach((i) => logNotif({
        key: `pay:${i.key}:${day}`, kind: i.status === 'overdue' ? 'late' : 'due',
        title: i.status === 'overdue' ? (i.type === 'income' ? `${i.name} is late` : `${i.name} is overdue`) : (i.type === 'income' ? `${i.name} expected today` : `${i.name} is due today`),
        text: `${formatDisplay(i.amount, i.currency)} · ${i.status === 'overdue' ? 'was due' : 'due'} ${shortDate(i.due)}`
    }));
    const autoSoon = viewBills().filter((b) => b.autoLog && b.type === 'expense' && b.nextDate <= toISODate(addDays(new Date(), 7))).sort((a, b) => (a.nextDate > b.nextDate ? 1 : -1));
    $('due-section').hidden = !items.length && !autoSoon.length;
    const worst = items.some((i) => i.status === 'overdue') ? 'overdue' : items.some((i) => i.status === 'due') ? 'due' : 'upcoming';
    $('pay-summary').textContent = items.length ? paymentSummary(items) : 'Nothing to pay by hand';
    $('pay-summary').dataset.status = items.length ? worst : 'ok';
    const shown = items.slice(0, 4);
    $('due-list').innerHTML = `${shown.length ? `<ul class="pay-list">${shown.map(paymentRowHtml).join('')}</ul>` : ''}
        ${items.length > shown.length ? `<button type="button" class="link-btn pay-more" data-status-filter="unpaid">See all ${items.length} unpaid payments</button>` : ''}
        ${autoSoon.length ? `<p class="pay-auto">${icon('i-repeat', 'ic ic-sm')} Logs itself: ${autoSoon.map((b) => `${escapeHtml(b.name)} ${escapeHtml(dueLabel(b.nextDate).text.toLowerCase())}`).join(' · ')}</p>` : ''}`;
};
// When Vela opens with payments due today or overdue: a pop-up listing them (once per opening).
let payPopupShownAt = 0;
const showPaymentsPopup = async () => {
    await splashDone;
    if (Date.now() - payPopupShownAt < 30 * 60000) return;
    if (isLocked()) { setTimeout(showPaymentsPopup, 1500); return; }
    if (openSheets.length || isConfirmOpen()) return;
    const items = paymentItems({ view: true }).filter((i) => i.status !== 'upcoming');
    if (!items.length) return;
    payPopupShownAt = Date.now();
    $('pay-popup-sub').textContent = paymentSummary(items);
    $('pay-popup-list').innerHTML = items.map(paymentRowHtml).join('');
    openOrSwap('modal-payments');
};

/* ---- Confirming money that was waiting ---- */
const pendingNotifId = (id) => hashToInt(`p-${id}`);
const confirmTx = (id) => {
    const t = state.transactions.find((x) => x.id === id);
    if (!t || !t.pending) return;
    t.pending = false;
    // Paid on the day it was really paid; the original due date is kept for the record.
    t.dueDate = t.dueDate || t.date;
    t.date = todayISO();
    t.paidAt = new Date().toISOString();
    saveState();
    haptic('MEDIUM');
    queueSync('transaction', t.id, 'upsert');
    const ln = nativePlugin('LocalNotifications');
    // Remove its lasting reminders; a failure here must not stop the confirmation.
    if (ln) cancelPaymentReminders(`tx:${t.id}`);
    if (isSheetOpen('modal-payments')) refreshPaymentsPopup();
    showToast(`${t.desc} ${t.type === 'income' ? 'received' : 'paid'}: ${formatCurrency(t.amount, t.currency)} now counts in ${accountById(t.accountId).name}`, 'success');
    renderActive();
};
const refreshPaymentsPopup = () => {
    const items = paymentItems({ view: true }).filter((i) => i.status !== 'upcoming');
    if (!items.length) { closeSheet('modal-payments'); return; }
    $('pay-popup-sub').textContent = paymentSummary(items);
    $('pay-popup-list').innerHTML = items.map(paymentRowHtml).join('');
};
const askConfirmTx = (id) => {
    const t = state.transactions.find((x) => x.id === id);
    if (!t || !t.pending) return;
    showConfirm({
        title: t.type === 'income' ? `Did ${t.desc} arrive?` : `Did you pay ${t.desc}?`,
        message: `${formatCurrency(t.amount, t.currency)} ${t.type === 'income' ? 'into' : 'from'} ${accountById(t.accountId).name}. It counts in your balance once you confirm.`,
        confirmLabel: t.type === 'income' ? 'Yes, received' : 'Yes, paid',
        danger: false,
        onConfirm: () => confirmTx(id)
    });
};

const emptyState = ({ iconId, title, text, actionLabel, action }) => `
    <div class="empty">
        <span class="empty-icon">${icon(iconId)}</span>
        <span class="empty-title">${escapeHtml(title)}</span>
        <span class="empty-text">${escapeHtml(text)}</span>
        ${actionLabel ? `<button type="button" class="btn btn-primary btn-sm" data-action="${action}">${icon('i-plus', 'ic ic-sm')} ${escapeHtml(actionLabel)}</button>` : ''}
    </div>`;

const setMeter = (fill, pct, stateName) => {
    if (!fill) return;
    fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    if (stateName) fill.dataset.state = stateName;
    else delete fill.dataset.state;
};

const meterHtml = (pct, stateName, label) => `<span class="meter" role="progressbar" aria-label="${escapeHtml(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.min(100, pct))}"><span class="meter-fill" style="width:${Math.max(0, Math.min(100, pct))}%" ${stateName ? `data-state="${stateName}"` : ''}></span></span>`;
const budgetState = (pct) => (pct >= 100 ? 'over' : pct >= 80 ? 'warn' : null);

const breakdownHtml = (entries, total, type) => entries.map(([catId, v]) => {
    const cat = catById(catId, type);
    const pct = total > 0 ? (v / total) * 100 : 0;
    return `<li style="--cat:${catColor(cat)}">
        ${catBadge(catId, type)}
        <span class="breakdown-name">${escapeHtml(cat.name)}</span>
        <span class="breakdown-val amount">${escapeHtml(formatCurrency(v, dcur()))}</span>
        <span class="breakdown-bar"><span class="meter"><span class="meter-fill" style="width:${pct}%"></span></span><span class="breakdown-pct">${pct < 1 && pct > 0 ? '<1' : Math.round(pct)}%</span></span>
    </li>`;
}).join('');

// Money that counts up to its new value (skipped when the user prefers less motion).
const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Big numbers on one line: step the font down until the amount fits its box.
const shrinkToFit = (el) => {
    if (!el || !el.clientWidth) return;
    el.style.fontSize = '';
    const over = el.scrollWidth / (el.clientWidth || 1);
    if (over <= 1.005) return;
    const size = parseFloat(getComputedStyle(el).fontSize);
    el.style.fontSize = `${Math.max(18, Math.floor((size / over) * 0.98))}px`;
};
const countUp = (el, to, cur) => {
    if (!el) return;
    const from = el.dataset.v === undefined ? 0 : Number(el.dataset.v);
    const sameCur = el.dataset.cur === undefined || el.dataset.cur === cur;
    el.dataset.v = String(to);
    el.dataset.cur = cur;
    cancelAnimationFrame(el._raf);
    clearTimeout(el._done);
    if (reduceMotion() || document.hidden || !sameCur || !isFinite(from) || from === to) { el.textContent = formatCurrency(to, cur); shrinkToFit(el); return; }
    const t0 = performance.now();
    const dur = 750;
    const step = (now) => {
        const p = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - p, 3);
        el.textContent = formatCurrency(p < 1 ? from + (to - from) * e : to, cur);
        if (p < 1) el._raf = requestAnimationFrame(step);
        else shrinkToFit(el);
    };
    el._raf = requestAnimationFrame(step);
    // If the browser pauses animation frames, still land on the right number.
    clearTimeout(el._done);
    el._done = setTimeout(() => { cancelAnimationFrame(el._raf); el.textContent = formatCurrency(to, cur); shrinkToFit(el); }, dur + 150);
};

/* =========================================================================
   15. Rendering — Home
   ========================================================================= */
const renderDashboard = () => {
    const cur = dcur();
    const now = new Date();
    const s = monthStats();

    const acc = viewAccountObj();
    $('dash-month-label').textContent = acc ? `${acc.name} balance` : state.accounts.length > 1 ? 'All accounts balance' : 'Balance';
    const hideIt = viewBalanceHidden();
    const eye = $('btn-hide-balance');
    if (eye) {
        eye.hidden = false;
        eye.setAttribute('aria-pressed', String(hideIt));
        eye.setAttribute('aria-label', acc ? (hideIt ? 'Show balance' : 'Hide balance') : (hideIt ? 'Show total' : 'Hide total'));
        eye.innerHTML = icon(hideIt ? 'i-eye-off' : 'i-eye', 'ic ic-sm');
    }
    if (hideIt) showHidden($('dash-balance'), cur); else countUp($('dash-balance'), viewBalance(), cur);
    // A minus balance is always shown in red, with a label (never only by colour).
    const minus = !hideIt && viewBalance() < -0.004;
    $('dash-balance').classList.toggle('is-negative', minus);
    $('dash-minus').hidden = !minus;
    const nowD = new Date();
    const coming = viewTx().filter((t) => isUpcoming(t) && t.type === 'income' && inMonth(t, nowD.getFullYear(), nowD.getMonth()))
        .sort((a, b) => (a.date > b.date ? 1 : -1));
    const comingNote = coming.length ? ` · ${formatCompact(sumDisplay(coming), cur)} coming ${shortDate(coming[0].date)}` : '';
    const monthName0 = now.toLocaleDateString('en-US', { month: 'long' });
    const change = monthChange();
    $('dash-balance-sub').textContent = (Math.abs(change) >= 0.005 || s.income > 0 || s.spent > 0
        ? `${change >= 0 ? '+' : '−'}${formatCompact(Math.abs(change), cur)} in ${monthName0}${s.income > 0 ? ` · ${Math.max(0, Math.round((s.net / s.income) * 100))}% of income left` : ''}`
        : `Nothing in or out yet in ${monthName0}`) + comingNote;
    if (hideIt) $('dash-balance-sub').textContent = acc ? 'Balance hidden · tap the eye to show it' : 'Total hidden · tap the eye to show it';
    setMoney($('dash-income'), s.income, cur, 12);
    setMoney($('dash-spent'), s.spent, cur, 12);

    const pill = $('dash-spend-trend');
    const pillText = $('dash-spend-trend-text');
    if (s.prevSpent > 0) {
        // Money, not a percentage: "730% more" says little when last month was quiet.
        const diff = s.spent - s.prevSpent;
        const flat = Math.abs(diff) < Math.max(1, s.prevSpent * 0.02);
        pill.dataset.trend = flat ? 'flat' : (diff > 0 ? 'up' : 'down');
        pillText.textContent = flat ? 'Same as last month' : `${formatCompact(Math.abs(diff), cur)} ${diff > 0 ? 'more' : 'less'} than last month`;
        pill.title = `Spending so far compared with the same days of last month (${formatCurrency(s.prevSpent, cur)})`;
    } else {
        pill.dataset.trend = 'flat';
        pillText.textContent = s.spent > 0 ? 'First month tracked' : 'Nothing spent yet';
    }

    document.querySelector('.hero-budget').hidden = !budgetOn();
    setMeter($('dash-budget-fill'), s.budgetPct, budgetState(s.budgetPct));
    $('dash-budget-meter').setAttribute('aria-valuenow', String(Math.round(Math.min(100, s.budgetPct))));
    $('dash-budget-desc').textContent = `${Math.round(s.budgetPct)}% of ${fitMoney(s.budget, cur, 11)} budget${s.fromBalance ? ' (from balance)' : s.fromIncome ? ' (from income)' : ''}`;
    const left = s.budget - s.spent;
    // A budget can't be spent before the money is there: until the income arrives, "left" is what the account has.
    const haveNow = Math.max(0, round2(viewBalance()));
    const shortOfMoney = left > 0 && haveNow < left - 0.004 && !s.fromBalance;
    $('dash-budget-left').innerHTML = shortOfMoney
        ? `<strong>${escapeHtml(fitMoney(haveNow, cur, 12))}</strong> to spend now`
        : left >= 0
            ? `<strong>${escapeHtml(fitMoney(left, cur, 12))}</strong> left`
            : `<strong>${escapeHtml(fitMoney(-left, cur, 12))}</strong> over`;
    $('dash-budget-left').title = shortOfMoney ? `${formatCurrency(left, cur)} of the budget is left, but only ${formatCurrency(haveNow, cur)} is in the account until your income arrives.` : '';

    const savedTotal = viewGoals().reduce((sum, g) => sum + toDisplay(g.saved, g.currency), 0);
    setMoney($('dash-total-savings'), savedTotal, cur, 12);
    $('dash-savings-status').textContent = viewGoals().length ? `across ${plural(viewGoals().length, 'goal')}` : 'Tap to create a goal';

    const { owedToYou, youOwe } = debtTotals();
    const netDebt = owedToYou - youOwe;
    setMoney($('dash-debts'), netDebt, cur, 12, true);
    $('dash-debts').className = `tile-value ${netDebt > 0 ? 'text-income' : netDebt < 0 ? 'text-expense' : ''}`;
    $('dash-debts-meta').textContent = owedToYou || youOwe
        ? (owedToYou && youOwe ? `Owed ${formatCompact(owedToYou, cur)}, you owe ${formatCompact(youOwe, cur)}` : owedToYou ? `${formatCompact(owedToYou, cur)} owed to you` : `You owe ${formatCompact(youOwe, cur)}`)
        : 'Nothing owed';

    renderPaymentsHome();

    const fx = fixedForMonth();
    $('dash-fixed').innerHTML = (fx.income > 0 || fx.total > 0) ? fixedSummaryHtml({ link: true }) : '';
    renderTripHome();
    renderSectionsHome();
    if (hideAll) showHidden($('networth'), cur); else setMoney($('networth'), netWorth(), cur, 16);
    $('networth').classList.toggle('text-expense', !hideAll && netWorth() < -0.004);
    $('account-strip').innerHTML = state.accounts.map((a) => {
        const bal = accountBalance(a);
        return `<button type="button" class="account-chip${viewId() === a.id ? ' is-current' : ''}" data-view-account="${escapeHtml(a.id)}" data-hold-account="${escapeHtml(a.id)}" aria-pressed="${viewId() === a.id}" aria-label="${escapeHtml(a.name)}: ${escapeHtml(formatCurrency(bal, a.currency))}. ${viewId() === a.id ? 'You are in this account' : 'Switch to this account'}">
            <span class="account-chip-top">${accountBadge(a, 'is-acc', 'account-icon')}<span class="account-name">${escapeHtml(a.name)}</span></span>
            ${balanceHidden(a.id) ? `<span class="account-bal amount is-hidden" title="Hidden">${escapeHtml(maskedMoney())}</span>` : `<span class="account-bal amount ${bal < 0 ? 'text-expense' : ''}" title="${escapeHtml(formatCurrency(bal, a.currency))}" ${moneyAttrs(toDisplay(bal, a.currency), dcur())}>${escapeHtml(formatDisplay(bal, a.currency))}</span>${origNote(bal, a.currency)}`}
        </button>`;
    }).join('') + `<button type="button" class="account-chip account-add" data-action="add-account">${icon('i-plus')}<span>Add account</span></button>`;
    if (state.accounts.length) $('account-strip').setAttribute('title', 'Tap to switch, hold to edit');

    // Waiting payments live in the Payments card above; Recent is money that really moved.
    // Recent: this account, or every account (each entry then says which account it was in or out of).
    let recentAll = false;
    try { recentAll = localStorage.getItem('VELA_RECENT_ALL') === '1'; } catch (e) { /* storage blocked */ }
    $('recent-scope').hidden = state.accounts.length < 2 || viewId() === 'all';
    if (viewId() === 'all') recentAll = true;
    setPressed('[data-recent-all]', (b) => (b.dataset.recentAll === '1') === recentAll);
    const recentSrc = recentAll && state.accounts.length > 1 ? state.transactions : viewTx();
    const recent = sortByNewest(recentSrc.filter((t) => !t.pending)).slice(0, recentAll ? 10 : 6);
    $('recent-list').innerHTML = recent.length
        ? recent.map((t) => txRow(t, { withAccount: recentAll })).join('')
        : starterHtml();

    renderTrendChart();
};

/* =========================================================================
   16. Rendering — Activity
   ========================================================================= */
const renderActivity = () => {
    const cur = dcur();
    const { y, m } = activityMonth;
    const now = new Date();
    const query = $('activity-search').value.trim().toLowerCase();
    const isCurrent = y === now.getFullYear() && m === now.getMonth();

    $('month-label').innerHTML = query
        ? 'Search results<small>across all months</small>'
        : `${escapeHtml(monthName(y, m))}${isCurrent ? '<small>This month</small>' : ''}`;
    $('month-next').disabled = isCurrent || !!query;
    $('month-next').style.opacity = isCurrent || query ? '0.35' : '';
    $('month-prev').disabled = !!query;
    $('month-prev').style.opacity = query ? '0.35' : '';

    setPressed('[data-activity-type]', (b) => b.dataset.activityType === activityType);
    setPressed('[data-activity-view]', (b) => b.dataset.activityView === activityView);
    activityAccount = viewId();
    fillAccountSelect($('activity-account'), activityAccount, { all: true });
    $('activity-account-wrap').hidden = true; // the account bar at the top switches accounts

    const chipCats = activityType === 'all' ? state.categories : catsOfType(activityType);
    if (activityCategory !== 'all' && !chipCats.some((c) => c.id === activityCategory)) activityCategory = 'all';
    $('activity-chips').innerHTML = [`<button type="button" class="chip" data-filter-category="all" aria-pressed="${activityCategory === 'all'}">All</button>`]
        .concat(chipCats.map((c) => `<button type="button" class="chip" data-filter-category="${escapeHtml(c.id)}" aria-pressed="${activityCategory === c.id}" style="--cat:${catColor(c)}"><span class="chip-dot"></span>${escapeHtml(c.name)}</button>`))
        .join('');

    const scoped = activityAccount === scopeId() ? viewTx() : state.transactions.filter((t) => inAccount(t, activityAccount));
    // Unpaid, upcoming, overdue and bank filters look across all months.
    const allMonths = ['unpaid', 'upcoming', 'overdue', 'bank'].includes(activityStatus);
    const base = query || allMonths ? scoped : scoped.filter((t) => inMonth(t, y, m));
    let list = base;
    const today = todayISO();
    const STATUS_TEST = {
        paid: (t) => !t.pending,
        unpaid: (t) => t.pending === true && t.type !== 'transfer',
        upcoming: (t) => t.pending === true && t.date > today,
        overdue: (t) => t.pending === true && t.date < today,
        bank: (t) => !!t.bank
    };
    if (STATUS_TEST[activityStatus]) list = list.filter(STATUS_TEST[activityStatus]);
    // The counts on the filter chips, in one pass over the entries.
    const counts = { unpaid: 0, upcoming: 0, overdue: 0, bank: 0 };
    scoped.forEach((t) => {
        if (t.bank) counts.bank++;
        if (t.pending === true) {
            if (t.type !== 'transfer') counts.unpaid++;
            if (t.date > today) counts.upcoming++;
            else if (t.date < today) counts.overdue++;
        }
    });
    $('activity-status').innerHTML = [['all', 'All'], ['paid', 'Paid'], ['unpaid', 'Unpaid'], ['upcoming', 'Upcoming'], ['overdue', 'Overdue'], ['bank', 'From bank']]
        .map(([v, label]) => `<button type="button" class="chip" data-activity-status="${v}" aria-pressed="${activityStatus === v}">${label}${v !== 'all' && v !== 'paid' ? ` <span class="chip-count">${counts[v]}</span>` : ''}</button>`).join('');
    if (allMonths && !query) $('month-label').innerHTML = `${escapeHtml({ unpaid: 'Unpaid', upcoming: 'Upcoming', overdue: 'Overdue', bank: 'From your bank' }[activityStatus])}<small>All months</small>`;
    if (activityType !== 'all') list = list.filter((t) => t.type === activityType);
    if (activityCategory !== 'all') list = list.filter((t) => t.category === activityCategory);
    if (query) {
        list = list.filter((t) => t.desc.toLowerCase().includes(query)
            || (t.note && t.note.toLowerCase().includes(query))
            || catById(t.category, t.type).name.toLowerCase().includes(query));
    }
    list = sortByNewest(list);

    const summarySrc = (query ? list : base).filter((t) => !isUpcoming(t));
    const inc = sumDisplay(summarySrc.filter((t) => t.type === 'income'));
    const out = sumDisplay(summarySrc.filter((t) => t.type === 'expense'));
    setMoney($('act-income'), inc, cur, 11);
    setMoney($('act-spent'), out, cur, 11);
    setMoney($('act-net'), inc - out, cur, 11, true);
    $('act-net').className = `amount ${inc - out >= 0 ? 'text-income' : 'text-expense'}`;

    const showCalendar = activityView === 'calendar' && !query;
    renderCalendar(showCalendar ? base.filter((t) => (activityType === 'all' || t.type === activityType) && (activityCategory === 'all' || t.category === activityCategory)) : null, y, m);
    if (showCalendar) {
        if (activityDay && activityDay.slice(0, 7) === `${y}-${pad2(m + 1)}`) list = list.filter((t) => t.date === activityDay);
        else { activityDay = null; list = []; }
    }

    const container = $('activity-entries');
    if (showCalendar && !activityDay) {
        container.innerHTML = '<p class="card-sub calendar-hint">Tap a day to see what you spent and earned.</p>';
        return;
    }
    if (!state.transactions.length) {
        container.innerHTML = `<div class="card">${emptyState({ iconId: 'i-activity', title: 'No activity yet', text: 'Expenses and income you add show up here, grouped by day.', actionLabel: 'Add expense', action: 'add-expense' })}</div>`;
        return;
    }
    if (!list.length) {
        const what = activityType === 'all' ? 'entries' : activityType === 'income' ? 'income' : 'expenses';
        container.innerHTML = `<div class="card"><div class="empty"><span class="empty-icon">${icon('i-search')}</span><span class="empty-title">Nothing here</span><span class="empty-text">${query ? 'No entries match your search.' : showCalendar ? `Nothing logged on ${escapeHtml(relativeDayLabel(activityDay))}.` : `No ${what} in ${escapeHtml(monthName(y, m, { month: 'long' }))}.`}</span>${(activityType !== 'all' || activityCategory !== 'all' || activityAccount !== 'all' || query) ? '<button type="button" class="btn btn-secondary btn-sm" data-clear-filters>Clear filters</button>' : ''}</div></div>`;
        return;
    }

    const groups = [];
    list.forEach((t) => {
        const last = groups[groups.length - 1];
        if (last && last.date === t.date) last.items.push(t);
        else groups.push({ date: t.date, items: [t] });
    });
    container.innerHTML = groups.map((g) => {
        const counted = g.items.filter((t) => !isUpcoming(t));
        const net = sumDisplay(counted.filter((t) => t.type === 'income')) - sumDisplay(counted.filter((t) => t.type === 'expense'));
        const head = counted.length ? `<span class="amount">${escapeHtml(formatSigned(net, cur))}</span>` : '<span class="tx-upcoming">Upcoming</span>';
        return `<div class="day-group">
            <div class="day-head"><span>${escapeHtml(relativeDayLabel(g.date))}</span>${head}</div>
            <div class="card card-list"><ul class="tx-list">${g.items.map((t) => txRow(t, { showDate: false })).join('')}</ul></div>
        </div>`;
    }).join('');
};

const renderCalendar = (list, y, m) => {
    const el = $('activity-calendar');
    if (!list) { el.hidden = true; return; }
    el.hidden = false;
    const spent = {};
    const earned = {};
    // Only money that really moved is coloured; unpaid or expected entries get a ring on their day instead.
    const waiting = {};
    list.forEach((t) => {
        if (isUpcoming(t)) { if (t.type !== 'transfer') waiting[t.date] = true; return; }
        if (t.type === 'expense') spent[t.date] = (spent[t.date] || 0) + toDisplay(t.amount, t.currency);
        if (t.type === 'income') earned[t.date] = (earned[t.date] || 0) + toDisplay(t.amount, t.currency);
    });
    const max = Math.max(0, ...Object.values(spent));
    const days = daysInMonth(y, m);
    const lead = new Date(y, m, 1).getDay();
    const today = todayISO();
    const cur = dcur();
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<span class="cal-blank"></span>');
    for (let d = 1; d <= days; d++) {
        const iso = `${y}-${pad2(m + 1)}-${pad2(d)}`;
        const out = spent[iso] || 0;
        const inc = earned[iso] || 0;
        const heat = max > 0 && out > 0 ? Math.max(0.12, out / max) : 0;
        const label = `${shortDate(iso)}${out ? `, spent ${formatCurrency(out, cur)}` : ''}${inc ? `, earned ${formatCurrency(inc, cur)}` : ''}${waiting[iso] ? ', something still to pay or receive' : ''}`;
        cells.push(`<button type="button" class="cal-day" data-cal-day="${iso}" style="--heat:${heat.toFixed(2)}" ${heat > 0.55 ? 'data-hot="true"' : ''} aria-pressed="${activityDay === iso}" ${iso === today ? 'aria-current="date"' : ''} aria-label="${escapeHtml(label)}">
            <span class="cal-num">${d}</span>
            ${out ? `<span class="cal-amt">${escapeHtml(formatCompact(out, cur).replace(/^[^\d-]+/, ''))}</span>` : ''}
            <span class="cal-marks" aria-hidden="true">${inc ? '<span class="cal-dot"></span>' : ''}${waiting[iso] ? '<span class="cal-due"></span>' : ''}</span>
        </button>`);
    }
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    el.innerHTML = `<div class="cal-grid">${names.map((n) => `<span class="cal-head" aria-hidden="true">${n.slice(0, 2)}</span>`).join('')}${cells.join('')}</div>
        <div class="cal-legend"><span><i class="cal-swatch"></i>Spent (deeper = more)</span><span><i class="cal-dot"></i>Income</span><span><i class="cal-due"></i>To pay or receive</span></div>`;
};

/* =========================================================================
   17. Rendering — Plan (budgets, bills, goals, debts)
   ========================================================================= */
const renderPlan = () => {
    setPressed('[data-plan-tab]', (b) => b.dataset.planTab === planTab);
    const el = $('plan-content');
    if (planTab === 'bills') el.innerHTML = planBillsHtml();
    else if (planTab === 'goals') el.innerHTML = planGoalsHtml();
    else if (planTab === 'debts') el.innerHTML = planDebtsHtml();
    else if (planTab === 'sections') { el.innerHTML = planSectionsHtml(); animateIn(el); }
    else el.innerHTML = planBudgetsHtml();
};

const planBudgetsHtml = () => {
    const cur = dcur();
    const s = monthStats();
    const now = new Date();
    const daysLeft = daysInMonth(now.getFullYear(), now.getMonth()) - now.getDate() + 1;
    const left = s.budget - s.spent;
    const perDay = left > 0 ? left / daysLeft : 0;

    const budgeted = Object.keys(state.config.categoryBudgets).filter((id) => state.categories.some((c) => c.id === id && c.type === 'expense'));
    const rows = budgeted.map((id) => {
        const cat = catById(id);
        const limit = budgetIn(state.config.categoryBudgets[id], cur);
        const spent = s.byCat[id] || 0;
        const pct = limit > 0 ? (spent / limit) * 100 : 0;
        const rem = limit - spent;
        return `<button type="button" class="plan-row" data-edit-budget="${escapeHtml(id)}" aria-label="Edit ${escapeHtml(cat.name)} budget">
            <span class="row-top">${catBadge(id, 'expense')}<span class="row-main"><span class="row-title">${escapeHtml(cat.name)}</span><span class="row-sub">${escapeHtml(formatCurrency(spent, cur))} of ${escapeHtml(formatCurrency(limit, cur))}</span></span>
            <span class="row-end"><span class="amount ${rem < 0 ? 'text-expense' : ''}">${escapeHtml(formatCurrency(Math.abs(rem), cur))}</span><span class="row-sub">${rem < 0 ? 'over' : 'left'}</span></span></span>
            ${meterHtml(pct, budgetState(pct), `${cat.name} budget used`)}
        </button>`;
    }).join('');

    const unbudgeted = Object.entries(s.byCat).filter(([id]) => !budgeted.includes(id)).sort((a, b) => b[1] - a[1]);
    const toggle = `<div class="card budget-toggle"><div class="setting-row"><div class="setting-text"><span class="setting-title">Monthly budget</span><span class="setting-desc">${budgetOn() ? 'On: limits, progress and warnings.' : 'Off: Vela only tracks income and spending. Turn on to plan a monthly budget.'}</span></div>
        <button class="switch" type="button" role="switch" aria-checked="${budgetOn()}" data-action="budget-toggle" aria-label="Monthly budget"></button></div></div>`;
    if (!budgetOn()) {
        return `${toggle}
        <div class="card">${emptyState({ iconId: 'i-target', title: 'No monthly budget', text: `This month you spent ${formatCurrency(s.spent, cur)} and received ${formatCurrency(s.income, cur)}. Turn the budget on to set a total, a share of your salary, or limits per category.`, actionLabel: 'Turn the budget on', action: 'budget-toggle' })}</div>`;
    }

    return `${toggle}
    <article class="card glow" style="--glow:var(--pal-violet)">
        <div class="card-head"><h2 class="card-title">Monthly budget</h2><button type="button" class="btn btn-secondary btn-xs" data-edit-budget="__overall">${icon('i-edit', 'ic ic-sm')} Edit</button></div>
        <div class="big-number ${left < 0 ? 'text-expense' : ''}">${escapeHtml(formatCurrency(Math.abs(left), cur))}</div>
        <div class="card-sub" style="margin-bottom:var(--sp-3)">${left >= 0 ? `left of ${escapeHtml(formatCurrency(s.budget, cur))}. That's about ${escapeHtml(formatCurrency(perDay, cur))} a day for the next ${plural(daysLeft, 'day')}.` : `over your ${escapeHtml(formatCurrency(s.budget, cur))} budget`}</div>
        ${!s.fromBalance && left > 0 && Math.max(0, viewBalance()) < left - 0.004 ? `<div class="budget-source is-short">${icon('i-alert', 'ic ic-sm')}<span>Only ${escapeHtml(formatCurrency(Math.max(0, viewBalance()), cur))} is in ${viewAccountObj() ? 'this account' : 'your accounts'} now. The rest of the budget needs your income first${s.expectedIncome > 0 ? ` (${escapeHtml(formatCurrency(s.expectedIncome, cur))} expected)` : ''}.</span></div>` : ''}
        ${state.config.budgetMode === 'balance' ? `<div class="budget-source">${icon('i-wallet', 'ic ic-sm')}<span>From your balance: ${escapeHtml(formatCurrency(viewBalance(), cur))} in this account now</span></div>` : ''}
        ${s.fromIncome ? `<div class="budget-source">${icon('i-arrow-down', 'ic ic-sm')}<span>${s.incomeFallback ? `No income has come in here this month yet, so your account balance is used until it does.` : `From your income received: ${escapeHtml(formatCurrency(s.plannedIncome, cur))} this month`}${state.config.budgetSavePct && !s.incomeCapped ? `, keeping ${state.config.budgetSavePct}% (${escapeHtml(formatCurrency(s.plannedIncome - s.budget, cur))}) for saving` : ''}${s.incomeCapped ? `. Part of it was spent before Vela tracked it, so your budget is what you really have: ${escapeHtml(formatCurrency(s.baseBudget, cur))}` : ''}</span></div>`
            : (s.plannedIncome > 0 ? `<button type="button" class="link-btn budget-switch" data-action="budget-from-income">${icon('i-arrow-down', 'ic ic-sm')} Use my income (${escapeHtml(formatCurrency(s.plannedIncome, cur))}) as the budget</button>` : '')}
        ${s.fromIncome && s.expectedIncome > 0 ? `<div class="budget-source is-expected">${icon('i-calendar', 'ic ic-sm')}<span>+${escapeHtml(formatCurrency(s.expectedIncome, cur))} more when your expected income arrives</span></div>` : ''}
        ${s.goalKeep > 0 ? `<button type="button" class="budget-source budget-goals" data-goto-plan="goals">${icon('i-target', 'ic ic-sm')}<span>${escapeHtml(formatCurrency(s.goalKeep, cur))} kept for goals (${escapeHtml(viewGoals().filter((g) => goalMonthly(g) > 0).map((g) => g.name).join(', '))}), so your budget to spend is ${escapeHtml(formatCurrency(s.budget, cur))} of ${escapeHtml(formatCurrency(s.baseBudget, cur))}</span>${icon('i-chevron', 'ic ic-sm')}</button>` : ''}
        ${meterHtml(s.budgetPct, budgetState(s.budgetPct), 'Monthly budget used')}
        <div class="meter-row" style="margin-top:var(--sp-2)"><span>${Math.round(s.budgetPct)}% used</span><span>Spent <strong>${escapeHtml(formatCurrency(s.spent, cur))}</strong></span></div>
    </article>
    <div class="section-head"><h2>By category</h2><button type="button" class="btn btn-primary btn-xs" data-action="add-budget">${icon('i-plus', 'ic ic-sm')} Add</button></div>
    ${rows ? `<div class="card plan-list">${rows}</div>` : `<div class="card">${emptyState({ iconId: 'i-target', title: 'No category budgets', text: 'Set a monthly limit for food, transport or anything else. Vela warns you at 80%.', actionLabel: 'Add a budget', action: 'add-budget' })}</div>`}
    ${unbudgeted.length ? `<div class="section-head"><h2>Spending without a budget</h2></div>
    <div class="card card-list"><ul class="tx-list">${unbudgeted.map(([id, v]) => `<li><button type="button" class="tx" data-new-budget="${escapeHtml(id)}">${catBadge(id, 'expense')}<span class="tx-main"><span class="tx-title">${escapeHtml(catById(id).name)}</span><span class="tx-sub">Tap to set a budget</span></span><span class="tx-amt"><span class="amount">${escapeHtml(formatCurrency(v, cur))}</span></span></button></li>`).join('')}</ul></div>` : ''}`;
};

const FREQ_PHRASE = { weekly: 'Every week', monthly: 'Every month', yearly: 'Every year' };

const billRow = (b) => {
    const dl = dueLabel(b.nextDate);
    const label = b.type === 'income' ? dl.text.replace('Due', 'Expected').replace('overdue', 'late') : dl.text;
    const how = b.autoLog ? 'logs itself' : (b.type === 'income' ? 'you confirm it' : 'you mark it paid');
    return `<div class="plan-row">
        <button type="button" class="plan-row-main" data-edit-bill="${escapeHtml(b.id)}" aria-label="Edit ${escapeHtml(b.name)}">
            ${entryBadge(b.name, b.category, b.type)}
            <span class="row-main"><span class="row-title">${escapeHtml(b.name)}</span><span class="row-sub">${b.parts ? `<span class="parts-pill">Part ${b.parts.done + 1} of ${b.parts.count}</span> ${escapeHtml(formatDisplay(partsLeft(b) * b.amount, b.currency))} left · ` : ''}${b.ref ? `${escapeHtml(refLabel(b.ref))} · ` : ''}${FREQ_PHRASE[b.frequency]}, ${how}</span></span>
            <span class="row-end"><span class="amount ${b.type === 'income' ? 'text-income' : ''}">${escapeHtml(formatDisplay(billDue(b), b.currency))}</span>${b.carry ? `<span class="row-sub">incl. ${escapeHtml(formatDisplay(b.carry, b.currency))} carried</span>` : ''}<span class="badge-due" data-tone="${dl.tone}">${escapeHtml(label)}</span></span>
        </button>
        ${b.autoLog ? '' : `<div class="bill-actions"><button type="button" class="btn btn-secondary btn-sm paid-btn" data-bill-paid="${escapeHtml(b.id)}">${icon('i-check', 'ic ic-sm')} ${b.type === 'income' ? 'Mark received' : 'Mark paid'}</button><button type="button" class="link-btn pay-later-btn" data-pay-later="bill:${escapeHtml(b.id)}">Not this time</button></div>`}
    </div>`;
};

const planBillsHtml = () => {
    const cur = dcur();
    const sorted = [...viewBills()].sort((a, b) => (a.nextDate > b.nextDate ? 1 : -1));
    const bills = sorted.filter((b) => b.type === 'expense');
    const inc = sorted.filter((b) => b.type === 'income');
    const billIds = new Set(viewBills().map((b) => b.id));
    const oneOffFixed = viewTx().filter((t) => t.type === 'expense' && t.fixed && (!t.recurringId || !billIds.has(t.recurringId)) && inMonth(t, new Date().getFullYear(), new Date().getMonth()));
    if (!sorted.length && !oneOffFixed.length) {
        return `${fixedSummaryHtml()}<div class="card">${emptyState({ iconId: 'i-repeat', title: 'No fixed expenses yet', text: 'Add rent, internet, subscriptions and other regular payments once. Vela takes them off your income each month, logs them on time and reminds you before they are due.', actionLabel: 'Add a fixed expense', action: 'add-bill' })}</div>`;
    }
    const monthlyOut = bills.reduce((s, b) => s + monthlyEquivalent(b), 0);
    const monthlyIn = inc.reduce((s, b) => s + monthlyEquivalent(b), 0);
    return `
    ${fixedSummaryHtml({ list: true })}
    <div class="duo">
        <div class="card glow metric" style="--glow:var(--pal-pink)"><span class="metric-label">Fixed per month</span><span class="metric-value text-expense" title="${escapeHtml(formatCurrency(monthlyOut, cur))}" ${moneyAttrs(monthlyOut, cur)}>${escapeHtml(formatCurrency(monthlyOut, cur))}</span><span class="metric-sub">${plural(bills.length, 'fixed expense', 'fixed expenses')}</span></div>
        <div class="card glow metric" style="--glow:var(--pal-green)"><span class="metric-label">Regular income</span><span class="metric-value text-income" title="${escapeHtml(formatCurrency(monthlyIn, cur))}" ${moneyAttrs(monthlyIn, cur)}>${escapeHtml(formatCurrency(monthlyIn, cur))}</span><span class="metric-sub">per month</span></div>
    </div>
    <div class="section-head"><h2>Fixed expenses</h2><button type="button" class="btn btn-primary btn-xs" data-action="add-bill">${icon('i-plus', 'ic ic-sm')} Add</button></div>
    <div class="plan-half stack">${bills.length ? `<div class="card plan-list">${bills.map(billRow).join('')}</div>` : '<p class="card-sub" style="padding:0 4px">No repeating fixed expenses yet.</p>'}</div>
    ${oneOffFixed.length ? `<div class="plan-half stack"><div class="section-head"><h2>One-off fixed this month</h2></div><div class="card"><ul class="tx-list">${sortByNewest(oneOffFixed).map((t) => txRow(t)).join('')}</ul></div></div>` : ''}
    ${inc.length ? `<div class="plan-half stack"><div class="section-head"><h2>Regular income</h2></div><div class="card plan-list">${inc.map(billRow).join('')}</div></div>` : ''}`;
};

const planGoalsHtml = () => {
    const cur = dcur();
    if (!viewGoals().length) {
        return `<div class="card">${emptyState({ iconId: 'i-target', title: 'No savings goals yet', text: 'Pick something to save for, set a date, and Vela tells you how much to put away each month.', actionLabel: 'Create a goal', action: 'add-goal' })}</div>`;
    }
    const saved = viewGoals().reduce((s, g) => s + toDisplay(g.saved, g.currency), 0);
    const target = viewGoals().reduce((s, g) => s + toDisplay(g.target, g.currency), 0);
    const pct = target > 0 ? (saved / target) * 100 : 0;
    const cards = viewGoals().map((g) => {
        const p = g.target > 0 ? (g.saved / g.target) * 100 : 0;
        const done = p >= 100;
        const remaining = Math.max(0, g.target - g.saved);
        let hint;
        if (done) hint = `${icon('i-check')} Goal reached`;
        else if (g.deadline) {
            const now = new Date();
            const end = parseDate(g.deadline);
            const months = (end.getFullYear() - now.getFullYear()) * 12 + (end.getMonth() - now.getMonth()) + (end.getDate() >= now.getDate() ? 0 : -1);
            if (months >= 1) hint = `${icon('i-calendar')} Save ${escapeHtml(formatDisplay(remaining / months, g.currency))} a month to reach it by ${escapeHtml(shortDate(g.deadline))}`;
            else if (daysBetween(now, end) >= 0) hint = `${icon('i-calendar')} Due ${escapeHtml(shortDate(g.deadline))}: ${escapeHtml(formatDisplay(remaining, g.currency))} to go`;
            else hint = `${icon('i-alert')} Target date passed`;
        } else hint = `${icon('i-target')} ${escapeHtml(formatDisplay(remaining, g.currency))} to go`;
        // Saving every month: when it will be reached at this pace.
        const eta = !done && g.monthly > 0 ? (() => {
            const n = Math.ceil(remaining / g.monthly);
            const d = new Date();
            d.setMonth(d.getMonth() + n);
            const when = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
            const ahead = g.deadline && toISODate(d) > g.deadline;
            return `<div class="goal-hint goal-eta" data-late="${!!ahead}">${icon('i-calendar')} At ${escapeHtml(formatDisplay(g.monthly, g.currency))} a month: reached in ${plural(n, 'month')}, around <strong>${escapeHtml(when)}</strong>${ahead ? ` (after your date: save ${escapeHtml(formatDisplay(goalSuggestMonthly(g.target, g.saved, g.deadline), g.currency))} a month to make it)` : ''}</div>`;
        })() : '';
        const mon = goalMonthly(g);
        const inMon = goalSavedThisMonth(g);
        const monLine = mon > 0 ? `<div class="goal-month" data-done="${inMon >= mon - 0.004}">${icon(inMon >= mon - 0.004 ? 'i-check' : 'i-calendar', 'ic ic-sm')}<span>${inMon >= mon - 0.004 ? `Saved ${escapeHtml(formatDisplay(inMon, g.currency))} this month. Done for ${escapeHtml(new Date().toLocaleDateString(undefined, { month: 'long' }))}` : `${escapeHtml(formatDisplay(mon, g.currency))} a month from your budget · ${escapeHtml(formatDisplay(inMon, g.currency))} saved this month`}</span></div>` : '';
        return `<article class="card row-card plan-half">
            <div class="row-top"><span class="cat-badge" style="--cat:var(--pal-${done ? 'green' : 'violet'})">${icon('i-target')}</span><div class="row-main"><span class="row-title">${escapeHtml(g.name)}</span><span class="row-sub">${g.currency !== cur ? `Saving in ${g.currency}` : 'Savings goal'}</span></div><span class="goal-pct" data-done="${done}">${Math.floor(Math.min(p, 999))}%</span></div>
            <div class="goal-figures"><span class="amount">${escapeHtml(formatDisplay(g.saved, g.currency))}</span><span>of ${escapeHtml(formatDisplay(g.target, g.currency))}</span></div>
            ${meterHtml(p, done ? 'done' : null, `${g.name} progress`)}
            <div class="goal-hint">${hint}</div>
            ${eta}
            ${monLine}
            ${g.fundId && secById(g.fundId) ? `<div class="goal-hint">${icon('i-wallet')} Kept in the ${escapeHtml(secById(g.fundId).name)} fund · ${escapeHtml(formatCurrency(sectionBalances()[g.fundId] || 0, cur))} there</div>` : ''}
            <div class="row-actions">
                <button type="button" class="btn btn-primary btn-sm" data-deposit-goal="${escapeHtml(g.id)}" ${mon > 0 && inMon < mon - 0.004 ? `data-deposit-amount="${round2(mon - inMon)}"` : ''}>${icon('i-deposit', 'ic ic-sm')} ${mon > 0 && inMon < mon - 0.004 ? `Save ${escapeHtml(formatCompact(mon - inMon, g.currency))}` : 'Deposit'}</button>
                <button type="button" class="btn btn-secondary btn-sm" data-edit-goal="${escapeHtml(g.id)}">${icon('i-edit', 'ic ic-sm')} Edit</button>
            </div>
        </article>`;
    }).join('');
    return `
    <article class="card glow" style="--glow:var(--pal-green)">
        <div class="card-head" style="margin-bottom:var(--sp-1)"><span class="card-sub">Total saved</span><button type="button" class="btn btn-primary btn-xs" data-action="add-goal">${icon('i-plus', 'ic ic-sm')} New goal</button></div>
        <div class="big-number">${escapeHtml(formatCurrency(saved, cur))}</div>
        <div style="margin-top:var(--sp-3)">${meterHtml(pct, pct >= 100 ? 'done' : null, 'All goals progress')}</div>
        <div class="meter-row" style="margin-top:var(--sp-2)"><span>${Math.round(pct)}% of all targets</span><span>Target <strong>${escapeHtml(formatCurrency(target, cur))}</strong></span></div>
        ${goalsKeep(viewGoals()) > 0 ? `<div class="budget-source" style="margin-top:var(--sp-3)">${icon('i-calendar', 'ic ic-sm')}<span>Saving ${escapeHtml(formatCurrency(goalsKeep(viewGoals()), cur))} a month for goals, kept aside from your budget</span></div>` : ''}
    </article>
    ${cards}`;
};

const planDebtsHtml = () => {
    const cur = dcur();
    if (!viewDebts().length) {
        return `<div class="card">${emptyState({ iconId: 'i-users', title: 'No debts tracked', text: 'Keep track of money you lent to friends or borrowed, and record repayments as they come.', actionLabel: 'Add a debt', action: 'add-debt' })}</div>`;
    }
    const { owedToYou, youOwe } = debtTotals();
    const open = viewDebts().filter((d) => d.repaid < d.amount);
    const settled = viewDebts().filter((d) => d.repaid >= d.amount);
    const card = (d) => {
        const left = d.amount - d.repaid;
        const p = (d.repaid / d.amount) * 100;
        const lent = d.direction === 'lent';
        const due = d.dueDate && left > 0 ? dueLabel(d.dueDate) : null;
        return `<article class="card row-card plan-half">
            <div class="row-top"><span class="cat-badge" style="--cat:var(--pal-${lent ? 'green' : 'pink'})">${icon('i-users')}</span>
            <div class="row-main"><span class="row-title">${escapeHtml(d.person)}</span><span class="row-sub">${lent ? 'Owes you' : 'You owe'}${d.note ? ` for ${escapeHtml(d.note)}` : ''}</span></div>
            <div class="row-end"><span class="amount ${lent ? 'text-income' : 'text-expense'}">${escapeHtml(formatDisplay(left, d.currency))}</span>${left <= 0 ? '<span class="badge-due" data-tone="ok">Settled</span>' : due ? `<span class="badge-due" data-tone="${due.tone}">${escapeHtml(due.text)}</span>` : `<span class="row-sub">of ${escapeHtml(formatDisplay(d.amount, d.currency))}</span>`}</div></div>
            ${meterHtml(p, p >= 100 ? 'done' : null, `${d.person} repaid`)}
            <div class="meter-row"><span>${escapeHtml(formatDisplay(d.repaid, d.currency))} paid back</span><span>${Math.round(p)}%</span></div>
            <div class="row-actions">
                ${left > 0 ? `<button type="button" class="btn btn-primary btn-sm" data-repay-debt="${escapeHtml(d.id)}">${icon('i-check', 'ic ic-sm')} Record payment</button>` : ''}
                <button type="button" class="btn btn-secondary btn-sm" data-edit-debt="${escapeHtml(d.id)}">${icon('i-edit', 'ic ic-sm')} Edit</button>
            </div>
        </article>`;
    };
    return `
    <div class="duo">
        <div class="card glow metric" style="--glow:var(--pal-green)"><span class="metric-label">Owed to you</span><span class="metric-value text-income" title="${escapeHtml(formatCurrency(owedToYou, cur))}" ${moneyAttrs(owedToYou, cur)}>${escapeHtml(formatCurrency(owedToYou, cur))}</span><span class="metric-sub">${plural(open.filter((d) => d.direction === 'lent').length, 'person', 'people')}</span></div>
        <div class="card glow metric" style="--glow:var(--pal-pink)"><span class="metric-label">You owe</span><span class="metric-value text-expense" title="${escapeHtml(formatCurrency(youOwe, cur))}" ${moneyAttrs(youOwe, cur)}>${escapeHtml(formatCurrency(youOwe, cur))}</span><span class="metric-sub">${plural(open.filter((d) => d.direction === 'borrowed').length, 'person', 'people')}</span></div>
    </div>
    <div class="section-head"><h2>Open</h2><button type="button" class="btn btn-primary btn-xs" data-action="add-debt">${icon('i-plus', 'ic ic-sm')} Add</button></div>
    ${open.length ? open.map(card).join('') : '<p class="card-sub" style="padding:0 4px">Everything is settled.</p>'}
    ${settled.length ? `<div class="section-head"><h2>Settled</h2></div>${settled.map(card).join('')}` : ''}`;
};

/* =========================================================================
   18. Rendering — Insights
   ========================================================================= */
const renderAnalytics = () => {
    const all = insightsAll();
    const sw = $('insights-scope');
    if (sw) {
        sw.hidden = state.accounts.length < 2 || viewId() === 'all';
        const a = viewAccountObj();
        $('insights-scope-this').textContent = a ? a.name : 'This account';
        setPressed('[data-insights-scope]', (b) => (b.dataset.insightsScope === 'all') === all);
    }
    scopeAll = all;
    try { renderAnalyticsNow(); } finally { scopeAll = false; }
};
const renderAnalyticsNow = () => {
    const cur = dcur();
    setPressed('.range-btn', (b) => b.dataset.analyticsRange === analyticsRange);
    $('analytics-range-label').textContent = RANGE_LABELS[analyticsRange];

    const list = txInRange(analyticsRange);
    renderSectionsInsights(list);
    const out = list.filter((t) => t.type === 'expense');
    const inc = list.filter((t) => t.type === 'income');
    const { start, end } = rangeBounds(analyticsRange);
    const days = Math.max(1, daysBetween(start, end) + 1);
    const spent = sumDisplay(out);
    const income = sumDisplay(inc);
    const net = income - spent;

    setMoney($('metric-income'), income, cur, 13);
    $('metric-income-sub').textContent = plural(inc.length, 'entry', 'entries');
    setMoney($('metric-total'), spent, cur, 13);
    $('metric-total-items').textContent = plural(out.length, 'expense');
    setMoney($('metric-net'), net, cur, 13);
    $('metric-net').className = `metric-value ${net >= 0 ? 'text-income' : 'text-expense'}`;
    $('metric-rate').textContent = income > 0 ? `Savings rate ${Math.round((net / income) * 100)}%` : 'Add income to see your savings rate';
    setMoney($('metric-avg-daily'), spent / days, cur, 13);
    $('metric-avg-days').textContent = `over ${plural(days, 'day')}`;

    let biggest = null;
    out.forEach((e) => { const v = toDisplay(e.amount, e.currency); if (!biggest || v > biggest.v) biggest = { v, e }; });
    setMoney($('metric-max-spend'), biggest ? biggest.v : 0, cur, 13);
    $('metric-max-spend-title').textContent = biggest ? biggest.e.desc : '—';

    const ms = monthStats();
    $('metric-budget').textContent = `${Math.round(ms.budgetPct)}%`;
    $('metric-budget').className = `metric-value ${ms.budgetPct >= 100 ? 'text-expense' : ms.budgetPct >= 80 ? 'text-warning' : ''}`;
    $('metric-budget-sub').textContent = `of ${formatCompact(ms.budget, cur)} this month`;

    renderHistoryChart(list, start, end);
    renderCategoryChart(out, spent);

    const incByCat = {};
    inc.forEach((t) => { incByCat[t.category] = (incByCat[t.category] || 0) + toDisplay(t.amount, t.currency); });
    const incEntries = Object.entries(incByCat).sort((a, b) => b[1] - a[1]);
    $('income-breakdown').innerHTML = incEntries.length ? breakdownHtml(incEntries, income, 'income') : '<li style="display:block" class="faint">No income in this period. Add your salary or other income with +.</li>';
};

/* =========================================================================
   19. Rendering — Settings
   ========================================================================= */
const renderRateSetting = () => {
    const input = $('setting-rate');
    const sel = $('setting-rate-currency');
    if (!input || !sel) return;
    const others = myCurrencies().filter((c) => c !== 'USD');
    const block = $('setting-rate-block');
    block.hidden = !others.length;
    if (!others.length) return;
    const keep = others.includes(sel.value) ? sel.value : (others.includes(dcur()) ? dcur() : others[0]);
    sel.innerHTML = others.map((c) => `<option value="${c}">${c}</option>`).join('');
    sel.value = keep;
    if (document.activeElement !== input) input.value = formatRate(rateFor(keep));
    const desc = $('rate-mode-desc');
    if (state.config.rateOverrides[keep] > 0) desc.textContent = `Using your own rate for ${keep}. Tap "Live rate" to go back to automatic updates.`;
    else if (rateStatus === 'syncing') desc.textContent = 'Getting the latest rates…';
    else if (state.config.ratesUpdatedAt && state.config.rates[keep]) desc.textContent = `${rateStatus === 'live' ? 'Live' : 'Saved'} rate from ${new Date(state.config.ratesUpdatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.`;
    else desc.textContent = 'Approximate until the first live update. Rates update automatically when you are online.';
};

const renderSettings = () => {
    renderRateSetting();
    updateThemeChrome();
    updateUserProfileUI();
    $('currencies-desc').textContent = `${myCurrencies().join(', ')}. Amounts shown in ${dcur()}.`;
    $('accounts-desc').textContent = state.accounts.map((a) => a.name).join(', ');
    const custom = state.categories.filter((c) => !c.builtIn).length;
    $('categories-count').textContent = `${state.categories.length} categories${custom ? ` (${custom} of your own)` : ''}. Add your own.`;
    const lock = state.config.lock;
    setSwitch($('switch-lock'), lock.enabled);
    $('btn-change-pin').hidden = !lock.enabled;
    $('biometric-row').hidden = !(lock.enabled && biometricAvailable);
    $('lock-after-row').hidden = !lock.enabled;
    updateSecureScreenRow();
    renderDevices();
    updateMfaRow();
    setPressed('[data-lock-after]', (b) => Number(b.dataset.lockAfter) * 1000 === lockAfterMs());
    setSwitch($('switch-biometric'), lock.biometric);
    $('biometric-title').textContent = bioWords().title;
    $('biometric-desc').textContent = `${bioWords().desc} It uses what is saved in your phone's own settings.`;
    $('switch-biometric').setAttribute('aria-label', bioWords().title);
    $('bio-mode-row').hidden = !(lock.enabled && biometricAvailable && lock.biometric && bioChoices().length > 1);
    setPressed('[data-bio-mode]', (b) => b.dataset.bioMode === bioMode());
    const native = !!nativePlugin('LocalNotifications');
    setSwitch($('switch-reminders'), native && state.config.reminders && notifPermission !== 'denied');
    $('reminders-desc').textContent = !native
        ? 'Works in the Android app. Here, bills due soon show on Home.'
        : state.config.reminders && notifPermission === 'denied'
            ? 'Blocked by Android. Allow notifications for Vela in Android settings, then turn this on.'
            : 'The day before each bill, and every evening at 8 pm.';
    renderBankConnections();
    refreshBankStatus();
    $('report-month-desc').textContent = `Income, spending and categories for ${monthName(activityMonth.y, activityMonth.m)}`;
    $('app-version').textContent = `Vela ${APP_VERSION}${isNative() ? ' for Android' : ''}. Exchange rates from open.er-api.com`;
};

/* =========================================================================
   20. Charts
   ========================================================================= */
const chartsReady = () => typeof window.Chart !== 'undefined';
const hexToRgba = (hex, alpha) => {
    const h = hex.replace('#', '');
    if (h.length !== 6) return hex;
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};
const chartTheme = () => ({
    text: cssVar('--text-3'), grid: cssVar('--chart-grid'),
    income: cssVar('--income'), expense: cssVar('--chart-out'), surface: cssVar('--surface'),
    tooltipBg: cssVar('--bg-elevated'), tooltipText: cssVar('--text'), tooltipBorder: cssVar('--border-strong'), track: cssVar('--surface-2')
});
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Charts normally grow in over 450 ms; when only their colours change (theme switch) they are drawn at once.
let chartsInstant = false;
const chartAnim = () => ({ duration: chartsInstant || reducedMotion() ? 0 : 450 });

const baseOptions = (t) => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: chartAnim(),
    interaction: { mode: 'index', intersect: false },
    plugins: {
        legend: { display: false },
        tooltip: {
            backgroundColor: t.tooltipBg, titleColor: t.text, bodyColor: t.tooltipText, borderColor: t.tooltipBorder,
            borderWidth: 1, padding: 10, cornerRadius: 10, boxPadding: 4,
            titleFont: { family: 'Inter', size: 11, weight: '600' },
            bodyFont: { family: 'Outfit', size: 13, weight: '600' },
            callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y, dcur())}` }
        }
    },
    scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: t.text, font: { family: 'Inter', size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 6, sampleSize: 8 } },
        y: { beginAtZero: true, grid: { color: t.grid }, border: { display: false }, ticks: { color: t.text, font: { family: 'Inter', size: 10 }, maxTicksLimit: 5, sampleSize: 6, callback: (v) => formatCompact(v, dcur()) } }
    }
});

const destroyChart = (key) => { if (charts[key]) { charts[key].destroy(); charts[key] = null; } };
const showChartMessage = (id, message) => {
    const el = $(id);
    if (!el) return;
    el.hidden = !message;
    el.textContent = message || '';
};

const bucketize = (list, start, end, byMonth) => {
    const labels = [];
    const inc = new Map();
    const out = new Map();
    if (byMonth) {
        const c = new Date(start.getFullYear(), start.getMonth(), 1);
        const span = daysBetween(start, end);
        while (c <= end) {
            const k = monthKey(c);
            inc.set(k, 0);
            out.set(k, 0);
            labels.push((span > 366 ? FMT_MONTH_YEAR : FMT_MONTH).format(c));
            c.setMonth(c.getMonth() + 1);
        }
        list.forEach((t) => {
            if (t.type === 'transfer') return;
            const k = t.date.slice(0, 7);
            const map = t.type === 'income' ? inc : out;
            if (map.has(k)) map.set(k, map.get(k) + toDisplay(t.amount, t.currency));
        });
    } else {
        const span = daysBetween(start, end) + 1;
        for (let i = 0; i < span; i++) {
            const d = addDays(start, i);
            const k = toISODate(d);
            inc.set(k, 0);
            out.set(k, 0);
            labels.push(FMT_MONTH_DAY.format(d));
        }
        list.forEach((t) => {
            if (t.type === 'transfer') return;
            const map = t.type === 'income' ? inc : out;
            if (map.has(t.date)) map.set(t.date, map.get(t.date) + toDisplay(t.amount, t.currency));
        });
    }
    return { labels, income: [...inc.values()], spent: [...out.values()] };
};

const cashFlowChart = (canvasId, emptyId, data, key) => {
    if (!chartsReady()) { destroyChart(key); showChartMessage(emptyId, 'Charts load when you are online.'); return; }
    const t = chartTheme();
    const has = data.income.some((v) => v > 0) || data.spent.some((v) => v > 0);
    showChartMessage(emptyId, has ? '' : 'Nothing logged in this period');
    // Same numbers and colours as the chart already on screen: keep it (no rebuild, no grow-in again).
    const sig = JSON.stringify([data.labels, data.income, data.spent, t]);
    const live = charts[key] && charts[key].canvas === $(canvasId) ? charts[key] : null;
    if (live && live.$velaSig === sig) return;
    // Only the numbers changed (another account, a new entry): move the bars instead of rebuilding the chart.
    const colours = JSON.stringify(t);
    if (live && live.$velaColours === colours && live.data.labels.length === data.labels.length) {
        live.data.labels = data.labels;
        live.data.datasets[0].data = data.income;
        live.data.datasets[1].data = data.spent;
        live.$velaSig = sig;
        live.update(chartsInstant || reducedMotion() ? 'none' : undefined);
        return;
    }
    destroyChart(key);
    const ds = (label, values, color) => ({ label, data: values, backgroundColor: hexToRgba(color, 0.85), hoverBackgroundColor: color, borderRadius: 4, borderSkipped: false, maxBarThickness: 16, categoryPercentage: 0.8, barPercentage: 0.9 });
    charts[key] = new Chart($(canvasId), {
        type: 'bar',
        data: { labels: data.labels, datasets: [ds('Income', data.income, t.income), ds('Spent', data.spent, t.expense)] },
        options: baseOptions(t)
    });
    charts[key].$velaSig = sig;
    charts[key].$velaColours = colours;
};

const renderTrendChart = () => {
    const today = startOfDay(new Date());
    const start = dashboardRange === '30' ? addDays(today, -29) : new Date(today.getFullYear(), today.getMonth() - 11, 1);
    // Only money that really moved: waiting / not-yet-received entries aren't income or spending yet.
    const list = viewTx().filter((x) => { const d = parseDate(x.date); return d >= start && d <= today && !isUpcoming(x); });
    cashFlowChart('dashboard-trend-chart', 'dashboard-chart-empty', bucketize(list, start, today, dashboardRange !== '30'), 'trend');
};

const renderHistoryChart = (list, start, end) => {
    const span = daysBetween(start, end) + 1;
    const byMonth = analyticsRange === '12m' || (analyticsRange === 'all' && span > 62);
    cashFlowChart('analytics-history-chart', 'analytics-history-empty', bucketize(list, start, end, byMonth), 'history');
};

const renderCategoryChart = (out, total) => {
    destroyChart('category');
    const cur = dcur();
    const byCat = {};
    out.forEach((e) => { byCat[e.category] = (byCat[e.category] || 0) + toDisplay(e.amount, e.currency); });
    const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    $('donut-total').textContent = formatCompact(total, cur);
    $('category-breakdown').innerHTML = entries.length ? breakdownHtml(entries, total, 'expense') : '<li style="display:block" class="faint">No spending in this period.</li>';
    if (!chartsReady()) return;
    const t = chartTheme();
    const colors = entries.map(([id]) => cssVar(`--pal-${catById(id).color}`));
    charts.category = new Chart($('analytics-category-chart'), {
        type: 'doughnut',
        data: {
            labels: entries.length ? entries.map(([id]) => catById(id).name) : ['None'],
            datasets: [{
                data: entries.length ? entries.map(([, v]) => v) : [1],
                backgroundColor: entries.length ? colors : [t.track],
                borderColor: t.surface,
                borderWidth: entries.length > 1 ? 3 : 0,
                hoverOffset: entries.length ? 6 : 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '74%',
            animation: chartAnim(),
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: entries.length > 0,
                    backgroundColor: t.tooltipBg, titleColor: t.text, bodyColor: t.tooltipText, borderColor: t.tooltipBorder,
                    borderWidth: 1, padding: 10, cornerRadius: 10,
                    callbacks: { label: (ctx) => ` ${ctx.label}: ${formatCurrency(ctx.parsed, cur)} (${total > 0 ? Math.round((ctx.parsed / total) * 100) : 0}%)` }
                }
            }
        }
    });
};

/* =========================================================================
   21. Sheet: expense / income
   ========================================================================= */
let txType = 'expense';
let txKind = 'variable';
let txKindTouched = false;
const FIXED_HINT = /\b(rent|lease|boarding|internet|wifi|broadband|electric|water bill|phone bill|reload|subscription|netflix|spotify|youtube|insurance|loan|emi|installment|instalment|tuition|school fee|class fee|gym|membership|bill)\b/i;
// Income that is the same every month.
const FIXED_INCOME_HINT = /\b(salary|salaries|wage|wages|pay ?roll|allowance|pension|stipend|rent(al)? income|rent from|monthly)\b/i;
const fixedHintFor = (text) => (txType === 'income' ? FIXED_INCOME_HINT : FIXED_HINT).test(text || '');
const setTxKind = (kind) => {
    const editing = $('tx-id').value ? state.transactions.find((t) => t.id === $('tx-id').value) : null;
    const fromBill = !!(editing && editing.recurringId);
    txKind = fromBill ? 'fixed' : kind;
    setPressed('[data-tx-kind]', (b) => b.dataset.txKind === txKind);
    document.querySelectorAll('[data-tx-kind]').forEach((b) => { b.disabled = fromBill; });
    const income = txType === 'income';
    $('tx-kind-field').hidden = false;
    $('tx-kind-label').textContent = income ? 'Kind of income' : 'Kind of expense';
    $('tx-kind-group').setAttribute('aria-label', income ? 'Kind of income' : 'Kind of expense');
    $('tx-repeat-row').hidden = !(txKind === 'fixed' && !editing);
    $('tx-repeat-text').textContent = income ? 'Expect it every month' : 'Repeats every month';
    $('tx-repeat-desc').textContent = income
        ? 'Vela shows it as expected each month and counts it only when you tap Received.'
        : 'Adds it to your fixed expenses, logs it each month and reminds you.';
    $('tx-kind-hint').textContent = fromBill
        ? `Logged from your fixed ${income ? 'income' : 'expense'} "${(state.recurring.find((b) => b.id === editing.recurringId) || {}).name || editing.desc}". Change it in Plan > Fixed.`
        : income
            ? (txKind === 'fixed' ? 'Fixed: the same every month, like a salary, allowance or rent you receive.' : 'Variable: changes or comes once, like freelancing, gifts or extra income.')
            : (txKind === 'fixed' ? 'Fixed: the same every month, like rent or internet. It is taken off your income for the month.' : 'Variable: changes from month to month, like food or transport.');
};

const buildCategoryPicker = (type, selected) => {
    $('tx-category-picker').innerHTML = catsOfType(type).map((c, i) => `
        <div class="cat-cell${c.builtIn ? '' : ' is-custom'}" data-cat-cell="${escapeHtml(c.id)}" style="--i:${i % 4}">
            <label class="cat-option" style="--cat:${catColor(c)}">
                <input type="radio" name="tx-category" value="${escapeHtml(c.id)}" ${c.id === selected ? 'checked' : ''}>
                <span class="cat-option-box">${catBadge(c.id, type)}<span>${escapeHtml(c.name)}</span></span>
            </label>
            ${c.builtIn ? '' : `<button type="button" class="cat-del" data-cat-del="${escapeHtml(c.id)}" aria-label="Delete ${escapeHtml(c.name)}" tabindex="-1"><span aria-hidden="true"></span></button>`}
        </div>`).join('') + `
        <button type="button" class="cat-option" data-action="new-category-inline" style="border:0;background:none;padding:0">
            <span class="cat-option-box" style="border-style:dashed"><span class="cat-badge" style="--cat:var(--text-3)">${icon('i-plus')}</span><span>New</span></span>
        </button>`;
    if (!document.querySelector('input[name="tx-category"]:checked')) {
        const first = document.querySelector('input[name="tx-category"]');
        if (first) first.checked = true;
    }
};

const setTxType = (type, keepCategory) => {
    txType = type;
    if (catEditing) setCatEditing(false);
    setPressed('[data-tx-type]', (b) => b.dataset.txType === type);
    const editing = !!$('tx-id').value;
    $('tx-title').textContent = editing ? (type === 'income' ? 'Edit income' : 'Edit expense') : (type === 'income' ? 'New income' : 'New expense');
    $('tx-desc-label').textContent = type === 'income' ? 'Where did it come from?' : 'What was it for?';
    $('tx-desc').placeholder = type === 'income' ? 'e.g. November salary' : 'e.g. Groceries';
    const btn = $('btn-submit-tx');
    btn.className = `btn ${type === 'income' ? 'btn-income' : 'btn-primary'}`;
    btn.textContent = editing ? 'Save changes' : (type === 'income' ? 'Add income' : 'Add expense');
    buildCategoryPicker(type, keepCategory || state.config.lastCategory[type]);
    renderTxSuggest();
    updatePriceHint();
    updateDateHint();
    setTxKind(txKind);
    updateTripRow();
    renderTxSections();
    updateBeforeRow();
    updateInBudgetRow();
    updatePartsRow();
    updateChargedRow();
    $('tx-billref-field').hidden = type !== 'expense';
    updateShareRow();
};
let txChargedTouched = false;
// The bill's own number on an entry: CEB / water account number, or the phone number of a phone bill or reload.
const txBillRef = () => String($('tx-billref').value || '').trim().replace(/\s+/g, ' ').slice(0, 40);
// A fixed bill that doesn't know its number yet learns it from the entry (so the next bank SMS is matched to it).
const teachBillRef = (t) => {
    if (!t || !t.billRef || !t.recurringId) return;
    const b = state.recurring.find((x) => x.id === t.recurringId);
    if (b && !b.ref) { b.ref = t.billRef; queueSync('recurring', b.id, 'upsert', false); }
};
const txFxAccount = () => state.accounts.find((a) => a.id === ($('tx-account').value || (state.accounts[0] && state.accounts[0].id)));
const updateChargedRow = () => {
    const acc = txFxAccount();
    const cur = normCur($('tx-currency').value);
    const amount = toNumber($('tx-amount').value, NaN);
    const show = txType === 'expense' && !!acc && fxApplies(acc) && cur !== acc.currency;
    $('tx-charged-field').hidden = !show;
    if (!show) return;
    $('tx-charged-label').textContent = `Taken from ${acc.name} (${acc.currency})`;
    const est = amount > 0 ? fxCharge(amount, cur, acc) : 0;
    if (!txChargedTouched) $('tx-charged').value = est ? est : '';
    const typed = toNumber($('tx-charged').value, NaN);
    const rate = amount > 0 ? convertAmount(1, cur, acc.currency) : 0;
    const fee = fxFeeFor(acc);
    $('tx-charged-hint').textContent = !(amount > 0) ? 'Enter the amount first.'
        : txChargedTouched && typed > 0 ? `That is ${formatCurrency(typed / amount, acc.currency)} per ${cur}. Vela learns ${acc.name}'s charge from it for next time.`
            : `${formatCurrency(amount, cur)} × ${formatCurrency(rate, acc.currency)} + ${fee}% ${fxFeeLearned(acc) ? `${acc.name}'s charge` : bankFxFee(acc) !== undefined ? `${accountBankName(acc)}'s published charge (estimate)` : 'typical bank charge (estimate)'}. Change it to what your bank took.`;
};
// An entry dated before its account's balance was typed in: "Already in my balance" (on by default), so it's
// recorded in history and spending without changing the balance again.
let txBefore = false;
let txBeforeTouched = false;
let txInBudget = null; // null = the usual rule for its kind of income
let txParts = 0; // a new expense paid in parts: how many parts (0 = not a plan)
const updatePartsRow = () => {
    const show = txType === 'expense' && !$('tx-id').value;
    $('tx-parts-row').hidden = !show;
    if (!show) return;
    if (!txParts && BNPL_RE.test($('tx-desc').value)) txParts = 3;
    setPressed('[data-tx-parts]', (b) => Number(b.dataset.txParts) === txParts);
    const amt = toNumber($('tx-amount').value, 0);
    $('tx-parts-desc').textContent = txParts ? `This is part 1 of ${txParts}. The other ${txParts - 1} (${formatCurrency(amt * (txParts - 1), normCur($('tx-currency').value))}) are expected every month, then the plan ends.` : 'Koko, Mintpay or a card plan: this amount is the first part.';
};
// Someone paying their share of a bill (a sister or friend chipping in for Netflix): the money goes into the fund
// that bill is paid from, and is kept out of the budget (it's for the bill, not for spending).
const fundForBill = (bill) => {
    if (!bill) return null;
    const last = sortByNewest(state.transactions.filter((t) => t.recurringId === bill.id && t.sectionId && secById(t.sectionId)))[0];
    if (last) return secById(last.sectionId);
    const learned = (state.config.sectionCatMap || {})[bill.category];
    if (learned && secById(learned)) return secById(learned);
    return secList().find((x) => /bill/i.test(x.name)) || null;
};
const onShareChange = () => { if (txShareBill()) txInBudget = false; else txInBudget = null; updateShareRow(); updateInBudgetRow(); };
const txShareBill = () => state.recurring.find((b) => b.id === $('tx-share').value && b.type === 'expense') || null;
const updateShareRow = () => {
    const bills = state.recurring.filter((b) => b.type === 'expense');
    const show = txType === 'income' && bills.length > 0;
    $('tx-share-field').hidden = !show;
    if (!show) return;
    const sel = $('tx-share');
    const keep = sel.value;
    const opts = [['', 'No, it’s my own income']].concat(bills.map((b) => [b.id, b.name]));
    if (sel.options.length !== opts.length || [...sel.options].some((o, k) => o.value !== opts[k][0] || o.textContent !== opts[k][1])) {
        sel.innerHTML = opts.map(([v, l]) => `<option value="${escapeHtml(v)}">${escapeHtml(l)}</option>`).join('');
    }
    sel.value = opts.some(([v]) => v === keep) ? keep : '';
    const bill = txShareBill();
    const fund = fundForBill(bill);
    $('tx-share-hint').textContent = !bill ? 'Pick the bill if someone gave you their share of it (e.g. Netflix).'
        : fund ? `Goes into your ${fund.name} fund for ${bill.name}, not into your budget.`
        : `Kept for ${bill.name}, not in your budget. (Make a Bills fund to keep it there.)`;
};
const updateInBudgetRow = () => {
    const show = txType === 'income' && budgetOn() && state.config.budgetMode === 'income';
    $('tx-inbudget-row').hidden = !show;
    if (!show) return;
    const cat = (document.querySelector('input[name="tx-category"]:checked') || {}).value;
    const on = typeof txInBudget === 'boolean' ? txInBudget : !budgetSkips().includes(cat);
    setSwitch($('tx-inbudget'), on);
    $('tx-inbudget-desc').textContent = on ? 'This income adds to your monthly budget.' : 'Kept out of the budget (still in your balance and income).';
};
const updateBeforeRow = () => {
    const accId = $('tx-account').value || (state.accounts[0] && state.accounts[0].id);
    const acc = state.accounts.find((a) => a.id === accId);
    const bd = balanceDateOf(acc);
    const date = $('tx-date').value;
    // Any entry dated in the past can be "already in my balance"; it's on by itself before the account's balance date.
    const show = !!(acc && isISODate(date) && (date < todayISO() || (bd && date <= bd)) && (txType === 'expense' || txType === 'income'));
    $('tx-before-row').hidden = !show;
    if (!show) { if (!txBeforeTouched) txBefore = false; return; }
    if (!txBeforeTouched) txBefore = beforeBalanceFor(acc.id, date, cleanTime($('tx-time').value));
    setSwitch($('tx-before'), txBefore);
    const what = txBefore ? `It's kept in your history and spending without changing ${acc.name}'s balance again.` : `It will be ${txType === 'income' ? 'added to' : 'taken off'} ${acc.name}'s balance.`;
    $('tx-before-desc').textContent = bd
        ? `${acc.name}'s balance is correct as of ${shortDate(bd)}. ${what}`
        : `Turn on if the balance you typed for ${acc.name} already includes this ${txType}. ${what}`;
};
// While a trip is on (or the entry already belongs to one), expenses show a "Part of the trip" switch.
let txTripId = null;
const updateTripRow = () => {
    const trip = txTripId ? tripById(txTripId) : null;
    const on = activeTrip();
    const show = txType === 'expense' && !!(trip || on);
    $('tx-trip-row').hidden = !show;
    if (!show) return;
    const t = trip || on;
    $('tx-trip-name').textContent = `Part of ${t.name}`;
    setSwitch($('tx-trip'), !!txTripId);
    $('tx-trip').dataset.trip = t.id;
};

const updateDateHint = () => {
    const el = $('tx-date-hint');
    const d = $('tx-date').value;
    const future = isISODate(d) && d > todayISO();
    el.hidden = !future;
    if (future) el.textContent = `This date is in the future. It waits until you tap “${txType === 'income' ? 'Received' : 'Paid'}”, then counts in your balance. Vela reminds you on ${relativeDayLabel(d).toLowerCase() === 'tomorrow' ? 'the day' : shortDate(d)}.`;
    setTxStatus(txWaiting);
};
// Received / Not received yet (Paid / Not paid yet): money that hasn't really arrived or left yet waits,
// doesn't count in balances, and gets a reminder until it's marked done. A future date always waits.
let txWaiting = false;
const setTxStatus = (waiting) => {
    const d = $('tx-date').value;
    const future = isISODate(d) && d > todayISO();
    txWaiting = !!waiting;
    const w = future || txWaiting;
    const income = txType === 'income';
    $('tx-status-done').textContent = income ? 'Received' : 'Paid';
    $('tx-status-waiting').textContent = income ? 'Not received yet' : 'Not paid yet';
    setPressed('[data-tx-status]', (b) => (b.dataset.txStatus === 'waiting') === w);
    $('tx-status-done').disabled = future;
    $('tx-status-hint').textContent = future ? 'A future date waits until that day.'
        : w ? `Not counted in your balance until you mark it ${income ? 'received' : 'paid'}. Vela keeps reminding you.`
            : 'Counted in your balance.';
};

const openAddTx = (type = 'expense') => {
    smsEditing = null;
    $('tx-allocate').hidden = true;
    if ($('tx-source')) $('tx-source').hidden = true;
    $('tx-form').reset();
    txHistory = historyStats();
    resetTxSession();
    txCatTouched = false;
    txKind = 'variable';
    txKindTouched = false;
    setSwitch($('tx-repeat'), true);
    $('tx-id').value = '';
    $('btn-delete-tx').hidden = true;
    fillAccountSelect($('tx-account'), viewId() !== 'all' ? viewId() : state.config.lastAccount);
    $('tx-account-field').hidden = state.accounts.length < 2;
    setReceiptDraft(null);
    fillCurrencySelect($('tx-currency'), dcur());
    $('tx-date').value = todayISO();
    $('tx-time').value = nowTime();
    txWaiting = false;
    txTripId = tripIdFor(todayISO());
    txBefore = false;
    txBeforeTouched = false;
    txInBudget = null;
    $('tx-share').value = '';
    txParts = 0;
    txChargedTouched = false;
    txSectionId = null;
    txSectionTouched = false;
    resetTxCover();
    setTxType(type);
    syncTxSectionToCategory();
    openOrSwap('modal-tx');
};

const openEditTx = (id) => {
    smsEditing = null;
    const t = state.transactions.find((x) => x.id === id);
    if (!t) return;
    if (t.type === 'transfer') { openTransfer(t.id); return; }
    $('tx-form').reset();
    txHistory = historyStats();
    resetTxSession();
    txCatTouched = true;
    txKind = t.fixed ? 'fixed' : 'variable';
    txKindTouched = true;
    fillAccountSelect($('tx-account'), t.accountId);
    $('tx-account-field').hidden = state.accounts.length < 2;
    setReceiptDraft(t);
    $('tx-id').value = t.id;
    $('btn-delete-tx').hidden = false;
    $('tx-amount').value = t.fx ? t.fx.amount : t.amount;
    fillCurrencySelect($('tx-currency'), t.fx ? t.fx.currency : t.currency);
    txChargedTouched = !!t.fx;
    $('tx-charged').value = t.fx ? t.amount : '';
    $('tx-desc').value = t.desc;
    $('tx-date').value = t.date;
    $('tx-time').value = txTime(t) || '';
    $('tx-note').value = t.note || '';
    $('tx-share').value = t.shareOf || '';
    $('tx-billref').value = t.billRef || (() => { const b = t.recurringId && state.recurring.find((x) => x.id === t.recurringId); return (b && b.ref) || ''; })();
    txWaiting = t.pending === true;
    txTripId = t.tripId || null;
    txBefore = t.beforeBalance === true;
    txBeforeTouched = true;
    txInBudget = typeof t.inBudget === 'boolean' ? t.inBudget : null;
    txSectionId = t.sectionId && secById(t.sectionId) ? t.sectionId : null;
    txSectionTouched = true;
    resetTxCover();
    setTxType(t.type, t.category);
    const allocated = secMoves().some((m) => m.incomeId === t.id);
    $('tx-allocate').hidden = !(t.type === 'income' && secList().length && !isUpcoming(t));
    $('tx-allocate').dataset.id = t.id;
    $('tx-allocate-text').textContent = allocated ? 'Allocated to funds · reverse' : 'Allocate to funds';
    $('tx-allocate').dataset.done = String(allocated);
    $('tx-source').hidden = false;
    $('tx-source').innerHTML = t.bank
        ? `${icon('i-check', 'ic ic-sm')}<span>${escapeHtml(`${t.bank.bank} – ${sourceLabel(t.bank.sources || ['sms'])}`)}${t.bank.ref ? ` · Ref ${escapeHtml(t.bank.ref)}` : ''}${t.bank.last4 ? ` · ••${escapeHtml(t.bank.last4)}` : ''} · Bank-verified</span>`
        : '<span>Manual entry</span>';
    openOrSwap('modal-tx');
};

const budgetOn = () => state.config.budgetOn !== false;
const setBudgetOn = (on) => {
    state.config.budgetOn = !!on;
    if (!commitState('That')) return;
    haptic();
    showToast(on ? 'Monthly budget is on' : 'Monthly budget is off. Income and spending are still tracked; your budget settings are kept.', 'info');
    renderActive();
};
const budgetAlert = (categoryId) => {
    if (!budgetOn()) return;
    const s = monthStats();
    const limitUsd = state.config.categoryBudgets[categoryId];
    if (limitUsd) {
        const limit = budgetIn(limitUsd, dcur());
        const pct = ((s.byCat[categoryId] || 0) / limit) * 100;
        const name = catById(categoryId).name;
        if (pct >= 100) { showToast(`You're over your ${name} budget this month (${Math.round(pct)}%).`, 'warning'); return; }
        if (pct >= 80) { showToast(`You've used ${Math.round(pct)}% of your ${name} budget.`, 'warning'); return; }
    }
    if (s.budgetPct >= 100) showToast(`You're over this month's budget (${Math.round(s.budgetPct)}%).`, 'warning');
    else if (s.budgetPct >= 80) showToast(`You've used ${Math.round(s.budgetPct)}% of this month's budget.`, 'warning');
};

const prevFx = (id) => { const t = id && state.transactions.find((x) => x.id === id); return t ? t.fx || null : null; };
const submitTx = async () => {
    const id = $('tx-id').value;
    const amount = toNumber($('tx-amount').value, NaN);
    const currency = normCur($('tx-currency').value);
    const desc = $('tx-desc').value.trim();
    const date = $('tx-date').value;
    const note = $('tx-note').value.trim();
    const accountId = $('tx-account').value || state.accounts[0].id;
    const catInput = document.querySelector('input[name="tx-category"]:checked');
    const category = catInput ? catInput.value : FALLBACK_CATEGORY[txType];

    if (!(amount > 0)) return fieldError($('tx-amount'), 'Enter an amount greater than zero.');
    // Paid in another currency from a card or bank account: saved as what left the account, with the original kept.
    let fx = null;
    let saveAmount = amount;
    let saveCurrency = currency;
    if (!$('tx-charged-field').hidden) {
        const acc = state.accounts.find((a) => a.id === accountId);
        const charged = toNumber($('tx-charged').value, NaN);
        if (!(charged > 0)) return fieldError($('tx-charged'), `Enter what ${acc.name} was charged, or leave Vela's estimate.`);
        const estimate = fxCharge(amount, currency, acc);
        const real = txChargedTouched && Math.abs(charged - estimate) > 0.009;
        const fee = real ? learnFxFee(acc, amount, currency, charged) : fxFeeFor(acc);
        if (real && fee !== null) setTimeout(() => showToast(`Exact amount saved. Vela learned ${acc.name} takes about ${fee}% on foreign payments, so the next ones will be much closer.`, 'success'), 600);
        fx = { amount, currency, rate: convertAmount(1, currency, acc.currency), fee: fee === null ? fxFeeFor(acc) : fee, estimated: !real && !(prevFx(id) && !prevFx(id).estimated && Math.abs(charged - (state.transactions.find((x) => x.id === id) || {}).amount) < 0.01) };
        saveAmount = round2(charged);
        saveCurrency = acc.currency;
    }
    if (!desc) return fieldError($('tx-desc'), txType === 'income' ? 'Add where the money came from, like "Salary".' : 'Add a short description, like "Groceries".');
    if (!isISODate(date)) return fieldError($('tx-date'), 'Pick a date.');
    // Paid from a fund that hasn't got enough: ask where the rest comes from (once per entry).
    let coverNeed = 0;
    const coverFund = txType === 'expense' && txSectionId && !$('tx-section-field').hidden ? secById(txSectionId) : null;
    if (coverFund && date <= todayISO() && !txWaiting) {
        const prevT = id ? state.transactions.find((x) => x.id === id) : null;
        const have = round2((sectionBalances()[coverFund.id] || 0) + (prevT && prevT.sectionId === coverFund.id && !isUpcoming(prevT) ? toDisplay(prevT.amount, prevT.currency) : 0));
        coverNeed = round2(toDisplay(saveAmount, saveCurrency) - Math.max(0, have));
        if (coverNeed > 0.004 && txCover === null) { showTxCover(coverFund, have, coverNeed, accountId); return false; }
    }

    const prev = id ? state.transactions.find((t) => t.id === id) : null;
    let receipt = prev ? prev.receipt : null;
    if (receiptDraft.mode === 'new') {
        try {
            const rid = generateId();
            await receiptStore.put(rid, receiptDraft.blob);
            if (receipt) removeReceipt(receipt);
            receipt = { id: rid, path: null };
        } catch (err) {
            showToast("The receipt photo couldn't be saved on this device. The entry was saved without it.", 'warning');
        }
    } else if (receiptDraft.mode === 'remove' && receipt) {
        removeReceipt(receipt);
        receipt = null;
    }

    let record;
    if (prev) {
        const idx = state.transactions.findIndex((t) => t.id === id);
        const waiting = date > todayISO() || txWaiting;
        record = { ...prev, type: txType, desc, amount: saveAmount, currency: saveCurrency, category, date, note, accountId, receipt, fixed: txKind === 'fixed' || !!prev.recurringId, pending: waiting };
        if (cleanTime($('tx-time').value)) record.time = $('tx-time').value; else delete record.time;
        if (txType === 'income' && typeof txInBudget === 'boolean') record.inBudget = txInBudget; else delete record.inBudget;
        if (txType === 'income' && txShareBill()) { record.shareOf = txShareBill().id; record.inBudget = false; } else delete record.shareOf;
        if (fx) record.fx = fx; else delete record.fx;
        if (txType === 'expense' && txTripId) record.tripId = txTripId; else delete record.tripId;
        if (txType === 'expense' && txBillRef()) record.billRef = txBillRef(); else delete record.billRef;
        if (txType === 'expense' && txSectionId && secById(txSectionId)) record.sectionId = txSectionId; else delete record.sectionId;
        if (!$('tx-before-row').hidden && txBefore) record.beforeBalance = true; else delete record.beforeBalance;
        // Marked done here: same as tapping Received / Paid. Marked not done: it waits again, with reminders.
        if (prev.pending && !waiting) { record.paidAt = new Date().toISOString(); record.dueDate = prev.dueDate || prev.date; cancelPaymentReminders(`tx:${id}`); }
        if (!prev.pending && waiting) delete record.paidAt;
        if (prev.pending !== waiting) setTimeout(scheduleReminders, 0);
        state.transactions[idx] = record;
        teachBillRef(record);
    } else {
        record = { id: generateId(), type: txType, desc, amount: saveAmount, currency: saveCurrency, category, date, note, createdAt: Date.now(), recurringId: null, accountId, receipt, fixed: txKind === 'fixed', pending: date > todayISO() || txWaiting };
        if (cleanTime($('tx-time').value)) record.time = $('tx-time').value;
        if (txType === 'income' && typeof txInBudget === 'boolean') record.inBudget = txInBudget;
        if (txType === 'income' && txShareBill()) { record.shareOf = txShareBill().id; record.inBudget = false; }
        if (txType === 'expense' && txBillRef()) record.billRef = txBillRef();
        if (txType === 'expense' && txParts >= 2) {
            const plan = makePlan({ name: desc, amount: saveAmount, currency: saveCurrency, category, accountId, firstDate: date, count: txParts, done: 1 });
            if (plan) { record.recurringId = plan.id; record.note = [record.note, `Part 1 of ${txParts}`].filter(Boolean).join(' · '); setTimeout(() => showToast(`${desc}: part 1 of ${txParts} saved. The next part is expected ${shortDate(plan.nextDate)}.`, 'success'), 450); }
        }
        if (fx) record.fx = fx;
        if (txType === 'expense' && txTripId) record.tripId = txTripId;
        if (txType === 'expense' && txSectionId && secById(txSectionId) && (txSectionTouched || (sectionBalances()[txSectionId] || 0) + 0.004 >= toDisplay(saveAmount, saveCurrency))) record.sectionId = txSectionId;
        if (!$('tx-before-row').hidden && txBefore) record.beforeBalance = true;
        if (record.pending) setTimeout(scheduleReminders, 0);
        // A new fixed entry that repeats becomes a monthly fixed payment; this entry is its first one.
        // Fixed income is only expected each month: it counts when you tap Received (never on its own, never twice).
        if (record.fixed && isOn($('tx-repeat'))) {
            const day = parseDate(date).getDate();
            const bill = { id: generateId(), type: txType, name: desc, amount, currency, category, frequency: 'monthly', nextDate: advanceDate(date, 'monthly', day), anchorDay: day, autoLog: txType === 'expense', accountId, createdAt: Date.now() };
            state.recurring.push(bill);
            record.recurringId = bill.id;
            queueSync('recurring', bill.id, 'upsert', false);
            setTimeout(scheduleReminders, 0);
        }
        state.transactions.push(record);
        teachBillRef(record);
    }
    if (coverNeed > 0.004 && txCover === 'none') delete record.sectionId;
    if (coverNeed > 0.004 && txCover && secById(txCover) && record.sectionId) {
        state.config.sectionMoves = [...secMoves(), { id: generateId(), date, kind: 'move', incomeId: null, from: txCover, to: record.sectionId, amount: coverNeed, currency: dcur(), note: `To cover ${desc.slice(0, 80)}` }];
        const coverMsg = `${formatCurrency(coverNeed, dcur())} moved from ${secById(txCover).name} to ${secById(record.sectionId).name}`;
        setTimeout(() => showToast(coverMsg, 'success'), 400);
    }
    resetTxCover();
    if (record.type === 'income') {
        const shareNote = (m) => m.incomeId === record.id && m.kind === 'income' && /^Share of /.test(m.note || '');
        state.config.sectionMoves = secMoves().filter((m) => !shareNote(m));
        const bill = record.shareOf && state.recurring.find((b) => b.id === record.shareOf);
        const fund = fundForBill(bill);
        if (bill && fund && !record.pending) {
            state.config.sectionMoves = [...secMoves(), { id: generateId(), date: record.date, kind: 'income', incomeId: record.id, from: null, to: fund.id, amount: round2(toDisplay(record.amount, record.currency)), currency: dcur(), accountId: record.accountId || undefined, note: `Share of ${bill.name}`.slice(0, 120) }];
            setTimeout(() => showToast(`${formatCurrency(record.amount, record.currency)} for ${bill.name} is in your ${fund.name} fund (not your budget)`, 'success'), 500);
        }
    }
    state.config.lastCategory[txType] = category;
    state.config.lastAccount = accountId;
    if (txType === 'expense' && secList().length && txSectionTouched) learnSection(category, record.sectionId || null);
    if (smsEditing && !id) smsEditSaved(record);
    if (!commitState(txType === 'income' ? 'The income' : 'The expense')) return false;
    haptic('MEDIUM');
    queueSync('transaction', record.id, 'upsert');
    if (receipt && !receipt.path) uploadReceipt(record);
    closeSheet('modal-tx');
    if (txType === 'income' && !id && secList().length && !isUpcoming(record) && !record.shareOf && allocatesIncome(record)) {
        setTimeout(() => openDivide(record.id), 450);
    } else if (txType === 'income') {
        const d = parseDate(date);
        const f = fixedForMonth(d.getFullYear(), d.getMonth());
        const c = dcur();
        showToast(f.total > 0
            ? `${monthName(d.getFullYear(), d.getMonth(), { month: 'long' })}: income ${formatCurrency(f.income, c)} − fixed ${formatCurrency(f.total, c)} = ${formatCurrency(f.left, c)} left${isUpcoming(record) ? ` (this income counts from ${shortDate(date)})` : ''}`
            : (isUpcoming(record) ? `Saved as waiting: ${formatCurrency(amount, currency)} on ${shortDate(date)}. Tap “Received” when it arrives and it counts in your balance.` : `Income added: ${formatCurrency(amount, currency)}`), 'success');
    } else if (isUpcoming(record)) {
        showToast(`Saved as waiting: ${formatCurrency(amount, currency)} on ${shortDate(date)}. Tap “Paid” when it’s done and it counts in your balance.`, 'info');
    } else {
        // Saved to another account than the one you're in: say where it went (it shows there, not here).
        const elsewhere = viewId() !== 'all' && accountId !== viewId() ? state.accounts.find((x) => x.id === accountId) : null;
        showToast(elsewhere ? `Saved to ${elsewhere.name}` : id ? 'Saved' : `${txType === 'income' ? 'Income' : 'Expense'} added: ${formatCurrency(amount, currency)}`, 'success');
        const now = new Date();
        if (txType === 'expense' && inMonth(record, now.getFullYear(), now.getMonth())) setTimeout(() => budgetAlert(category), 400);
    }
    renderActive();
    return true;
};

const deleteTx = (id) => {
    const t = state.transactions.find((x) => x.id === id);
    if (!t) return;
    showConfirm({
        title: `Delete this ${t.type === 'income' ? 'income' : 'expense'}?`,
        message: `"${t.desc}" (${formatCurrency(t.amount, t.currency)}) will be removed.`,
        onConfirm: () => {
            state.transactions = state.transactions.filter((x) => x.id !== id);
            // A divided income: what it put in the sections goes too (moves between sections stay).
            if (t.type === 'income' && secMoves().some((m) => m.incomeId === id)) state.config.sectionMoves = secMoves().filter((m) => !(m.incomeId === id && m.kind !== 'move'));
            if (!commitState('Deleting it')) return;
            if (t.receipt) removeReceipt(t.receipt);
            queueSync('transaction', id, 'delete');
            closeSheet('modal-tx');
            showToast('Deleted', 'success');
            renderActive();
        }
    });
};

/* =========================================================================
   21b. Smart add: local prices, your usual items, price check, Vela bot
   ========================================================================= */
// Everyday prices people actually pay. [name, category, price, a food or drink]
const PRICE_BOOK = {
    LKR: {
        region: 'Sri Lanka',
        items: [
            ['Rice & curry', 'Food', 450, 1], ['Chicken kottu', 'Food', 1100, 1], ['Fried rice', 'Food', 950, 1],
            ['String hoppers', 'Food', 350, 1], ['Egg hopper', 'Food', 120, 1], ['Short eats', 'Food', 150, 1],
            ['Lunch packet', 'Food', 500, 1], ['Plain tea', 'Food', 80, 1], ['Milk tea', 'Food', 120, 1],
            ['Coffee', 'Food', 300, 1], ['Fresh juice', 'Food', 350, 1], ['Water bottle', 'Food', 120, 1],
            ['Burger', 'Food', 1300, 1], ['Pizza', 'Food', 3200, 1], ['Bread loaf', 'Food', 180, 0], ['Groceries', 'Food', 6000, 0],
            ['Bus fare', 'Travel', 100, 0], ['Tuk-tuk ride', 'Travel', 450, 0], ['PickMe / Uber', 'Travel', 900, 0],
            ['Train ticket', 'Travel', 250, 0], ['Petrol (1 L)', 'Travel', 310, 0],
            ['Mobile reload', 'Utilities', 500, 0], ['Electricity bill', 'Utilities', 4500, 0], ['Water bill', 'Utilities', 1200, 0],
            ['Internet bill', 'Utilities', 3500, 0], ['Pharmacy', 'Health', 1500, 0], ['Doctor visit', 'Health', 2500, 0],
            ['Movie ticket', 'Entertainment', 1500, 0]
        ]
    },
    INR: {
        region: 'India',
        items: [
            ['Thali', 'Food', 180, 1], ['Biryani', 'Food', 250, 1], ['Masala dosa', 'Food', 90, 1], ['Idli plate', 'Food', 60, 1],
            ['Samosa', 'Food', 20, 1], ['Chai', 'Food', 20, 1], ['Coffee', 'Food', 150, 1], ['Lassi', 'Food', 60, 1],
            ['Water bottle', 'Food', 20, 1], ['Burger', 'Food', 180, 1], ['Pizza', 'Food', 450, 1], ['Groceries', 'Food', 2500, 0],
            ['Bus fare', 'Travel', 25, 0], ['Auto ride', 'Travel', 80, 0], ['Uber / Ola', 'Travel', 250, 0], ['Metro ticket', 'Travel', 40, 0],
            ['Petrol (1 L)', 'Travel', 105, 0], ['Mobile recharge', 'Utilities', 300, 0], ['Electricity bill', 'Utilities', 1500, 0],
            ['Internet bill', 'Utilities', 700, 0], ['Pharmacy', 'Health', 300, 0], ['Doctor visit', 'Health', 500, 0],
            ['Movie ticket', 'Entertainment', 250, 0]
        ]
    },
    USD: {
        region: 'the US',
        items: [
            ['Lunch', 'Food', 15, 1], ['Dinner out', 'Food', 30, 1], ['Burger meal', 'Food', 12, 1], ['Sandwich', 'Food', 9, 1],
            ['Pizza', 'Food', 18, 1], ['Salad bowl', 'Food', 13, 1], ['Coffee', 'Food', 5, 1], ['Tea', 'Food', 3.5, 1],
            ['Soft drink', 'Food', 2.5, 1], ['Water bottle', 'Food', 2, 1], ['Dessert', 'Food', 7, 1], ['Groceries', 'Food', 120, 0],
            ['Bus fare', 'Travel', 2.75, 0], ['Taxi / Uber', 'Travel', 18, 0], ['Fuel fill-up', 'Travel', 50, 0], ['Parking', 'Travel', 10, 0],
            ['Phone bill', 'Utilities', 45, 0], ['Electricity bill', 'Utilities', 120, 0], ['Internet bill', 'Utilities', 60, 0],
            ['Pharmacy', 'Health', 20, 0], ['Doctor visit', 'Health', 150, 0], ['Movie ticket', 'Entertainment', 15, 0],
            ['Streaming', 'Entertainment', 15, 0]
        ]
    }
};
// Rough price level against the US, for currencies without their own list.
const PRICE_LEVEL = { EUR: 0.85, GBP: 0.9, AED: 0.7, SAR: 0.6, QAR: 0.7, KWD: 0.6, OMR: 0.6, AUD: 0.9, CAD: 0.9, SGD: 0.85, MYR: 0.35, JPY: 0.65, CNY: 0.4, MVR: 0.6 };
const REGION_NAMES = { EUR: 'the euro area', GBP: 'the UK', AED: 'the UAE', SAR: 'Saudi Arabia', QAR: 'Qatar', KWD: 'Kuwait', OMR: 'Oman', AUD: 'Australia', CAD: 'Canada', SGD: 'Singapore', MYR: 'Malaysia', JPY: 'Japan', CNY: 'China', MVR: 'the Maldives' };
// Words that point to a category, so typing "kottu" or "bus" picks it for you.
const CATEGORY_HINTS = [
    ['Food', /\b(food|lunch|dinner|breakfast|meal|rice|kottu|hopper|biryani|thali|dosa|pizza|burger|sandwich|coffee|tea|chai|cafe|restaurant|grocer|groceries|bakery|bread|snack|short eats|juice|water|kfc|mcdonald|domino|keells|cargills|uber eats|dessert|cake)/],
    ['Travel', /\b(bus|train|taxi|uber|pickme|tuk|auto ride|fuel|petrol|diesel|parking|toll|metro|flight|ticket to|fare)/],
    ['Utilities', /\b(electric|ceb|leco|water bill|internet|wifi|broadband|phone bill|reload|recharge|dialog|mobitel|airtel|hutch|gas bill|bill)/],
    ['Rent', /\b(rent|lease|landlord|boarding)/],
    ['Health', /\b(doctor|pharmacy|medicine|hospital|clinic|dentist|channel|lab test|vitamin)/],
    ['Shopping', /\b(clothes|shoes|shirt|dress|daraz|amazon|shopping|mall|gift for)/],
    ['Entertainment', /\b(movie|cinema|netflix|spotify|youtube|game|concert|party|streaming)/]
];

const normDesc = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const nicePrice = (v, cur) => {
    const step = v >= 5000 ? 100 : v >= 500 ? 10 : v >= 50 ? 5 : v >= 5 ? 0.5 : 0.1;
    const r = Math.max(step, Math.round(v / step) * step);
    const d = decimalsFor(cur);
    return d === 0 ? Math.max(1, Math.round(r)) : Number(r.toFixed(d));
};
const median = (arr) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const expenseCatExists = (id) => state.categories.some((c) => c.id === id && c.type === 'expense');

// The price list for a currency: its own list, or US prices scaled to the local price level.
// Prices you change (and items you add) are kept in config.priceBook[currency][name].
const priceList = (cur) => {
    const own = PRICE_BOOK[cur];
    const src = own || PRICE_BOOK.USD;
    const factor = own ? 1 : convertAmount(1, 'USD', cur) * (PRICE_LEVEL[cur] || 0.7);
    const mine = state.config.priceBook[cur] || {};
    const items = src.items.map(([name, category, price, meal]) => ({
        name,
        category,
        meal: !!meal,
        price: mine[name] && mine[name].price > 0 ? mine[name].price : nicePrice(price * factor, cur)
    }));
    Object.keys(mine).forEach((name) => {
        if (mine[name].added && !items.some((i) => i.name === name)) items.push({ name, category: mine[name].category || 'Food', meal: true, price: mine[name].price, custom: true });
    });
    return { region: own ? own.region : (REGION_NAMES[cur] || cur), approx: !own, items };
};

const rememberPrice = (cur, name, price, extra = {}) => {
    const book = state.config.priceBook[cur] || (state.config.priceBook[cur] = {});
    book[name] = { ...(book[name] || {}), ...extra, price };
    saveState();
};

// What you've bought in the last 6 months, grouped by description.
const historyStats = () => {
    const cutoff = toISODate(addDays(new Date(), -183));
    const map = new Map();
    state.transactions.forEach((t) => {
        if (t.type !== 'expense' || t.date < cutoff || !t.desc) return;
        const key = normDesc(t.desc);
        let g = map.get(key);
        if (!g) { g = { key, count: 0, last: t, usd: [] }; map.set(key, g); }
        g.count += 1;
        g.usd.push(convertAmount(t.amount, t.currency, 'USD'));
        if (t.date > g.last.date || (t.date === g.last.date && (t.createdAt || 0) > (g.last.createdAt || 0))) g.last = t;
    });
    return map;
};

let txHistory = new Map();
// While the entry form is open, the quick picks and the price list don't change: work them out once, not on every letter.
let txSession = { picks: new Map(), prices: new Map() };
const resetTxSession = () => { txSession = { picks: new Map(), prices: new Map() }; };
const sessionPriceList = (cur) => {
    if (!txSession.prices.has(cur)) txSession.prices.set(cur, priceList(cur));
    return txSession.prices.get(cur);
};
let txCatTouched = false;
let txPicks = [];

const selectTxCategory = (id) => {
    const input = document.querySelector(`input[name="tx-category"][value="${CSS.escape(id)}"]`);
    if (input) input.checked = true;
};

// ---- Name suggestions while typing (entries, bills and regular income, goals, people, accounts) ----
// Everyday names people type, with other words they're known by (typing "nw" finds Water bill via NWSDB).
const COMMON_NAMES = {
    expense: [
        ['Water bill', 'Utilities', 'nwsdb water board national supply'], ['Electricity bill', 'Utilities', 'ceb leco light current power electric'],
        ['Phone bill', 'Utilities', 'mobile postpaid dialog mobitel hutch airtel'], ['Internet bill', 'Utilities', 'wifi broadband fibre router data'],
        ['TV subscription', 'Entertainment', 'peo dialog tv cable satellite'], ['Mobile reload', 'Utilities', 'top up recharge data card'],
        ['Gas cylinder', 'Utilities', 'litro laugfs cooking lp'], ['Garbage collection', 'Utilities', 'waste municipal council'],
        ['House rent', 'Rent', 'home annex apartment'], ['Boarding fee', 'Rent', 'hostel room boarding'],
        ['School van', 'Travel', 'kids transport van fee'], ['School fees', 'Other', 'facility fee education'],
        ['Tuition class', 'Other', 'class tuition education teacher'], ['Loan instalment', 'Other', 'emi loan bank repayment'],
        ['Vehicle leasing', 'Other', 'lease car bike three wheeler'], ['Vehicle insurance', 'Other', 'insurance car bike motor'],
        ['Life insurance', 'Other', 'policy assurance premium'], ['Medical insurance', 'Health', 'health policy premium'],
        ['Credit card bill', 'Other', 'card payment settlement'], ['Gym membership', 'Health', 'fitness gym'],
        ['Newspaper', 'Other', 'paper daily'], ['Domestic help', 'Other', 'maid helper nanny'],
        ['Fuel', 'Travel', 'petrol diesel ceypetco ioc'], ['Groceries', 'Food', 'supermarket market vegetables'],
        ['Medicine', 'Health', 'pharmacy drugs tablets'], ['Doctor channelling', 'Health', 'channel clinic consultation'],
        ['Bus fare', 'Travel', 'transport ticket'], ['Tuk-tuk ride', 'Travel', 'three wheeler taxi'],
        ['Vehicle service', 'Travel', 'repair garage oil'], ['Haircut', 'Other', 'salon barber'],
        ['Donation', 'Other', 'temple church charity dana'], ['Pocket money', 'Other', 'kids allowance']
    ],
    income: [
        ['Salary', 'Salary', 'pay wages monthly'], ['Allowance', 'Salary', 'pocket money monthly'], ['Bonus', 'Salary', 'incentive'],
        ['Overtime', 'Salary', 'ot extra hours'], ['Rent received', 'OtherIncome', 'rental tenant house'], ['Pension', 'OtherIncome', 'retirement'],
        ['Interest', 'Investment', 'fd fixed deposit savings'], ['Dividends', 'Investment', 'shares stocks cse'],
        ['Freelance work', 'Freelance', 'fiverr upwork client project'], ['Business income', 'Business', 'sales shop profit'],
        ['Commission', 'Business', 'sales agent'], ['Scholarship', 'OtherIncome', 'mahapola bursary'],
        ['Gift received', 'Gift', 'money from family'], ['Money from abroad', 'OtherIncome', 'remittance foreign']
    ],
    goal: [['Emergency fund', '', 'savings rainy day'], ['New phone', '', 'mobile iphone samsung'], ['Laptop', '', 'computer'],
        ['Bike', '', 'motorbike scooter'], ['Car', '', 'vehicle'], ['House', '', 'home land'], ['Wedding', '', 'marriage'],
        ['Holiday trip', '', 'vacation travel tour'], ['Education', '', 'degree course studies'], ['Gold jewellery', '', 'necklace ring']]
};
// Brands: every word of the name and of the other names it is known by (NWSDB, Ceylon Electricity...).
const brandWords = (b) => b.words || (b.words = [...new Set(`${b.name} ${b.start.source}`.toLowerCase().match(/[a-z0-9]{2,}/g) || [])]);
const wordsMatch = (words, q) => q.split(/\s+/).filter(Boolean).every((part) => words.some((w) => w.startsWith(part)));
// kind: 'expense' | 'income' | 'goal' | 'bank'. past: names you used before (shown first).
const nameSuggestions = (text, kind, past = []) => {
    const q = String(text || '').trim().toLowerCase();
    if (q.length < 2) return [];
    const out = [];
    const seen = new Set([q]);
    const add = (item) => { const k = item.name.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(item); } };
    past.forEach((p) => { if (wordsMatch(p.name.toLowerCase().match(/[a-z0-9]+/g) || [], q)) add({ ...p, brand: brandOfName(p.name) }); });
    (COMMON_NAMES[kind] || []).forEach(([name, cat, also]) => { if (wordsMatch(`${name} ${also}`.toLowerCase().match(/[a-z0-9]+/g) || [], q)) add({ name, cat }); });
    if (kind !== 'goal' && kind !== 'people') {
        BRANDS.filter((b) => (kind === 'bank' ? b.cat === null : kind === 'income' ? b.cat === null : b.cat !== null) && wordsMatch(brandWords(b), q))
            // Brands whose own name matches first, then ones found by another name; real logos before badges.
            .map((b) => ({ b, rank: (wordsMatch(b.name.toLowerCase().match(/[a-z0-9]+/g) || [], q) ? 2 : 0) + (logoSlug(b.slug) ? 1 : 0) }))
            .sort((x, y) => y.rank - x.rank).map((x) => x.b)
            .forEach((b) => add({ name: b.name, cat: kind === 'expense' ? brandCategory(b) : null, brand: b }));
    }
    return out.slice(0, 6);
};
const nameChips = (list, target, type) => list.map((x) => `<button type="button" class="brand-pick" data-name-pick="${escapeHtml(x.name)}" data-name-for="${target}" data-name-cat="${escapeHtml(x.cat || '')}"${x.amount ? ` data-name-amount="${x.amount}"` : ''}>${x.brand ? brandBadge(x.brand, ' is-mini') : x.cat ? catBadge(x.cat, type).replace('class="cat-badge', 'class="cat-badge is-mini') : '<span class="chip-dot"></span>'}<span>${escapeHtml(x.name)}</span></button>`).join('');
const NAME_BOXES = {
    bill: { input: 'bill-name', box: 'bill-name-suggest', kind: () => billType, type: () => billType,
        past: () => state.recurring.filter((b) => b.type === billType && b.id !== $('bill-id').value).map((b) => ({ name: b.name, cat: b.category, amount: b.amount }))
            .concat(state.transactions.filter((t) => t.type === billType && t.fixed).map((t) => ({ name: t.desc, cat: t.category, amount: t.amount }))) },
    goal: { input: 'goal-name', box: 'goal-name-suggest', kind: () => 'goal', type: () => 'expense', past: () => [] },
    debt: { input: 'debt-person', box: 'debt-person-suggest', kind: () => 'people', type: () => 'expense',
        past: () => [...new Set(state.debts.map((d) => d.person))].map((name) => ({ name })) },
    account: { input: 'account-name', box: 'account-name-suggest', kind: () => 'bank', type: () => 'expense',
        past: () => [] }
};
const renderNameBox = (key) => {
    const cfg = NAME_BOXES[key];
    const input = $(cfg.input);
    const box = $(cfg.box);
    if (!input || !box) return;
    const list = document.activeElement === input ? nameSuggestions(input.value, cfg.kind(), cfg.past()) : [];
    box.hidden = !list.length;
    box.innerHTML = nameChips(list, key, cfg.type());
};
const pickName = (d) => {
    const target = d.nameFor;
    haptic();
    if (target === 'tx') {
        pickDescBrand(d.namePick);
        if (d.nameCat && !txCatTouched && catsOfType(txType).some((c) => c.id === d.nameCat)) selectTxCategory(d.nameCat);
        return;
    }
    const cfg = NAME_BOXES[target];
    if (!cfg) return;
    $(cfg.input).value = d.namePick;
    $(cfg.box).hidden = true;
    if (target === 'bill') {
        if (d.nameCat && catsOfType(billType).some((c) => c.id === d.nameCat)) $('bill-category').value = d.nameCat;
        if (d.nameAmount && !(toNumber($('bill-amount').value, 0) > 0)) $('bill-amount').value = d.nameAmount;
    }
    if (target === 'account') $(cfg.input).dispatchEvent(new Event('input', { bubbles: true }));
};

// The name box: the shop's real logo appears inside it as soon as the name matches a known brand, and while
// typing, brands whose name starts with the letters typed are offered with their logos (tap to fill the name).
const descBrands = (text) => {
    const exact = brandFor(text);
    return nameSuggestions(text, txType).filter((x) => !(exact && x.brand && x.brand.slug === exact.slug)).slice(0, 5);
};
const updateDescLogo = () => {
    const input = $('tx-desc');
    const name = input.value.trim();
    const own = name ? customBadge(name, ' is-field') : '';
    const b = name ? brandFor(name) : null;
    $('tx-desc-logo').innerHTML = own || (b ? brandBadge(b, ' is-field') : '');
    $('tx-desc-wrap').classList.toggle('has-brand', !!(own || b));
    // Add / change / remove your own logo for this name (shops you pay, not income like a salary).
    const row = $('tx-logo-row');
    row.hidden = name.length < 2 || (txType !== 'expense' && !own);
    const picked = chosenBrand(name);
    $('tx-logo-add-text').textContent = own && !picked ? 'Change photo' : b && logoSlug(b.slug) ? 'Use my own photo' : 'Add a photo logo';
    $('tx-logo-pick-text').textContent = picked ? 'Change brand logo' : b ? 'Not this logo?' : 'Choose a brand logo';
    $('tx-logo-remove').hidden = !own;
    const list = document.activeElement === input || input.dataset.typing === '1' ? descBrands(input.value) : [];
    const box = $('tx-brand-suggest');
    box.hidden = !list.length;
    box.innerHTML = nameChips(list, 'tx', txType);
};
// Choose the right logo from Vela's list (when the name matched the wrong one, or none).
let brandPickFor = null;
const renderBrandPick = () => {
    const q = $('brand-pick-search').value.trim().toLowerCase();
    const list = BRANDS.filter((b) => logoSlug(b.slug) && (!q || b.name.toLowerCase().includes(q) || b.slug.includes(q.replace(/[^a-z0-9]/g, ''))))
        .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 80);
    $('brand-pick-grid').innerHTML = list.length ? list.map((b) => `<button type="button" class="brand-choice" data-brand-choose="${escapeHtml(b.slug)}">
            <span class="cat-badge brand-badge has-logo"><img src="logos/${logoSlug(b.slug)}.webp" alt="" loading="lazy" decoding="async" draggable="false"></span>
            <span>${escapeHtml(b.name)}</span></button>`).join('')
        : `<p class="field-hint">No logo called "${escapeHtml(q)}". You can add a photo of the logo instead.</p>`;
};
const openBrandPick = () => {
    const name = $('tx-desc').value.trim();
    if (name.length < 2) { fieldError($('tx-desc'), 'Type the name first.'); return; }
    brandPickFor = name;
    $('brand-pick-title').textContent = `Logo for "${name}"`;
    $('brand-pick-search').value = '';
    $('brand-pick-auto').hidden = !chosenBrand(name);
    renderBrandPick();
    openOrSwap('modal-brand-pick');
    setTimeout(() => $('brand-pick-search').focus(), 350);
};
const chooseBrandLogo = (slug) => {
    const name = brandPickFor;
    if (!name) return;
    if (!setShopLogo(name, slug ? `brand:${slug}` : null)) { showToast('No room left on this phone for more logos.', 'error'); return; }
    brandMemo.clear();
    closeSheet('modal-brand-pick');
    const b = slug ? BRANDS.find((x) => x.slug === slug) : null;
    if (b && txType === 'expense' && !txCatTouched) { const cat = brandCategory(b); if (cat) selectTxCategory(cat); }
    updateDescLogo();
    renderActive();
    showToast(b ? `${name} now shows the ${b.name} logo` : `${name} uses the automatic logo again`, 'success');
};
const pickShopLogo = () => {
    const name = $('tx-desc').value.trim();
    if (name.length < 2) return;
    const input = $('shop-logo-input');
    input.dataset.name = name;
    input.value = '';
    input.click();
};
const onShopLogoPicked = async () => {
    const input = $('shop-logo-input');
    const file = input.files && input.files[0];
    const name = input.dataset.name;
    input.value = '';
    if (!file || !name) return;
    try {
        const data = await makeShopLogo(file);
        if (!setShopLogo(name, data)) { showToast('No room left on this phone for more logos.', 'error'); return; }
        updateDescLogo();
        renderActive();
        showToast(`Logo saved for ${name}`, 'success');
    } catch (e) {
        showToast("That picture couldn't be used. Try another one.", 'error');
    }
};
const removeShopLogo = () => {
    const name = $('tx-desc').value.trim();
    setShopLogo(name, null);
    updateDescLogo();
    renderActive();
    showToast(`Logo removed for ${name}`, 'info');
};
const pickDescBrand = (name) => {
    const input = $('tx-desc');
    input.value = name;
    delete input.dataset.typing;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    $('tx-brand-suggest').hidden = true;
    haptic();
};

const renderTxSuggest = () => {
    updateDescLogo();
    const wrap = $('tx-suggest');
    const show = txType === 'expense' && !$('tx-id').value;
    wrap.hidden = !show;
    if (!show) return;
    const cur = normCur($('tx-currency').value);
    const q = normDesc($('tx-desc').value);
    const book = sessionPriceList(cur);
    const pickKey = `${cur}|${daySlot()}`;
    if (!txSession.picks.has(pickKey)) txSession.picks.set(pickKey, smartPicks(cur, 999));
    let picks = txSession.picks.get(pickKey);
    if (q) {
        const words = q.split(' ');
        const exact = picks.some((p) => normDesc(p.name) === q);
        const matches = picks.filter((p) => { const n = normDesc(p.name); return n !== q && words.every((w) => n.includes(w)); });
        // Once you've picked something, keep showing the others so you can switch.
        picks = matches.length || !exact ? matches : picks.filter((p) => normDesc(p.name) !== q);
    }
    txPicks = picks.slice(0, q ? 8 : 16);

    $('tx-suggest-src').textContent = q
        ? `${book.approx ? 'Approx. prices' : 'Typical prices'} in ${book.region}`
        : `Your usual and ${SLOT_NAMES[daySlot()]} picks first · ${book.approx ? 'approx. prices' : 'typical prices'} in ${book.region}`;
    $('tx-suggest-chips').innerHTML = txPicks.length
        ? txPicks.map((p, i) => `<button type="button" class="pick-chip" data-pick="${i}" data-kind="${p.kind}" style="--cat:${catColor(catById(p.category))}" aria-label="${escapeHtml(p.name)}, ${escapeHtml(formatCurrency(p.price, cur))}${p.kind === 'usual' ? `, you've added this ${p.count} times` : ''}">
            ${p.kind === 'usual' ? icon('i-repeat', 'ic ic-sm') : '<span class="chip-dot"></span>'}<span class="pick-name">${escapeHtml(p.name)}</span><span class="pick-price">${escapeHtml(formatCurrency(p.price, cur))}</span>
        </button>`).join('')
        : `<span class="field-hint">No quick picks match. Keep typing and save it — Vela will learn it.</span>`;
};

const applyPick = (p) => {
    if (!txKindTouched) txKind = fixedHintFor(p.name) || p.category === 'Rent' || p.category === 'Utilities' ? 'fixed' : 'variable';
    $('tx-desc').value = p.name;
    $('tx-amount').value = p.price;
    if (expenseCatExists(p.category)) { selectTxCategory(p.category); txCatTouched = true; }
    clearFieldErrors($('tx-form'));
    haptic();
    renderTxSuggest();
    updatePriceHint();
};

const BRAND_KINDS = [
    [/insur|assur|policy/i, 'aia ceylinco unionassurance allianz softlogiclife slinsurance hnbassurance janashakthi fairfirst'],
    [/educat|school|class|tuition|course|campus|stud|exam/i, 'udemy coursera duolingo edx skillshare quizlet chegg icbt nsbm sliit iit apiit esoft britishcouncil cima acca ielts'],
    [/fuel|petrol|diesel|gas station/i, 'ceypetco lankaioc sinopec shell'],
    [/game|gaming|play ?store|g ?play/i, 'steam playstation xbox nintendo roblox pubg freefire epicgames ea riot minecraft mobilelegends supercell callofduty hoyoverse king ubisoft blizzard codashop'],
    [/subscri|stream/i, 'netflix spotify disney primevideo hbomax youtube crunchyroll deezer soundcloud twitch audible hulu paramount tidal scribd viu zee5 hotstar sonyliv anghami patreon openai claude gemini perplexity canva notion dropbox grammarly'],
    [/hospital|medical|doctor|pharm|health/i, 'asiri nawaloka lankahospitals hemas durdans ninewells kingshospital osusala healthguard']
].map(([re, slugs]) => [re, new Set(slugs.split(' '))]);
const brandCategory = (brand) => {
    if (!brand) return null;
    for (const [re, slugs] of BRAND_KINDS) {
        if (!slugs.has(brand.slug)) continue;
        const mine = catsOfType('expense').find((c) => re.test(c.name));
        if (mine) return mine.id;
    }
    return brand.cat && expenseCatExists(brand.cat) ? brand.cat : null;
};
const guessCategory = (desc) => {
    const key = normDesc(desc);
    if (key.length < 2) return null;
    const g = txHistory.get(key);
    if (g && expenseCatExists(g.last.category)) return g.last.category;
    const item = sessionPriceList(normCur($('tx-currency').value)).items.find((i) => normDesc(i.name) === key);
    if (item) return item.category;
    const fromBrand = brandCategory(brandOfName(desc));
    if (fromBrand) return fromBrand;
    const hit = CATEGORY_HINTS.find(([, re]) => re.test(key));
    return hit && expenseCatExists(hit[0]) ? hit[0] : null;
};

// A gentle note when the amount is far from what you (or most people) pay.
const updatePriceHint = () => {
    const el = $('tx-price-hint');
    const hide = () => { el.hidden = true; el.textContent = ''; };
    if (txType !== 'expense') return hide();
    const amount = toNumber($('tx-amount').value, NaN);
    const key = normDesc($('tx-desc').value);
    if (!(amount > 0) || !key) return hide();
    const cur = normCur($('tx-currency').value);
    let ref = 0;
    let who = '';
    const g = txHistory.get(key);
    const editingId = $('tx-id').value;
    const own = g ? state.transactions.filter((t) => t.type === 'expense' && t.id !== editingId && normDesc(t.desc) === key) : [];
    if (own.length >= 2) {
        ref = convertAmount(median(own.map((t) => convertAmount(t.amount, t.currency, 'USD'))), 'USD', cur);
        who = 'what you usually pay';
    } else {
        const item = sessionPriceList(cur).items.find((i) => normDesc(i.name) === key);
        if (item) { ref = item.price; who = 'the typical price'; }
    }
    if (!(ref > 0)) return hide();
    const ratio = amount / ref;
    let text = '';
    if (ratio >= 2) text = `That's ${ratio >= 10 ? 'over 10' : ratio.toFixed(1)}× ${who} (${formatCurrency(ref, cur)}). Check the amount before saving.`;
    else if (ratio <= 0.2) text = `That's much less than ${who} (${formatCurrency(ref, cur)}). Missing a zero?`;
    if (!text) return hide();
    el.innerHTML = `${icon('i-alert', 'ic ic-sm')}<span>${escapeHtml(text)}</span>`;
    el.hidden = false;
};

const onTxDescInput = () => {
    if (!txKindTouched && !$('tx-id').value) setTxKind(fixedHintFor($('tx-desc').value) ? 'fixed' : 'variable');
    if (txType === 'expense' && !txCatTouched && !$('tx-id').value) {
        const cat = guessCategory($('tx-desc').value);
        if (cat) selectTxCategory(cat);
    }
    renderTxSuggest();
    updatePriceHint();
};

// The currency you usually spend in: your last-used account's, else the display currency.
const homeCurrency = () => { const a = accountById(state.config.lastAccount); return normCur(a ? a.currency : dcur()); };

/* ---- Time of day: breakfast, lunch, tea time, dinner ---- */
const daySlot = (d = new Date()) => { const h = d.getHours(); return h >= 5 && h < 11 ? 'b' : h >= 11 && h < 15 ? 'l' : h >= 15 && h < 18 ? 't' : 'd'; };
const SLOT_NAMES = { b: 'breakfast', l: 'lunch', t: 'tea time', d: 'dinner' };
const TIME_TAGS = {
    'String hoppers': 'b', 'Egg hopper': 'bd', 'Plain tea': 'bt', 'Milk tea': 'bt', Coffee: 'bt', 'Bread loaf': 'b', 'Fresh juice': 'lt',
    'Rice & curry': 'l', 'Lunch packet': 'l', 'Fried rice': 'ld', 'Chicken kottu': 'd', 'Short eats': 't', Pizza: 'd', Burger: 'ld',
    Thali: 'l', Biryani: 'ld', 'Masala dosa': 'b', 'Idli plate': 'b', Samosa: 't', Chai: 'bt', Lassi: 'l',
    Lunch: 'l', 'Dinner out': 'd', 'Burger meal': 'ld', Sandwich: 'l', 'Salad bowl': 'l', Tea: 'bt', Dessert: 'd', 'Soft drink': 'lt',
    'Bus fare': 'bd', 'Train ticket': 'bd', 'Metro ticket': 'bd', 'Tuk-tuk ride': 'bd', 'Auto ride': 'bd'
};
const fitsSlot = (name, slot) => (TIME_TAGS[name] || '').includes(slot);

// Things worth suggesting right now: what you buy at this time of day first, then the local list.
const smartPicks = (cur, limit = 16) => {
    const slot = daySlot();
    const hist = historyStats();
    // How often each thing was added at this time of day, counted in one pass.
    const atThisTime = new Map();
    state.transactions.forEach((t) => {
        if (t.type !== 'expense' || !t.createdAt || daySlot(new Date(t.createdAt)) !== slot) return;
        const k = normDesc(t.desc);
        atThisTime.set(k, (atThisTime.get(k) || 0) + 1);
    });
    const usual = [...hist.values()].filter((g) => g.count >= 2).map((g) => {
        const sameTime = atThisTime.get(g.key) || 0;
        return {
            kind: 'usual',
            name: g.last.desc,
            category: expenseCatExists(g.last.category) ? g.last.category : 'Other',
            price: g.last.currency === cur ? g.last.amount : nicePrice(convertAmount(g.last.amount, g.last.currency, cur), cur),
            count: g.count,
            score: sameTime * 3 + g.count
        };
    }).sort((a, b) => b.score - a.score).slice(0, 6);
    const seen = new Set(usual.map((p) => normDesc(p.name)));
    const book = priceList(cur).items.filter((i) => !seen.has(normDesc(i.name))).map((i, idx) => ({ kind: 'book', ...i, score: (fitsSlot(i.name, slot) ? 100 : 0) - idx }));
    book.sort((a, b) => b.score - a.score);
    return usual.concat(book).slice(0, limit);
};

/* =========================================================================
   Vela AI: one real AI assistant (Google Gemini), reached through the vela-ai
   Supabase Edge Function so the API key stays on the server. Signed-in users only.
   ========================================================================= */
const BOT_CHIPS = ['How much did I spend this month?', 'How can I save more?', 'How much budget is left?', 'Any bills coming up?'];
const botDrafts = {};
let botStarted = false;
let aiHistory = [];   // [{ role: 'user' | 'model', text }]
let aiBusy = false;
let aiUserId = null;

const botScroll = () => { const b = $('bot-body'); setTimeout(() => { b.scrollTop = b.scrollHeight; }, 30); };
const botChips = (chips) => {
    $('bot-chips').innerHTML = chips.map((c) => `<button type="button" class="chip" data-bot-chip="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('');
};
const botSay = (html, chips = BOT_CHIPS) => {
    const li = document.createElement('li');
    li.className = 'bot-msg bot-msg-bot';
    li.innerHTML = `<div class="bot-bubble">${html}</div>`;
    $('bot-log').appendChild(li);
    botChips(chips);
    botScroll();
    return li;
};
const botUser = (text) => {
    const li = document.createElement('li');
    li.className = 'bot-msg bot-msg-user';
    li.innerHTML = `<div class="bot-bubble">${escapeHtml(text)}</div>`;
    $('bot-log').appendChild(li);
    botScroll();
};
const botTyping = () => {
    const li = document.createElement('li');
    li.className = 'bot-msg bot-msg-bot';
    li.innerHTML = '<div class="bot-bubble bot-typing" aria-label="Vela AI is typing"><span></span><span></span><span></span></div>';
    $('bot-log').appendChild(li);
    botScroll();
    return li;
};
const money = (v) => escapeHtml(formatCurrency(v, dcur()));
const aiText = (t) => escapeHtml(t)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^\s*[-*•]\s+/gm, '• ')
    .replace(/\n/g, '<br>');
const daysLeftInMonth = () => { const n = new Date(); return daysInMonth(n.getFullYear(), n.getMonth()) - n.getDate() + 1; };

const setBotMode = () => {
    const on = canSync();
    $('bot-status').textContent = on ? 'Vela AI · powered by Google Gemini' : 'Sign in to chat with Vela AI';
    $('bot-new').hidden = !on;
};

const signInCard = () => `<div class="ai-offer">
        <strong>Sign in to use Vela AI</strong>
        <span>Vela AI uses your synced data to answer, so it needs your Vela account. It's free.</span>
        <div class="ai-offer-actions"><button type="button" class="btn btn-primary btn-sm" data-action="bot-signin">${icon('i-cloud', 'ic ic-sm')} Sign in</button></div>
    </div>`;

const openBot = () => {
    const uid = state.auth.user ? state.auth.user.id : null;
    if (uid !== aiUserId) { aiUserId = uid; aiHistory = []; botStarted = false; $('bot-log').innerHTML = ''; }
    setBotMode();
    if (!botStarted) {
        botStarted = true;
        const name = state.auth.user && state.auth.user.full_name && canSync() ? `, ${escapeHtml(state.auth.user.full_name.split(' ')[0])}` : '';
        botSay(canSync()
            ? `Hi${name}! I'm <strong>Vela AI</strong>. Tell me what you spent, like <em>“kottu 1200 and bus 100”</em>, and I'll set it up for you to add. Or ask me anything about your money, in English or Sinhala.`
            : `Hi! I'm <strong>Vela AI</strong>, your money assistant.${signInCard()}`, canSync() ? BOT_CHIPS : []);
    }
    openOrSwap('modal-bot');
    botScroll();
};

const newAiChat = () => {
    aiHistory = [];
    $('bot-log').innerHTML = '';
    botSay('New chat. What would you like to know?');
};

/* ---- What the AI knows: exact facts the app works out ---- */
const aiFacts = () => {
    const cur = dcur();
    const m = (v) => formatCurrency(v, cur);
    const now = new Date();
    const s = monthStats();
    const left = s.budget - s.spent;
    const catLine = (by) => Object.entries(by).sort((a, b) => b[1] - a[1]).map(([id, v]) => `${catById(id).name} ${m(v)}`).join(', ') || 'nothing';
    const lines = [
        `Today: ${now.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} (${todayISO()}), ${SLOT_NAMES[daySlot()]} time.`,
        `Display currency: ${cur}. Home currency for new entries: ${homeCurrency()}.`,
        `This month: spent ${m(s.spent)}, income ${m(s.income)}, budget ${m(s.budget)}${s.fromIncome ? ` (set from this month's income of ${m(s.plannedIncome)}${state.config.budgetSavePct ? `, keeping ${state.config.budgetSavePct}% for saving` : ''})` : ''}, ${left >= 0 ? `${m(left)} left (${m(left / daysLeftInMonth())} a day for ${daysLeftInMonth()} days)` : `${m(-left)} over budget`}. Spent on the same days last month: ${m(s.prevSpent)}.`,
        `This month by category: ${catLine(s.byCat)}.`,
        (() => { const f = fixedForMonth(); return `Fixed expenses this month: ${m(f.total)} (${m(f.paid)} paid, ${m(f.due)} still due): ${f.items.map((i) => `${i.name} ${m(i.amount)} ${i.paid ? 'paid' : 'due'} ${i.date}`).join('; ') || 'none'}. Income ${m(f.income)} minus fixed = ${m(f.left)} left for everything else.`; })()
    ];
    for (let i = 1; i <= 5; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const ms = monthStats(d.getFullYear(), d.getMonth());
        if (ms.spent || ms.income) lines.push(`${monthName(d.getFullYear(), d.getMonth())}: spent ${m(ms.spent)}, income ${m(ms.income)}; by category: ${catLine(ms.byCat)}.`);
    }
    const caps = Object.entries(state.config.categoryBudgets).map(([id, usd]) => `${catById(id).name} ${m(s.byCat[id] || 0)} of ${m(budgetIn(usd, cur))}`);
    if (caps.length) lines.push(`Category budgets this month: ${caps.join(', ')}.`);
    lines.push(`Accounts: ${state.accounts.map((a) => `${a.name} ${formatCurrency(accountBalance(a), a.currency)}`).join(', ')}; total ${m(netWorth())}.`);
    if (state.savings.length) lines.push(`Savings goals: ${state.savings.map((g) => `${g.name} ${formatCurrency(g.saved, g.currency)} of ${formatCurrency(g.target, g.currency)}${g.deadline ? ` by ${g.deadline}` : ''}`).join('; ')}.`);
    const bills = state.recurring.slice().sort((a, b) => (a.nextDate > b.nextDate ? 1 : -1)).slice(0, 8);
    if (bills.length) lines.push(`Bills and regular income: ${bills.map((b) => `${b.name} ${formatCurrency(b.amount, b.currency)} ${b.type === 'income' ? '(income) ' : ''}${dueLabel(b.nextDate).text.toLowerCase()}`).join('; ')}.`);
    const { owedToYou, youOwe } = debtTotals();
    if (owedToYou || youOwe) lines.push(`Debts: others owe the user ${m(owedToYou)}, the user owes ${m(youOwe)}.`);
    lines.push(`Usual items and local prices: ${smartPicks(homeCurrency(), 20).map((p) => `${p.name} ${formatCurrency(p.price, homeCurrency())}`).join(', ')}.`);
    const recent = sortByNewest(state.transactions).filter((t) => t.type !== 'transfer').slice(0, 60);
    if (recent.length) lines.push(`Latest entries (newest first):\n${recent.map((t) => `${t.date} ${t.type === 'income' ? '+' : '-'}${formatCurrency(t.amount, t.currency)} ${t.desc} [${catById(t.category, t.type).name}]`).join('\n')}`);
    return lines.join('\n');
};
const aiData = () => ({
    facts: aiFacts(),
    today: todayISO(),
    homeCurrency: homeCurrency(),
    currencies: Object.keys(CURRENCIES),
    categories: state.categories.map((c) => ({ id: c.id, name: c.name, type: c.type }))
});

/* ---- Entry cards the AI prepares; nothing is saved until you tap Add ---- */
const draftFromAi = (x) => {
    if (!x || typeof x !== 'object') return null;
    const type = x.type === 'income' ? 'income' : 'expense';
    const amount = toNumber(x.amount, NaN);
    if (!(amount > 0) || amount > 1e12) return null;
    const currency = isCurrency(x.currency) ? x.currency : homeCurrency();
    const category = state.categories.some((c) => c.id === x.category && c.type === type) ? x.category : FALLBACK_CATEGORY[type];
    const date = isISODate(x.date) && x.date <= toISODate(addDays(new Date(), 1)) ? x.date : todayISO();
    const desc = String(x.description || '').trim().slice(0, 80) || catById(category, type).name;
    return { type, desc, amount, currency, category, date };
};
const draftCard = (d) => {
    const id = generateId();
    botDrafts[id] = d;
    const cat = catById(d.category, d.type);
    return `<div class="bot-card" data-draft="${id}">
        <div class="bot-card-row">${entryBadge(d.desc, d.category, d.type)}<div class="bot-card-main"><strong>${escapeHtml(d.desc)}</strong><span>${escapeHtml(cat.name)} · ${escapeHtml(relativeDayLabel(d.date))}</span></div>
        <span class="amount ${d.type === 'income' ? 'text-income' : ''}">${escapeHtml(formatCurrency(d.amount, d.currency))}</span></div>
        <div class="bot-card-actions"><button type="button" class="btn btn-secondary btn-sm" data-bot-edit="${id}">Change</button><button type="button" class="btn ${d.type === 'income' ? 'btn-income' : 'btn-primary'} btn-sm" data-bot-add="${id}">Add ${d.type}</button></div>
    </div>`;
};

const quickSaveTx = (d) => {
    if (!state.accounts.length) ensureAccounts(state);
    const acc = state.accounts.find((a) => a.id === d.accountId) || state.accounts.find((a) => a.id === state.config.lastAccount) || state.accounts[0];
    const record = { id: generateId(), type: d.type, desc: d.desc, amount: d.amount, currency: d.currency, category: d.category, date: d.date, note: d.note || '', createdAt: Date.now(), recurringId: null, accountId: acc.id, receipt: null, fixed: d.type === 'expense' && !!d.fixed, pending: d.date > todayISO() };
    const tm = cleanTime(d.time) || (d.date === todayISO() ? nowTime() : null);
    if (tm) record.time = tm;
    if (d.type === 'expense' && tripIdFor(d.date)) record.tripId = tripIdFor(d.date);
    if (beforeBalanceFor(acc.id, d.date, record.time)) record.beforeBalance = true;
    if (d.type === 'expense' && autoFundFor(d.category, d.amount, d.currency)) record.sectionId = autoFundFor(d.category, d.amount, d.currency);
    state.transactions.push(record);
    state.config.lastCategory[d.type] = d.category;
    saveState();
    haptic('MEDIUM');
    queueSync('transaction', record.id, 'upsert');
    renderActive();
    return record;
};

const botAdd = (id, btn) => {
    const d = botDrafts[id];
    if (!d) return;
    delete botDrafts[id];
    const rec = quickSaveTx(d);
    const card = btn.closest('.bot-card');
    card.querySelector('.bot-card-actions').innerHTML = `<span class="bot-done">${icon('i-check', 'ic ic-sm')} Added</span><button type="button" class="btn btn-secondary btn-sm" data-bot-undo="${escapeHtml(rec.id)}">Undo</button>`;
    let extra = '';
    if (d.type === 'expense') {
        const s = monthStats();
        const left = s.budget - s.spent;
        extra = left >= 0 ? ` You have <strong>${money(left)}</strong> left in this month's budget.` : ` You're <strong>${money(-left)}</strong> over this month's budget.`;
    }
    botSay(`Done!${extra} Anything else?`);
};

const botUndo = (id, btn) => {
    if (!state.transactions.some((t) => t.id === id)) return;
    state.transactions = state.transactions.filter((t) => t.id !== id);
    saveState();
    queueSync('transaction', id, 'delete');
    renderActive();
    btn.closest('.bot-card-actions').innerHTML = '<span class="bot-done">Removed</span>';
};

const botEdit = (id) => {
    const d = botDrafts[id];
    if (!d) return;
    openAddTx(d.type);
    fillCurrencySelect($('tx-currency'), d.currency);
    $('tx-desc').value = d.desc;
    if (d.amount > 0) $('tx-amount').value = d.amount;
    $('tx-date').value = d.date;
    $('tx-time').value = cleanTime(d.time) || (d.date === todayISO() ? nowTime() : '');
    updateDateHint();
    selectTxCategory(d.category);
    txCatTouched = true;
    renderTxSuggest();
    updatePriceHint();
};


/* ---- Talking to the AI ---- */
const aiError = async (error) => {
    let status = 0;
    let code = '';
    if (error && error.context && typeof error.context.json === 'function') {
        status = error.context.status;
        try { code = (await error.context.json()).error || ''; } catch (e) { /* not JSON */ }
    }
    if (status === 404 || code === 'not_configured' || (error && (error.name === 'FunctionsRelayError'))) return "Vela AI isn't switched on yet. The app owner needs to finish its one-time setup.";
    if (status === 401) return 'Please sign in again to keep using Vela AI.';
    if (status === 429) return 'Vela AI is busy right now. Try again in a minute.';
    if (error && error.name === 'FunctionsFetchError') {
        // A function that isn't deployed answers without browser headers, so it looks like a network error.
        // If Supabase itself answers, the internet is fine and the AI just isn't switched on.
        try {
            const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: SUPABASE_ANON_KEY }, cache: 'no-store' });
            if (res.ok) return "Vela AI isn't switched on yet. The app owner needs to finish its one-time setup (deploy the vela-ai function and add a Gemini key).";
        } catch (e) { /* really offline */ }
        return "Couldn't reach Vela AI. Check your internet and try again.";
    }
    return code && code.length < 320 ? code : 'Vela AI had a problem. Try again.';
};

const aiAsk = async (text) => {
    aiBusy = true;
    $('bot-send').disabled = true;
    const typing = botTyping();
    try {
        const messages = aiHistory.slice(-12).concat({ role: 'user', text });
        const { data, error } = await supabaseClient.functions.invoke('vela-ai', { body: { messages, data: aiData() } });
        if (error) throw error;
        const drafts = (Array.isArray(data && data.drafts) ? data.drafts : []).map(draftFromAi).filter(Boolean);
        const reply = String((data && data.text) || '').trim();
        typing.remove();
        botSay((reply ? aiText(reply) : (drafts.length ? (drafts.length > 1 ? 'Here they are. Tap Add on each one to save.' : 'Here it is. Tap Add to save.') : "Sorry, I don't have an answer for that."))
            + drafts.map((d) => draftCard(d)).join(''));
        const note = drafts.length ? ` [Prepared for the user to add: ${drafts.map((d) => `${d.desc} ${formatCurrency(d.amount, d.currency)} (${d.type}, ${d.date})`).join('; ')}]` : '';
        aiHistory.push({ role: 'user', text }, { role: 'model', text: (reply || 'Prepared entries.') + note });
    } catch (err) {
        typing.remove();
        botSay(escapeHtml(await aiError(err)));
    } finally {
        aiBusy = false;
        $('bot-send').disabled = false;
    }
};

const botHandle = (raw) => {
    const text = String(raw || '').trim().slice(0, 1500);
    if (!text || aiBusy) return;
    botUser(text);
    if (!canSync()) { botSay(`To chat with me, sign in first.${signInCard()}`, []); return; }
    if (navigator.onLine === false) { botSay('Vela AI needs the internet. Connect and try again.'); return; }
    aiAsk(text);
};

/* ---- First-run card on Home ---- */
const starterHtml = () => {
    const cur = homeCurrency();
    const book = priceList(cur);
    const foods = book.items.filter((i) => i.meal).slice(0, 3);
    const travel = book.items.find((i) => i.category === 'Travel');
    const picks = travel ? foods.concat(travel) : foods;
    return `<li class="starter">
        <span class="empty-icon">${icon('i-wallet')}</span>
        <span class="empty-title">Log your first expense</span>
        <span class="empty-text">Tap something you bought today. Prices are typical for ${escapeHtml(book.region)} and you can change them.</span>
        <div class="starter-picks">${picks.map((p) => `<button type="button" class="pick-chip" data-starter-pick="${escapeHtml(p.name)}" style="--cat:${catColor(catById(p.category))}"><span class="chip-dot"></span><span class="pick-name">${escapeHtml(p.name)}</span><span class="pick-price">${escapeHtml(formatCurrency(p.price, cur))}</span></button>`).join('')}</div>
        <div class="starter-actions">
            <button type="button" class="btn btn-primary btn-sm" data-action="add-expense">${icon('i-plus', 'ic ic-sm')} Add expense</button>
            <button type="button" class="btn btn-secondary btn-sm" data-action="open-bot">${icon('i-bot', 'ic ic-sm')} Ask Vela AI</button>
        </div>
        <ul class="starter-steps">
            <li>${icon('i-check', 'ic ic-sm')}<span>Vela learns what you buy often and suggests it next time.</span></li>
            <li>${icon('i-check', 'ic ic-sm')}<span>Or tell Vela AI “kottu 1200” and it sets it up for you.</span></li>
            <li>${icon('i-check', 'ic ic-sm')}<span>Set a monthly budget in <button type="button" class="link-btn" data-goto="plan">Plan</button> to get alerts.</span></li>
        </ul>
    </li>`;
};

const starterPick = (name) => {
    const cur = homeCurrency();
    const item = priceList(cur).items.find((i) => i.name === name);
    openAddTx('expense');
    fillCurrencySelect($('tx-currency'), cur);
    if (item) applyPick(item);
};

/* =========================================================================
   22. Sheets: goals & deposits
   ========================================================================= */
const openAddGoal = () => {
    $('goal-form').reset();
    $('goal-id').value = '';
    $('goal-title').textContent = 'New savings goal';
    $('btn-submit-goal').textContent = 'Create goal';
    $('goal-saved-label').textContent = 'Already saved';
    $('btn-delete-goal').hidden = true;
    fillCurrencySelect($('goal-currency'), dcur());
    $('goal-monthly').value = '';
    fillGoalFundSelect(null);
    updateGoalMonthlyHint();
    openOrSwap('modal-goal');
};

const openEditGoal = (id) => {
    const g = state.savings.find((x) => x.id === id);
    if (!g) return;
    $('goal-form').reset();
    $('goal-id').value = g.id;
    $('goal-title').textContent = 'Edit goal';
    $('btn-submit-goal').textContent = 'Save changes';
    $('goal-saved-label').textContent = 'Saved so far';
    $('btn-delete-goal').hidden = false;
    $('goal-name').value = g.name;
    $('goal-target').value = g.target;
    fillCurrencySelect($('goal-currency'), g.currency);
    $('goal-saved').value = round2(g.saved);
    $('goal-deadline').value = g.deadline || '';
    $('goal-monthly').value = g.monthly ? round2(g.monthly) : '';
    fillGoalFundSelect(g);
    updateGoalMonthlyHint();
    openOrSwap('modal-goal');
};

// Under "Save each month": what reaches the target by the date, as a tap-to-use chip.
const fillGoalFundSelect = (g) => {
    const name = $('goal-name').value.trim() || 'this goal';
    $('goal-fund').innerHTML = `<option value="">Not in a fund</option>${secList().map((x) => `<option value="${escapeHtml(x.id)}">${escapeHtml(x.name)}</option>`).join('')}<option value="__new">New fund: ${escapeHtml(name)}</option>`;
    $('goal-fund').value = g && g.fundId && secById(g.fundId) ? g.fundId : '';
};
const updateGoalMonthlyHint = () => {
    const target = toNumber($('goal-target').value, 0);
    const saved = toNumber($('goal-saved').value, 0);
    const sug = goalSuggestMonthly(target, saved, $('goal-deadline').value);
    const cur = normCur($('goal-currency').value);
    const chip = $('goal-monthly-suggest');
    chip.hidden = !(sug > 0);
    if (sug > 0) { chip.textContent = `Use ${formatCurrency(sug, cur)} a month (reaches it by ${shortDate($('goal-deadline').value)})`; chip.dataset.v = sug; }
    const m = toNumber($('goal-monthly').value, 0);
    $('goal-monthly-hint').textContent = m > 0 && target > saved
        ? `Kept aside from your monthly budget. At this pace you reach it in about ${plural(Math.ceil((target - saved) / m), 'month')}.`
        : 'Kept aside from your monthly budget, so you don\'t spend it. Leave empty for no monthly saving.';
};
const submitGoal = () => {
    const id = $('goal-id').value;
    const name = $('goal-name').value.trim();
    const target = toNumber($('goal-target').value, NaN);
    const currency = normCur($('goal-currency').value);
    const savedRaw = $('goal-saved').value.trim();
    const saved = savedRaw === '' ? 0 : toNumber(savedRaw, NaN);
    const deadline = $('goal-deadline').value || null;
    const monthly = Math.max(0, round2(toNumber($('goal-monthly').value, 0)));
    if (!name) return fieldError($('goal-name'), 'Give your goal a name.');
    let fundId = $('goal-fund').value || null;
    if (fundId === '__new') {
        if (secList().some((o) => o.name.toLowerCase() === name.toLowerCase())) fundId = secList().find((o) => o.name.toLowerCase() === name.toLowerCase()).id;
        else {
            const used = secList().map((x) => x.color);
            const fund = { id: generateId(), name: name.slice(0, 40), mode: 'manual', value: 0, currency: dcur(), color: PALETTE.find((c) => !used.includes(c)) || 'green', icon: 'i-target', accountIds: viewId() !== 'all' ? [viewId()] : [], target: round2(convertAmount(target, normCur($('goal-currency').value), dcur())) };
            state.config.sections = [...secList(), fund];
            if (!state.config.sectionSince) state.config.sectionSince = todayISO();
            fundId = fund.id;
        }
    }
    if (!(target > 0)) return fieldError($('goal-target'), 'Enter a target greater than zero.');
    if (!(saved >= 0)) return fieldError($('goal-saved'), "The saved amount can't be negative.");
    let record;
    if (id) {
        const idx = state.savings.findIndex((g) => g.id === id);
        if (idx === -1) return false;
        record = { ...state.savings[idx], name, target, currency, saved, deadline, monthly };
        if (fundId) record.fundId = fundId; else delete record.fundId;
        state.savings[idx] = record;
    } else {
        record = { id: generateId(), name, target, currency, saved, deadline, monthly, months: {}, accountId: viewId() !== 'all' ? viewId() : null, ...(fundId ? { fundId } : {}), createdAt: Date.now() };
        state.savings.push(record);
    }
    saveState();
    queueSync('goal', record.id, 'upsert');
    closeSheet('modal-goal');
    showToast(id ? 'Goal updated' : `Goal "${name}" created`, 'success');
    renderActive();
    return true;
};

const deleteGoal = (id) => {
    const g = state.savings.find((x) => x.id === id);
    if (!g) return;
    showConfirm({
        title: 'Delete this goal?',
        message: `"${g.name}" and the ${formatCurrency(g.saved, g.currency)} recorded in it will be removed.`,
        onConfirm: () => {
            state.savings = state.savings.filter((x) => x.id !== id);
            saveState();
            queueSync('goal', id, 'delete');
            closeSheet('modal-goal');
            showToast('Goal deleted', 'success');
            renderActive();
        }
    });
};

let fundsMode = 'deposit';

const updateFundsHint = () => {
    const goal = state.savings.find((g) => g.id === $('funds-goal').value);
    const cur = $('funds-currency').value;
    $('funds-hint').textContent = !goal ? '' : goal.currency === cur
        ? `Saved so far: ${formatCurrency(goal.saved, goal.currency)} of ${formatCurrency(goal.target, goal.currency)}`
        : `Converted to ${goal.currency} at today's rate.`;
};

const setFundsMode = (mode) => {
    fundsMode = mode;
    setPressed('[data-funds-mode]', (b) => b.dataset.fundsMode === mode);
    $('btn-submit-funds').textContent = mode === 'withdraw' ? 'Withdraw' : 'Deposit';
};

const openDeposit = (goalId) => {
    if (!viewGoals().length) {
        showToast('Create a savings goal first, then deposit into it.', 'info');
        openAddGoal();
        return;
    }
    const select = $('funds-goal');
    select.innerHTML = viewGoals().map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join('');
    const goal = state.savings.find((g) => g.id === goalId) || state.savings[0];
    select.value = goal.id;
    $('funds-amount').value = '';
    fillCurrencySelect($('funds-currency'), goal.currency);
    setFundsMode('deposit');
    updateFundsHint();
    openOrSwap('modal-funds');
};

const submitFunds = () => {
    const goal = state.savings.find((g) => g.id === $('funds-goal').value);
    const amount = toNumber($('funds-amount').value, NaN);
    const currency = normCur($('funds-currency').value);
    if (!goal) return fieldError($('funds-goal'), 'Choose a goal.');
    if (!(amount > 0)) return fieldError($('funds-amount'), 'Enter an amount greater than zero.');
    const delta = convertAmount(amount, currency, goal.currency);
    if (fundsMode === 'withdraw' && delta > goal.saved + 0.005) return fieldError($('funds-amount'), `You can withdraw up to ${formatCurrency(goal.saved, goal.currency)} from this goal.`);
    // The goal keeps its money in a fund: the money goes into (or comes out of) that fund, from money in no fund.
    // No fund chosen yet: keep goal money in your Savings fund (if you have one), so funds and accounts still add up.
    if (!goal.fundId && fundsMode === 'deposit') {
        const sav = secList().find((x) => /sav/i.test(x.name));
        if (sav) { goal.fundId = sav.id; setTimeout(() => showToast(`Kept in your ${sav.name} fund`, 'info'), 900); }
    }
    const gFund = goal.fundId && secById(goal.fundId);
    const inDisp = round2(toDisplay(amount, currency));
    if (gFund) {
        if (fundsMode === 'deposit') {
            const free = fundFreeAll(gFund);
            if (inDisp > free + 0.004) return fieldError($('funds-amount'), `Only ${formatCurrency(free, dcur())} of your money is not in a fund. Take some out of another fund first, or add the income.`);
        }
        const fb = sectionBalances()[gFund.id] || 0;
        const amt = fundsMode === 'deposit' ? inDisp : Math.min(inDisp, Math.max(0, fb));
        if (amt > 0.004) state.config.sectionMoves = [...secMoves(), { id: generateId(), date: todayISO(), kind: fundsMode === 'deposit' ? 'add' : 'out', incomeId: null, from: fundsMode === 'deposit' ? null : gFund.id, to: fundsMode === 'deposit' ? gFund.id : null, amount: amt, currency: dcur(), note: `Goal: ${goal.name}`.slice(0, 120) }];
    }
    const wasDone = goal.saved >= goal.target;
    goal.saved = round2(Math.max(0, goal.saved + (fundsMode === 'withdraw' ? -delta : delta)));
    goal.months = { ...(goal.months || {}) };
    goal.months[ymKey()] = round2(Math.max(0, (goal.months[ymKey()] || 0) + (fundsMode === 'withdraw' ? -delta : delta)));
    saveState();
    haptic('MEDIUM');
    queueSync('goal', goal.id, 'upsert');
    closeSheet('modal-funds');
    showToast(`${fundsMode === 'withdraw' ? 'Withdrew' : 'Deposited'} ${formatCurrency(amount, currency)} ${fundsMode === 'withdraw' ? 'from' : 'to'} ${goal.name}`, 'success');
    if (fundsMode === 'deposit' && !wasDone && goal.saved >= goal.target) setTimeout(() => showToast(`You reached your "${goal.name}" goal!`, 'success'), 500);
    renderActive();
    return true;
};

/* =========================================================================
   23. Sheets: budgets, bills, debts
   ========================================================================= */
let budgetModeDraft = 'fixed';
let budgetSaveDraft = 0;
let budgetSkipDraft = [];
const syncBudgetModeUi = () => {
    const overall = $('budget-category').value === '__overall';
    const income = overall && budgetModeDraft === 'income';
    const fromBal = overall && budgetModeDraft === 'balance';
    $('budget-mode-field').hidden = !overall;
    $('budget-income-field').hidden = !income;
    $('budget-amount-field').hidden = income || fromBal;
    $('budget-balance-hint').hidden = !fromBal;
    if (fromBal) $('budget-balance-hint').textContent = `You have ${formatCurrency(viewBalance(), dcur())} in this account. Your budget is what's in it, and it follows every income and expense.`;
    setPressed('[data-budget-mode]', (b) => b.dataset.budgetMode === budgetModeDraft);
    setPressed('[data-budget-save]', (b) => Number(b.dataset.budgetSave) === budgetSaveDraft);
    if (income) {
        const now = new Date();
        const s = monthStats(now.getFullYear(), now.getMonth());
        const cur = dcur();
        // Each kind of income received this month, with its total; tap one to leave it out of the budget.
        const groups = {};
        s.incomeList.forEach((t) => { const k = incomeGroup(t); groups[k] = (groups[k] || 0) + toDisplay(t.amount, t.currency); });
        const counted = round2(Object.entries(groups).filter(([k]) => !budgetSkipDraft.includes(k)).reduce((a, [, v]) => a + v, 0));
        const budget = counted * (1 - budgetSaveDraft / 100);
        $('budget-income-parts').innerHTML = Object.keys(groups).length > 0
            ? `<span class="field-label">Counted as income for the budget <span class="faint">(tap to change)</span></span>${Object.entries(groups).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<button type="button" class="inc-part" data-budget-inc="${escapeHtml(k)}" aria-pressed="${!budgetSkipDraft.includes(k)}">${icon(budgetSkipDraft.includes(k) ? 'i-x' : 'i-check', 'ic ic-sm')}<span>${escapeHtml(incomeGroupName(k))}</span><strong>${escapeHtml(formatCurrency(v, cur))}</strong></button>`).join('')}`
            : '';
        $('budget-income-hint').textContent = counted > 0
            ? `Income counted this month: ${formatCurrency(counted, cur)}, so your budget is ${formatCurrency(budget, cur)}${budgetSaveDraft ? ` and ${formatCurrency(counted - budget, cur)} goes to saving` : ''}. It grows by itself when you add income.`
            : 'No income counted this month yet. Add your salary or rent and your budget fills in by itself.';
    }
};

const openBudget = (catId) => {
    const sel = $('budget-category');
    sel.innerHTML = ['<option value="__overall">Whole month (all spending)</option>']
        .concat(catsOfType('expense').map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`)).join('');
    const isOverall = catId === '__overall';
    const existing = isOverall ? state.config.budget : (catId ? state.config.categoryBudgets[catId] : null);
    const firstFree = catsOfType('expense').find((c) => !state.config.categoryBudgets[c.id]);
    sel.value = catId || (firstFree ? firstFree.id : 'Food');
    sel.disabled = !!catId && (isOverall || !!existing);
    $('budget-amount').value = existing ? round2(budgetIn(existing, dcur())) : '';
    $('budget-currency').textContent = dcur();
    $('budget-title').textContent = existing ? 'Edit budget' : 'Set a budget';
    $('btn-delete-budget').hidden = !(existing && !isOverall);
    budgetModeDraft = state.config.budgetMode;
    budgetSaveDraft = state.config.budgetSavePct;
    budgetSkipDraft = [...budgetSkips()];
    syncBudgetModeUi();
    openOrSwap('modal-budget');
};

const submitBudget = () => {
    const catId = $('budget-category').value;
    if (catId === '__overall' && budgetModeDraft === 'balance') {
        state.config.budgetMode = 'balance';
        saveState();
        flushSync();
        closeSheet('modal-budget');
        showToast(`Your budget now follows your balance: ${formatCurrency(viewBalance(), dcur())} in this account`, 'success');
        renderActive();
        return true;
    }
    if (catId === '__overall' && budgetModeDraft === 'income') {
        state.config.budgetMode = 'income';
        state.config.budgetSavePct = budgetSaveDraft;
        state.config.budgetSkipIncome = [...budgetSkipDraft];
        saveState();
        flushSync();
        closeSheet('modal-budget');
        const s = monthStats();
        showToast(s.plannedIncome > 0
            ? `Your budget now follows your income: ${formatCurrency(s.budget, dcur())} this month`
            : 'Your budget now follows your income. Add this month\u2019s income to fill it in.', 'success');
        renderActive();
        return true;
    }
    const value = toNumber($('budget-amount').value, NaN);
    if (!(value > 0)) return fieldError($('budget-amount'), 'Enter a monthly limit greater than zero.');
    if (catId === '__overall') state.config.budgetMode = 'fixed';
    setBudgetCurrency(dcur());
    if (catId === '__overall') state.config.budget = value;
    else state.config.categoryBudgets[catId] = value;
    state.syncSettings = true;
    saveState();
    flushSync();
    closeSheet('modal-budget');
    showToast(`${catId === '__overall' ? 'Monthly' : catById(catId).name} budget set to ${formatCurrency(value, dcur())}`, 'success');
    renderActive();
    return true;
};

const deleteBudget = () => {
    const catId = $('budget-category').value;
    if (catId === '__overall') return;
    delete state.config.categoryBudgets[catId];
    state.syncSettings = true;
    saveState();
    flushSync();
    closeSheet('modal-budget');
    showToast(`${catById(catId).name} budget removed`, 'success');
    renderActive();
};

let billType = 'expense';

const fillBillCategories = (type, selected) => {
    const cats = catsOfType(type);
    $('bill-category').innerHTML = cats.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
    $('bill-category').value = cats.some((c) => c.id === selected) ? selected : (type === 'income' ? 'Salary' : 'Utilities');
};

const setBillType = (type, selected) => {
    billType = type;
    setPressed('[data-bill-type]', (b) => b.dataset.billType === type);
    // Income waits to be received (no automatic logging); only bills can log themselves.
    $('bill-auto-setting').hidden = type === 'income';
    $('bill-parts-field').hidden = type === 'income';
    $('bill-income-wait').hidden = type !== 'income';
    fillBillCategories(type, selected);
    $('bill-name').placeholder = type === 'income' ? 'e.g. Salary' : 'e.g. Netflix, Rent';
};

const openAddBill = (type = 'expense') => {
    $('bill-form').reset();
    delete $('bill-form').dataset.sub;
    $('bill-id').value = '';
    $('bill-title').textContent = 'New bill or regular income';
    $('btn-delete-bill').hidden = true;
    fillCurrencySelect($('bill-currency'), dcur());
    $('bill-next').value = todayISO();
    setSwitch($('bill-auto'), true);
    fillAccountSelect($('bill-account'), state.config.lastAccount);
    $('bill-account-field').hidden = state.accounts.length < 2;
    setBillType(type);
    openOrSwap('modal-bill');
};

const openEditBill = (id) => {
    const b = state.recurring.find((x) => x.id === id);
    if (!b) return;
    $('bill-form').reset();
    if (b.sub) $('bill-form').dataset.sub = '1'; else delete $('bill-form').dataset.sub;
    $('bill-id').value = b.id;
    $('bill-title').textContent = b.type === 'income' ? 'Edit regular income' : 'Edit bill';
    $('btn-delete-bill').hidden = false;
    $('bill-name').value = b.name;
    $('bill-amount').value = b.amount;
    fillCurrencySelect($('bill-currency'), b.currency);
    $('bill-frequency').value = b.frequency;
    $('bill-next').value = b.nextDate;
    $('bill-ref').value = b.ref || '';
    $('bill-parts').value = b.parts ? b.parts.count : '';
    $('bill-parts-done').value = b.parts ? b.parts.done : '';
    setSwitch($('bill-auto'), b.autoLog);
    fillAccountSelect($('bill-account'), b.accountId);
    $('bill-account-field').hidden = state.accounts.length < 2;
    setBillType(b.type, b.category);
    openOrSwap('modal-bill');
};

const submitBill = () => {
    const id = $('bill-id').value;
    const name = $('bill-name').value.trim();
    const amount = toNumber($('bill-amount').value, NaN);
    const nextDate = $('bill-next').value;
    if (!name) return fieldError($('bill-name'), 'Give it a name, like "Netflix".');
    if (!(amount > 0)) return fieldError($('bill-amount'), 'Enter an amount greater than zero.');
    if (!isISODate(nextDate)) return fieldError($('bill-next'), 'Pick the next due date.');
    const data = {
        type: billType,
        name,
        amount,
        currency: normCur($('bill-currency').value),
        category: $('bill-category').value,
        frequency: FREQ_LABELS[$('bill-frequency').value] ? $('bill-frequency').value : 'monthly',
        nextDate,
        anchorDay: parseDate(nextDate).getDate(),
        autoLog: billType === 'income' ? false : isOn($('bill-auto')),
        accountId: $('bill-account').value || state.accounts[0].id,
        ...($('bill-form').dataset.sub === '1' ? { sub: true } : {}),
        ref: $('bill-ref').value.trim().slice(0, 40)
    };
    if (!data.ref) delete data.ref;
    // A plan paid in parts: how many in total, how many already paid (e.g. Koko, first part paid last month).
    const pc = Math.round(toNumber($('bill-parts').value, 0));
    const pd = Math.round(toNumber($('bill-parts-done').value, 0));
    if ($('bill-parts').value.trim() !== '' && billType === 'expense') {
        if (!(pc >= 2 && pc <= 60)) return fieldError($('bill-parts'), 'Enter 2 or more parts, like 3.');
        if (!(pd >= 0 && pd < pc)) return fieldError($('bill-parts-done'), `Parts already paid must be between 0 and ${pc - 1}.`);
        data.parts = { count: pc, done: pd };
    }
    let record;
    if (id) {
        const idx = state.recurring.findIndex((b) => b.id === id);
        if (idx >= 0 && !data.ref) delete state.recurring[idx].ref;
        if (idx >= 0 && !data.parts) delete state.recurring[idx].parts;
        if (idx === -1) return false;
        record = { ...state.recurring[idx], ...data };
        state.recurring[idx] = record;
    } else {
        record = { id: generateId(), ...data, createdAt: Date.now() };
        state.recurring.push(record);
    }
    saveState();
    queueSync('recurring', record.id, 'upsert');
    closeSheet('modal-bill');
    const created = processRecurring();
    scheduleReminders();
    if (!created) showToast(id ? 'Saved' : `${name} added. Next: ${shortDate(record.nextDate)}`, 'success');
    renderActive();
    return true;
};

const deleteBill = (id) => {
    const b = state.recurring.find((x) => x.id === id);
    if (!b) return;
    showConfirm({
        title: `Delete ${b.name}?`,
        message: 'It will stop repeating. Entries already logged stay in your activity.',
        onConfirm: () => {
            state.recurring = state.recurring.filter((x) => x.id !== id);
            saveState();
            queueSync('recurring', id, 'delete');
            scheduleReminders();
            closeSheet('modal-bill');
            showToast('Deleted', 'success');
            renderActive();
        }
    });
};

let debtDir = 'lent';
let debtMoved = false;
let debtAccId = null;
const updateDebtMovedRow = () => {
    const acc = state.accounts.find((a) => a.id === debtAccId);
    $('debt-moved-row').hidden = !acc;
    if (!acc) return;
    setSwitch($('debt-moved'), debtMoved);
    $('debt-moved-title').textContent = debtDir === 'lent' ? `Paid from ${acc.name}` : `Received into ${acc.name}`;
    $('debt-moved-desc').textContent = debtMoved
        ? (debtDir === 'lent' ? `The open amount comes off ${acc.name}'s balance (${formatCurrency(toDisplay(accountBalance(acc), acc.currency), dcur())} now); repayments add it back.` : `The open amount is added to ${acc.name}'s balance; paying it back takes it off.`)
        : 'Your account balance is not changed: use this for money given or borrowed before, or not through this account.';
};

const setDebtDir = (dir) => {
    debtDir = dir;
    setPressed('[data-debt-dir]', (b) => b.dataset.debtDir === dir);
    $('debt-person-label').textContent = dir === 'lent' ? 'Who did you lend to?' : 'Who did you borrow from?';
    if ($('debt-moved-row')) updateDebtMovedRow();
};

const openAddDebt = () => {
    $('debt-form').reset();
    $('debt-id').value = '';
    $('debt-title').textContent = 'New debt';
    $('btn-delete-debt').hidden = true;
    fillCurrencySelect($('debt-currency'), dcur());
    debtAccId = viewId() !== 'all' ? viewId() : null;
    debtMoved = false; // off unless you say the money went through the account
    setDebtDir('lent');
    openOrSwap('modal-debt');
};

const openEditDebt = (id) => {
    const d = state.debts.find((x) => x.id === id);
    if (!d) return;
    $('debt-form').reset();
    $('debt-id').value = d.id;
    $('debt-title').textContent = 'Edit debt';
    $('btn-delete-debt').hidden = false;
    $('debt-person').value = d.person;
    $('debt-amount').value = d.amount;
    fillCurrencySelect($('debt-currency'), d.currency);
    $('debt-repaid').value = d.repaid ? round2(d.repaid) : '';
    $('debt-due').value = d.dueDate || '';
    $('debt-note').value = d.note || '';
    debtAccId = d.accountId || null;
    debtMoved = d.moved === true;
    setDebtDir(d.direction);
    openOrSwap('modal-debt');
};

const submitDebt = () => {
    const id = $('debt-id').value;
    const person = $('debt-person').value.trim();
    const amount = toNumber($('debt-amount').value, NaN);
    const currency = normCur($('debt-currency').value);
    const repaidRaw = $('debt-repaid').value.trim();
    const repaid = repaidRaw === '' ? 0 : toNumber(repaidRaw, NaN);
    if (!person) return fieldError($('debt-person'), 'Add a name.');
    if (!(amount > 0)) return fieldError($('debt-amount'), 'Enter an amount greater than zero.');
    if (!(repaid >= 0) || repaid > amount) return fieldError($('debt-repaid'), `Paid back must be between 0 and ${formatCurrency(amount, currency)}.`);
    // Lending from an account: not more than the account has (unless it was already counted before this change).
    const acc = state.accounts.find((a) => a.id === debtAccId);
    if (debtMoved && acc && debtDir === 'lent') {
        const prev = id ? state.debts.find((d) => d.id === id) : null;
        const already = prev && prev.moved && prev.accountId === acc.id && prev.direction === 'lent' ? convertAmount(Math.max(0, prev.amount - prev.repaid), prev.currency, acc.currency) : 0;
        const have = round2(accountBalance(acc) + already);
        const open = round2(convertAmount(amount - repaid, currency, acc.currency));
        if (open > have + 0.004) return fieldError($('debt-amount'), `${acc.name} has only ${formatCurrency(have, acc.currency)}, so ${formatCurrency(open, acc.currency)} can't have come from it. Turn off "Paid from ${acc.name}" if you gave this money earlier or another way.`);
    }
    const data = { direction: debtDir, person, amount, currency, repaid, dueDate: $('debt-due').value || null, note: $('debt-note').value.trim(), moved: !!(debtMoved && acc), accountId: acc ? acc.id : null };
    let record;
    if (id) {
        const idx = state.debts.findIndex((d) => d.id === id);
        if (idx === -1) return false;
        record = { ...state.debts[idx], ...data };
        state.debts[idx] = record;
    } else {
        record = { id: generateId(), ...data, createdAt: Date.now() };
        state.debts.push(record);
    }
    saveState();
    queueSync('debt', record.id, 'upsert');
    closeSheet('modal-debt');
    const accName = (state.accounts.find((a) => a.id === record.accountId) || {}).name;
    showToast(id ? 'Saved' : `${debtDir === 'lent' ? `${person} owes you` : `You owe ${person}`} ${formatCurrency(amount, currency)}${accName && record.moved ? `. ${accName} balance updated` : ''}`, 'success');
    renderActive();
    return true;
};

const deleteDebt = (id) => {
    const d = state.debts.find((x) => x.id === id);
    if (!d) return;
    showConfirm({
        title: 'Delete this debt?',
        message: `The record with ${d.person} (${formatCurrency(d.amount, d.currency)}) will be removed.`,
        onConfirm: () => {
            state.debts = state.debts.filter((x) => x.id !== id);
            saveState();
            queueSync('debt', id, 'delete');
            closeSheet('modal-debt');
            showToast('Deleted', 'success');
            renderActive();
        }
    });
};

const openRepay = (id) => {
    const d = state.debts.find((x) => x.id === id);
    if (!d) return;
    $('repay-id').value = d.id;
    $('repay-amount').value = '';
    $('repay-currency').textContent = d.currency;
    $('repay-title').textContent = d.direction === 'lent' ? `${d.person} paid you back` : `You paid ${d.person}`;
    $('repay-hint').textContent = `${formatCurrency(d.amount - d.repaid, d.currency)} still open of ${formatCurrency(d.amount, d.currency)}.`;
    openOrSwap('modal-repay');
};

const submitRepay = () => {
    const d = state.debts.find((x) => x.id === $('repay-id').value);
    const amount = toNumber($('repay-amount').value, NaN);
    if (!d) return false;
    const open = d.amount - d.repaid;
    if (!(amount > 0)) return fieldError($('repay-amount'), 'Enter an amount greater than zero.');
    if (amount > open + 0.005) return fieldError($('repay-amount'), `Only ${formatCurrency(open, d.currency)} is still open.`);
    d.repaid = round2(Math.min(d.amount, d.repaid + amount));
    saveState();
    haptic('MEDIUM');
    queueSync('debt', d.id, 'upsert');
    closeSheet('modal-repay');
    showToast(d.repaid >= d.amount ? `Settled with ${d.person}` : `Payment saved. ${formatCurrency(d.amount - d.repaid, d.currency)} still open.`, 'success');
    renderActive();
    return true;
};

/* =========================================================================
   Trips: while a trip is on, every expense is tagged to it; see what the trip costs
   ========================================================================= */
const activeTrip = () => (state.config.trips || []).find((t) => !t.endedAt) || null;
const tripById = (id) => (state.config.trips || []).find((t) => t.id === id) || null;
// The trip a new expense on this date belongs to (the one that's on, if the date is in it).
const tripIdFor = (date) => {
    const t = activeTrip();
    return t && date >= t.start && (!t.end || date <= addDaysISO(t.end, 1)) ? t.id : null;
};
const addDaysISO = (d, n) => toISODate(addDays(parseDate(d), n));
const tripEntries = (id) => state.transactions.filter((t) => t.tripId === id && t.type === 'expense');
const tripStats = (trip) => {
    const list = tripEntries(trip.id).filter((t) => !isUpcoming(t));
    const cur = dcur();
    const spent = list.reduce((sum, t) => sum + toDisplay(t.amount, t.currency), 0);
    const byCat = {};
    list.forEach((t) => { byCat[t.category] = (byCat[t.category] || 0) + toDisplay(t.amount, t.currency); });
    const budget = trip.budget ? convertAmount(trip.budget, trip.currency, cur) : 0;
    const last = trip.endedAt ? (trip.end || trip.endedAt.slice(0, 10)) : todayISO();
    const days = Math.max(1, Math.round((parseDate(last) - parseDate(trip.start)) / 86400000) + 1);
    const total = trip.end ? Math.max(days, Math.round((parseDate(trip.end) - parseDate(trip.start)) / 86400000) + 1) : null;
    return { list, spent, budget, left: budget - spent, byCat, days, total, perDay: spent / days, cur };
};
const tripCardHtml = (trip, opts = {}) => {
    const st = tripStats(trip);
    const pct = st.budget ? Math.min(100, (st.spent / st.budget) * 100) : 0;
    const over = st.budget && st.spent > st.budget;
    return `<div class="card trip-card${trip.endedAt ? ' is-ended' : ''}">
        <div class="trip-head">
            <span class="cat-badge trip-badge">${icon('x-plane')}</span>
            <span class="trip-title"><span>${escapeHtml(trip.name)}</span><span>${trip.endedAt ? `${shortDate(trip.start)} – ${shortDate(trip.end || trip.endedAt.slice(0, 10))}` : `Day ${st.days}${st.total ? ` of ${st.total}` : ''} · since ${shortDate(trip.start)}`}</span></span>
            ${opts.link ? `<button type="button" class="link-btn" data-open-trip="${escapeHtml(trip.id)}">Details</button>` : ''}
        </div>
        <div class="trip-amount"><span class="amount">${escapeHtml(formatCurrency(st.spent, st.cur))}</span><span>${st.budget ? `of ${escapeHtml(formatCurrency(st.budget, st.cur))}` : `spent · ${escapeHtml(formatCurrency(st.perDay, st.cur))} a day`}</span></div>
        ${st.budget ? `<div class="meter${over ? ' is-over' : ''}" role="progressbar" aria-label="Trip budget used" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><div class="meter-fill" style="width:${pct}%"></div></div>
        <div class="meter-row"><span>${plural(st.list.length, 'expense')}</span><span>${over ? `<strong class="neg">${escapeHtml(formatCurrency(-st.left, st.cur))}</strong> over` : `<strong>${escapeHtml(formatCurrency(st.left, st.cur))}</strong> left`}</span></div>` : ''}
        ${opts.actions && !trip.endedAt ? `<div class="trip-actions"><button type="button" class="btn btn-primary btn-sm" data-action="trip-add-expense">${icon('i-plus')} Add expense</button><button type="button" class="btn btn-secondary btn-sm" data-open-trip="${escapeHtml(trip.id)}">Details</button></div>` : ''}
    </div>`;
};
const renderTripHome = () => {
    const el = $('dash-trip');
    if (!el) return;
    const t = activeTrip();
    el.innerHTML = t ? tripCardHtml(t, { actions: true }) : '';
};
let tripView = null;
const openTrips = (id) => {
    tripView = id || (activeTrip() ? activeTrip().id : null);
    renderTripSheet();
    openOrSwap('modal-trip');
};
const renderTripSheet = () => {
    const trip = tripView ? tripById(tripView) : null;
    const past = (state.config.trips || []).filter((t) => t.endedAt).slice().reverse();
    $('trip-title').textContent = trip ? trip.name : 'Start a trip';
    $('trip-form').hidden = !!trip;
    $('trip-view').hidden = !trip;
    $('btn-trip-start').hidden = !!trip;
    $('btn-trip-end').hidden = !trip || !!trip.endedAt;
    $('btn-trip-delete').hidden = !trip || !trip.endedAt;
    if (!trip) {
        $('trip-name').value = '';
        $('trip-budget').value = '';
        $('trip-start').value = todayISO();
        $('trip-end').value = '';
        fillCurrencySelect($('trip-currency'), dcur());
    } else {
        const st = tripStats(trip);
        const cats = Object.entries(st.byCat).sort((a, b) => b[1] - a[1]).slice(0, 5);
        $('trip-view').innerHTML = tripCardHtml(trip)
            + (cats.length ? `<div class="section-head"><h2>Where it went</h2></div><ul class="trip-cats">${cats.map(([c, v]) => `<li>${catBadge(c, 'expense')}<span>${escapeHtml(catById(c).name)}</span><span class="amount">${escapeHtml(formatCurrency(v, st.cur))}</span></li>`).join('')}</ul>` : '')
            + `<div class="section-head"><h2>Expenses</h2></div>`
            + (st.list.length ? `<ul class="tx-list">${st.list.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 40).map(txRow).join('')}</ul>`
                : `<p class="field-hint">Nothing yet. Every expense you add while the trip is on lands here, also ones Vela reads from your bank SMS.</p>`);
    }
    $('trip-past').innerHTML = !trip && past.length ? `<div class="section-head"><h2>Past trips</h2></div>${past.map((t) => { const st = tripStats(t); return `<button type="button" class="row-btn" data-open-trip="${escapeHtml(t.id)}">${'<span class="row-icon tint">' + icon('x-plane') + '</span>'}<span class="row-label"><span>${escapeHtml(t.name)}</span><span>${shortDate(t.start)} · ${plural(st.list.length, 'expense')}</span></span><span class="amount">${escapeHtml(formatCurrency(st.spent, st.cur))}</span></button>`; }).join('')}` : '';
};
const startTrip = () => {
    const name = $('trip-name').value.trim();
    const start = $('trip-start').value;
    const end = $('trip-end').value;
    if (!name) return fieldError($('trip-name'), 'Give the trip a name, like "Trip to Ella".');
    if (!isISODate(start)) return fieldError($('trip-start'), 'Pick the day the trip starts.');
    if (end && end < start) return fieldError($('trip-end'), 'The trip ends after it starts.');
    if (activeTrip()) activeTrip().endedAt = new Date().toISOString();
    const trip = { id: generateId(), name, budget: Math.max(0, toNumber($('trip-budget').value, 0)), currency: normCur($('trip-currency').value), start, end: end || null, endedAt: null };
    state.config.trips = [...(state.config.trips || []), trip];
    // Expenses already added from the start day on join the trip.
    state.transactions.forEach((t) => { if (t.type === 'expense' && !t.tripId && !t.recurringId && t.date >= start && (!end || t.date <= end)) { t.tripId = trip.id; queueSync('transaction', t.id, 'upsert', false); } });
    if (!commitState('The trip')) return false;
    flushSync();
    haptic('MEDIUM');
    closeSheet('modal-trip');
    showToast(`${name} started. Expenses you add now count for the trip.`, 'success');
    renderActive();
    return true;
};
const endTrip = () => {
    const trip = tripView && tripById(tripView);
    if (!trip) return;
    showConfirm({
        title: `End ${trip.name}?`,
        message: 'New expenses stop counting for this trip. You can still see it under Past trips.',
        confirmLabel: 'End trip',
        danger: false,
        onConfirm: () => {
            trip.endedAt = new Date().toISOString();
            if (!trip.end || trip.end > todayISO()) trip.end = todayISO();
            if (!commitState('Ending the trip')) return;
            const st = tripStats(trip);
            closeSheet('modal-trip');
            showToast(`${trip.name}: ${formatCurrency(st.spent, st.cur)} in ${plural(st.days, 'day')}`, 'success');
            renderActive();
        }
    });
};
const deleteTrip = () => {
    const trip = tripView && tripById(tripView);
    if (!trip) return;
    showConfirm({
        title: `Remove ${trip.name}?`,
        message: 'The trip goes; its expenses stay in your history, just without the trip label.',
        confirmLabel: 'Remove',
        onConfirm: () => {
            state.config.trips = state.config.trips.filter((t) => t.id !== trip.id);
            state.transactions.forEach((t) => { if (t.tripId === trip.id) { delete t.tripId; queueSync('transaction', t.id, 'upsert', false); } });
            if (!commitState('Removing the trip')) return;
            flushSync();
            closeSheet('modal-trip');
            showToast('Trip removed', 'success');
            renderActive();
        }
    });
};

/* =========================================================================
   Subscriptions: pick the service, type what you pay, it's a monthly bill with a reminder
   ========================================================================= */
const SUBSCRIPTIONS = [
    ['netflix', 'Netflix', 'Entertainment'], ['spotify', 'Spotify Premium', 'Entertainment'], ['youtube', 'YouTube Premium', 'Entertainment'],
    ['disney', 'Disney+', 'Entertainment'], ['primevideo', 'Prime Video', 'Entertainment'], ['hbomax', 'HBO Max', 'Entertainment'],
    ['apple', 'iCloud+', 'Other'], ['google', 'Google One', 'Other'], ['openai', 'ChatGPT Plus', 'Other'], ['claude', 'Claude Pro', 'Other'],
    ['gemini', 'Gemini Advanced', 'Other'], ['microsoft', 'Microsoft 365', 'Other'], ['canva', 'Canva Pro', 'Other'], ['adobe', 'Adobe Creative Cloud', 'Other'],
    ['notion', 'Notion', 'Other'], ['dropbox', 'Dropbox', 'Other'], ['duolingo', 'Duolingo Super', 'Other'], ['grammarly', 'Grammarly', 'Other'],
    ['linkedin', 'LinkedIn Premium', 'Other'], ['crunchyroll', 'Crunchyroll', 'Entertainment'], ['audible', 'Audible', 'Entertainment'],
    ['deezer', 'Deezer', 'Entertainment'], ['playstation', 'PlayStation Plus', 'Entertainment'], ['xbox', 'Xbox Game Pass', 'Entertainment'],
    ['nintendo', 'Nintendo Switch Online', 'Entertainment'], ['peotv', 'PEO TV', 'Utilities'], ['dialog', 'Dialog TV', 'Utilities'],
    ['slt', 'SLT Fibre', 'Utilities'], ['capcut', 'CapCut Pro', 'Other'], ['zoom', 'Zoom Pro', 'Other'], ['tinder', 'Tinder Gold', 'Entertainment'],
    ['viu', 'Viu', 'Entertainment'], ['hotstar', 'Hotstar', 'Entertainment'], ['zee5', 'ZEE5', 'Entertainment'], ['perplexity', 'Perplexity Pro', 'Other']
];
const SUB_SLUGS = new Set([...SUBSCRIPTIONS.map(([slug]) => slug), ...BRAND_KINDS[4][1]]);
// Your subscriptions: monthly bills for a streaming / app / TV service (or added from the Subscription menu).
const mySubscriptions = () => state.recurring.filter((b) => b.type === 'expense' && (b.sub || SUB_SLUGS.has((brandOfName(b.name) || {}).slug)));
const renderSubsSheet = () => {
    const mine = mySubscriptions();
    const cur = dcur();
    const total = mine.reduce((sum, b) => sum + monthlyEquivalent(b), 0);
    $('subs-mine').innerHTML = mine.length ? `<div class="subs-total"><span>Your subscriptions</span><strong class="amount">${escapeHtml(formatCurrency(total, cur))}</strong><span>a month · ${escapeHtml(formatCurrency(total * 12, cur))} a year</span></div>
        <ul class="cat-manage">${mine.map((b) => `<li><button type="button" class="row-btn" data-edit-bill="${escapeHtml(b.id)}">${entryBadge(b.name, b.category, 'expense')}<span class="row-label"><span>${escapeHtml(b.name)}</span><span>Next ${escapeHtml(shortDate(b.nextDate))} · ${escapeHtml(FREQ_LABELS[b.frequency] || 'Monthly')}</span></span><span class="amount">${escapeHtml(formatCurrency(b.amount, b.currency))}</span></button></li>`).join('')}</ul>` : '';
    const have = new Set(mine.map((b) => b.name.toLowerCase()));
    $('subs-grid').innerHTML = SUBSCRIPTIONS.filter(([, name]) => !have.has(name.toLowerCase())).map(([slug, name]) => {
        const b = BRANDS.find((x) => x.slug === slug);
        return `<button type="button" class="brand-choice" data-sub-pick="${escapeHtml(name)}" data-sub-cat="${escapeHtml(BRAND_KINDS[4][1].has(slug) || !b ? 'Entertainment' : '')}">${b ? brandBadge(b) : ''}<span>${escapeHtml(name)}</span></button>`;
    }).join('') + `<button type="button" class="brand-choice" data-sub-pick=""><span class="cat-badge" style="--cat:var(--text-3)">${icon('i-plus')}</span><span>Other</span></button>`;
};
const openSubscriptions = () => { renderSubsSheet(); openOrSwap('modal-subs'); };
const pickSubscription = (name) => {
    const entry = SUBSCRIPTIONS.find(([, n]) => n === name);
    openAddBill('expense');
    $('bill-title').textContent = name ? `Add ${name}` : 'New subscription';
    $('bill-name').value = name;
    $('bill-frequency').value = 'monthly';
    if (entry && catsOfType('expense').some((c) => c.id === entry[2])) $('bill-category').value = entry[2];
    // A price you paid before for it fills in; otherwise you type what you pay (Vela doesn't guess prices).
    const before = state.transactions.filter((t) => t.type === 'expense' && name && t.desc.toLowerCase() === name.toLowerCase()).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    if (before) { $('bill-amount').value = before.amount; fillCurrencySelect($('bill-currency'), before.currency); }
    $('bill-form').dataset.sub = '1';
    setTimeout(() => (name ? $('bill-amount') : $('bill-name')).focus(), 380);
};

/* =========================================================================
   Sections (envelopes): your income divided into sections you choose. Expenses come out of a section,
   balances run on from month to month (never reset), money left over can stay or move, and a section
   that went below zero is filled back to zero first from the next income.
   Every change is a "move" kept as history: income split, fill to zero, carry to another section, money added.
   ========================================================================= */
const secList = () => state.config.sections || [];
const secById = (id) => secList().find((x) => x.id === id) || null;
const secMoves = () => state.config.sectionMoves || [];
const secBadge = (sec, extra = '') => `<span class="cat-badge sec-badge${extra}" style="--cat:var(--pal-${PALETTE.includes(sec && sec.color) ? sec.color : 'slate'})">${icon(sec && /^[cxi]-[A-Za-z-]+$/.test(sec.icon || '') ? sec.icon : 'i-wallet')}</span>`;
// Funds that belong to an account (or to every account). Money is allocated from an income only to the funds
// of the account it arrived in; an expense can only be paid from the funds of its account.
// The accounts a fund uses (none = every account). Older funds had one accountId.
const fundAccs = (x) => (!x ? [] : Array.isArray(x.accountIds) ? x.accountIds : x.accountId ? [x.accountId] : []);
// How a fund is shared between its accounts, in % (equal when not set).
const fundShares = (x) => {
    const ids = fundAccs(x);
    if (ids.length < 2) return {};
    const set = x.accountShares || {};
    const given = ids.every((id) => typeof set[id] === 'number') && Math.abs(ids.reduce((a, id) => a + set[id], 0) - 100) < 0.6;
    if (given) return Object.fromEntries(ids.map((id) => [id, set[id]]));
    const each = Math.floor(10000 / ids.length) / 100;
    return Object.fromEntries(ids.map((id, i) => [id, i === 0 ? round2(100 - each * (ids.length - 1)) : each]));
};
// Splits an amount by the shares; the first account takes the rounding.
const splitByShares = (x, amount) => {
    const sh = fundShares(x);
    const ids = Object.keys(sh);
    const parts = ids.map((id) => round2((amount * sh[id]) / 100));
    if (ids.length) parts[0] = round2(parts[0] + amount - parts.reduce((a, v) => a + v, 0));
    return Object.fromEntries(ids.map((id, i) => [id, parts[i]]));
};
const fundsFor = (accountId) => secList().filter((x) => !fundAccs(x).length || !accountId || fundAccs(x).includes(accountId));
// How much of each fund sits in each account: moves carry their account; spending comes out of its account.
// '' = money not tied to one account (older entries of funds that use every account).
const fundPortions = () => {
    const out = {};
    secList().forEach((x) => { out[x.id] = {}; });
    const keyOf = (fund, acc) => acc || (fundAccs(fund).length === 1 ? fundAccs(fund)[0] : '');
    secMoves().forEach((m) => {
        const v = toDisplay(m.amount, m.currency);
        if (m.to && out[m.to]) { const k = keyOf(secById(m.to), m.accountId); out[m.to][k] = (out[m.to][k] || 0) + v; }
        if (m.from && out[m.from]) { const k = keyOf(secById(m.from), m.accountId); out[m.from][k] = (out[m.from][k] || 0) - v; }
    });
    state.transactions.forEach((t) => {
        if (t.type !== 'expense' || !t.sectionId || !out[t.sectionId] || isUpcoming(t)) return;
        const fund = secById(t.sectionId);
        const k = fundAccs(fund).length && !fundAccs(fund).includes(t.accountId) ? keyOf(fund, null) : (t.accountId || '');
        out[t.sectionId][k] = (out[t.sectionId][k] || 0) - toDisplay(t.amount, t.currency);
    });
    Object.values(out).forEach((o) => Object.keys(o).forEach((k) => { o[k] = round2(o[k]); }));
    return out;
};
// Funds are part of an account's money set aside, never extra money. Free money = balance - what its funds hold.
const accountFundsTotal = (accountId) => { const por = fundPortions(); return round2(Object.values(por).reduce((a, o) => a + Math.max(0, o[accountId] || 0), 0)); };
const accountFreeMoney = (accountId, bal) => {
    const acc = state.accounts.find((a) => a.id === accountId);
    return acc ? round2(toDisplay(accountBalance(acc), acc.currency) - accountFundsTotal(accountId, bal)) : 0;
};
// "Not enough money" with the numbers: what is available, what was asked, what is missing.
const shortfallText = (available, requested, cur = dcur()) => `Insufficient balance. Available: ${formatCurrency(Math.max(0, available), cur)} · Requested: ${formatCurrency(requested, cur)} · Short by: ${formatCurrency(requested - Math.max(0, available), cur)}`;
const fundOnceDone = (x) => x.once && secMoves().some((m) => m.to === x.id && m.kind === 'income' && m.amount > 0);
const secPlanLabelBase = (sec) => (sec.mode === 'manual' ? 'Only money you add' : sec.mode === 'rest' ? 'Remainder of income' : sec.mode === 'percent' ? `${sec.value}% of income` : `${formatCurrency(sec.value, sec.currency)} ${sec.once ? 'once' : 'fixed per income'}`);
const secPlanLabel = (sec) => (sec.once && sec.mode !== 'manual' && sec.mode !== 'rest' ? (fundOnceDone(sec) ? `${secPlanLabelBase(sec)} · done, nothing more` : `${secPlanLabelBase(sec)} · next income only`) : secPlanLabelBase(sec));
// Balances in the display currency, from the very first move: nothing is reset between months.
const sectionBalances = () => {
    const bal = {};
    secList().forEach((x) => { bal[x.id] = 0; });
    secMoves().forEach((m) => {
        const v = toDisplay(m.amount, m.currency);
        if (m.to && bal[m.to] !== undefined) bal[m.to] += v;
        if (m.from && bal[m.from] !== undefined) bal[m.from] -= v;
    });
    state.transactions.forEach((t) => {
        if (t.type === 'expense' && t.sectionId && bal[t.sectionId] !== undefined && !isUpcoming(t)) bal[t.sectionId] -= toDisplay(t.amount, t.currency);
    });
    Object.keys(bal).forEach((k) => { bal[k] = round2(bal[k]); });
    return bal;
};
// What went in and out of each section in a month.
const sectionMonth = (y, m) => {
    const out = {};
    secList().forEach((x) => { out[x.id] = { in: 0, spent: 0 }; });
    secMoves().forEach((mv) => {
        const d = parseDate(mv.date);
        if (d.getFullYear() !== y || d.getMonth() !== m) return;
        const v = toDisplay(mv.amount, mv.currency);
        if (mv.to && out[mv.to]) out[mv.to].in += v;
        if (mv.from && out[mv.from]) out[mv.from].in -= v;
    });
    state.transactions.forEach((t) => { if (t.type === 'expense' && t.sectionId && out[t.sectionId] && !isUpcoming(t) && inMonth(t, y, m)) out[t.sectionId].spent += toDisplay(t.amount, t.currency); });
    return out;
};
const dividedIncomeIds = () => new Set([...secMoves().filter((m) => m.incomeId).map((m) => m.incomeId), ...(state.config.sectionSkipped || [])]);
// Income that arrived since sections were set up and hasn't been divided (or skipped) yet.
// Only the kinds of income you chose go to your funds (Salary unless you pick others). Any other income can
// still be allocated by hand from its entry.
const fundIncomeCats = () => {
    const list = state.config.fundIncomeCats;
    return new Set(Array.isArray(list) ? list : ['Salary']);
};
const allocatesIncome = (t) => !!t && t.type === 'income' && fundIncomeCats().has(t.category);
const undividedIncomes = () => {
    if (!secList().length) return [];
    const since = state.config.sectionSince || '0000';
    const done = dividedIncomeIds();
    return state.transactions.filter((t) => allocatesIncome(t) && !isUpcoming(t) && t.date >= since && !done.has(t.id))
        .sort((a, b) => (a.date < b.date ? -1 : 1));
};
const toggleFundIncomeCat = (cat) => {
    const set = fundIncomeCats();
    if (set.has(cat)) set.delete(cat); else set.add(cat);
    state.config.fundIncomeCats = [...set];
    if (!commitState('That')) return;
    haptic();
    renderActive();
};
const fundIncomeChooserHtml = () => {
    const set = fundIncomeCats();
    return `<section class="card fund-income">
        <div class="card-head"><h2 class="card-title">Income allocated to funds</h2></div>
        <p class="card-sub">Only these kinds of income are offered for allocation. Others stay out of your funds, unless you allocate one yourself from its entry.</p>
        <div class="fund-income-chips">${catsOfType('income').map((c) => `<button type="button" class="chip" data-fund-income="${escapeHtml(c.id)}" aria-pressed="${set.has(c.id)}" style="--cat:${catColor(c)}"><span class="chip-dot"></span>${escapeHtml(c.name)}</button>`).join('')}</div>
    </section>`;
};
// The section an expense of this category usually comes out of (learned from what you pick).
const sectionForCategory = (cat) => {
    const id = (state.config.sectionCatMap || {})[cat];
    return id && secById(id) ? id : null;
};
// A fund chosen automatically (from the category, a fixed payment or an SMS) must hold the money;
// otherwise the expense comes from money not in a fund instead of pushing the fund below zero.
const autoFundFor = (cat, amount, currency) => {
    const id = sectionForCategory(cat);
    if (!id) return null;
    return (sectionBalances()[id] || 0) + 0.004 >= toDisplay(amount, currency) ? id : null;
};
// Funds below zero were paid from before money was put in. Keep those expenses, but stop paying them
// from the fund (they come from money not in a fund): replay the fund by date and unlink only the ones
// that found it empty. Account balances don't change.
const repairShortFunds = (onlyId = null) => {
    let n = 0;
    secList().filter((x) => !onlyId || x.id === onlyId).forEach((x) => {
        const ev = [];
        secMoves().forEach((m) => {
            if (m.to === x.id) ev.push({ d: m.date, k: 0, v: toDisplay(m.amount, m.currency) });
            if (m.from === x.id) ev.push({ d: m.date, k: 1, v: -toDisplay(m.amount, m.currency) });
        });
        state.transactions.forEach((t) => {
            if (t.type === 'expense' && t.sectionId === x.id && !isUpcoming(t)) ev.push({ d: t.date, k: 2, v: -toDisplay(t.amount, t.currency), t });
        });
        ev.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.k - b.k));
        let run = 0;
        ev.forEach((e) => {
            if (e.t && run + e.v < -0.004) { delete e.t.sectionId; queueSync('transaction', e.t.id, 'upsert', false); n++; return; }
            run += e.v;
        });
    });
    return n;
};
// Start the funds again. Expenses and account balances never change: only what the funds hold.
const resetFunds = (how) => {
    let n = 0;
    state.transactions.forEach((t) => { if (t.sectionId) { delete t.sectionId; queueSync('transaction', t.id, 'upsert', false); n++; } });
    state.config.sectionMoves = [];
    state.config.sectionSkipped = [];
    // From now on: incomes before today are not offered for allocation again.
    state.config.sectionSince = todayISO();
    if (how === 'all') {
        state.config.sections = [];
        state.config.sectionCatMap = {};
    }
    if (!commitState('The funds')) return;
    flushSync();
    closeSheet('modal-fund-reset');
    showToast(how === 'all' ? 'All funds deleted. Your entries and balances are unchanged.' : `Every fund is now Rs. 0${n ? ` (${plural(n, 'expense')} no longer paid from a fund)` : ''}`, 'success');
    renderActive();
};
const askRepairShort = (onlyId = null) => {
    const bal = sectionBalances();
    const short = secList().filter((x) => (!onlyId || x.id === onlyId) && bal[x.id] < -0.004);
    if (!short.length) return;
    const cur = dcur();
    const total = short.reduce((a, x) => a + -bal[x.id], 0);
    showConfirm({
        title: short.length === 1 ? `Fix ${short[0].name}` : 'Fix funds below zero',
        message: `${short.map((x) => x.name).join(', ')} ${short.length === 1 ? 'is' : 'are'} ${formatCurrency(total, cur)} short: expenses were paid from ${short.length === 1 ? 'it' : 'them'} before money was put in. Vela keeps those expenses, but they'll come from money not in a fund. Your account balances don't change.`,
        confirmLabel: 'Fix it',
        cancelLabel: 'Not now',
        danger: false,
        onConfirm: () => {
            const n = repairShortFunds(onlyId);
            if (!commitState('The funds')) return;
            flushSync();
            showToast(n ? `Fixed: ${plural(n, 'expense')} no longer paid from a fund` : 'Nothing to fix', 'success');
            renderActive();
        }
    });
};
const learnSection = (cat, secId) => {
    if (!cat) return;
    const map = state.config.sectionCatMap || (state.config.sectionCatMap = {});
    if (secId) map[cat] = secId; else delete map[cat];
};

/* ---- Dividing an income ---- */
let divideJob = null;
let divideKeepRest = false;
// The plan for an amount: fixed amounts first (in order), then percentages of the same base, the rest to the
// "what's left" section. Never more than there is.
// The funds an income can go to: those of the account it arrived in, plus funds for every account.
const divFunds = () => (divideJob ? fundsFor(divideJob.accountId) : secList());
const planSplit = (amount) => {
    const out = {};
    let left = amount;
    divFunds().forEach((x) => { out[x.id] = 0; });
    divFunds().filter((x) => x.mode === 'amount' && !fundOnceDone(x)).forEach((x) => { const v = Math.min(left, round2(toDisplay(x.value, x.currency))); out[x.id] = v; left -= v; });
    const base = left;
    divFunds().filter((x) => x.mode === 'percent' && !fundOnceDone(x)).forEach((x) => { const v = Math.min(left, round2((base * x.value) / 100)); out[x.id] = v; left -= v; });
    const rest = divFunds().find((x) => x.mode === 'rest');
    if (rest) { out[rest.id] = round2(out[rest.id] + left); left = 0; }
    return { split: out, left: round2(left) };
};
// Carries chosen, then sections still below zero are filled to zero, then the plan splits what remains.
const divideNumbers = () => {
    const job = divideJob;
    const bal = sectionBalances();
    const after = { ...bal };
    const carries = [];
    Object.entries(job.carry).forEach(([from, to]) => {
        if (!to || to === 'keep' || !(bal[from] > 0) || !secById(to) || to === from) return;
        carries.push({ from, to, amount: bal[from] });
        after[from] -= bal[from];
        after[to] += bal[from];
    });
    // Only the share of the income you chose to allocate (100%, 50%, a custom amount...); the rest stays free.
    let pool = job.base === undefined ? job.total : Math.min(job.total, job.base);
    const fills = [];
    divFunds().map((x) => ({ id: x.id, need: round2(-after[x.id]) })).filter((x) => x.need > 0).sort((a, b) => b.need - a.need)
        .forEach((x) => { const v = Math.min(pool, x.need); if (v > 0) { fills.push({ to: x.id, amount: round2(v) }); pool -= v; } });
    pool = round2(pool);
    return { bal, after, carries, fills, pool };
};
const openDivide = (incomeId) => {
    const t = state.transactions.find((x) => x.id === incomeId && x.type === 'income');
    if (!t || !fundsFor(t.accountId).length) { if (t) showToast('No funds for this account yet. Add one in Plan › Funds.', 'info'); return; }
    divideJob = { incomeId, total: round2(toDisplay(t.amount, t.currency)), carry: {}, alloc: null, name: t.desc, date: t.date, accountId: t.accountId, share: 1 };
    divideKeepRest = false;
    const n = divideNumbers();
    divideJob.alloc = planSplit(n.pool).split;
    renderDivide();
    openOrSwap('modal-divide');
};
const renderDivide = () => {
    const job = divideJob;
    if (!job) return;
    const cur = dcur();
    const n = divideNumbers();
    $('divide-title').textContent = `Allocate ${job.name}`;
    $('divide-total').textContent = formatCurrency(job.total, cur);
    const base = job.base === undefined ? job.total : Math.min(job.total, job.base);
    const shares = [[1, '100%'], [0.75, '75%'], [0.5, '50%'], [0.25, '25%']];
    $('divide-share').innerHTML = shares.map(([k, l]) => `<button type="button" class="chip" data-divide-share="${k}" aria-pressed="${job.share === k}">${l}</button>`).join('')
        + `<button type="button" class="chip" data-divide-share="custom" aria-pressed="${job.share === 'custom'}">Custom</button><button type="button" class="chip" data-divide-share="none">None</button>`;
    $('divide-custom-field').hidden = job.share !== 'custom';
    $('divide-summary').innerHTML = `<span><small>Salary</small><strong>${escapeHtml(formatCurrency(job.total, cur))}</strong></span><span><small>Allocating</small><strong class="text-income">${escapeHtml(formatCurrency(base, cur))}</strong></span><span><small>Not allocated</small><strong>${escapeHtml(formatCurrency(job.total - base, cur))}</strong></span>`;
    const leftovers = divFunds().filter((x) => n.bal[x.id] > 0);
    $('divide-carry').innerHTML = leftovers.length ? `<div class="section-head"><h2>Unspent balances</h2></div><p class="field-hint">Carry each one forward in the same fund, or transfer it to another fund.</p>${leftovers.map((x) => `
        <div class="sec-line">${secBadge(x, ' is-mini')}<span class="sec-line-name"><span>${escapeHtml(x.name)}</span><span class="text-income">${escapeHtml(formatCurrency(n.bal[x.id], cur))} unspent</span></span>
            <div class="select sec-carry"><select class="input" data-sec-carry="${escapeHtml(x.id)}" aria-label="Where ${escapeHtml(x.name)}'s unspent balance goes">
                <option value="keep">Carry forward in ${escapeHtml(x.name)}</option>
                ${divFunds().filter((o) => o.id !== x.id).map((o) => `<option value="${escapeHtml(o.id)}" ${job.carry[x.id] === o.id ? 'selected' : ''}>Transfer to ${escapeHtml(o.name)}</option>`).join('')}
            </select></div></div>`).join('')}` : '';
    $('divide-fills').innerHTML = n.fills.length ? `<div class="section-head"><h2>Cover deficits first</h2></div>${n.fills.map((f) => { const x = secById(f.to); return `
        <div class="sec-line">${secBadge(x, ' is-mini')}<span class="sec-line-name"><span>${escapeHtml(x.name)}</span><span class="text-expense">deficit ${escapeHtml(formatCurrency(-n.after[x.id], cur))}</span></span><span class="amount">+${escapeHtml(formatCurrency(f.amount, cur))}</span></div>`; }).join('')}` : '';
    $('divide-split').innerHTML = `<div class="section-head"><h2>${n.fills.length ? 'Allocate the rest' : 'Allocation'}</h2><span class="card-sub">${escapeHtml(formatCurrency(n.pool, cur))}</span></div>${divFunds().map((x) => `
        <div class="sec-line">${secBadge(x, ' is-mini')}<span class="sec-line-name"><span>${escapeHtml(x.name)}</span><span>${escapeHtml(secPlanLabel(x))}</span></span>
            <input type="text" inputmode="decimal" class="input sec-amount" data-sec-alloc="${escapeHtml(x.id)}" value="${job.alloc[x.id] ? round2(job.alloc[x.id]) : ''}" placeholder="0" aria-label="Amount for ${escapeHtml(x.name)}"></div>`).join('')}`;
    updateDivideLeft();
};
const updateDivideLeft = () => {
    const job = divideJob;
    if (!job) return;
    const n = divideNumbers();
    const used = Object.values(job.alloc).reduce((s, v) => s + (v || 0), 0);
    const left = round2(n.pool - used);
    const rest = divFunds().find((x) => x.mode === 'rest');
    const el = $('divide-left');
    el.dataset.state = left < -0.004 ? 'over' : left > 0.004 ? 'left' : 'ok';
    el.textContent = left < -0.004 ? `Over-allocated by ${formatCurrency(-left, dcur())}. Lower an amount.`
        : left > 0.004 ? (divideKeepRest || !rest ? `${formatCurrency(left, dcur())} stays unallocated (not in any fund).` : `${formatCurrency(left, dcur())} unallocated: it goes to ${rest.name} as the remainder.`)
            : 'Fully allocated.';
    $('divide-keep-row').hidden = !(left > 0.004);
    setSwitch($('divide-keep'), divideKeepRest || !rest);
    $('btn-divide-ok').disabled = left < -0.004;
    const parts = divFunds().map((x) => [x, (job.alloc[x.id] || 0) + (n.fills.find((f) => f.to === x.id) || { amount: 0 }).amount + (x.mode === 'rest' && left > 0 && !divideKeepRest ? left : 0)]);
    $('divide-bar').innerHTML = secStackBar(parts).replace(/data-grow="([\d.]+)"/g, 'style="width:$1%" data-w="$1"').replace(/style="--cat:([^"]+)" style="width/g, 'style="--cat:$1;width');
};
// 100% / 75% / 50% / 25% / a custom amount of the income to allocate; "None" leaves it out of the funds.
const setDivideShare = (k) => {
    const job = divideJob;
    if (!job) return;
    if (k === 'none') { skipDivide(job.incomeId); return; }
    job.share = k === 'custom' ? 'custom' : Number(k);
    job.base = k === 'custom' ? Math.min(job.total, Math.max(0, toNumber($('divide-custom').value, job.base === undefined ? job.total : job.base))) : round2(job.total * Number(k));
    if (k === 'custom' && !$('divide-custom').value) $('divide-custom').value = job.base;
    job.alloc = planSplit(divideNumbers().pool).split;
    renderDivide();
};
const confirmDivide = () => {
    const job = divideJob;
    if (!job) return;
    const n = divideNumbers();
    const cur = dcur();
    const used = Object.values(job.alloc).reduce((s, v) => s + (v || 0), 0);
    let left = round2(n.pool - used);
    if (left < -0.004) return;
    // Kept unallocated (your choice, or there's no remainder fund): it simply stays out of the funds.
    const rest = divideKeepRest ? null : divFunds().find((x) => x.mode === 'rest');
    if (!rest) left = 0;
    const moves = [];
    const mk = (kind, from, to, amount, acc = job.accountId) => moves.push({ id: generateId(), date: job.date, kind, incomeId: job.incomeId, from: from || null, to: to || null, amount: round2(amount), currency: cur, ...(acc ? { accountId: acc } : {}) });
    // A carried balance keeps its accounts: one move per account it sits in.
    const por = fundPortions();
    n.carries.forEach((c) => {
        const parts = Object.entries(por[c.from] || {}).filter(([, v]) => v > 0.004);
        if (!parts.length) { mk('move', c.from, c.to, c.amount, null); return; }
        parts.forEach(([acc, v]) => mk('move', c.from, c.to, v, acc || null));
    });
    n.fills.forEach((f) => mk('fill', null, f.to, f.amount));
    Object.entries(job.alloc).forEach(([id, v]) => { if (v > 0 && secById(id)) mk('income', null, id, v); });
    if (left > 0.004) mk('income', null, rest.id, left);
    if (!moves.length) mk('income', null, (rest || divFunds()[0]).id, 0); // marks it divided even if nothing went in
    state.config.sectionMoves = [...secMoves(), ...moves];
    if (!commitState('The allocation')) return;
    divideJob = null;
    haptic('MEDIUM');
    closeSheet('modal-divide');
    showToast(`${job.name} allocated to your funds`, 'success');
    renderActive();
};
const skipDivide = (incomeId) => {
    state.config.sectionSkipped = [...(state.config.sectionSkipped || []), incomeId].slice(-500);
    if (!commitState('That')) return;
    if (openSheets.includes('modal-divide')) closeSheet('modal-divide');
    showToast('Not allocated to your funds', 'info');
    renderActive();
};
// Undo a division (to do it again differently): its moves go, balances go back.
const undoDivide = (incomeId) => {
    const t = state.transactions.find((x) => x.id === incomeId);
    showConfirm({
        title: 'Reverse this allocation?',
        message: `${t ? t.desc : 'This income'} becomes unallocated again and every fund goes back to its earlier balance. You can allocate it again.`,
        confirmLabel: 'Reverse',
        danger: false,
        onConfirm: () => {
            state.config.sectionMoves = secMoves().filter((m) => m.incomeId !== incomeId);
            state.config.sectionSkipped = (state.config.sectionSkipped || []).filter((id) => id !== incomeId);
            if (!commitState('Reversing it')) return;
            showToast('Allocation reversed', 'success');
            if (openSheets.includes('modal-section-view')) renderSectionView();
            renderActive();
        }
    });
};

/* ---- Moving money between sections, or adding money (a starting balance) ---- */
let secMoveFrom = null;
const openSecMove = (fromId, mode = 'move') => {
    secMoveFrom = fromId || null;
    $('sec-move-title').textContent = mode === 'add' ? 'Add money to a fund' : mode === 'out' ? 'Take money out of a fund' : 'Move between funds';
    $('sec-move-mode').value = mode;
    const opts = secList().map((x) => `<option value="${escapeHtml(x.id)}">${escapeHtml(x.name)}</option>`).join('');
    $('sec-move-from').innerHTML = opts;
    $('sec-move-to').innerHTML = opts;
    $('sec-move-from-field').hidden = mode === 'add';
    $('sec-move-to-field').hidden = mode === 'out';
    $('sec-move-from-label').textContent = mode === 'out' ? 'Fund' : 'From';
    $('sec-move-to-label').textContent = mode === 'add' ? 'Fund' : 'To';
    if (fromId) { if (mode === 'add') $('sec-move-to').value = fromId; else $('sec-move-from').value = fromId; }
    if (mode === 'move' && $('sec-move-to').value === $('sec-move-from').value && secList().length > 1) $('sec-move-to').selectedIndex = (($('sec-move-from').selectedIndex) + 1) % secList().length;
    $('sec-move-amount').value = '';
    renderSecSplit();
    updateAllFreeBtn();
    secMoveToken = generateId();
    $('sec-move-note').value = '';
    $('sec-move-date').value = todayISO();
    $('sec-move-date').max = todayISO();
    updateSecMoveHint();
    openOrSwap('modal-sec-move');
};
// The fund this sheet is about, and the accounts you can enter an amount for.
const secMoveFund = () => secById($('sec-move-mode').value === 'add' ? $('sec-move-to').value : $('sec-move-from').value);
const secSplitAccounts = () => {
    const fund = secMoveFund();
    return fund && fundAccs(fund).length > 1 ? fundAccs(fund).map((id) => state.accounts.find((a) => a.id === id)).filter(Boolean) : [];
};
const renderSecSplit = () => {
    const mode = $('sec-move-mode').value;
    const accs = secSplitAccounts();
    const fund = secMoveFund();
    $('sec-move-amount-field').hidden = accs.length > 1;
    $('sec-move-split').hidden = accs.length < 2;
    if (accs.length < 2) return;
    const por = fundPortions()[fund.id] || {};
    const cur = dcur();
    const sh = fundShares(fund);
    $('sec-move-split').innerHTML = `<label class="field-label" for="sec-split-all">Total amount</label><input type="text" id="sec-split-all" class="input money-input" inputmode="decimal" placeholder="0.00" autocomplete="off">
        <span class="field-label">From each account <span class="split-shares-note">(split ${accs.map((a) => `${sh[a.id]}%`).join(' / ')}, change any)</span></span>${accs.map((a) => {
        const avail = mode === 'add' ? accountFreeMoney(a.id) : Math.max(0, por[a.id] || 0);
        return `<div class="split-row">${accountBadge(a, 'is-row', 'row-icon tint')}<span class="split-name"><span>${escapeHtml(a.name)}</span><span>${mode === 'add' ? 'free' : 'in this fund'}: ${escapeHtml(formatCurrency(avail, cur))}</span></span>
            <input type="text" inputmode="decimal" class="input split-amount" data-split-acc="${escapeHtml(a.id)}" placeholder="0" aria-label="Amount from ${escapeHtml(a.name)}"></div>`;
    }).join('')}<div class="split-total">Total <strong id="sec-split-total">${escapeHtml(formatCurrency(0, cur))}</strong></div>`;
};
// "All of it": every rupee of this fund's account(s) that is not in a fund yet.
const fundFreeAll = (fund) => {
    const accs = fundAccs(fund);
    if (accs.length === 1) return Math.max(0, accountFreeMoney(accs[0]));
    if (accs.length > 1) return round2(accs.reduce((a, id) => a + Math.max(0, accountFreeMoney(id)), 0));
    const bal = sectionBalances();
    return Math.max(0, round2(netWorth() - secList().reduce((a, x) => a + Math.max(0, bal[x.id] || 0), 0)));
};
const fillAllFree = () => {
    const fund = secMoveFund();
    if (!fund) return;
    const rows = $('sec-move-split').hidden ? [] : [...document.querySelectorAll('#sec-move-split [data-split-acc]')];
    if (rows.length) {
        rows.forEach((i) => { const v = Math.max(0, accountFreeMoney(i.dataset.splitAcc)); i.value = v > 0 ? round2(v) : ''; });
        $('sec-move-split').dispatchEvent(new Event('input'));
    } else $('sec-move-amount').value = fundFreeAll(fund) || '';
};
const updateAllFreeBtn = () => {
    const b = $('sec-move-all');
    if (!b) return;
    const fund = secMoveFund();
    const v = fund && $('sec-move-mode').value === 'add' ? fundFreeAll(fund) : 0;
    b.hidden = !(v > 0.004);
    if (v > 0.004) b.textContent = `Add all the rest: ${formatCurrency(v, dcur())}`;
};
const updateSecMoveHint = () => {
    const mode = $('sec-move-mode').value;
    const bal = sectionBalances();
    const cur = dcur();
    const fund = secById(mode === 'add' ? $('sec-move-to').value : $('sec-move-from').value);
    if (!fund) { $('sec-move-hint').textContent = ''; return; }
    const acc = fundAccs(fund).length === 1 && state.accounts.find((a) => a.id === fundAccs(fund)[0]);
    $('sec-move-hint').textContent = mode === 'add'
        ? (acc ? `Sets money aside from ${acc.name}: ${formatCurrency(Math.max(0, accountFreeMoney(acc.id, bal)), cur)} is free (not in a fund). The account balance itself doesn't change.` : 'Sets money aside for this fund (an opening balance, or extra money you put away).')
        : mode === 'out' ? `${fund.name} has ${formatCurrency(bal[fund.id] || 0, cur)}. Taken-out money is free to spend again; it stays in your account.`
            : `${fund.name} has ${formatCurrency(bal[fund.id] || 0, cur)}. Moving between funds doesn't change your accounts.`;
};
let secMoveToken = null;
const submitSecMove = () => {
    if (!secMoveToken) return false; // this sheet was already saved: a second tap never adds it twice
    const mode = $('sec-move-mode').value;
    // Several accounts: one amount per account (each checked against that account); else the single amount.
    const split = secSplitAccounts().length > 1
        ? [...document.querySelectorAll('[data-split-acc]')].map((i) => ({ acc: i.dataset.splitAcc, amount: round2(Math.max(0, toNumber(i.value, 0))), el: i })).filter((x) => x.amount > 0)
        : null;
    const amount = split ? round2(split.reduce((a, x) => a + x.amount, 0)) : round2(toNumber($('sec-move-amount').value, NaN));
    const to = mode === 'out' ? null : $('sec-move-to').value;
    const from = mode === 'add' ? null : $('sec-move-from').value;
    const date = isISODate($('sec-move-date').value) && $('sec-move-date').value <= todayISO() ? $('sec-move-date').value : todayISO();
    const note = $('sec-move-note').value.trim();
    if (!(amount > 0)) return fieldError(split ? document.querySelector('[data-split-acc]') : $('sec-move-amount'), 'Enter an amount greater than zero.');
    if (from && from === to) return fieldError($('sec-move-to'), 'Pick a different fund.');
    if (split) {
        const por = fundPortions()[from || ''] || {};
        for (const x of split) {
            const avail = mode === 'add' ? accountFreeMoney(x.acc) : Math.max(0, por[x.acc] || 0);
            if (x.amount > avail + 0.004) return fieldError(x.el, shortfallText(avail, x.amount));
        }
    }
    const bal = sectionBalances();
    if (from && amount > (bal[from] || 0) + 0.004) return fieldError($('sec-move-amount'), shortfallText(bal[from] || 0, amount));
    if (mode === 'add') {
        const fund = secById(to);
        if (split) { /* checked per account above */ } else if (fund && fundAccs(fund).length === 1) {
            const free = accountFreeMoney(fundAccs(fund)[0], bal);
            if (amount > free + 0.004) return fieldError($('sec-move-amount'), shortfallText(free, amount));
        } else if (fund) {
            const free = round2(netWorth() - secList().reduce((a, x) => a + Math.max(0, bal[x.id] || 0), 0));
            if (amount > free + 0.004) return fieldError($('sec-move-amount'), shortfallText(free, amount));
        }
    }
    const token = secMoveToken;
    secMoveToken = null;
    const kind = mode === 'add' ? 'add' : mode === 'out' ? 'out' : 'move';
    const oneAcc = (() => { const f = secById(from || to); return f && fundAccs(f).length === 1 ? fundAccs(f)[0] : null; })();
    const parts = split ? split.map((x) => ({ acc: x.acc, amount: x.amount })) : [{ acc: oneAcc, amount }];
    state.config.sectionMoves = [...secMoves(), ...parts.map((x) => ({ id: generateId(), date, kind, incomeId: null, from, to, amount: x.amount, currency: dcur(), ...(x.acc ? { accountId: x.acc } : {}), ...(note ? { note: note.slice(0, 120) } : {}) }))];
    if (!commitState('That')) { secMoveToken = token; return false; }
    haptic('MEDIUM');
    closeSheet('modal-sec-move');
    const after = sectionBalances();
    const f = secById(to || from);
    showToast(mode === 'add' ? `${formatCurrency(amount, dcur())} added to ${f.name}. Now ${formatCurrency(after[f.id], dcur())}.`
        : mode === 'out' ? `${formatCurrency(amount, dcur())} taken out of ${f.name}. Now ${formatCurrency(after[f.id], dcur())}.`
            : `${formatCurrency(amount, dcur())} moved from ${secById(from).name} to ${secById(to).name}`, 'success');
    if (openSheets.includes('modal-section-view')) renderSectionView();
    renderActive();
    return true;
};

// ---- Hold a fund: add, take out, move, edit, delete ----
let fundHold = null;
let fundHeld = false;
const openFundActions = (id) => {
    const x = secById(id);
    if (!x) return;
    secViewId = id;
    const bal = sectionBalances()[id] || 0;
    $('fund-actions-title').textContent = x.name;
    $('fund-actions-sub').textContent = `${formatCurrency(bal, dcur())} · ${secPlanLabel(x)}`;
    openOrSwap('modal-fund-actions');
};
const initFundHold = () => {
    const cancel = () => { if (fundHold) { clearTimeout(fundHold.timer); fundHold = null; } };
    document.addEventListener('pointerdown', (e) => {
        const tile = e.target.closest('.sec-tile[data-sec-view], .sec-open[data-sec-view], .sec-chip[data-sec-view]');
        fundHeld = false;
        if (!tile) return;
        fundHold = { x: e.clientX, y: e.clientY, timer: setTimeout(() => {
            fundHold = null;
            fundHeld = true;
            haptic('MEDIUM');
            tile.classList.add('is-held');
            setTimeout(() => tile.classList.remove('is-held'), 280);
            openFundActions(tile.dataset.secView);
        }, 480) };
    });
    document.addEventListener('pointermove', (e) => { if (fundHold && Math.hypot(e.clientX - fundHold.x, e.clientY - fundHold.y) > 8) cancel(); });
    ['pointerup', 'pointercancel'].forEach((ev) => document.addEventListener(ev, () => { cancel(); if (fundHeld) setTimeout(() => { fundHeld = false; }, 80); }));
    document.addEventListener('click', (e) => { if (fundHeld && e.target.closest('.sec-tile, .sec-open, .sec-chip')) { e.preventDefault(); e.stopPropagation(); fundHeld = false; } }, true);
    document.addEventListener('contextmenu', (e) => { if (e.target.closest('.sec-tile, .sec-open, .sec-chip')) e.preventDefault(); });
};

// Hold any entry (Activity, Home, funds, bills…) to see everything about it, nothing cut short.
let txHold = null;
let txHeld = false;
const txDetailRows = (t) => {
    const rows = [];
    const add = (label, value) => { if (value !== null && value !== undefined && String(value).trim()) rows.push([label, String(value)]); };
    const value = toDisplay(t.amount, t.currency);
    add('Amount', t.type === 'transfer' ? formatDisplay(t.amount, t.currency) : formatSigned(t.type === 'income' ? value : -value, dcur()));
    if (t.currency !== dcur()) add('In its own currency', formatCurrency(t.amount, t.currency));
    if (t.fx) add('Exchange', fxNote(t));
    // A foreign payment whose rupee amount is Vela's estimate: one tap to put in what the bank really took.
    if (t.fx && t.fx.estimated) rows.push(['Bank amount', '', 'charged']);
    const day = parseDate(t.date);
    add('Date', `${day.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${txTime(t) ? ` · ${fmtTime(txTime(t))}` : ''}`);
    add('Type', t.type === 'transfer' ? 'Transfer between your accounts' : `${t.type === 'income' ? 'Income' : 'Expense'}${t.fixed ? ' · fixed every month' : ''}`);
    if (t.pending) add('Status', `${payStatusLabel(payStatus(t.date), t.type)} · ${t.type === 'income' ? 'expected' : 'due'} ${shortDate(t.date)}`);
    else if (t.paidAt || t.dueDate) add('Status', `${t.type === 'income' ? 'Received' : 'Paid'}${t.paidAt ? ` ${shortDate(toISODate(new Date(t.paidAt)))}` : ''}${t.dueDate ? ` · was due ${shortDate(t.dueDate)}` : ''}`);
    if (t.type === 'transfer') add('Accounts', transferLine(t));
    else { const a = state.accounts.find((x) => x.id === t.accountId); if (a) add(t.type === 'income' ? 'Into account' : 'From account', a.name); }
    if (t.type !== 'transfer') add('Category', catById(t.category, t.type).name);
    const sec = t.sectionId ? secById(t.sectionId) : null;
    if (sec) add('Fund', sec.name);
    const bill = t.recurringId ? state.recurring.find((x) => x.id === t.recurringId) : null;
    if (bill) add('Fixed payment', bill.name);
    const ref = t.billRef || (bill && bill.ref);
    if (ref) add('Paid for', refLabel(ref));
    else if (t.type === 'expense' && (bill || /util|bill|phone|mobile|internet|electric|water|reload/i.test(`${catById(t.category, t.type).name} ${t.desc}`) || /(ceb|leco|nwsdb|water|dialog|mobitel|slt|hutch|airtel)/i.test(t.desc))) rows.push(['Paid for', '', 'add']);
    if (t.feeFor) add('Bank fee', t.feeEstimated ? 'Usual fee (the SMS did not say the amount)' : 'Charged by the bank');
    if (t.type === 'income' && t.shareOf) { const b = state.recurring.find((x) => x.id === t.shareOf); const f = fundForBill(b); add('Share of a bill', `${b ? b.name : 'A bill'}${f ? ` · in your ${f.name} fund` : ''}`); }
    if (t.type === 'income' && t.inBudget === false) add('Budget', 'Not counted in the budget');
    if (t.bank) {
        const b = t.bank;
        add('Found in', `${b.bank} · ${sourceLabel(b.sources || ['sms'])}`);
        if (b.merchant && b.merchant !== t.desc) add('Bank says', b.merchant);
        if (b.last4) add('Card or account', `••${b.last4}`);
        if (b.ref) add('Bank reference', b.ref);
    }
    if (t.note) add('Note', t.note);
    if (t.beforeBalance) add('Balance', 'Before the balance date: already inside that balance');
    if (t.createdAt) { const c = new Date(t.createdAt); add('Added', `${c.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })} · ${c.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`); }
    return rows;
};
const openTxDetail = (id) => {
    const t = state.transactions.find((x) => x.id === id);
    if (!t) return;
    $('txd-badge').innerHTML = t.type === 'transfer' ? `<span class="cat-badge" style="--cat:var(--text-2)">${icon('i-swap')}</span>` : entryBadge(t.desc, t.category, t.type);
    $('txd-title').textContent = t.type === 'transfer' && t.desc === 'ATM withdrawal' ? 'Cash from ATM' : t.desc;
    const value = toDisplay(t.amount, t.currency);
    const amt = $('txd-amount');
    amt.textContent = t.type === 'transfer' ? formatDisplay(t.amount, t.currency) : formatSigned(t.type === 'income' ? value : -value, dcur());
    amt.className = `amount txd-amount ${t.type === 'income' ? 'is-income' : t.type === 'transfer' ? 'is-transfer' : ''}`;
    $('txd-list').innerHTML = txDetailRows(t).slice(1).map(([k, v, add]) => `<div class="txd-row"><span>${escapeHtml(k)}</span>${add === 'charged' ? `<button type="button" class="link-btn txd-add" data-edit-tx="${escapeHtml(t.id)}" data-focus="tx-charged">${icon('i-edit', 'ic ic-sm')} Estimate · enter what your bank took</button>` : add ? `<button type="button" class="link-btn txd-add" data-edit-tx="${escapeHtml(t.id)}" data-focus="tx-billref">${icon('i-plus', 'ic ic-sm')} Add account or phone no.</button>` : `<strong>${escapeHtml(v)}</strong>`}</div>`).join('');
    $('txd-edit').dataset.editTx = t.id;
    openOrSwap('modal-tx-detail');
};
const initTxHold = () => {
    const cancel = () => { if (txHold) { clearTimeout(txHold.timer); txHold = null; } };
    document.addEventListener('pointerdown', (e) => {
        const row = e.target.closest('[data-edit-tx]');
        txHeld = false;
        if (!row || row.id === 'txd-edit' || row.classList.contains('txd-add') || e.target.closest('[data-pay], .tx-confirm')) return;
        cancel();
        txHold = { x: e.clientX, y: e.clientY, timer: setTimeout(() => {
            txHold = null;
            txHeld = true;
            haptic('MEDIUM');
            row.classList.add('is-held');
            setTimeout(() => row.classList.remove('is-held'), 280);
            openTxDetail(row.dataset.editTx);
        }, 480) };
    });
    document.addEventListener('pointermove', (e) => { if (txHold && Math.hypot(e.clientX - txHold.x, e.clientY - txHold.y) > 8) cancel(); });
    ['pointerup', 'pointercancel'].forEach((ev) => document.addEventListener(ev, () => { cancel(); if (txHeld) setTimeout(() => { txHeld = false; }, 80); }));
    document.addEventListener('click', (e) => { if (txHeld && e.target.closest('[data-edit-tx]')) { e.preventDefault(); e.stopPropagation(); txHeld = false; } }, true);
    document.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-edit-tx]')) e.preventDefault(); });
};

/* ---- Motion: amounts count up, bars grow (nothing moves when the phone asks for less motion) ---- */
const lessMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const animateIn = (root) => {
    if (!root) return;
    const nums = root.querySelectorAll('[data-countup]');
    if (lessMotion()) { nums.forEach((el) => { el.textContent = formatCurrency(Number(el.dataset.countup), dcur()); }); return; }
    nums.forEach((el) => {
        const to = Number(el.dataset.countup);
        const from = Number(el.dataset.from || 0);
        const t0 = performance.now();
        const step = (now) => {
            const k = Math.min(1, (now - t0) / 650);
            const e = 1 - Math.pow(1 - k, 3);
            el.textContent = formatCurrency(from + (to - from) * e, dcur());
            if (k < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    });
    root.querySelectorAll('[data-grow]').forEach((el) => { el.style.width = '0%'; requestAnimationFrame(() => requestAnimationFrame(() => { el.style.width = `${el.dataset.grow}%`; })); });
};
// The share of money each section holds, as one coloured bar.
const secStackBar = (values) => {
    const pos = values.filter(([, v]) => v > 0);
    const total = pos.reduce((a, [, v]) => a + v, 0);
    if (!total) return '<div class="sec-stack is-empty"></div>';
    return `<div class="sec-stack" role="img" aria-label="How your money is spread over your funds">${pos.map(([x, v]) => `<span style="--cat:var(--pal-${x.color})" data-grow="${((v / total) * 100).toFixed(2)}" title="${escapeHtml(x.name)}"></span>`).join('')}</div>`;
};

/* ---- Setting sections up and editing them ---- */
const SECTION_TEMPLATES = {
    '503020': [['Needs', 'percent', 50, 'cyan', 'c-Rent'], ['Wants', 'percent', 30, 'magenta', 'c-Entertainment'], ['Savings', 'rest', 0, 'green', 'c-Investment']],
    'basic': [['Bills', 'percent', 40, 'violet', 'c-Utilities'], ['Food', 'percent', 25, 'pink', 'c-Food'], ['Transport', 'percent', 10, 'cyan', 'c-Travel'], ['Fun', 'percent', 10, 'orange', 'c-Entertainment'], ['Savings', 'rest', 0, 'green', 'c-Investment']]
};
const setupSections = (template) => {
    const list = SECTION_TEMPLATES[template];
    if (!list) { openSectionEditor(); return; }
    state.config.sections = list.map(([name, mode, value, color, ic]) => ({ id: generateId(), name, mode, value, color, icon: ic, currency: dcur() }));
    if (!state.config.sectionSince) state.config.sectionSince = toISODate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    if (!commitState('Your funds')) return;
    showToast('Funds created. Change names and allocations any time.', 'success');
    renderActive();
};
let secEditMode = 'percent';
let secEditColor = 'violet';
let secEditIcon = 'i-wallet';
let secEditOnce = false;
const SECTION_ICONS = ['i-wallet', 'c-Rent', 'c-Food', 'c-Utilities', 'c-Travel', 'c-Entertainment', 'c-Health', 'c-Shopping', 'c-Investment', 'c-Gift', 'x-school', 'x-book', 'x-coffee', 'x-plane', 'x-gym', 'x-paw', 'x-phone', 'x-fuel', 'x-music', 'x-tools'];
const openSectionEditor = (id) => {
    const x = id ? secById(id) : null;
    $('section-id').value = x ? x.id : '';
    $('section-edit-title').textContent = x ? `Edit ${x.name}` : 'New fund';
    $('section-name').value = x ? x.name : '';
    secEditMode = x ? x.mode : (secList().some((o) => o.mode === 'rest') ? 'percent' : 'rest');
    secEditColor = x ? x.color : PALETTE[secList().length % PALETTE.length];
    secEditIcon = x && x.icon ? x.icon : 'i-wallet';
    $('section-value').value = x && x.mode !== 'rest' && x.mode !== 'manual' ? x.value : '';
    secEditOnce = !!(x && x.once);
    $('section-target').value = x && x.target ? x.target : '';
    const view = viewAccountObj();
    const chosen = x ? fundAccs(x) : (view ? [view.id] : []);
    $('section-accounts').innerHTML = state.accounts.map((a) => `<label class="acc-check"><input type="checkbox" value="${escapeHtml(a.id)}" ${chosen.includes(a.id) ? 'checked' : ''}>${accountBadge(a, 'is-row', 'row-icon tint')}<span>${escapeHtml(a.name)}</span></label>`).join('');
    secEditShares = x ? { ...fundShares(x) } : {};
    renderSectionShares();
    $('btn-delete-section').hidden = !x;
    renderSectionEditor();
    openOrSwap('modal-section');
};
const renderSectionEditor = () => {
    setPressed('[data-sec-mode]', (b) => b.dataset.secMode === secEditMode);
    $('section-value-field').hidden = secEditMode === 'rest' || secEditMode === 'manual';
    $('section-once-row').hidden = secEditMode === 'rest' || secEditMode === 'manual';
    setSwitch($('section-once'), secEditOnce);
    $('section-value-label').textContent = secEditMode === 'percent' ? 'Percentage of each income (%)' : `Fixed amount from each income (${dcur()})`;
    $('section-value').placeholder = secEditMode === 'percent' ? 'e.g. 30' : '0.00';
    const restNow = secList().find((o) => o.mode === 'rest' && o.id !== $('section-id').value);
    $('section-mode-hint').textContent = secEditMode === 'manual' ? 'Nothing is allocated to it automatically: it only has the money you add yourself (Add funds), for example Rs. 7,500 for food this month only.'
        : secEditMode === 'rest'
        ? (restNow ? `This becomes the remainder fund instead of ${restNow.name} (it becomes 0%).` : 'Receives whatever is left after the other funds are allocated.')
        : secEditMode === 'percent' ? 'Allocated after fixed amounts and after covering any fund in deficit.' : 'Allocated first, before the percentages.';
    $('section-colors').innerHTML = PALETTE.map((p) => `<button type="button" class="swatch" data-sec-color="${p}" style="--cat:var(--pal-${p})" aria-label="${p}" aria-pressed="${p === secEditColor}"></button>`).join('');
    $('section-icons').innerHTML = SECTION_ICONS.map((i) => `<button type="button" class="icon-choice" data-sec-icon="${i}" style="--cat:var(--pal-${secEditColor})" aria-label="${i.replace(/^[cxi]-/, '')}" aria-pressed="${i === secEditIcon}">${icon(i)}</button>`).join('');
    updateSectionPreview();
};
const updateSectionPreview = () => {
    const name = $('section-name').value.trim() || 'Your fund';
    const v = toNumber($('section-value').value, 0);
    $('section-preview').innerHTML = `${secBadge({ color: secEditColor, icon: secEditIcon })}<span><span>${escapeHtml(name)}</span><span>${escapeHtml(secPlanLabelBase({ mode: secEditMode, value: v, currency: dcur(), once: secEditOnce }))}</span></span>`;
};
let secEditShares = {};
// With 2+ accounts ticked: how much of this fund comes from each (%), with a live total.
const renderSectionShares = () => {
    const ids = [...document.querySelectorAll('#section-accounts input:checked')].map((i) => i.value);
    const box = $('section-shares');
    box.hidden = ids.length < 2;
    if (ids.length < 2) { box.innerHTML = ''; return; }
    const known = ids.every((id) => typeof secEditShares[id] === 'number') && Math.abs(ids.reduce((a, id) => a + secEditShares[id], 0) - 100) < 0.6;
    const vals = known ? secEditShares : fundShares({ accountIds: ids });
    box.innerHTML = `<span class="field-label">How this fund is shared</span>${ids.map((id) => {
        const a = state.accounts.find((y) => y.id === id);
        return `<div class="split-row">${accountBadge(a, 'is-row', 'row-icon tint')}<span class="split-name"><span>${escapeHtml(a.name)}</span><span data-share-rs="${escapeHtml(id)}"></span></span><span class="share-input"><input type="text" inputmode="decimal" class="input" data-share-acc="${escapeHtml(id)}" value="${vals[id]}" aria-label="Share from ${escapeHtml(a.name)} in percent"><span>%</span></span></div>`;
    }).join('')}<div class="split-total"><span>Total</span><strong id="section-share-total"></strong></div><span class="field-hint">When you add money, Vela splits it this way. You can still change each amount.</span>`;
    updateShareTotal();
};
const updateShareTotal = () => {
    const ins = [...document.querySelectorAll('[data-share-acc]')];
    ins.forEach((i) => { secEditShares[i.dataset.shareAcc] = round2(Math.max(0, toNumber(i.value, 0))); });
    const t = round2(ins.reduce((a, i) => a + Math.max(0, toNumber(i.value, 0)), 0));
    const el = $('section-share-total');
    if (!el) return;
    el.textContent = `${t}%`;
    el.classList.toggle('text-expense', Math.abs(t - 100) >= 0.6);
    el.classList.toggle('text-income', Math.abs(t - 100) < 0.6);
    const ex = toNumber($('section-value').value, 0);
    ins.forEach((i) => {
        const rs = document.querySelector(`[data-share-rs="${i.dataset.shareAcc}"]`);
        if (rs) rs.textContent = secEditMode === 'amount' && ex > 0 ? `${formatCompact((ex * Math.max(0, toNumber(i.value, 0))) / 100, dcur())} of ${formatCompact(ex, dcur())}` : `${formatCompact(100 * Math.max(0, toNumber(i.value, 0)), dcur())} of every ${formatCompact(10000, dcur())}`;
    });
};
const submitSection = () => {
    const id = $('section-id').value;
    const name = $('section-name').value.trim();
    const value = toNumber($('section-value').value, NaN);
    if (!name) return fieldError($('section-name'), 'Give the fund a name, like "Food".');
    if (secList().some((o) => o.name.toLowerCase() === name.toLowerCase() && o.id !== id)) return fieldError($('section-name'), `You already have "${name}".`);
    const shareIns = [...document.querySelectorAll('[data-share-acc]')];
    const shareSum = round2(shareIns.reduce((a, i) => a + Math.max(0, toNumber(i.value, 0)), 0));
    if (shareIns.length > 1 && Math.abs(shareSum - 100) >= 0.6) return fieldError(shareIns[0], `The shares add up to ${shareSum}%. Make them 100%.`);
    if (secEditMode !== 'rest' && secEditMode !== 'manual' && !(value > 0)) return fieldError($('section-value'), secEditMode === 'percent' ? 'Enter a percentage like 30.' : 'Enter an amount.');
    if (secEditMode === 'percent') {
        const others = secList().filter((o) => o.mode === 'percent' && o.id !== id).reduce((s, o) => s + o.value, 0);
        if (others + value > 100) return fieldError($('section-value'), `Your other funds already take ${others}%. This can be at most ${Math.max(0, 100 - others)}%.`);
    }
    if (secEditMode === 'rest') state.config.sections = secList().map((o) => (o.mode === 'rest' && o.id !== id ? { ...o, mode: 'percent', value: 0 } : o));
    const data = { name, mode: secEditMode, value: secEditMode === 'rest' || secEditMode === 'manual' ? 0 : value, color: secEditColor, icon: secEditIcon, currency: dcur(),
        once: secEditOnce && (secEditMode === 'percent' || secEditMode === 'amount'), accountIds: [...document.querySelectorAll('#section-accounts input:checked')].map((i) => i.value),
        accountShares: shareIns.length > 1 ? Object.fromEntries(shareIns.map((i) => [i.dataset.shareAcc, round2(Math.max(0, toNumber(i.value, 0)))])) : undefined,
        target: Math.max(0, round2(toNumber($('section-target').value, 0))) };
    if (id) state.config.sections = secList().map((o) => (o.id === id ? { ...o, ...data } : o));
    else {
        state.config.sections = [...secList(), { id: generateId(), ...data }];
        if (!state.config.sectionSince) state.config.sectionSince = toISODate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    }
    if (!commitState('The fund')) return false;
    closeSheet('modal-section');
    showToast(id ? 'Fund saved' : `Fund "${name}" added`, 'success');
    renderActive();
    return true;
};
// Deleting a section: its money, history and expenses go to another section (nothing disappears).
const deleteSection = () => {
    const id = $('section-id').value;
    const x = secById(id);
    if (!x) return;
    const others = secList().filter((o) => o.id !== id);
    const bal = sectionBalances()[id] || 0;
    const used = state.transactions.some((t) => t.sectionId === id) || secMoves().some((m) => m.to === id || m.from === id);
    if (used && !others.length) { showToast('Add another fund first: its balance and history need somewhere to go.', 'info'); return; }
    const target = others.find((o) => o.mode === 'rest') || others[0];
    showConfirm({
        title: `Delete "${x.name}"?`,
        message: used ? `Its balance (${formatCurrency(bal, dcur())}), history and expenses are transferred to "${target.name}". Nothing is lost.` : 'It has no balance or history yet.',
        onConfirm: () => {
            state.config.sectionMoves = secMoves().map((m) => ({ ...m, to: m.to === id ? target.id : m.to, from: m.from === id ? target.id : m.from })).filter((m) => !(m.from && m.from === m.to));
            state.transactions.forEach((t) => { if (t.sectionId === id) { t.sectionId = target.id; queueSync('transaction', t.id, 'upsert', false); } });
            Object.keys(state.config.sectionCatMap || {}).forEach((k) => { if (state.config.sectionCatMap[k] === id) state.config.sectionCatMap[k] = target.id; });
            state.config.sections = others.map((o) => (x.mode === 'rest' && o.id === target.id ? { ...o, mode: 'rest', value: 0 } : o));
            if (!state.config.sections.length) { state.config.sectionMoves = []; state.config.sectionSince = null; }
            if (!commitState('Deleting the fund')) return;
            flushSync();
            closeSheet('modal-section');
            if (openSheets.includes('modal-section-view')) closeSheet('modal-section-view');
            showToast('Fund deleted', 'success');
            renderActive();
        }
    });
};

/* ---- A section's page: balance, this month, history ---- */
let secViewId = null;
const openSectionView = (id) => { secViewId = id; renderSectionView(); openOrSwap('modal-section-view'); animateIn($('section-view-body')); };
const renderSectionView = () => {
    const x = secById(secViewId);
    if (!x) return;
    const cur = dcur();
    const bal = sectionBalances()[x.id] || 0;
    const now = new Date();
    const mo = sectionMonth(now.getFullYear(), now.getMonth())[x.id];
    $('section-view-title').textContent = x.name;
    const items = [];
    secMoves().forEach((m) => {
        if (m.to !== x.id && m.from !== x.id) return;
        const inc = m.incomeId && state.transactions.find((t) => t.id === m.incomeId);
        const other = secById(m.to === x.id ? m.from : m.to);
        const label = m.kind === 'fill' ? `Deficit covered${inc ? ` · ${inc.desc}` : ''}` : m.kind === 'add' ? `Money added${m.note ? ` · ${m.note}` : ''}` : m.kind === 'out' ? `Taken out${m.note ? ` · ${m.note}` : ''}`
            : m.kind === 'move' ? (m.to === x.id ? `Transfer from ${other ? other.name : 'a fund'}` : `Transfer to ${other ? other.name : 'a fund'}`)
                : `Allocated from ${inc ? inc.desc : 'income'}`;
        items.push({ date: m.date, label, v: (m.to === x.id ? 1 : -1) * toDisplay(m.amount, m.currency), incomeId: m.kind === 'income' || m.kind === 'fill' ? m.incomeId : null, ic: m.kind === 'move' ? 'i-swap' : m.kind === 'fill' ? 'i-check' : m.kind === 'add' ? 'i-plus' : m.kind === 'out' ? 'i-arrow-up' : 'i-arrow-down' });
    });
    state.transactions.forEach((t) => { if (t.type === 'expense' && t.sectionId === x.id && !isUpcoming(t)) items.push({ date: t.date, label: t.desc, v: -toDisplay(t.amount, t.currency), tx: t.id, badge: entryBadge(t.desc, t.category, 'expense') }); });
    items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const seenIncome = new Set();
    $('section-view-body').innerHTML = `
        <div class="sec-hero" style="--cat:var(--pal-${x.color})">${secBadge(x, ' is-big')}<span class="sec-hero-amount amount ${bal < 0 ? 'text-expense' : ''}" data-countup="${bal}">${escapeHtml(formatCurrency(bal, cur))}</span><span>${bal < 0 ? 'deficit: covered first from the next income' : 'available balance'} · ${escapeHtml(secPlanLabel(x))}</span></div>
        ${(() => {
        let added = 0; let out = 0; let spent = 0;
        secMoves().forEach((m) => { const v = toDisplay(m.amount, m.currency); if (m.to === x.id) added += v; if (m.from === x.id) out += v; });
        state.transactions.forEach((t) => { if (t.type === 'expense' && t.sectionId === x.id && !isUpcoming(t)) spent += toDisplay(t.amount, t.currency); });
        const tgt = x.target ? toDisplay(x.target, x.currency) : 0;
        return `<div class="fund-stats"><span><small>Added</small><strong class="text-income">${escapeHtml(formatCurrency(added, cur))}</strong></span><span><small>Taken out</small><strong>${escapeHtml(formatCurrency(out, cur))}</strong></span><span><small>Spent</small><strong class="text-expense">${escapeHtml(formatCurrency(spent, cur))}</strong></span></div>`
            + (tgt ? `<div class="fund-target"><div class="fund-target-row"><span>Target ${escapeHtml(formatCurrency(tgt, cur))}</span><span>${Math.min(100, Math.max(0, Math.round((bal / tgt) * 100)))}%</span></div>${meterHtml(Math.max(0, (bal / tgt) * 100), null, `${x.name} target`)}<span class="fund-target-left">${bal >= tgt ? 'Target reached' : `${escapeHtml(formatCurrency(tgt - Math.max(0, bal), cur))} still to go`}</span></div>` : '');
    })()}
        ${(() => {
        const por = fundPortions()[x.id] || {};
        const rows = Object.entries(por).filter(([, v]) => Math.abs(v) > 0.004);
        if (!rows.length) return '';
        return `<div class="section-head"><h2>Where the money is</h2></div><div class="fund-where">${rows.map(([acc, v]) => {
            const a = state.accounts.find((y) => y.id === acc);
            return `<div class="split-row">${a ? accountBadge(a, 'is-row', 'row-icon tint') : `<span class="row-icon tint">${icon('i-wallet')}</span>`}<span class="split-name"><span>${escapeHtml(a ? a.name : 'Not tied to one account')}</span>${a && fundShares(x)[acc] !== undefined ? `<span>Planned share ${fundShares(x)[acc]}%</span>` : ''}</span><strong class="amount ${v < 0 ? 'text-expense' : ''}">${escapeHtml(formatCurrency(v, cur))}</strong></div>`;
        }).join('')}</div>`;
    })()}
        <div class="sec-month"><span>Allocated this month <strong class="text-income">${escapeHtml(formatCurrency(mo.in, cur))}</strong></span><span>Spent <strong class="text-expense">${escapeHtml(formatCurrency(mo.spent, cur))}</strong></span></div>
        <div class="section-head"><h2>Transactions</h2></div>
        ${items.length ? `<ul class="sec-history">${items.slice(0, 80).map((i) => {
        const undo = i.incomeId && !seenIncome.has(i.incomeId) ? (seenIncome.add(i.incomeId), `<button type="button" class="link-btn faint" data-sec-undo="${escapeHtml(i.incomeId)}">Reverse</button>`) : '';
        return `<li${i.tx ? ` data-edit-tx="${escapeHtml(i.tx)}" role="button" tabindex="0"` : ''}>${i.badge || `<span class="cat-badge sec-h-icon" data-in="${i.v >= 0}">${icon(i.ic || 'i-wallet')}</span>`}<span class="sec-h-main"><span>${escapeHtml(i.label)}</span><span>${escapeHtml(shortDate(i.date))}</span></span>${undo}<span class="amount ${i.v < 0 ? 'text-expense' : 'text-income'}">${i.v > 0 ? '+' : '−'}${escapeHtml(formatCurrency(Math.abs(i.v), cur))}</span></li>`;
    }).join('')}</ul>` : '<p class="field-hint">No transactions yet. Allocate an income, or add funds yourself.</p>'}`;
};

/* ---- Expenses with no section: give them one ---- */
const unassignedExpenses = () => {
    const since = state.config.sectionSince || '9999';
    return state.transactions.filter((t) => t.type === 'expense' && !t.sectionId && !isUpcoming(t) && t.date >= since).sort((a, b) => (a.date < b.date ? 1 : -1));
};
const openUnassigned = () => {
    const list = unassignedExpenses();
    const opts = (sel) => `<option value="">Unallocated</option>${secList().map((x) => `<option value="${escapeHtml(x.id)}" ${sel === x.id ? 'selected' : ''}>${escapeHtml(x.name)}</option>`).join('')}`;
    $('sec-unassigned-body').innerHTML = list.length ? list.slice(0, 100).map((t) => `
        <div class="sec-line">${entryBadge(t.desc, t.category, 'expense')}<span class="sec-line-name"><span>${escapeHtml(t.desc)}</span><span>${escapeHtml(shortDate(t.date))} · ${escapeHtml(formatCurrency(t.amount, t.currency))}</span></span>
            <div class="select sec-carry"><select class="input" data-assign-tx="${escapeHtml(t.id)}" aria-label="Fund for ${escapeHtml(t.desc)}">${opts(autoFundFor(t.category, t.amount, t.currency))}</select></div></div>`).join('')
        : '<p class="field-hint">Every expense is assigned to a fund.</p>';
    openOrSwap('modal-sec-unassigned');
};
const saveUnassigned = () => {
    let n = 0;
    document.querySelectorAll('[data-assign-tx]').forEach((sel) => {
        if (!sel.value) return;
        const t = state.transactions.find((x) => x.id === sel.dataset.assignTx);
        if (!t || t.sectionId) return;
        t.sectionId = sel.value;
        learnSection(t.category, sel.value);
        queueSync('transaction', t.id, 'upsert', false);
        n++;
    });
    if (!commitState('The funds')) return;
    flushSync();
    closeSheet('modal-sec-unassigned');
    showToast(n ? `${plural(n, 'expense')} assigned to funds` : 'Nothing changed', n ? 'success' : 'info');
    renderActive();
};

/* ---- Plan > Sections, the Home card, Insights ---- */
const planSectionsHtml = () => {
    const cur = dcur();
    const viewing = viewAccountObj();
    const shown = fundsFor(viewing ? viewing.id : null);
    if (!secList().length) {
        const tpl = (key, title, desc) => `<button type="button" class="sec-template" data-sec-template="${key}">
            <span class="sec-template-icons">${SECTION_TEMPLATES[key].map(([n, , , color, ic]) => secBadge({ color, icon: ic }, ' is-mini')).join('')}</span>
            <span class="sec-template-text"><strong>${title}</strong><span>${desc}</span></span>${icon('i-chevron', 'ic chev')}</button>`;
        return `<section class="card sec-intro">
            <span class="sec-intro-art">${icon('i-wallet')}</span>
            <h2 class="card-title">Allocate your income into funds</h2>
            <p class="card-sub">Allocate each salary into funds such as Bills, Food and Savings. Every expense is paid from a fund and reduces only that fund's balance. Unspent balances carry forward (or are transferred where you choose), and a fund in deficit is covered first from the next income.</p>
            <div class="sec-templates">
                ${tpl('503020', 'Needs · Wants · Savings', '50/30/20 rule: needs, wants, and the remainder saved')}
                ${tpl('basic', 'Bills · Food · Transport · Fun · Savings', 'Five everyday funds')}
                <button type="button" class="sec-template is-own" data-sec-template="own"><span class="sec-template-icons"><span class="cat-badge is-mini" style="--cat:var(--primary)">${icon('i-plus')}</span></span><span class="sec-template-text"><strong>Create my own</strong><span>Name, icon, colour and allocation for each fund</span></span>${icon('i-chevron', 'ic chev')}</button>
            </div></section>`;
    }
    const bal = sectionBalances();
    const now = new Date();
    const mo = sectionMonth(now.getFullYear(), now.getMonth());
    const total = shown.reduce((a, x) => a + Math.max(0, bal[x.id] || 0), 0);
    const shortSum = round2(shown.reduce((a, x) => a + Math.min(0, bal[x.id] || 0), 0));
    const waiting = undividedIncomes().filter((t) => !viewing || t.accountId === viewing.id);
    const loose = unassignedExpenses().filter((t) => !viewing || t.accountId === viewing.id);
    const pct = secList().filter((x) => x.mode === 'percent').reduce((a, x) => a + x.value, 0);
    return `
        ${waiting.map((t) => `<section class="card sec-divide-card">
            <span class="sec-divide-icon">${icon('i-arrow-down')}</span>
            <span class="sec-divide-text"><strong>${escapeHtml(formatCurrency(t.amount, t.currency))} ${escapeHtml(t.desc)}</strong><span>Received ${escapeHtml(shortDate(t.date))} · unallocated</span></span>
            <span class="sec-divide-actions"><button type="button" class="btn btn-primary btn-sm" data-sec-divide="${escapeHtml(t.id)}">Allocate now</button><button type="button" class="btn btn-secondary btn-sm" data-sec-skip="${escapeHtml(t.id)}">Don't allocate</button></span></section>`).join('')}
        <article class="card glow sec-summary" style="--glow:var(--primary)">
            <div class="card-head" style="margin-bottom:var(--sp-1)"><span class="card-sub">Total in funds${viewing ? ` · ${escapeHtml(viewing.name)}` : ''}</span><button type="button" class="btn btn-primary btn-xs" data-action="sec-new">${icon('i-plus', 'ic ic-sm')} New fund</button></div>
            <div class="big-number amount" data-countup="${total}">${escapeHtml(formatCurrency(total, cur))}</div>
            <div style="margin-top:var(--sp-3)">${secStackBar(shown.map((x) => [x, bal[x.id] || 0]))}</div>
            ${shortSum < -0.004 ? `<div class="fund-short">${icon('i-alert', 'ic ic-sm')}<span><strong>${escapeHtml(formatCurrency(-shortSum, cur))} short</strong> in ${plural(shown.filter((x) => bal[x.id] < -0.004).length, 'fund')}: expenses were paid from ${shown.filter((x) => bal[x.id] < -0.004).length === 1 ? 'it' : 'them'} before money was put in.</span><button type="button" class="btn btn-secondary btn-xs" data-fund-repair="all">Fix</button></div>` : ''}
            ${total > 0 ? `<div class="sec-legend">${shown.filter((x) => (bal[x.id] || 0) > 0).map((x) => `<span style="--cat:var(--pal-${x.color})"><i></i>${escapeHtml(x.name)} <b>${Math.round(((bal[x.id] || 0) / total) * 100)}%</b></span>`).join('')}</div>` : ''}
            ${(() => {
        // Do the funds hold exactly the money in the accounts?
        const row = (label, v, cls = '') => `<div class="fund-check-row"><span>${label}</span><strong class="amount ${cls}">${escapeHtml(formatCurrency(v, cur))}</strong></div>`;
        if (!viewing) {
            const inAccounts = round2(netWorth());
            const inFunds = round2(secList().reduce((a, x) => a + (bal[x.id] || 0), 0));
            const diff = round2(inAccounts - inFunds);
            const ok = Math.abs(diff) < 0.005;
            const rest = secList().find((x) => x.mode === 'rest') || secList()[0];
            const bigFund = secList().slice().sort((p, q) => (bal[q.id] || 0) - (bal[p.id] || 0))[0];
            return `<div class="fund-check" data-state="${ok ? 'ok' : diff > 0 ? 'free' : 'over'}">
                ${row('All accounts', inAccounts)}${row('All funds', inFunds)}${row('Difference', diff, ok ? 'text-income' : diff < 0 ? 'text-expense' : '')}
                <div class="fund-reconcile" data-state="${ok ? 'ok' : diff > 0 ? 'free' : 'over'}">${ok
                ? `${icon('i-check', 'ic ic-sm')}<span>Your funds hold exactly the money in your accounts.</span>`
                : diff > 0 ? `${icon('i-info', 'ic ic-sm')}<span>${escapeHtml(formatCurrency(diff, cur))} of your money is not in any fund.</span>${rest ? `<button type="button" class="btn btn-secondary btn-xs" data-fund-fix="add" data-fund-id="${escapeHtml(rest.id)}" data-fund-amount="${diff}">Put it in ${escapeHtml(rest.name)}</button>` : ''}`
                    : `${icon('i-alert', 'ic ic-sm')}<span>Your funds hold ${escapeHtml(formatCurrency(-diff, cur))} more than your accounts have.</span>${bigFund ? `<button type="button" class="btn btn-secondary btn-xs" data-fund-fix="out" data-fund-id="${escapeHtml(bigFund.id)}" data-fund-amount="${Math.min(-diff, Math.max(0, bal[bigFund.id] || 0))}">Take it out of ${escapeHtml(bigFund.name)}</button>` : ''}`}</div></div>`;
        }
        const inAcc = toDisplay(accountBalance(viewing), viewing.currency);
        const held = accountFundsTotal(viewing.id, bal);
        const free = round2(inAcc - held);
        return `<div class="fund-check" data-state="${free < -0.004 ? 'over' : 'ok'}">
                ${row(`In ${escapeHtml(viewing.name)}`, inAcc)}${row('In its funds', held)}${row('Not in a fund', free, free < 0 ? 'text-expense' : '')}
                ${free < -0.004 ? `<p class="field-hint text-expense">Its funds hold ${escapeHtml(formatCurrency(-free, cur))} more than the account has. Take some out, or record the missing income.</p>` : '<p class="field-hint">Funds are part of this account\'s money set aside for a purpose, not extra money.</p>'}</div>`;
    })()}
            <div class="row-actions" style="margin-top:var(--sp-3)">
                <button type="button" class="btn btn-primary btn-sm" data-action="sec-add-money">${icon('i-plus', 'ic ic-sm')} Add</button>
                <button type="button" class="btn btn-secondary btn-sm" data-action="sec-take-out">${icon('i-arrow-up', 'ic ic-sm')} Take out</button>
                <button type="button" class="btn btn-secondary btn-sm" data-action="sec-move">${icon('i-swap', 'ic ic-sm')} Transfer</button>
            </div>
            ${pct > 100 ? '<p class="field-hint text-expense">Your percentages add up to more than 100%.</p>' : ''}
        </article>
        ${shown.length ? '' : `<section class="card"><p class="card-sub">No funds for ${escapeHtml(viewing ? viewing.name : 'this account')} yet. Add one, or switch account at the top.</p></section>`}
        ${shown.map((x) => {
        const b = bal[x.id] || 0;
        const m = mo[x.id];
        const tgt = x.target ? toDisplay(x.target, x.currency) : 0;
        const p = tgt ? Math.max(0, (b / tgt) * 100) : m.in > 0 ? (m.spent / m.in) * 100 : (m.spent > 0 ? 100 : 0);
        const accs = fundAccs(x).map((id) => state.accounts.find((a) => a.id === id)).filter(Boolean);
        const where = accs.length === 1 ? accs[0].name : accs.length > 1 ? `${accs.length} accounts` : '';
        const rule = x.mode === 'amount' ? `${formatCompact(toDisplay(x.value, x.currency), cur)} ${x.once ? 'once' : 'per income'}` : secPlanLabelBase(x);
        const hint = b < 0 ? `${icon('i-alert')} ${escapeHtml(formatCurrency(-b, cur))} short: paid from before money was put in.`
            : tgt ? (b >= tgt ? `${icon('i-check')} Target reached` : `${icon('i-target')} ${escapeHtml(formatCurrency(tgt - Math.max(0, b), cur))} to go`)
                : m.in || m.spent ? `${icon('i-calendar')} This month: ${escapeHtml(formatCompact(m.in, cur))} in · ${escapeHtml(formatCompact(m.spent, cur))} spent`
                    : `${icon('i-info')} Nothing in or out this month`;
        return `<article class="card row-card plan-half fund-card${b < 0 ? ' is-below' : ''}">
            <button type="button" class="sec-open" data-sec-view="${escapeHtml(x.id)}" aria-label="${escapeHtml(x.name)}: ${escapeHtml(formatCurrency(b, cur))}">
                <span class="row-top">${secBadge(x)}<span class="row-main"><span class="row-title">${escapeHtml(x.name)}</span><span class="row-sub">${escapeHtml([rule, where].filter(Boolean).join(' · '))}</span></span>${b < 0 ? '<span class="goal-pct is-short">Short</span>' : total > 0 ? `<span class="goal-pct">${Math.round((Math.max(0, b) / total) * 100)}%</span>` : ''}</span>
                <span class="goal-figures"><span class="amount ${b < 0 ? 'text-expense' : ''}" data-countup="${b}">${escapeHtml(formatCurrency(b, cur))}</span><span>${tgt ? `of ${escapeHtml(formatCurrency(tgt, cur))}` : m.in && m.spent ? `${Math.round(Math.min(999, p))}% spent` : ''}</span></span>
                ${meterHtml(Math.min(100, p), b < 0 ? 'over' : tgt && p >= 100 ? 'done' : !tgt ? budgetState(p) : null, `${x.name} progress`)}
                <span class="goal-hint">${hint}</span>
            </button>
            ${b < 0 ? `<button type="button" class="fund-fix-link" data-fund-repair="${escapeHtml(x.id)}">${icon('i-check', 'ic ic-sm')} Fix: pay those expenses from money not in a fund</button>` : ''}
            <div class="row-actions">
                <button type="button" class="btn btn-primary btn-sm" data-fund-add="${escapeHtml(x.id)}">${icon('i-plus', 'ic ic-sm')} Add money</button>
                <button type="button" class="btn btn-secondary btn-sm" data-fund-out="${escapeHtml(x.id)}">${icon('i-arrow-up', 'ic ic-sm')} Take out</button>
                <button type="button" class="btn btn-secondary btn-sm btn-icon-only" data-fund-more="${escapeHtml(x.id)}" aria-label="More for ${escapeHtml(x.name)}">${icon('i-more', 'ic ic-sm')}</button>
            </div>
        </article>`;
    }).join('')}
        ${shown.length ? '<p class="field-hint sec-hold-hint">Tap a fund to see its history and where its money is.</p>' : ''}
        ${secList().length ? `<button type="button" class="btn btn-secondary btn-block fund-reset-btn" data-action="fund-reset">${icon('i-refresh', 'ic ic-sm')} Reset funds</button>` : ''}
        ${fundIncomeChooserHtml()}
        ${loose.length ? `<button type="button" class="card sec-loose" data-action="sec-unassigned"><span class="sec-loose-icon">${icon('i-alert')}</span><span><strong>${plural(loose.length, 'unallocated expense')}</strong><span>${escapeHtml(formatCurrency(sumDisplay(loose), cur))} · tap to assign them to funds</span></span>${icon('i-chevron', 'ic chev')}</button>` : ''}`;
};
const renderSectionsHome = () => {
    const el = $('dash-sections');
    if (!el) return;
    const viewing = viewAccountObj();
    const mine = fundsFor(viewing ? viewing.id : null);
    if (!mine.length) { el.innerHTML = ''; return; }
    const bal = sectionBalances();
    const cur = dcur();
    const waiting = undividedIncomes().filter((t) => !viewing || t.accountId === viewing.id);
    el.innerHTML = `<section class="card sec-home">
        <div class="card-head"><h2 class="card-title">Funds</h2><button type="button" class="link-btn" data-goto-plan="sections">See all</button></div>
        ${waiting.length ? `<button type="button" class="btn btn-primary btn-block sec-home-divide" data-sec-divide="${escapeHtml(waiting[0].id)}">Allocate ${escapeHtml(waiting[0].desc)} · ${escapeHtml(formatCurrency(waiting[0].amount, waiting[0].currency))}</button>` : ''}
        ${mine.some((x) => (bal[x.id] || 0) > 0) ? secStackBar(mine.map((x) => [x, Math.max(0, bal[x.id] || 0)])) : `<p class="fund-home-empty">Nothing in your funds yet. <button type="button" class="link-btn" data-action="sec-add-money">Add money</button></p>`}
        ${!viewing ? (() => { const diff = round2(netWorth() - secList().reduce((a, x) => a + (bal[x.id] || 0), 0)); return Math.abs(diff) < 0.005 ? '' : `<p class="fund-home-diff ${diff < 0 ? 'text-expense' : ''}">${diff > 0 ? `${escapeHtml(formatCurrency(diff, cur))} not in any fund` : `Funds hold ${escapeHtml(formatCurrency(-diff, cur))} more than your accounts`}</p>`; })() : ''}
        ${mine.some((x) => (bal[x.id] || 0) < -0.004) ? `<div class="fund-short">${icon('i-alert', 'ic ic-sm')}<span><strong>${escapeHtml(formatCurrency(-mine.reduce((a, x) => a + Math.min(0, bal[x.id] || 0), 0), cur))} short</strong>: expenses were paid from funds before money was put in.</span><button type="button" class="btn btn-secondary btn-xs" data-fund-repair="all">Fix</button></div>` : ''}
        <div class="sec-chips">${mine.map((x) => `<button type="button" class="sec-chip${bal[x.id] < 0 ? ' is-below' : ''}" data-sec-view="${escapeHtml(x.id)}">${secBadge(x, ' is-mini')}<span><span>${escapeHtml(x.name)}</span><span class="amount ${bal[x.id] < 0 ? 'text-expense' : ''}">${escapeHtml(formatCompact(bal[x.id] || 0, cur))}</span></span></button>`).join('')}</div>
    </section>`;
    animateIn(el);
};
const renderSectionsInsights = (list) => {
    const el = $('section-breakdown-card');
    if (!el) return;
    el.hidden = !secList().length;
    if (el.hidden) return;
    const cur = dcur();
    const by = {};
    let none = 0;
    list.filter((t) => t.type === 'expense').forEach((t) => { const v = toDisplay(t.amount, t.currency); if (t.sectionId && secById(t.sectionId)) by[t.sectionId] = (by[t.sectionId] || 0) + v; else none += v; });
    const total = Object.values(by).reduce((s, v) => s + v, 0) + none;
    const rows = secList().map((x) => [x, by[x.id] || 0]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    $('section-breakdown').innerHTML = rows.map(([x, v]) => `<li>${secBadge(x, ' is-mini')}<span class="bd-name">${escapeHtml(x.name)}</span><span class="bd-pct">${total ? Math.round((v / total) * 100) : 0}%</span><span class="amount">${escapeHtml(formatCurrency(v, cur))}</span></li>`).join('')
        + (none > 0 ? `<li><span class="cat-badge is-mini" style="--cat:var(--text-3)">${icon('i-wallet')}</span><span class="bd-name">Unallocated</span><span class="bd-pct">${total ? Math.round((none / total) * 100) : 0}%</span><span class="amount">${escapeHtml(formatCurrency(none, cur))}</span></li>` : '')
        || '<li class="field-hint">No spending in this period.</li>';
};

/* ---- The entry form: which section an expense comes out of ---- */
let txSectionId = null;
let txSectionTouched = false;
let txCover = null; // null = not asked yet; a fund id, 'below' (let it go under zero) or 'none' (not from a fund)
const resetTxCover = () => { txCover = null; if ($('tx-fund-cover')) $('tx-fund-cover').hidden = true; };
// The chosen fund hasn't got enough: say how much is missing and offer the funds that can cover it.
const showTxCover = (fund, have, need, accountId) => {
    const cur = dcur();
    const bal = sectionBalances();
    const others = fundsFor(accountId).filter((x) => x.id !== fund.id && (bal[x.id] || 0) > 0.004).sort((a, b) => (bal[b.id] || 0) - (bal[a.id] || 0));
    $('tx-fund-cover').innerHTML = `<p class="cover-msg">${icon('i-alert', 'ic ic-sm')}<span><strong>${escapeHtml(fund.name)}</strong> has ${escapeHtml(formatCurrency(Math.max(0, have), cur))}. This needs <strong>${escapeHtml(formatCurrency(need, cur))}</strong> more. Take it from:</span></p>
        <div class="cover-list">${others.map((x) => { const b = bal[x.id] || 0; const ok = b + 0.004 >= need; return `<button type="button" class="cover-opt" data-tx-cover="${escapeHtml(x.id)}" ${ok ? '' : 'disabled'}>${secBadge(x, ' is-mini')}<span><span>${escapeHtml(x.name)}</span><span>${escapeHtml(formatCurrency(b, cur))}${ok ? '' : ' · not enough'}</span></span>${icon('i-chevron', 'ic ic-sm')}</button>`; }).join('')}
        <button type="button" class="cover-opt" data-tx-cover="none"><span class="row-icon tint">${icon('i-wallet')}</span><span><span>Not from a fund</span><span>Pay it from money that isn't in any fund</span></span>${icon('i-chevron', 'ic ic-sm')}</button>
        <button type="button" class="cover-opt" data-tx-cover="below"><span class="row-icon tint">${icon('i-alert')}</span><span><span>Let ${escapeHtml(fund.name)} go below zero</span><span>The next income fills it first</span></span>${icon('i-chevron', 'ic ic-sm')}</button></div>`;
    $('tx-fund-cover').hidden = false;
    $('tx-fund-cover').scrollIntoView({ block: 'center', behavior: 'smooth' });
    haptic('HEAVY');
};
const renderTxSections = () => {
    const field = $('tx-section-field');
    const accId = $('tx-account').value || (state.accounts[0] && state.accounts[0].id);
    const list = fundsFor(accId);
    const show = txType === 'expense' && list.length > 0;
    field.hidden = !show;
    if (!show) return;
    if (txSectionId && !list.some((x) => x.id === txSectionId)) txSectionId = null;
    const bal = sectionBalances();
    const cur = dcur();
    $('tx-section-picker').innerHTML = list.map((x) => `<button type="button" class="sec-pick" data-tx-section="${escapeHtml(x.id)}" aria-pressed="${txSectionId === x.id}">${secBadge(x, ' is-mini')}<span><span>${escapeHtml(x.name)}</span><span class="${bal[x.id] < 0 ? 'text-expense' : ''}">${escapeHtml(formatCompact(bal[x.id] || 0, cur))}</span></span></button>`).join('')
        + `<button type="button" class="sec-pick is-none" data-tx-section="" aria-pressed="${!txSectionId}"><span><span>Unallocated</span></span></button>`;
};
const pickTxSection = (id) => { txSectionId = id || null; txSectionTouched = true; resetTxCover(); renderTxSections(); haptic(); };
const syncTxSectionToCategory = () => {
    if (txSectionTouched || $('tx-id').value) return;
    const cat = (document.querySelector('input[name="tx-category"]:checked') || {}).value;
    const s = sectionForCategory(cat);
    if (s) { txSectionId = s; renderTxSections(); }
};

/* =========================================================================
   24. Categories
   ========================================================================= */
let catEditType = 'expense';
let catEditColor = 'pink';
let catEditIcon = 'c-Other';
let catReturnToTx = false;
let catReturnToManager = false;

// After editing from the category list, show the list again instead of closing everything.
const backToCategoryManager = () => {
    catReturnToManager = false;
    hideSheet('modal-category');
    history.replaceState({ vela: 'sheet', id: 'modal-categories', tab: currentTab }, '');
    renderCategoryManager();
    showSheetElement('modal-categories');
};

let catManTab = 'expense';
// How many entries, fixed payments and budgets use a category (shown in the list and before deleting).
const categoryUse = (id) => ({
    entries: state.transactions.filter((t) => t.category === id).length,
    bills: state.recurring.filter((b) => b.category === id).length,
    budget: !!state.config.categoryBudgets[id]
});
const renderCategoryManager = () => {
    setPressed('[data-catman-tab]', (b) => b.dataset.catmanTab === catManTab);
    const counts = {};
    state.transactions.forEach((t) => { counts[t.category] = (counts[t.category] || 0) + 1; });
    $('categories-body').innerHTML = `<ul class="cat-manage cat-manage-list">${catsOfType(catManTab).map((c) => `
        <li class="cat-row" data-cat-row="${escapeHtml(c.id)}">
            ${catBadge(c.id, catManTab)}
            <span class="row-label"><span>${escapeHtml(c.name)}</span><span>${c.builtIn ? 'Built in' : 'Added by you'} · ${counts[c.id] ? plural(counts[c.id], 'entry', 'entries') : 'not used yet'}</span></span>
            <button type="button" class="icon-btn cat-row-btn" data-edit-category="${escapeHtml(c.id)}" aria-label="Edit ${escapeHtml(c.name)}">${icon('i-edit')}</button>
            ${c.builtIn
        ? `<span class="icon-btn cat-row-btn is-locked" title="Built in: it can be renamed but not deleted" aria-label="${escapeHtml(c.name)} is built in and can't be deleted">${icon('i-lock')}</span>`
        : `<button type="button" class="icon-btn cat-row-btn is-danger" data-delete-category="${escapeHtml(c.id)}" aria-label="Delete ${escapeHtml(c.name)}">${icon('i-trash')}</button>`}
        </li>`).join('')}</ul>`;
    $('btn-add-category').lastChild.textContent = catManTab === 'income' ? ' New income category' : ' New expense category';
};

const openCategoryManager = () => {
    renderCategoryManager();
    openOrSwap('modal-categories');
};

const renderCategoryEditor = () => {
    setPressed('[data-cat-type]', (b) => b.dataset.catType === catEditType);
    $('category-colors').innerHTML = PALETTE.map((p) => `<button type="button" class="swatch" data-cat-color="${p}" style="--cat:var(--pal-${p})" aria-label="${p}" aria-pressed="${p === catEditColor}"></button>`).join('');
    $('category-icons').innerHTML = ICON_CHOICES.map((i) => `<button type="button" class="icon-choice" data-cat-icon="${i}" style="--cat:var(--pal-${catEditColor})" aria-label="${i.replace(/^[cx]-/, '')}" aria-pressed="${i === catEditIcon}">${icon(i)}</button>`).join('');
};

const openCategoryEditor = (id, presetType) => {
    const c = id ? state.categories.find((x) => x.id === id) : null;
    $('category-form').reset();
    $('category-id').value = c ? c.id : '';
    $('category-title').textContent = c ? `Edit ${c.name}` : 'New category';
    $('category-name').value = c ? c.name : '';
    catEditType = c ? c.type : (presetType || catManTab || 'expense');
    catEditColor = c ? c.color : PALETTE[state.categories.length % PALETTE.length];
    catEditIcon = c ? c.icon : (catEditType === 'income' ? 'c-OtherIncome' : 'c-Other');
    $('category-type-group').hidden = !!c;
    $('btn-delete-category').hidden = !c || c.builtIn;
    renderCategoryEditor();
    openOrSwap('modal-category');
};

const submitCategory = () => {
    const id = $('category-id').value;
    const name = $('category-name').value.trim();
    if (!name) return fieldError($('category-name'), 'Give the category a name.');
    const clash = state.categories.find((c) => c.name.toLowerCase() === name.toLowerCase() && c.type === catEditType && c.id !== id);
    if (clash) return fieldError($('category-name'), `You already have a "${clash.name}" category.`);
    let record;
    if (id) {
        record = state.categories.find((c) => c.id === id);
        if (!record) return false;
        record.name = name;
        record.color = catEditColor;
        record.icon = catEditIcon;
    } else {
        record = { id: generateId(), name, type: catEditType, color: catEditColor, icon: catEditIcon, builtIn: false };
        state.categories.push(record);
    }
    if (!commitState('The category')) return false;
    queueSync('category', record.id, 'upsert');
    showToast(id ? 'Category updated' : `Category "${name}" added`, 'success');
    if (catReturnToTx) {
        catReturnToTx = false;
        if (!id) state.config.lastCategory[catEditType] = record.id;
        hideSheet('modal-category');
        history.replaceState({ vela: 'sheet', id: 'modal-tx', tab: currentTab }, '');
        showSheetElement('modal-tx');
        const keep = document.querySelector('input[name="tx-category"]:checked');
        buildCategoryPicker(txType, id ? (keep && keep.value) : record.id);
        if (catEditing) setCatEditing(true);
    } else if (catReturnToManager) {
        backToCategoryManager();
    } else {
        closeSheet('modal-category');
    }
    renderActive();
    return true;
};

let catDeleting = null;
// Deleting a category: unused ones go after a confirm. Used ones ask where their entries, fixed payments and
// budget should move first; nothing in your history is deleted, only re-labelled. Built-in ones can't be deleted.
const deleteCategory = (id, onDeleted) => {
    const c = state.categories.find((x) => x.id === id);
    if (!c) return;
    if (c.builtIn) { showToast(`"${c.name}" is built in. You can rename it or change its look, but not delete it.`, 'info'); return; }
    const use = categoryUse(id);
    catDeleting = { id, onDeleted };
    const others = catsOfType(c.type).filter((x) => x.id !== id);
    const fallback = FALLBACK_CATEGORY[c.type];
    $('cat-del-title').textContent = `Delete "${c.name}"?`;
    const parts = [use.entries ? plural(use.entries, 'entry', 'entries') : '', use.bills ? plural(use.bills, 'fixed payment', 'fixed payments') : '', use.budget ? 'its budget' : ''].filter(Boolean);
    const used = parts.length > 0;
    $('cat-del-msg').textContent = used
        ? (() => {
            const one = use.entries + use.bills + (use.budget ? 1 : 0) === 1;
            return `${parts.join(', ').replace(/, ([^,]*)$/, ' and $1')} ${one ? 'uses' : 'use'} this category. Choose where ${one ? 'it goes' : 'they go'}. Nothing in your history is deleted.`;
        })()
        : 'No entries use this category. It will be removed.';
    $('cat-del-move-field').hidden = !used;
    $('cat-del-move').innerHTML = others.map((x) => `<option value="${escapeHtml(x.id)}" ${x.id === fallback ? 'selected' : ''}>${escapeHtml(x.name)}</option>`).join('');
    openOrSwap('modal-cat-delete');
};
const confirmDeleteCategory = () => {
    const job = catDeleting;
    if (!job) return;
    const c = state.categories.find((x) => x.id === job.id);
    if (!c) { closeSheet('modal-cat-delete'); return; }
    const to = $('cat-del-move').value || FALLBACK_CATEGORY[c.type];
    const target = catById(to, c.type);
    const moved = [];
    state.transactions.forEach((t) => { if (t.category === c.id) { t.category = target.id; moved.push(['transaction', t.id]); } });
    state.recurring.forEach((b) => { if (b.category === c.id) { b.category = target.id; moved.push(['recurring', b.id]); } });
    const budgets = state.config.categoryBudgets;
    if (budgets[c.id]) {
        // Its budget joins the category the entries moved to.
        budgets[target.id] = (budgets[target.id] || 0) + budgets[c.id];
        delete budgets[c.id];
        state.syncSettings = true;
    }
    Object.keys(state.config.lastCategory).forEach((k) => { if (state.config.lastCategory[k] === c.id) state.config.lastCategory[k] = target.id; });
    state.categories = state.categories.filter((x) => x.id !== c.id);
    if (!commitState('Deleting the category')) { closeSheet('modal-cat-delete'); return; }
    moved.forEach(([kind, rid]) => queueSync(kind, rid, 'upsert', false));
    queueSync('category', c.id, 'delete');
    catDeleting = null;
    haptic('MEDIUM');
    closeSheet('modal-cat-delete');
    if (openSheets.includes('modal-category')) closeSheet('modal-category');
    showToast(moved.length ? `"${c.name}" deleted. ${plural(moved.length, 'item')} moved to ${target.name}.` : `"${c.name}" deleted`, 'success');
    if (job.onDeleted) job.onDeleted(target.id);
    if (openSheets.includes('modal-categories')) renderCategoryManager();
    renderActive();
};

// ---- Hold a category in the entry form: your own categories wiggle and can be deleted (like iPhone apps) ----
let catEditing = false;
let catHold = null;
let catHeld = false;
const setCatEditing = (on) => {
    catEditing = !!on;
    const picker = $('tx-category-picker');
    picker.classList.toggle('is-editing', catEditing);
    $('cat-edit-done').hidden = !catEditing;

};
const initCategoryHold = () => {
    const picker = $('tx-category-picker');
    const cancel = () => { if (catHold) { clearTimeout(catHold.timer); catHold = null; } };
    picker.addEventListener('pointerdown', (e) => {
        catHeld = false;
        const cell = e.target.closest('.cat-cell.is-custom');
        if (!cell || e.target.closest('.cat-del')) return;
        catHold = { x: e.clientX, y: e.clientY, timer: setTimeout(() => {
            catHold = null;
            catHeld = true;
            haptic('MEDIUM');
            cell.classList.add('is-held');
            setTimeout(() => cell.classList.remove('is-held'), 260);
            setCatEditing(true);
        }, 480) };
    });
    picker.addEventListener('pointermove', (e) => { if (catHold && Math.hypot(e.clientX - catHold.x, e.clientY - catHold.y) > 8) cancel(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => picker.addEventListener(ev, cancel));
    // The lift that ends a hold may or may not become a tap: either way the next real tap works.
    ['pointerup', 'pointercancel'].forEach((ev) => picker.addEventListener(ev, () => { if (catHeld) setTimeout(() => { catHeld = false; }, 60); }));
    picker.addEventListener('contextmenu', (e) => { if (e.target.closest('.cat-cell')) e.preventDefault(); });
    // The tap that ends a hold doesn't also pick the category; while editing, a tap edits instead of picking.
    picker.addEventListener('click', (e) => {
        if (catHeld && !e.target.closest('.cat-del')) { catHeld = false; e.preventDefault(); e.stopPropagation(); return; }
        catHeld = false;
        if (!catEditing) return;
        const del = e.target.closest('.cat-del');
        const cell = e.target.closest('.cat-cell');
        if (del) {
            e.preventDefault(); e.stopPropagation();
            const id = del.dataset.catDel;
            deleteCategory(id, (movedTo) => {
                const gone = picker.querySelector(`[data-cat-cell="${CSS.escape(id)}"]`);
                const rebuild = () => {
                    const keep = document.querySelector('input[name="tx-category"]:checked');
                    buildCategoryPicker(txType, keep && keep.value !== id ? keep.value : movedTo);
                    setCatEditing(catsOfType(txType).some((x) => !x.builtIn));
                };
                if (gone) { gone.classList.add('is-removing'); setTimeout(rebuild, 280); } else rebuild();
            });
            return;
        }
        if (cell && cell.classList.contains('is-custom')) {
            e.preventDefault(); e.stopPropagation();
            catReturnToTx = true; catReturnToManager = false;
            openCategoryEditor(cell.dataset.catCell);
        } else if (cell) {
            e.preventDefault(); e.stopPropagation();
            showToast('Built-in categories stay. Hold one of your own to edit or delete it.', 'info');
        }
    }, true);
    // Tapping outside the categories ends editing.
    document.addEventListener('pointerdown', (e) => { if (catEditing && !e.target.closest('#tx-category-picker, #cat-edit-done, .sheet-overlay:not(#modal-tx)')) setCatEditing(false); });
};

/* =========================================================================
   25. Cloud sync (Supabase): one table of records + one settings row
   ========================================================================= */
const KIND_STORE = { transaction: 'transactions', goal: 'savings', recurring: 'recurring', debt: 'debts', category: 'categories' };
const canSync = () => !!(supabaseClient && !state.auth.isMock && state.auth.user && state.auth.user.id);
// Settings can only be sent once this phone has loaded the account's settings; until then they wait.
const settingsReady = () => !!(state.auth.user && state.settingsUser === state.auth.user.id);
const pendingCount = () => Object.keys(state.sync).length + (state.syncSettings && settingsReady() ? 1 : 0);
const findRecord = (kind, id) => (state[KIND_STORE[kind]] || []).find((r) => r.id === id);
// Records are keyed per user, so ids that repeat across users (built-in categories) need a user prefix.
const rowId = (kind, id) => (kind === 'category' ? `${state.auth.user.id}:${id}` : id);

let flushPromise = null;
let flushAgain = false;
let lastSyncError = null;   // why the last upload failed, shown in Settings
let syncErrorToastShown = false;
let lastSyncedAt = null;

const syncErrorText = (err) => {
    const msg = String((err && (err.message || err.error_description || err.code)) || err || '');
    if (/jwt|token|session|auth|401/i.test(msg)) return 'Your sign-in expired. Sign out and sign in again.';
    if (/row-level security|42501|permission/i.test(msg)) return 'The cloud database refused the save (security rules). Run the setup SQL again.';
    if (/relation|does not exist|42P01|PGRST205/i.test(msg)) return "The cloud tables aren't set up. Run the setup SQL in Supabase.";
    if (/fetch|network|Failed to|timeout/i.test(msg)) return 'No connection to the cloud. It will retry automatically.';
    return msg.slice(0, 140) || 'Unknown error';
};

const flushSync = () => {
    if (!canSync() || (typeof navigator.onLine === 'boolean' && !navigator.onLine)) return Promise.resolve(pendingCount() === 0);
    if (flushPromise) { flushAgain = true; return flushPromise; }
    let release;
    const timeout = new Promise((r) => { release = setTimeout(() => r('timeout'), 30000); });
    const work = (async () => {
        try {
            const entries = Object.entries(state.sync);
            const upserts = entries.filter(([, v]) => v.op === 'upsert');
            const deletes = entries.filter(([, v]) => v.op === 'delete');
            const now = new Date().toISOString();
            if (upserts.length) {
                const rows = upserts.map(([id, v]) => {
                    const rec = findRecord(v.kind, id);
                    return rec ? { id: rowId(v.kind, id), user_id: state.auth.user.id, kind: v.kind, data: rec, updated_at: now } : null;
                }).filter(Boolean);
                for (let i = 0; i < rows.length; i += 200) {
                    const { error } = await supabaseClient.from('vela_records').upsert(rows.slice(i, i + 200));
                    if (error) throw error;
                }
                upserts.forEach(([id, v]) => { if (state.sync[id] === v) delete state.sync[id]; });
            }
            if (deletes.length) {
                const { error } = await supabaseClient.from('vela_records').delete().in('id', deletes.map(([id, v]) => rowId(v.kind, id)));
                if (error) throw error;
                deletes.forEach(([id, v]) => { if (state.sync[id] === v) delete state.sync[id]; });
            }
            if (state.syncSettings && settingsReady()) {
                const payload = settingsPayload();
                const { error } = await supabaseClient.from('vela_settings').upsert({
                    user_id: state.auth.user.id,
                    data: payload,
                    updated_at: now
                });
                if (error) throw error;
                state.settingsSig = JSON.stringify(payload);
                state.settingsUser = state.auth.user.id;
                state.syncSettings = settingsSigNow() !== state.settingsSig; // changed again while sending
            }
            lastSyncError = null;
            lastSyncedAt = Date.now();
            saveState();
            return true;
        } catch (err) {
            console.warn('Cloud sync failed; changes are kept on this device and will retry.', err);
            lastSyncError = syncErrorText(err);
            if (!syncErrorToastShown && !/No connection/.test(lastSyncError)) {
                syncErrorToastShown = true;
                showToast(`Not saved to your account yet: ${lastSyncError}`, 'warning');
            }
            saveState();
            return false;
        }
    })();
    // A save that never answers must not block every later save.
    const run = Promise.race([work, timeout]).then((r) => {
        clearTimeout(release);
        if (flushPromise === run) flushPromise = null;
        if (r === 'timeout') lastSyncError = 'No connection to the cloud. It will retry automatically.';
        if (flushAgain) { flushAgain = false; setTimeout(flushSync, 0); }
        if (currentTab === 'settings') updateUserProfileUI();
        return r === 'timeout' ? false : r;
    });
    flushPromise = run;
    return run;
};

const queueSync = (kind, id, op, flush = true) => {
    if (!canSync()) return;
    state.sync[id] = { kind, op };
    saveState();
    if (flush) flushSync();
};

const queueAllForUpload = () => {
    state.transactions.forEach((r) => { state.sync[r.id] = { kind: 'transaction', op: 'upsert' }; });
    state.savings.forEach((r) => { state.sync[r.id] = { kind: 'goal', op: 'upsert' }; });
    state.recurring.forEach((r) => { state.sync[r.id] = { kind: 'recurring', op: 'upsert' }; });
    state.debts.forEach((r) => { state.sync[r.id] = { kind: 'debt', op: 'upsert' }; });
    state.categories.forEach((r) => {
        const base = DEFAULT_CATEGORIES.find((d) => d.id === r.id);
        if (!base || base.name !== r.name || base.color !== r.color || base.icon !== r.icon) state.sync[r.id] = { kind: 'category', op: 'upsert' };
    });
    state.syncSettings = true;
    saveState();
};

const pullFromCloud = async () => {
    if (!canSync()) return false;
    const flushed = await flushSync();
    if (!flushed || Object.keys(state.sync).length > 0) return false;
    try {
        const [rec, set] = await Promise.all([
            supabaseClient.from('vela_records').select('kind,data'),
            supabaseClient.from('vela_settings').select('data').maybeSingle()
        ]);
        if (rec.error) throw rec.error;
        const by = { transaction: [], goal: [], recurring: [], debt: [], category: [] };
        (rec.data || []).forEach((r) => { if (by[r.kind] && r.data) by[r.kind].push(r.data); });
        // Anything added, edited or deleted on this phone while the download ran wins over the older cloud copy.
        const keepLocal = (kind, remote, local) => {
            const pending = Object.entries(state.sync).filter(([, v]) => v.kind === kind);
            if (!pending.length) return remote;
            const out = remote.filter((r) => !state.sync[r.id]);
            pending.forEach(([pid, v]) => { const mine = v.op !== 'delete' && local.find((r) => r.id === pid); if (mine) out.push(mine); });
            return out;
        };
        state.transactions = keepLocal('transaction', by.transaction.map((t) => normalizeTx(t)).filter(Boolean), state.transactions);
        state.savings = keepLocal('goal', by.goal.map(normalizeGoal).filter(Boolean), state.savings);
        state.recurring = keepLocal('recurring', by.recurring.map(normalizeBill).filter(Boolean), state.recurring);
        state.debts = keepLocal('debt', by.debt.map(normalizeDebt).filter(Boolean), state.debts);
        state.categories = keepLocal('category', mergeCategories(by.category), state.categories);
        // Tidy bank-SMS entries in the account too (shop names, lost bank details); the changes sync back.
        tidyBankEntryNames();
        repairAccountKinds();
        // Settings changed on this phone during the download stay as they are (and upload next).
        const changedHere = settingsReady() && state.settingsSig !== null && state.settingsSig !== settingsSigNow();
        const hadSettings = !set.error && set.data && set.data.data && !changedHere;
        if (hadSettings) applyCloudSettings(set.data.data);
        recoverAccounts();
        ensureAccounts(state);
        state.settingsUser = state.auth.user.id;
        if (hadSettings) {
            // In step with the account; only real changes from here on are sent.
            state.settingsSig = settingsSigNow();
            state.syncSettings = false;
        } else if (!set.error) {
            state.syncSettings = true; // the account has no settings yet, or this phone changed them: save this phone's
        }
        migrateBudgets();
        fixAccountCurrencies();
        applyTheme(state.config.theme);
        saveState();
        if (state.syncSettings) flushSync();
        return true;
    } catch (err) {
        console.error('Could not load your data from the cloud:', err);
        showToast("Couldn't load your synced data. Showing what's on this device.", 'warning');
        return false;
    }
};

// Entries that point to an account missing from the account list (for example after the list was
// overwritten) get that account back, instead of being moved into Cash.
const recoverAccounts = () => {
    const known = new Set(state.accounts.map((a) => a.id));
    const missing = new Map();
    const note = (id, cur) => {
        if (!id || known.has(id)) return;
        const m = missing.get(id) || {};
        m[cur] = (m[cur] || 0) + 1;
        missing.set(id, m);
    };
    state.transactions.forEach((t) => { note(t.accountId, t.currency); if (t.type === 'transfer') note(t.toAccountId, t.toCurrency || t.currency); });
    state.recurring.forEach((b) => note(b.accountId, b.currency));
    let n = 0;
    missing.forEach((curs, id) => {
        const currency = Object.entries(curs).sort((a, b) => b[1] - a[1])[0][0];
        n += 1;
        state.accounts.push(normalizeAccount({ id, name: id === 'acc-cash' ? 'Cash' : `Account ${n}`, kind: id === 'acc-cash' ? 'cash' : 'bank', currency, opening: 0 }));
    });
};

const syncNow = async (btn) => {
    if (!canSync()) { showAuth(1); return; }
    const run = async () => {
        // This phone hasn't loaded the account's settings yet: load them first so nothing here overwrites them.
        if (!settingsReady()) await pullFromCloud();
        queueAllForUpload();
        const ok = await flushSync();
        if (ok) await pullFromCloud();
        updateCurrencyButtons();
        updateUserProfileUI();
        renderActive();
        if (ok) showToast(`Everything is saved to ${state.auth.user.email || 'your account'}`, 'success');
        else showToast(`Couldn't sync: ${lastSyncError || 'try again'}`, 'error');
    };
    if (btn && typeof withBusy === 'function') await withBusy(btn, run);
    else await run();
};

const remoteSettingsExist = async () => {
    try {
        const { data, error } = await supabaseClient.from('vela_settings').select('user_id').maybeSingle();
        return !error && !!data;
    } catch (err) {
        return true; // unsure: don't risk overwriting
    }
};

const remoteHasData = async () => {
    try {
        const { data } = await supabaseClient.from('vela_records').select('id').limit(1);
        return !!(data && data.length);
    } catch (err) {
        return false;
    }
};

/* =========================================================================
   26. Profile
   ========================================================================= */
const initialsFor = (name) => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'V';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
};
const displayName = () => (state.auth.user && state.auth.user.full_name) || 'Guest';

const updateUserProfileUI = () => {
    const user = state.auth.user;
    const cloud = !state.auth.isMock && !!user;
    document.querySelectorAll('[data-avatar]').forEach((el) => {
        el.textContent = initialsFor(user && user.full_name);
        if (user && user.avatar_url) {
            const img = document.createElement('img');
            img.alt = '';
            img.referrerPolicy = 'no-referrer';
            img.src = user.avatar_url;
            img.onerror = () => img.remove();
            el.appendChild(img);
        }
    });
    document.querySelectorAll('[data-user-name]').forEach((el) => { el.textContent = displayName(); });
    document.querySelectorAll('[data-user-kind]').forEach((el) => { el.textContent = cloud ? 'Synced account' : 'On this device'; });
    const email = $('profile-email');
    if (email) email.textContent = cloud ? (user.email || '') : 'Data is stored on this device only';
    const badge = $('profile-badge');
    if (badge) {
        badge.dataset.kind = cloud ? 'cloud' : 'local';
        const pending = pendingCount();
        $('profile-badge-text').textContent = cloud ? (lastSyncError ? 'Not synced' : pending ? `${pending} waiting to sync` : 'Synced') : 'Guest';
        badge.dataset.error = String(!!(cloud && lastSyncError));
    }
    const syncRow = $('sync-row');
    if (syncRow) {
        syncRow.hidden = !cloud;
    }
    if (syncRow && cloud) {
        const pending = pendingCount();
        $('sync-detail').textContent = lastSyncError ? lastSyncError
            : pending ? `${plural(pending, 'change')} waiting to upload`
            : lastSyncedAt ? `All saved to ${user.email || 'your account'} · ${new Date(lastSyncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
            : `Saved to ${user.email || 'your account'}`;
        $('sync-detail').dataset.error = String(!!lastSyncError);
    }
    const nameInput = $('profile-username');
    if (nameInput && document.activeElement !== nameInput) nameInput.value = user && user.full_name ? user.full_name : '';
    const logout = $('btn-auth-logout');
    if (logout) {
        logout.className = cloud ? 'btn btn-danger btn-block' : 'btn btn-primary btn-block';
        logout.innerHTML = cloud ? `${icon('i-logout')} <span>Sign out</span>` : `${icon('i-cloud')} <span>Sign in to sync</span>`;
    }
    if ($('btn-delete-my-account')) $('btn-delete-my-account').hidden = !cloud;
};

const resizeImage = (file, size = 256) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        canvas.getContext('2d').drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => (blob ? resolve({ blob, dataUrl: canvas.toDataURL('image/jpeg', 0.85) }) : reject(new Error('Could not process image'))), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Unsupported image')); };
    img.src = url;
});

const handleAvatarUpload = async (file) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) { showToast('Choose an image file (JPG, PNG or similar).', 'error'); return; }
    if (file.size > 15 * 1024 * 1024) { showToast('That image is over 15 MB. Choose a smaller one.', 'error'); return; }
    let resized;
    try { resized = await resizeImage(file); } catch (err) { showToast("That image couldn't be read. Try a JPG or PNG.", 'error'); return; }
    if (canSync()) {
        try {
            const path = `${state.auth.user.id}/${Date.now()}.jpg`;
            const { error } = await supabaseClient.storage.from('avatars').upload(path, resized.blob, { cacheControl: '3600', upsert: true, contentType: 'image/jpeg' });
            if (error) throw error;
            const { data } = supabaseClient.storage.from('avatars').getPublicUrl(path);
            const { error: pErr } = await supabaseClient.from('profiles').upsert({ id: state.auth.user.id, avatar_url: data.publicUrl, updated_at: new Date().toISOString() });
            if (pErr) throw pErr;
            state.auth.user.avatar_url = data.publicUrl;
            saveState();
            updateUserProfileUI();
            showToast('Profile photo updated', 'success');
        } catch (err) {
            console.error('Avatar upload failed:', err);
            showToast("Couldn't upload the photo. Check your connection and try again.", 'error');
        }
        return;
    }
    if (!state.auth.user) state.auth.user = { id: 'local', email: null, full_name: null, avatar_url: null };
    state.auth.user.avatar_url = resized.dataUrl;
    saveState();
    updateUserProfileUI();
    showToast('Profile photo updated', 'success');
};

const saveProfileChanges = async () => {
    const name = $('profile-username').value.trim();
    if (!name) { fieldError($('profile-username'), 'Enter a display name.'); return; }
    if (!state.auth.user) state.auth.user = { id: 'local', email: null, full_name: null, avatar_url: null };
    state.auth.user.full_name = name;
    saveState();
    updateUserProfileUI();
    if (canSync()) {
        try {
            const { error } = await supabaseClient.from('profiles').upsert({ id: state.auth.user.id, full_name: name, username: name, updated_at: new Date().toISOString() });
            if (error) throw error;
            showToast('Name saved', 'success');
        } catch (err) {
            showToast("Name saved on this device, but it couldn't sync. It will update next time.", 'warning');
        }
    } else {
        showToast('Name saved', 'success');
    }
};

/* =========================================================================
   27. Authentication & onboarding
   ========================================================================= */
const goToStep = (step) => {
    document.querySelectorAll('.auth-step').forEach((s) => s.classList.toggle('active', s.id === `auth-step-${step}`));
    const dots = $('auth-step-indicators');
    dots.hidden = step === 1;
    dots.querySelectorAll('span').forEach((d) => d.classList.toggle('active', Number(d.dataset.step) === step));
    $('auth-overlay-container').scrollTop = 0;
};

const showAuth = (step = 1) => {
    document.documentElement.classList.remove('needs-auth');
    $('auth-overlay-container').classList.add('active');
    $('btn-skip-auth').textContent = state.auth.completedOnboarding ? 'Not now' : 'Continue without an account';
    goToStep(step);
};

const hideAuth = () => {
    document.documentElement.classList.remove('needs-auth');
    $('auth-overlay-container').classList.remove('active');
};

const friendlyAuthError = (error) => {
    const msg = (error && error.message) || '';
    if (/invalid login credentials/i.test(msg)) return "That email and password don't match. Check them and try again.";
    if (/email not confirmed/i.test(msg)) return 'Confirm your email first. Check your inbox for the link we sent.';
    if (/already registered|already exists/i.test(msg)) return 'An account with this email already exists. Sign in instead.';
    if (/password/i.test(msg) && /6/.test(msg)) return 'Use a password with at least 6 characters.';
    if (/fetch|network|load failed/i.test(msg)) return "Can't reach the server. Check your connection and try again.";
    if (/rate limit|too many/i.test(msg)) return 'Too many emails or attempts. Wait a few minutes and try again.';
    if (/error sending|smtp|email address not authorized/i.test(msg)) return "Supabase couldn't send the email. In the Supabase dashboard, set up an email provider or turn off email confirmation.";
    if (/provider is not enabled|unsupported provider/i.test(msg)) return 'Google sign-in is not switched on for this app yet.';
    return msg || 'Something went wrong. Try again.';
};

const requireCloud = () => {
    if (supabaseClient) return true;
    showToast('Sign-in needs an internet connection. You can keep using Vela on this device.', 'warning');
    return false;
};

const authServerReachable = async () => {
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: SUPABASE_ANON_KEY }, signal: ctrl.signal, cache: 'no-store' });
        clearTimeout(timer);
        return res.status < 500;
    } catch (err) {
        return false;
    }
};

// Approve new sign-ins on a phone you already use (like GitHub Mobile). Server side: supabase/device-approval.sql.
// Each phone keeps its own random key; only an approved phone can approve another one.
const DEVICE_KEY = 'VELA_DEVICE';
const randomHex = (bytes) => { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return [...a].map((b) => b.toString(16).padStart(2, '0')).join(''); };
const deviceKey = (fresh = false) => {
    let k = null;
    try { k = JSON.parse(localStorage.getItem(DEVICE_KEY) || 'null'); } catch (e) { k = null; }
    if (fresh || !k || !k.id || !k.secret) {
        k = { id: `dev-${randomHex(12)}`, secret: randomHex(32) };
        try { localStorage.setItem(DEVICE_KEY, JSON.stringify(k)); } catch (e) { /* storage blocked */ }
    }
    return k;
};
const deviceName = () => {
    const ua = navigator.userAgent || '';
    const android = ua.match(/Android [\d.]+; ([^;)]+)/);
    if (android) { const model = android[1].replace(/\s*Build\/.*$/, '').trim(); return model && model !== 'K' ? model : 'Android phone'; }
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Windows/.test(ua)) return 'Windows computer';
    if (/Macintosh/.test(ua)) return 'Mac';
    return 'Browser';
};
const deviceRpc = async (fn, args) => {
    const { data, error } = await supabaseClient.rpc(fn, args);
    if (error) throw error;
    return data;
};
const deviceCheck = async () => {
    let k = deviceKey();
    let r = await deviceRpc('vela_device_check', { p_device: k.id, p_secret: k.secret, p_name: deviceName() });
    if (r === 'mismatch') { k = deviceKey(true); r = await deviceRpc('vela_device_check', { p_device: k.id, p_secret: k.secret, p_name: deviceName() }); }
    return r;
};
let approvalGate = null;
let lastDeviceCheck = 0;
// Signing in on a phone that isn't approved yet: wait here until a phone you already use says yes.
const passDeviceApproval = async () => {
    if (!supabaseClient || typeof supabaseClient.rpc !== 'function') return true;
    let status;
    // Not set up on the server yet, or offline: there is nothing to check against, so carry on.
    try { status = await deviceCheck(); } catch (e) { return true; }
    lastDeviceCheck = Date.now();
    return status === 'pending' ? waitForApproval() : true;
};
const showApproveWait = () => {
    const g = approvalGate;
    $('approve-number').textContent = g.number;
    $('approve-wait-note').textContent = 'Open Vela on a phone you already use and tap this number.';
    $('approve-wait').hidden = false;
    document.body.classList.add('approve-waiting');
    $('btn-approve-code').hidden = true;
    mfaFactor().then((f) => { if (approvalGate === g) $('btn-approve-code').hidden = !f; });
    // Which phones can approve this one (the phones already approved on this account).
    $('approve-phones').innerHTML = '';
    Promise.resolve(supabaseClient.from('vela_devices').select('device_id, name, approved, last_seen').order('last_seen', { ascending: false }))
        .then(({ data }) => {
            if (approvalGate !== g) return;
            const me = deviceKey().id;
            const list = (data || []).filter((d) => d.approved && d.device_id !== me);
            // A phone with this phone's name is usually this same phone before Vela was reinstalled: it can't say yes.
            const sameName = (d) => (d.name || '') === deviceName();
            const others = list.filter((d) => !sameName(d));
            $('approve-phones').innerHTML = list.length
                ? `<span class="approve-phones-title">Open Vela on one of these:</span>${list.slice(0, 4).map((d) => `<span class="approve-phone">${icon('x-phone', 'ic ic-sm')}<span>${escapeHtml(d.name || 'Phone')}${sameName(d) ? ' (probably this phone before you reinstalled)' : ''}</span><span>used ${escapeHtml(relTime(new Date(d.last_seen).getTime()))}</span></span>`).join('')}`
                : '<span class="approve-phones-title">No other approved phone was found for this account.</span>';
            // No other real phone to approve: say so and open the help (use the authenticator code, or turn approval off).
            if (!others.length) {
                $('approve-wait-note').textContent = 'You have no other phone to approve this one. Use the code from your authenticator app below, or turn phone approval off.';
                const help = document.querySelector('#approve-wait details');
                if (help) help.open = true;
            }
        }).catch(() => {});
};
const endApproveWait = (ok, message, via = 'phone') => {
    const g = approvalGate;
    if (!g) return;
    clearInterval(g.timer);
    approvalGate = null;
    $('approve-wait').hidden = true;
    document.body.classList.remove('approve-waiting');
    if (ok) { showToast('Approved. Welcome back!', 'success'); g.resolve(via === 'phone' ? 'phone' : true); return; }
    g.resolve(false);
    Promise.resolve(supabaseClient.auth.signOut()).catch(() => {}).finally(() => { resetToSignedOut(); if (message) showAuthProblem(message); });
};
const askForApproval = async () => {
    const k = deviceKey();
    const rows = await deviceRpc('vela_request_login', { p_device: k.id, p_secret: k.secret });
    const r = Array.isArray(rows) ? rows[0] : rows;
    if (!r || !r.request_id) throw new Error('no request');
    approvalGate.requestId = r.request_id;
    approvalGate.number = r.number;
    approvalGate.since = Date.now();
    showApproveWait();
};
const checkApproval = async () => {
    const g = approvalGate;
    if (!g || !g.requestId || g.checking) return;
    if (Date.now() - g.since > 10 * 60000) { endApproveWait(false, 'Nobody approved it in 10 minutes. Sign in again to ask again.'); return; }
    g.checking = true;
    try {
        const { data } = await supabaseClient.from('vela_login_requests').select('status').eq('id', g.requestId).maybeSingle();
        if (approvalGate !== g) return;
        if (data && data.status === 'approved') endApproveWait(true);
        else if (data && data.status === 'denied') endApproveWait(false, 'Sign-in was blocked on your other phone.');
    } catch (e) { /* offline for a moment: try again on the next tick */ } finally { g.checking = false; }
};
const waitForApproval = () => new Promise((resolve) => {
    approvalGate = { resolve, requestId: null, number: '··', since: Date.now(), timer: null };
    askForApproval().then(() => {
        if (approvalGate) approvalGate.timer = setInterval(checkApproval, 3000);
    }, (err) => endApproveWait(false, `Couldn’t ask your other phone (${(err && err.message) || 'server error'}). If you have no other phone signed in, turn off phone approval with turn-off-approval.sql, then sign in again.`));
});
const resendApproval = async () => {
    if (!approvalGate) return;
    try { await askForApproval(); showToast('Sent again with a new number', 'info'); } catch (e) { showToast('Couldn’t send it. Check the internet.', 'error'); }
};
// An already signed-in phone checks it is still allowed when it comes back (it may have been removed).
const recheckDevice = async () => {
    if (!canSync() || !handledUserId || approvalGate || Date.now() - lastDeviceCheck < 30000) return;
    if (!supabaseClient || typeof supabaseClient.rpc !== 'function') return;
    lastDeviceCheck = Date.now();
    let status;
    try { status = await deviceCheck(); } catch (e) { return; }
    if (status !== 'pending') return;
    const uid = handledUserId;
    handledUserId = null;
    if (await waitForApproval()) handledUserId = uid;
};

// A phone you already use: someone is signing in somewhere else. Show "Is this you?" with three numbers.
let askingRequest = null;
const pollSignInRequests = async () => {
    if (!canSync() || !handledUserId || approvalGate || askingRequest || document.hidden) return;
    try {
        const since = new Date(Date.now() - 10 * 60000).toISOString();
        const { data, error } = await supabaseClient.from('vela_login_requests').select('id, device_id, device_name, number, created_at')
            .eq('status', 'pending').gte('created_at', since).order('created_at', { ascending: false }).limit(1);
        if (error || !data || !data.length) return;
        const r = data[0];
        if (r.device_id === deviceKey().id || askingRequest) return;
        showApproveAsk(r);
    } catch (e) { /* not set up on the server, or offline */ }
};
const showApproveAsk = (r) => {
    askingRequest = r;
    const choices = [r.number];
    while (choices.length < 3) { const n = 10 + Math.floor(Math.random() * 90); if (!choices.includes(n)) choices.push(n); }
    choices.sort(() => Math.random() - 0.5);
    $('approve-ask-device').textContent = r.device_name || 'A phone';
    $('approve-ask-when').textContent = relTime(new Date(r.created_at).getTime());
    $('approve-ask-numbers').innerHTML = choices.map((n) => `<button type="button" class="approve-num" data-approve-num="${n}">${n}</button>`).join('');
    logNotif({ key: `signin:${r.id}`, kind: 'signin', title: 'Someone is signing in', text: `${r.device_name || 'A phone'} wants to open your Vela account` });
    openOrSwap('modal-approve-ask');
};
const decideSignIn = async (approve, picked) => {
    const r = askingRequest;
    if (!r) return;
    const right = approve && picked === r.number;
    const k = deviceKey();
    try {
        const status = await deviceRpc('vela_decide_login', { p_request: r.id, p_device: k.id, p_secret: k.secret, p_approve: right });
        closeSheet('modal-approve-ask');
        if (status === 'expired') showToast('That request was too old. Ask them to try again.', 'info');
        else if (right) showToast(`${r.device_name || 'The phone'} can use your account now`, 'success');
        else if (approve) showToast('Wrong number, so that sign-in was blocked.', 'warning');
        else showToast('Blocked. If it wasn’t you, change your password.', 'warning');
        renderDevices(true);
    } catch (e) {
        showToast('Couldn’t send your answer. Check the internet and try again.', 'error');
        return;
    } finally {
        setTimeout(() => { if (askingRequest === r) askingRequest = null; }, 400);
    }
};
let gatingUser = null;
let signSteps = [];
let finishingUser = null;
const signStep = (text) => {
    signSteps = [...signSteps, `${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} ${String(text).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '(email)').slice(0, 160)}`].slice(-14);
    try { localStorage.setItem('VELA_SIGNIN_STEPS', JSON.stringify(signSteps)); } catch (e) { /* storage blocked */ }
};
// A sign-in that didn't finish says why on the sign-in page itself (a toast is gone before you read it).
const showAuthProblem = (message) => {
    signStep(`Stopped: ${message}`);
    const box = $('auth-problem');
    if (!box) return;
    $('auth-problem-text').textContent = message;
    $('auth-problem-steps').textContent = signSteps.join('\n');
    box.hidden = false;
};
const clearAuthProblem = () => { if ($('auth-problem')) $('auth-problem').hidden = true; };
const handleSession = async (session) => {
    if (!session || !session.user) return;
    const user = session.user;
    if (gatingUser === user.id) return;
    // Already done for this user, unless you're still looking at the sign-in page (then an earlier try failed: go again).
    if (handledUserId === user.id && !$('auth-overlay-container').classList.contains('active')) return;
    if (finishingUser === user.id) return; // the same sign-in is still loading
    gatingUser = user.id;
    signStep('Signed in with Google. Checking this phone');
    let allowed;
    try {
        const phone = await passDeviceApproval();
        signStep(phone === false ? 'This phone was not approved' : phone === 'phone' ? 'Approved on your other phone' : 'This phone is allowed');
        if (phone === false) allowed = false;
        else if (phone === 'phone') allowed = true; // approved on your other phone: that is the second step
        else {
            const mfa = await needsMfaCode();
            if (mfa) signStep('Asking for the 6-digit code');
            allowed = mfa ? await askMfaCode() : true;
            if (mfa) signStep(allowed ? 'Code accepted' : 'Code not given');
        }
    } catch (err) {
        allowed = false;
        handledUserId = null;
        showAuthProblem(`Couldn't check this phone (${(err && err.message) || 'unknown error'}). Check the internet and try again.`);
    } finally { gatingUser = null; }
    if (!allowed) return;
    handledUserId = user.id;
    finishingUser = user.id;
    try {
        await finishSession(user);
        signStep('Done');
        clearAuthProblem();
    } catch (err) {
        // Don't remember a half-finished sign-in: the next try must run again, not be skipped.
        handledUserId = null;
        console.error('Sign-in did not finish:', err);
        showAuthProblem(`Signed in, but your data couldn't be loaded (${(err && err.message) || 'unknown error'}). Check the internet and try again.`);
    } finally { finishingUser = null; }
};
const finishSession = async (user) => {

    const hasLocal = state.transactions.length || state.savings.length || state.recurring.length || state.debts.length;
    const wasGuestWithData = state.auth.isMock && state.auth.completedOnboarding && hasLocal;
    const previousCloudUser = !state.auth.isMock && state.auth.user ? state.auth.user.id : null;
    if (previousCloudUser && previousCloudUser !== user.id) {
        state.transactions = [];
        state.savings = [];
        state.recurring = [];
        state.debts = [];
        state.categories = mergeCategories([]);
        state.accounts = [];
        ensureAccounts(state);
        state.sync = {};
    }

    const meta = user.user_metadata || {};
    let fullName = meta.full_name || meta.name || (user.email ? user.email.split('@')[0] : 'Vela user');
    let avatarUrl = meta.avatar_url || meta.picture || null;
    try {
        const { data: profile } = await supabaseClient.from('profiles').select('*').eq('id', user.id).maybeSingle();
        if (profile) { fullName = profile.full_name || profile.username || fullName; avatarUrl = profile.avatar_url || avatarUrl; }
    } catch (err) { /* profile is optional */ }

    const sameUserAgain = previousCloudUser === user.id;
    state.auth.user = { id: user.id, email: user.email || null, full_name: fullName, avatar_url: avatarUrl };
    state.auth.isMock = false;
    // A phone that wasn't signed in to this account has nothing of its own to push except entries made as a guest.
    // Never let its default settings (budget, currency, accounts) overwrite what the account already has.
    if (!sameUserAgain) { state.sync = {}; state.syncSettings = false; state.settingsUser = null; state.settingsSig = null; }
    saveState();

    signStep('Loading your data');
    const hasRemote = await remoteHasData();
    const remoteHasSettings = await remoteSettingsExist();
    if (wasGuestWithData) {
        queueAllForUpload();
        if (remoteHasSettings) state.syncSettings = false; // keep the account's budgets and accounts; only add the guest entries
    }
    if (hasRemote || remoteHasSettings || wasGuestWithData || state.auth.completedOnboarding) {
        state.auth.completedOnboarding = true;
        if (!hasRemote && hasLocal) { queueAllForUpload(); if (remoteHasSettings) state.syncSettings = false; }
        await pullFromCloud();
        updateCurrencyButtons();
        saveState();
        hideAuth();
        processRecurring();
        scheduleReminders();
        if (wasGuestWithData) showToast('Signed in. Your data on this device is now synced.', 'success');
    } else {
        saveState();
        showAuth(2);
    }
    updateUserProfileUI();
    renderActive();
};

const resetToSignedOut = () => {
    { const w = nativePlugin('BalanceWidget'); if (w) w.clear().catch(() => {}); }
    handledUserId = null;
    state.transactions = [];
    state.savings = [];
    state.recurring = [];
    state.debts = [];
    state.categories = mergeCategories([]);
    state.config.categoryBudgets = {};
    state.accounts = [];
    ensureAccounts(state);
    state.sync = {};
    state.syncSettings = false;
    state.settingsUser = null;
    state.settingsSig = null;
    state.auth = { user: null, isMock: true, completedOnboarding: false };
    saveState();
    scheduleReminders();
    updateUserProfileUI();
    renderActive();
    showAuth(1);
};

const onAuthEvent = (event, session) => {
    if (event === 'INITIAL_SESSION') {
        if (session) handleSession(session);
        else if (!state.auth.isMock && state.auth.user) {
            if (pendingCount() > 0) { showToast('Sign in again to sync changes made on this device.', 'warning'); showAuth(1); }
            else resetToSignedOut();
        }
    } else if (event === 'SIGNED_IN') {
        if (session) handleSession(session);
    } else if (event === 'SIGNED_OUT') {
        if (!state.auth.isMock) resetToSignedOut();
    }
};

const handleSignIn = async (email, password) => {
    if (!requireCloud()) return;
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
        if (/email not confirmed/i.test(error.message || '')) { showAuthNotice(email); return; }
        showToast(friendlyAuthError(error), 'error');
        return;
    }
    hideAuthNotice();
    await handleSession(data.session);
    if (state.auth.completedOnboarding) showToast(`Welcome back, ${displayName()}`, 'success');
};

let noticeEmail = '';
const showAuthNotice = (email) => {
    noticeEmail = email;
    $('auth-notice-body').textContent = `We sent a link to ${email}. Open it on this phone, then come back and sign in. Check spam if it isn't in your inbox.`;
    $('auth-notice').hidden = false;
    $('signin-email').value = email;
    setAuthMode('signin');
};
const hideAuthNotice = () => { $('auth-notice').hidden = true; };
const resendConfirmation = async () => {
    if (!noticeEmail || !requireCloud()) return;
    const { error } = await supabaseClient.auth.resend({ type: 'signup', email: noticeEmail, options: { emailRedirectTo: authRedirectUrl() } });
    if (error) showToast(friendlyAuthError(error), 'error');
    else showToast(`Sent another link to ${noticeEmail}`, 'success');
};

// Sign-in providers send errors back in the address (for example a blocked redirect). Show them once.
const reportAuthErrorInUrl = () => {
    const params = new URLSearchParams(`${window.location.search.slice(1)}&${window.location.hash.replace(/^#/, '')}`);
    const msg = params.get('error_description');
    if (!msg) return;
    showToast(`Sign-in didn't finish: ${msg.replace(/\+/g, ' ')}`, 'error');
    history.replaceState(history.state, '', window.location.pathname);
};

const handleSignUp = async (email, password, fullName) => {
    if (!requireCloud()) return;
    const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName, username: fullName }, emailRedirectTo: authRedirectUrl() }
    });
    if (error) { showToast(friendlyAuthError(error), 'error'); return; }
    if (data.session) {
        await handleSession(data.session);
        showToast(`Account created. Welcome, ${fullName}!`, 'success');
    } else {
        showAuthNotice(email);
    }
};

const handleGoogleSignIn = async () => {
    if (!requireCloud()) return;
    if (!(await authServerReachable())) {
        showToast("Can't reach the sign-in server right now. You can keep using Vela without an account.", 'error');
        return;
    }
    const native = isNative();
    signSteps = [];
    clearAuthProblem();
    signStep('Opening Google');
    const { data, error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        // In the Android app Google opens in a real browser tab (Google blocks sign-in inside app web views).
        options: { redirectTo: authRedirectUrl(), skipBrowserRedirect: native }
    });
    if (error) { showToast(friendlyAuthError(error), 'error'); return; }
    if (native && data && data.url) {
        const browser = nativePlugin('Browser');
        if (browser) await browser.open({ url: data.url, presentationStyle: 'popover' });
        else window.location.href = data.url;
    }
};

const handleNativeAuthRedirect = async (url) => {
    if (url && !url.startsWith(NATIVE_AUTH_REDIRECT)) signStep('Opened by a link that is not the sign-in link');
    if (!url || !url.startsWith(NATIVE_AUTH_REDIRECT)) return;
    signStep('Back from Google');
    const browser = nativePlugin('Browser');
    if (browser) browser.close().catch(() => {});
    if (!supabaseClient) return;
    let parsed;
    try { parsed = new URL(url); } catch (err) { return; }
    const query = parsed.searchParams;
    const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''));
    const errorText = query.get('error_description') || hash.get('error_description');
    if (errorText) { showAuthProblem(`Google sign-in didn't finish: ${errorText}`); return; }
    try {
        let session = null;
        const code = query.get('code');
        if (code) {
            const { data, error } = await supabaseClient.auth.exchangeCodeForSession(code);
            if (error) throw error;
            session = data.session;
        } else if (hash.get('access_token') && hash.get('refresh_token')) {
            const { data, error } = await supabaseClient.auth.setSession({ access_token: hash.get('access_token'), refresh_token: hash.get('refresh_token') });
            if (error) throw error;
            session = data.session;
        }
        if (session) {
            signStep('Google accepted the sign-in');
            await handleSession(session);
            if (state.auth.completedOnboarding && handledUserId) showToast(`Signed in as ${displayName()}`, 'success');
        } else showAuthProblem('Google sent Vela back without a sign-in. Try again.');
    } catch (err) {
        console.error('Could not finish sign-in:', err);
        showAuthProblem(friendlyAuthError(err));
    }
};

const handleGuest = () => {
    if (state.auth.completedOnboarding) { hideAuth(); return; }
    state.auth.isMock = true;
    saveState();
    showAuth(2);
};

const handleSignOut = () => {
    if (state.auth.isMock) { showAuth(1); return; }
    const pending = pendingCount();
    showConfirm({
        title: 'Sign out?',
        message: pending
            ? `${plural(pending, 'change')} haven't synced yet and will be lost if you sign out now. Connect to the internet first to keep them.`
            : 'Your data stays safe in your account. It will be removed from this device until you sign in again.',
        confirmLabel: 'Sign out',
        onConfirm: async () => {
            try { if (supabaseClient) await supabaseClient.auth.signOut(); } catch (err) { /* ignore */ }
            resetToSignedOut();
            showToast('Signed out', 'success');
        }
    });
};

// Delete my account: everything synced (entries, settings, profile, photos) and the login itself,
// through the delete-account function on Vela's server, then everything on this device.
const deleteMyAccount = () => {
    if (!supabaseClient || state.auth.isMock || !state.auth.user) return;
    showConfirm({
        title: 'Delete your account?',
        message: 'This permanently deletes your Vela account, every entry, budget, bill, goal and photo synced to it, and all Vela data on this phone. It cannot be undone. Export a backup first (Settings › Reports) if you might need it.',
        confirmLabel: 'Delete my account',
        onConfirm: async () => {
            try {
                const { data, error } = await supabaseClient.functions.invoke('delete-account', { body: {} });
                if (error || !data || !data.ok) throw error || new Error('delete failed');
            } catch (err) {
                showToast('Your account couldn’t be deleted right now. Check your internet and try again, or contact support from the privacy policy page.', 'warning');
                return;
            }
            try { await supabaseClient.auth.signOut(); } catch (e) { /* already gone */ }
            const ln = nativePlugin('LocalNotifications');
            if (ln && state.config.reminderIds.length) { try { await ln.cancel({ notifications: state.config.reminderIds.map((id) => ({ id })) }); } catch (e) { /* ignore */ } }
            const plugin = smsPlugin();
            if (plugin) { try { await plugin.disconnect(); } catch (e) { /* ignore */ } }
            try { localStorage.removeItem(SMS_KEY); localStorage.removeItem(SHOP_LOGO_KEY); } catch (e) { /* ignore */ }
            storage.remove(STORAGE_KEY);
            showToast('Your account and data were deleted', 'success');
            setTimeout(() => window.location.reload(), 900);
        }
    });
};

const setAuthMode = (mode) => {
    const signin = mode === 'signin';
    $('btn-toggle-signin').setAttribute('aria-pressed', String(signin));
    $('btn-toggle-signup').setAttribute('aria-pressed', String(!signin));
    $('form-signin').hidden = !signin;
    $('form-signup').hidden = signin;
};


const completeOnboarding = async () => {
    await withBusy($('btn-complete-onboarding'), async () => {
        state.auth.completedOnboarding = true;
        saveState();
        hideAuth();
        updateUserProfileUI();
        switchTab('dashboard', { fromHistory: true });
        flushSync();
        scheduleReminders();
        showToast("You're all set. Tap + to add your first entry.", 'success');
    });
};

/* =========================================================================
   28. App lock (PIN + fingerprint)
   ========================================================================= */
let lockBuffer = '';
let lockFails = 0;
let lockBlockedUntil = 0;
let hiddenAt = 0;
let pinFlow = null; // { mode: 'set'|'change'|'disable', step: 'current'|'new'|'confirm', first, buffer }

const hashPin = async (pin, salt) => {
    const input = `${salt}:${pin}`;
    if (window.crypto && window.crypto.subtle) {
        const buf = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
        return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 0;
    for (let i = 0; i < input.length; i++) h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
    return `f${h >>> 0}`;
};

const buildKeypad = (container, prefix, withBio) => {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', withBio ? 'bio' : '', '0', 'del'];
    container.innerHTML = keys.map((k) => {
        if (!k) return '<span></span>';
        if (k === 'del') return `<button type="button" class="key plain" data-${prefix}-key="del" aria-label="Delete last digit">${icon('i-backspace')}</button>`;
        if (k === 'bio') return `<button type="button" class="key plain" data-${prefix}-key="bio" aria-label="Use ${bioWords().name}">${icon(bioWords().icon)}</button>`;
        return `<button type="button" class="key" data-${prefix}-key="${k}">${k}</button>`;
    }).join('');
};

const paintDots = (dotsEl, n) => dotsEl.querySelectorAll('span').forEach((s, i) => s.classList.toggle('filled', i < n));
const shake = (el) => { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); };
const isLocked = () => $('lock-screen').classList.contains('active');


/* ---- Face / fingerprint scanner: animated states for the lock screen ---- */
const BIO_WORDS = {
    finger: { name: 'fingerprint', title: 'Unlock with fingerprint', on: 'Fingerprint unlock is on', desc: 'Use your fingerprint instead of the PIN.', idle: 'Touch the sensor to unlock', scan: 'Scanning…', again: 'Tap the fingerprint to try again', icon: 'i-fingerprint' },
    face: { name: 'face', title: 'Unlock with face', on: 'Face unlock is on', desc: 'Look at your phone instead of typing the PIN.', idle: 'Look at your phone to unlock', scan: 'Looking for your face…', again: 'Tap the face to try again', icon: 'i-face' },
    both: { name: 'face or fingerprint', title: 'Unlock with face or fingerprint', on: 'Face and fingerprint unlock is on', desc: 'Look at your phone or touch the sensor instead of typing the PIN.', idle: 'Look at your phone or touch the sensor', scan: 'Scanning…', again: 'Tap to try again', icon: 'i-face' }
};
const BIO_MODE_KEY = 'VELA_BIO_MODE';
const bioChoices = () => (bioKind === 'both' ? ['finger', 'face', 'both'] : [bioKind]);
const bioMode = () => {
    let m = null;
    try { m = localStorage.getItem(BIO_MODE_KEY); } catch (e) { /* storage blocked */ }
    return bioChoices().includes(m) ? m : bioKind;
};
const setBioMode = (m) => {
    if (!bioChoices().includes(m)) return;
    try { localStorage.setItem(BIO_MODE_KEY, m); } catch (e) { /* storage blocked */ }
    if ($('fp-core')) $('fp-core').dataset.kind = '';
    renderSettings();
    showToast(BIO_WORDS[m].on, 'success');
};
// Android lets an app ask for "strong" sensors only (fingerprint, and the face unlock of a few phones like
// Pixel) or for any sensor. Face, or both, needs "any"; fingerprint asks for strong only.
const bioAllowed = () => (bioMode() === 'finger' ? [3] : [3, 4]);
const bioWords = () => BIO_WORDS[bioMode()] || BIO_WORDS.finger;
// Face scan: corner brackets, eyes, nose and smile, drawn with the same animated strokes as the fingerprint.
const FACE_PATHS = [
    'M14 24v-6a4 4 0 0 1 4-4h6',
    'M40 14h6a4 4 0 0 1 4 4v6',
    'M50 40v6a4 4 0 0 1-4 4h-6',
    'M24 50h-6a4 4 0 0 1-4-4v-6',
    'M25 26v4',
    'M39 26v4',
    'M32 26v9h-2.5',
    'M25.5 40.5a9.5 9.5 0 0 0 13 0'
];
const FACE_DOTS = [[22, 22], [42, 22], [18, 34], [46, 34], [24, 46], [40, 46], [32, 18], [32, 48]];
let bioBusy = false;
const FP_PATHS = [
    'M32 30.5c-1.7 0-3 1.3-3 3 0 5.2-1.1 9.6-3.6 13.6',
    'M35 33.5c0 6.3-1 11.4-3.2 15.6',
    'M23.2 44.5c1.3-3.2 2-6.8 2-11a6.8 6.8 0 0 1 13.6 0c0 2.6-.2 5.1-.6 7.5',
    'M37.2 46.5c.6-1.6 1-3.3 1.4-5',
    'M19.6 39.5c.7-2 1-4 1-6a11.4 11.4 0 0 1 22.8 0c0 2.1-.1 4.1-.4 6.1',
    'M16.4 34.5c-.2-.4-.2-.7-.2-1a15.8 15.8 0 0 1 31.6 0c0 3-.3 6-.9 8.7',
    'M13 39c-.6-1.8-1-3.7-1-5.5',
    'M17.8 23.6a18.6 18.6 0 0 1 28.4 0',
    'M21.4 16.6a20.8 20.8 0 0 1 21.2 0',
    'M51.6 30.5c.3 1 .4 2 .4 3 0 3.2-.3 6.3-1 9.2'
];
const fpPaths = (cls, list = FP_PATHS) => list.map((d, i) => `<path class="${cls}" pathLength="1" style="--i:${i}" d="${d}"/>`).join('');
const fpCoreHtml = () => bioMode() !== 'finger' ? `<svg class="fp-svg is-face" viewBox="0 0 64 64" aria-hidden="true">
    <defs><linearGradient id="fp-grad" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="var(--fp-a)"/><stop offset="1" stop-color="var(--fp-b)"/></linearGradient></defs>
    <g class="fp-base">${fpPaths('', FACE_PATHS)}</g><g class="fp-fill">${fpPaths('', FACE_PATHS)}</g><g class="face-mesh">${FACE_DOTS.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="1.1" style="--i:${i}"/>`).join('')}</g></svg><span class="fp-laser"></span>` : `<svg class="fp-svg" viewBox="0 0 64 64" aria-hidden="true">
    <defs><linearGradient id="fp-grad" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="var(--fp-a)"/><stop offset="1" stop-color="var(--fp-b)"/></linearGradient></defs>
    <g class="fp-base">${fpPaths('')}</g><g class="fp-fill">${fpPaths('')}</g></svg><span class="fp-laser"></span>`;
const setScanner = (st, label) => {
    const s = $('fp-scanner');
    if (!s) return;
    s.dataset.state = st;
    if (label) $('fp-label').textContent = label;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Fade the lock away and bring the app in.
const unlockAnimated = () => {
    const el = $('lock-screen');
    el.classList.add('unlocking');
    document.documentElement.classList.add('app-reveal');
    setTimeout(() => { el.classList.remove('unlocking'); unlock(); }, 480);
    setTimeout(() => document.documentElement.classList.remove('app-reveal'), 1300);
};

// Shows the animated fingerprint scanner when fingerprint unlock is on and the phone supports it.
const setLockBio = () => {
    const bio = !!(state.config.lock.biometric && biometricAvailable);
    $('lock-screen').classList.toggle('has-bio', bio);
    $('fp-wrap').hidden = !bio;
    $('lock-title').textContent = bio ? 'Unlock Vela' : 'Enter your PIN';
    if (bio) {
        if (!$('fp-core').firstChild || $('fp-core').dataset.kind !== bioMode()) { $('fp-core').innerHTML = fpCoreHtml(); $('fp-core').dataset.kind = bioMode(); }
        $('fp-scanner').dataset.kind = bioMode();
        $('fp-scanner').setAttribute('aria-label', `Unlock with your ${bioWords().name}`);
        if (!bioBusy) setScanner('idle', bioWords().idle);
    }
};

const showLock = () => {
    if (!state.config.lock.enabled) { document.documentElement.classList.remove('is-locked'); return; }
    lockBuffer = '';
    paintDots($('lock-dots'), 0);
    $('lock-msg').textContent = '';
    $('lock-msg').dataset.error = 'false';
    buildKeypad($('lock-keypad'), 'lock', false);
    $('lock-screen').classList.remove('unlocking');
    $('lock-dots').classList.remove('ok');
    setLockBio();
    $('lock-screen').classList.add('active');
    document.documentElement.classList.add('is-locked');
    if (state.config.lock.biometric && biometricAvailable) setTimeout(tryBiometricUnlock, 450);
};

const unlock = () => {
    $('lock-screen').classList.remove('active');
    document.documentElement.classList.remove('is-locked');
    lockBuffer = '';
    lockFails = 0;
    haptic('LIGHT');
    if (widgetPending) setTimeout(() => runWidgetAction(widgetPending), 300);
};

const tryBiometricUnlock = async () => {
    const bio = nativePlugin('NativeBiometric');
    if (!bio || bioBusy || !isLocked()) return;
    bioBusy = true;
    await splashDone;
    if (!isLocked()) { bioBusy = false; return; }
    setScanner('scanning', bioWords().scan);
    const started = Date.now();
    try {
        await bio.verifyIdentity({ reason: 'Unlock Vela', title: 'Unlock Vela', subtitle: `Use your ${bioWords().name}`, negativeButtonText: 'Use PIN', maxAttempts: 3, allowedBiometryTypes: bioAllowed() });
        await wait(Math.max(0, 1100 - (Date.now() - started))); // let the scan finish on screen
        setScanner('success', 'Welcome back');
        haptic('MEDIUM');
        await wait(750);
        unlockAnimated();
    } catch (err) {
        const why = String((err && (err.message || err.code)) || '');
        if (/cancel|negative|use pin|user/i.test(why)) {
            setScanner('idle', bioWords().again);
        } else {
            setScanner('error', 'Not recognised. Try again or use your PIN');
            haptic('HEAVY');
            await wait(1600);
            if (isLocked()) setScanner('idle', bioWords().again);
        }
    } finally {
        bioBusy = false;
    }
};

const onLockKey = async (k) => {
    if (k === 'bio') { tryBiometricUnlock(); return; }
    const msg = $('lock-msg');
    if (Date.now() < lockBlockedUntil) {
        msg.textContent = `Too many tries. Wait ${Math.ceil((lockBlockedUntil - Date.now()) / 1000)} seconds.`;
        msg.dataset.error = 'true';
        return;
    }
    if (k === 'del') lockBuffer = lockBuffer.slice(0, -1);
    else if (lockBuffer.length < 4) lockBuffer += k;
    paintDots($('lock-dots'), lockBuffer.length);
    if (lockBuffer.length < 4) return;
    const attempt = lockBuffer;
    lockBuffer = '';
    const ok = (await hashPin(attempt, state.config.lock.salt)) === state.config.lock.hash;
    if (ok) {
        $('lock-dots').classList.add('ok');
        if ($('fp-scanner') && !$('fp-wrap').hidden) setScanner('success', 'Welcome back');
        haptic('MEDIUM');
        setTimeout(unlockAnimated, 320);
        return;
    }
    lockFails++;
    shake($('lock-dots'));
    if (!$('fp-wrap').hidden) { setScanner('error'); setTimeout(() => { if (isLocked() && !bioBusy) setScanner('idle'); }, 900); }
    haptic('HEAVY');
    setTimeout(() => paintDots($('lock-dots'), 0), 250);
    if (lockFails >= 5) {
        lockBlockedUntil = Date.now() + 30000;
        lockFails = 0;
        msg.textContent = 'Too many tries. Wait 30 seconds.';
    } else {
        msg.textContent = `Wrong PIN. ${plural(5 - lockFails, 'try', 'tries')} left.`;
    }
    msg.dataset.error = 'true';
};

const forgotPin = () => {
    const cloud = canSync();
    showConfirm({
        title: 'Reset Vela on this phone?',
        message: cloud
            ? 'You will be signed out and the PIN removed. Sign in again to get your synced data back.'
            : 'The only way to remove a forgotten PIN is to delete all Vela data on this phone. This cannot be undone.',
        confirmLabel: cloud ? 'Sign out and reset' : 'Delete everything',
        onConfirm: async () => {
            if (cloud) { try { await supabaseClient.auth.signOut(); } catch (err) { /* ignore */ } }
            storage.remove(STORAGE_KEY);
            try { localStorage.removeItem(SHOP_LOGO_KEY); } catch (e) { /* ignore */ }
            window.location.reload();
        }
    });
};

const pinFlowMessage = () => {
    const f = pinFlow;
    if (!f) return '';
    if (f.step === 'current') return f.mode === 'disable' ? 'Enter your PIN to turn the lock off.' : 'Enter your current PIN.';
    if (f.step === 'confirm') return 'Enter the same PIN again.';
    return 'Choose 4 digits you will remember.';
};

const openPinFlow = (mode) => {
    pinFlow = { mode, step: mode === 'set' ? 'new' : 'current', first: '', buffer: '' };
    $('pin-title').textContent = mode === 'disable' ? 'Turn off app lock' : mode === 'change' ? 'Change PIN' : 'Choose a PIN';
    $('pin-msg').textContent = pinFlowMessage();
    $('pin-msg').dataset.error = 'false';
    paintDots($('pin-dots'), 0);
    buildKeypad($('pin-keypad'), 'pin', false);
    openOrSwap('modal-pin');
};

const onPinKey = async (k) => {
    const f = pinFlow;
    if (!f) return;
    if (k === 'del') f.buffer = f.buffer.slice(0, -1);
    else if (f.buffer.length < 4) f.buffer += k;
    paintDots($('pin-dots'), f.buffer.length);
    if (f.buffer.length < 4) return;
    const entered = f.buffer;
    f.buffer = '';
    const msg = $('pin-msg');
    const fail = (text) => { shake($('pin-dots')); msg.textContent = text; msg.dataset.error = 'true'; setTimeout(() => paintDots($('pin-dots'), 0), 250); };

    if (f.step === 'current') {
        if ((await hashPin(entered, state.config.lock.salt)) !== state.config.lock.hash) { fail('That PIN is not right. Try again.'); return; }
        if (f.mode === 'disable') {
            state.config.lock = { enabled: false, hash: null, salt: null, biometric: false };
            saveState();
            closeSheet('modal-pin');
            showToast('App lock turned off', 'success');
            renderSettings();
            return;
        }
        f.step = 'new';
    } else if (f.step === 'new') {
        if (/^(\d)\1{3}$/.test(entered) || entered === '1234') { fail('Pick something harder to guess than that.'); return; }
        f.first = entered;
        f.step = 'confirm';
    } else {
        if (entered !== f.first) { f.step = 'new'; f.first = ''; fail("The PINs didn't match. Choose your PIN again."); return; }
        const salt = generateId();
        state.config.lock = { enabled: true, hash: await hashPin(entered, salt), salt, biometric: state.config.lock.biometric && biometricAvailable };
        saveState();
        closeSheet('modal-pin');
        haptic('MEDIUM');
        showToast(f.mode === 'change' ? 'PIN changed' : 'App lock is on. Vela asks for your PIN when it opens.', 'success');
        renderSettings();
        return;
    }
    msg.dataset.error = 'false';
    msg.textContent = pinFlowMessage();
    paintDots($('pin-dots'), 0);
};

const toggleBiometric = async () => {
    const bio = nativePlugin('NativeBiometric');
    if (!bio || !biometricAvailable) return;
    if (state.config.lock.biometric) {
        state.config.lock.biometric = false;
        saveState();
        renderSettings();
        return;
    }
    try {
        await bio.verifyIdentity({ reason: `Turn on ${bioWords().name} unlock`, title: "Confirm it's you", subtitle: `Use your ${bioWords().name}`, negativeButtonText: 'Cancel', allowedBiometryTypes: bioAllowed() });
        state.config.lock.biometric = true;
        saveState();
        showToast(bioWords().on, 'success');
    } catch (err) {
        showToast(`Your ${bioWords().name} wasn't confirmed, so it stays off.`, 'info');
    }
    renderSettings();
};

const checkBiometric = async () => {
    const bio = nativePlugin('NativeBiometric');
    if (!bio) return;
    try {
        // Report face too when the phone has a face sensor next to the fingerprint (Pixel face unlock).
        const res = await bio.isAvailable({ preferMultipleBiometryType: true });
        biometricAvailable = !!(res && res.isAvailable);
        const t = Number(res && res.biometryType);
        bioKind = t === 4 || t === 5 ? 'face' : t === 6 ? 'both' : 'finger';
    } catch (err) {
        biometricAvailable = false;
    }
    if (currentTab === 'settings') renderSettings();
    // The lock can appear before the phone reports fingerprint support (cold start): upgrade it now.
    if (isLocked() && state.config.lock.biometric && biometricAvailable) {
        setLockBio();
        setTimeout(tryBiometricUnlock, 300);
    }
};

/* =========================================================================
   29. Reports: CSV & PDF
   ========================================================================= */
const saveFile = async (fileName, content, mime, isBase64 = false) => {
    const fs = nativePlugin('Filesystem');
    const share = nativePlugin('Share');
    if (fs && share) {
        const written = await fs.writeFile(isBase64
            ? { path: fileName, data: content, directory: 'CACHE' }
            : { path: fileName, data: content, directory: 'CACHE', encoding: 'utf8' });
        await share.share({ title: fileName, url: written.uri, dialogTitle: 'Save or send' });
        return;
    }
    let blob;
    if (isBase64) {
        const bin = atob(content);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        blob = new Blob([bytes], { type: mime });
    } else {
        blob = new Blob([content], { type: mime });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
};

const shareCancelled = (err) => /cancel/i.test(String(err && err.message));

const exportCsv = async () => {
    if (!state.transactions.length) { showToast('Nothing to export yet.', 'info'); return; }
    const cell = (v) => {
        const s = String(v == null ? '' : v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const cur = dcur();
    const rows = [['Date', 'Type', 'Description', 'Category', 'Account', 'Amount', 'Currency', `Amount (${cur})`, 'Note']];
    sortByNewest(state.transactions).forEach((t) => rows.push([
        t.date, t.type === 'income' ? 'Income' : t.type === 'transfer' ? 'Transfer' : 'Expense', t.desc,
        t.type === 'transfer' ? transferLine(t) : catById(t.category, t.type).name, accountById(t.accountId).name,
        t.amount.toFixed(decimalsFor(t.currency)), t.currency, toDisplay(t.amount, t.currency).toFixed(2), t.note || ''
    ]));
    const csv = '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
    try {
        await saveFile(`vela-transactions-${todayISO()}.csv`, csv, 'text/csv');
        showToast(`Exported ${plural(state.transactions.length, 'entry', 'entries')}`, 'success');
    } catch (err) {
        if (!shareCancelled(err)) showToast("Couldn't create the file. Try again.", 'error');
    }
};

let jspdfLoading = null;
const loadJsPdf = () => {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (jspdfLoading) return jspdfLoading;
    jspdfLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = isNative() ? 'vendor/jspdf.umd.min.js' : JSPDF_CDN;
        s.onload = () => (window.jspdf && window.jspdf.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error('PDF library missing')));
        s.onerror = () => { jspdfLoading = null; reject(new Error('PDF library failed to load')); };
        document.head.appendChild(s);
    });
    return jspdfLoading;
};

// The PDF font covers Latin-1 only, so symbols like ₹ fall back to the currency code.
const pdfMoney = (v, cur) => `${v < 0 ? '-' : ''}${/^[\x20-\xFF]+$/.test(symbolFor(cur)) ? symbolFor(cur) : `${cur} `}${numberFmt(cur).format(Math.abs(v))}`;

const exportPdf = async () => {
    let JsPDF;
    try { JsPDF = await loadJsPdf(); } catch (err) { showToast('The PDF maker needs an internet connection the first time.', 'warning'); return; }
    const { y: Y, m: M } = activityMonth;
    const s = monthStats(Y, M);
    const cur = dcur();
    const money = (v) => pdfMoney(v, cur);
    const doc = new JsPDF({ unit: 'mm', format: 'a4' });
    const W = 210;
    const L = 16;
    const R = W - 16;
    let y;

    doc.setFillColor(35, 18, 63);
    doc.rect(0, 0, W, 38, 'F');
    doc.setFillColor(155, 81, 224);
    doc.rect(0, 36, W / 2, 2, 'F');
    doc.setFillColor(255, 42, 95);
    doc.rect(W / 2, 36, W / 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.text('Vela', L, 17);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.text(`Monthly report - ${monthName(Y, M)}`, L, 26);
    doc.setFontSize(8.5);
    doc.text(`${displayName()} - generated ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - amounts in ${cur}`, L, 32);
    y = 50;

    const boxes = [
        ['Income', money(s.income), [46, 125, 50]],
        ['Spent', money(s.spent), [216, 27, 96]],
        ['Net', money(s.net), s.net >= 0 ? [46, 125, 50] : [216, 27, 96]],
        ['Budget used', `${Math.round(s.budgetPct)}%`, [98, 0, 238]]
    ];
    const bw = (R - L - 9) / 4;
    boxes.forEach(([label, value, rgb], i) => {
        const x = L + i * (bw + 3);
        doc.setDrawColor(225, 225, 235);
        doc.setFillColor(248, 247, 252);
        doc.roundedRect(x, y, bw, 22, 2, 2, 'FD');
        doc.setTextColor(110, 110, 125);
        doc.setFontSize(8);
        doc.text(label.toUpperCase(), x + 4, y + 7);
        doc.setTextColor(rgb[0], rgb[1], rgb[2]);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text(value, x + 4, y + 16);
        doc.setFont('helvetica', 'normal');
    });
    y += 34;

    const ensure = (h) => { if (y + h > 280) { doc.addPage(); y = 20; } };
    const fx = fixedForMonth(Y, M);
    const sectionTitle = (t) => {
        ensure(14);
        doc.setTextColor(25, 25, 33);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text(t, L, y);
        doc.setFont('helvetica', 'normal');
        y += 6;
    };
    const tableRow = (cols, widths, opts = {}) => {
        ensure(8);
        if (opts.header) {
            doc.setFillColor(241, 238, 250);
            doc.rect(L, y - 4.5, R - L, 7, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(70, 50, 110);
        } else {
            doc.setTextColor(40, 40, 50);
        }
        doc.setFontSize(9);
        let x = L + 2;
        cols.forEach((c, i) => {
            const text = doc.splitTextToSize(String(c), widths[i] - 3)[0] || '';
            if (opts.alignRight && opts.alignRight.includes(i)) doc.text(text, x + widths[i] - 4, y, { align: 'right' });
            else doc.text(text, x, y);
            x += widths[i];
        });
        doc.setFont('helvetica', 'normal');
        y += 6.5;
        if (!opts.header) { doc.setDrawColor(236, 236, 242); doc.line(L, y - 4, R, y - 4); }
    };
    if (fx.income > 0 || fx.total > 0) {
        sectionTitle('After fixed expenses');
        tableRow(['', 'Amount'], [140, 38], { header: true, alignRight: [1] });
        tableRow(['Income', money(fx.income)], [140, 38], { alignRight: [1] });
        fx.items.forEach((i) => tableRow([`  ${i.name} (${i.paid ? 'paid' : 'due'} ${shortDate(i.date)})`, `-${money(i.amount)}`], [140, 38], { alignRight: [1] }));
        tableRow(['Fixed expenses total', `-${money(fx.total)}`], [140, 38], { alignRight: [1] });
        doc.setFont('helvetica', 'bold');
        tableRow([fx.left >= 0 ? 'Left for everything else' : 'Short this month', money(fx.left)], [140, 38], { alignRight: [1] });
        doc.setFont('helvetica', 'normal');
        y += 4;
    }
    const catTable = (title, byCat, total, type) => {
        const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
        if (!entries.length) return;
        sectionTitle(title);
        tableRow(['Category', 'Amount', 'Share'], [100, 50, 28], { header: true, alignRight: [1, 2] });
        entries.forEach(([id, v]) => tableRow([catById(id, type).name, money(v), `${total > 0 ? Math.round((v / total) * 100) : 0}%`], [100, 50, 28], { alignRight: [1, 2] }));
        y += 6;
    };
    catTable('Spending by category', s.byCat, s.spent, 'expense');
    const incByCat = {};
    s.incomeList.forEach((t) => { incByCat[t.category] = (incByCat[t.category] || 0) + toDisplay(t.amount, t.currency); });
    catTable('Income by source', incByCat, s.income, 'income');

    const budgets = Object.keys(state.config.categoryBudgets);
    if (budgets.length) {
        sectionTitle('Budgets');
        tableRow(['Category', 'Spent', 'Limit', 'Used'], [80, 36, 36, 26], { header: true, alignRight: [1, 2, 3] });
        budgets.forEach((id) => {
            const limit = budgetIn(state.config.categoryBudgets[id], cur);
            const spent = s.byCat[id] || 0;
            tableRow([catById(id).name, money(spent), money(limit), `${Math.round((spent / limit) * 100)}%`], [80, 36, 36, 26], { alignRight: [1, 2, 3] });
        });
        y += 6;
    }

    sectionTitle(`All entries (${s.list.length})`);
    if (s.list.length) {
        tableRow(['Date', 'Description', 'Category', 'Amount'], [24, 78, 40, 36], { header: true, alignRight: [3] });
        sortByNewest(s.list).forEach((t) => tableRow([
            shortDate(t.date), t.desc, t.type === 'transfer' ? transferLine(t) : catById(t.category, t.type).name,
            `${t.type === 'income' ? '+' : t.type === 'transfer' ? '' : '-'}${money(toDisplay(t.amount, t.currency))}`
        ], [24, 78, 40, 36], { alignRight: [3] }));
    } else {
        doc.setFontSize(9);
        doc.setTextColor(110, 110, 125);
        doc.text('No entries this month.', L, y);
    }

    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 160);
        doc.text(`Vela - ${monthName(Y, M)} - page ${i} of ${pages}`, W / 2, 290, { align: 'center' });
    }

    const fileName = `vela-report-${Y}-${pad2(M + 1)}.pdf`;
    try {
        if (isNative()) await saveFile(fileName, doc.output('datauristring').split(',')[1], 'application/pdf', true);
        else doc.save(fileName);
        showToast(`Report for ${monthName(Y, M)} is ready`, 'success');
    } catch (err) {
        if (!shareCancelled(err)) showToast("Couldn't create the PDF. Try again.", 'error');
    }
};

/* =========================================================================
   30. Backup, import, wipe
   ========================================================================= */
const exportBackup = async () => {
    const { lock, reminderIds, ...config } = state.config;
    const payload = {
        app: 'vela', version: APP_VERSION, exportedAt: new Date().toISOString(),
        config,
        transactions: state.transactions, savings: state.savings, recurring: state.recurring, debts: state.debts, accounts: state.accounts,
        categories: state.categories,
        shopLogos
    };
    try {
        await saveFile(`vela-backup-${todayISO()}.json`, JSON.stringify(payload, null, 2), 'application/json');
        showToast(`Backup ready (${plural(state.transactions.length, 'entry', 'entries')})`, 'success');
    } catch (err) {
        if (!shareCancelled(err)) showToast("Couldn't create the backup file. Try again.", 'error');
    }
};

const importBackup = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
        let parsed;
        try { parsed = JSON.parse(reader.result); } catch (err) { showToast("That file isn't a valid Vela backup (.json).", 'error'); return; }
        if (!parsed || !['transactions', 'expenses', 'savings', 'recurring', 'debts'].some((k) => Array.isArray(parsed[k]))) {
            showToast("That file doesn't contain any Vela data.", 'error');
            return;
        }
        const incoming = normalizeState({ ...parsed, auth: state.auth, config: { ...state.config, ...(parsed.config || {}), theme: state.config.theme, lock: state.config.lock } });
        showConfirm({
            title: 'Replace your data?',
            message: `This backup has ${plural(incoming.transactions.length, 'entry', 'entries')}, ${plural(incoming.savings.length, 'goal')}, ${plural(incoming.recurring.length, 'bill')} and ${plural(incoming.debts.length, 'debt')}. They will replace what's on this device.`,
            confirmLabel: 'Replace',
            danger: false,
            onConfirm: () => {
                ['transactions', 'savings', 'recurring', 'debts', 'categories', 'accounts'].forEach((k) => { state[k] = incoming[k]; });
                // Your own shop logos come back too (only small pictures, nothing else).
                if (parsed.shopLogos && typeof parsed.shopLogos === 'object') {
                    Object.entries(parsed.shopLogos).forEach(([k, v]) => { if (typeof v === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(v) && v.length < 200000) shopLogos[shopLogoKey(k)] = v; });
                    saveShopLogos();
                }
                state.config = { ...incoming.config, theme: state.config.theme, lock: state.config.lock, reminders: state.config.reminders, reminderIds: state.config.reminderIds };
                applyViewBudget();
                if (canSync()) queueAllForUpload();
                saveState();
                flushSync();
                updateCurrencyButtons();
                setRateStatus(rateStatus);
                processRecurring();
                scheduleReminders();
                renderActive();
                showToast('Backup restored', 'success');
            }
        });
    };
    reader.onerror = () => showToast("That file couldn't be read.", 'error');
    reader.readAsText(file);
};

// Everything Vela keeps on this phone (not the phone's own settings: lock timing, screen privacy, device key).
const VELA_DATA_KEYS = ['VELA_STATE', 'VELA_SHOP_LOGOS', 'VELA_NOTIF_LOG', 'VELA_VIEW_ACCOUNT', 'VELA_HIDE_BALANCE', 'VELA_INSIGHTS_ALL', 'VELA_SMS', 'VELA_BEFORE_BAL_FIXED', 'VELA_RECENT_ALL'];
const clearPhoneData = async () => {
    const ln = nativePlugin('LocalNotifications');
    if (ln && state.config.reminderIds.length) { try { await ln.cancel({ notifications: state.config.reminderIds.map((id) => ({ id })) }); } catch (e) { /* ignore */ } }
    const sms = smsPlugin && smsPlugin();
    if (sms && sms.disconnect) { try { await sms.disconnect(); } catch (e) { /* ignore */ } }
    VELA_DATA_KEYS.forEach((k) => storage.remove(k));
    try { await new Promise((done) => { const r = indexedDB.deleteDatabase('vela'); r.onsuccess = r.onerror = r.onblocked = () => done(); }); } catch (e) { /* no receipts */ }
};
const wipeData = () => {
    const cloud = canSync();
    $('wipe-msg').textContent = `${plural(state.transactions.length, 'entry', 'entries')}, ${plural(state.accounts.length, 'account')}, funds, goals, bills, debts, trips, logos and receipt photos.`;
    $('btn-wipe-everywhere').hidden = !cloud;
    $('btn-wipe-phone').textContent = cloud ? 'This phone only' : 'Delete everything';
    $('wipe-note').textContent = cloud
        ? '"This phone only": your synced data comes back when you sign in again. "Everywhere": it is also deleted from your online account and cannot be brought back.'
        : 'This cannot be undone. Make a backup first (Back up data) if you might need it.';
    openOrSwap('modal-wipe');
};
const wipePhone = async () => {
    closeSheet('modal-wipe');
    await clearPhoneData();
    window.location.reload();
};
const wipeEverywhere = () => {
    showConfirm({
        title: 'Delete everything everywhere?',
        message: 'All your Vela data is deleted from this phone AND from your online account. It cannot be brought back.',
        confirmLabel: 'Delete everywhere',
        onConfirm: async () => {
            closeSheet('modal-wipe');
            const uid = state.auth.user && state.auth.user.id;
            try {
                const { error } = await supabaseClient.from('vela_records').delete().eq('user_id', uid);
                if (error) throw error;
                // The settings row is emptied (accounts, budgets, funds, trips...).
                const fresh = createDefaultState();
                applyRegionDefaults(fresh);
                const keep = { auth: state.auth, settingsUser: state.settingsUser };
                state = { ...fresh, ...keep, sync: {}, syncSettings: true, settingsSig: null };
                ensureAccounts(state);
                saveState();
                const ok = await flushSync();
                if (!ok) throw new Error('settings not uploaded');
            } catch (e) {
                showToast('Couldn’t delete your online data (check the internet). Nothing was deleted from the phone.', 'error');
                loadState();
                renderActive();
                return;
            }
            await clearPhoneData();
            window.location.reload();
        }
    });
};

/* =========================================================================
   31. PWA install
   ========================================================================= */
const initPwaInstall = () => {
    const btn = $('btn-install-pwa');
    const standalone = isNative() || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
    if (standalone) $('app-group').hidden = true;
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        if (btn) btn.hidden = false;
    });
    if (btn) {
        btn.addEventListener('click', async () => {
            if (!deferredInstallPrompt) return;
            deferredInstallPrompt.prompt();
            try {
                const choice = await deferredInstallPrompt.userChoice;
                if (choice.outcome === 'accepted') btn.hidden = true;
            } finally {
                deferredInstallPrompt = null;
            }
        });
    }
    window.addEventListener('appinstalled', () => {
        $('app-group').hidden = true;
        showToast('Vela is installed. Open it from your home screen.', 'success');
    });
};

/* =========================================================================
   32. Events
   ========================================================================= */
const updateCurrencyButtons = () => {
    $('currency-code').textContent = dcur();
};

const setDisplayCurrency = (cur) => {
    if (cur === dcur()) return;
    state.config.currency = cur;
    if (!state.config.currencies.includes(cur)) state.config.currencies.push(cur);
    fixAccountCurrencies();
    saveState();
    updateCurrencyButtons();
    showToast(`Showing everything in ${cur}. New entries start in ${cur}.`, 'success');
    setRateStatus(rateStatus);
    renderActive();
};

const onAppHidden = () => { hiddenAt = Date.now(); };
// How long Vela can be away before it asks for the PIN or fingerprint again (this phone): 0, 60, 300 or 900 seconds.
const LOCK_AFTER_KEY = 'VELA_LOCK_AFTER';
const lockAfterMs = () => { let v = 60; try { const raw = localStorage.getItem(LOCK_AFTER_KEY); const n = Number(raw); if (raw !== null && raw !== '' && [0, 60, 300, 900].includes(n)) v = n; } catch (e) { /* storage blocked */ } return v * 1000; };
const setLockAfter = (sec) => { try { localStorage.setItem(LOCK_AFTER_KEY, String(sec)); } catch (e) { /* storage blocked */ } renderSettings(); showToast(sec === 0 ? 'Vela locks as soon as you leave it' : `Vela locks ${sec / 60} min after you leave it`, 'success'); };
const onAppVisible = () => {
    applyNativeInsets();
    if (state.config.lock.enabled && hiddenAt && Date.now() - hiddenAt >= lockAfterMs() && !isLocked()) showLock();
    hiddenAt = 0;
    processRecurring();
    if (pendingCount()) flushSync();
    renderActive();
    scanSms();
    refreshBankStatus();
    setTimeout(showPaymentsPopup, 900);
    recheckDevice();
    pollSignInRequests();
};

// A soft ink ripple where you touch buttons.
const initRipples = () => {
    document.addEventListener('pointerdown', (e) => {
        if (reduceMotion() || e.button > 0) return;
        const el = e.target.closest('.btn, .key, .action-tile, .fab, .pick-chip, .chip, .account-chip, .icon-btn, .fp-scanner');
        if (!el || el.disabled) return;
        const r = el.getBoundingClientRect();
        const size = Math.max(r.width, r.height) * 2.2;
        const ink = document.createElement('span');
        ink.className = 'ripple-ink';
        ink.style.width = ink.style.height = `${size}px`;
        ink.style.left = `${e.clientX - r.left - size / 2}px`;
        ink.style.top = `${e.clientY - r.top - size / 2}px`;
        el.appendChild(ink);
        ink.addEventListener('animationend', () => ink.remove(), { once: true });
        setTimeout(() => ink.remove(), 900);
    }, { passive: true });
};

const initEvents = () => {
    initRipples();
    initMoneyInputs();
    let refitTimer = null;
    window.addEventListener('resize', () => { clearTimeout(refitTimer); refitTimer = setTimeout(() => refitAmounts(), 150); });
    // The display font arrives after the first paint and is wider than the fallback: fit the amounts again then.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => refitAmounts()).catch(() => {});
    document.addEventListener('click', (e) => {
        const el = e.target.closest('button, [data-tab], [data-goto]');
        if (!el) return;
        const d = el.dataset;

        if (d.lockKey) { onLockKey(d.lockKey); return; }
        if (d.txParts !== undefined) { txParts = Number(d.txParts); updatePartsRow(); return; }
        if (d.txCover) { txCover = d.txCover; $('tx-fund-cover').hidden = true; submitTx(); return; }
        if (el.id === 'debt-moved') { debtMoved = !debtMoved; updateDebtMovedRow(); return; }
        if (d.smsParts) { const [sid, n] = d.smsParts.split(':'); smsPartsPick[sid] = Number(n); renderSmsSheet(); return; }
        if (d.smsBill) { const [sid, bid] = d.smsBill.split(':'); smsBillPick[sid] = bid; renderSmsSheet(); return; }
        if (d.smsFee) { const [sid, pick] = d.smsFee.split(':'); smsFeePick[sid] = pick; renderSmsSheet(); return; }
        if (d.pinKey) { onPinKey(d.pinKey); return; }
        if (d.tab) { switchTab(d.tab); return; }
        if (d.goto) { switchTab(d.goto); return; }
        if (d.gotoPlan) { goToPlan(d.gotoPlan); return; }
        if (d.gotoActivity) { goToActivity(d.gotoActivity); return; }
        if (d.planTab) { planTab = d.planTab; renderPlan(); return; }
        if (d.editTx) { openEditTx(d.editTx); if (d.focus && $(d.focus)) setTimeout(() => { $(d.focus).scrollIntoView({ block: 'center' }); $(d.focus).focus(); }, 380); return; }
        if (d.editGoal) { openEditGoal(d.editGoal); return; }
        if (d.depositGoal) { openDeposit(d.depositGoal); if (d.depositAmount) { $('funds-amount').value = d.depositAmount; updateFundsHint(); } return; }
        if (d.editBudget) { openBudget(d.editBudget); return; }
        if (d.newBudget) { openBudget(); $('budget-category').value = d.newBudget; return; }
        if (d.editBill) { openEditBill(d.editBill); return; }
        if (d.billPaid) { askMarkPaid(`bill:${d.billPaid}`); return; }
        if (d.pay) { askMarkPaid(d.pay); return; }
        if (d.payLater) { openPayLater(d.payLater); return; }
        if (d.action === 'pay-later-carry') { payLater('carry'); return; }
        if (d.action === 'pay-later-skip') { payLater('skip'); return; }
        if (d.action === 'pay-later-move') { payLater('move'); return; }
        if (d.markTimes) {
            const key = markPaidKey;
            markPaidKey = null;
            closeSheet('modal-mark-paid');
            if (key && key.startsWith('bill:')) { markBillPaid(key.slice(5), Number(d.markTimes)); scheduleReminders(); }
            return;
        }
        if (d.editDebt) { openEditDebt(d.editDebt); return; }
        if (d.repayDebt) { openRepay(d.repayDebt); return; }
        if (d.editCategory) { catReturnToTx = false; catReturnToManager = true; openCategoryEditor(d.editCategory); return; }
        if (d.deleteCategory) { deleteCategory(d.deleteCategory); return; }
        if (d.catmanTab) { catManTab = d.catmanTab; renderCategoryManager(); return; }
        if (d.action === 'cat-edit-done') { setCatEditing(false); return; }
        if (d.brandChoose !== undefined) { chooseBrandLogo(d.brandChoose); return; }
        if (d.action === 'pick-brand-logo') { openBrandPick(); return; }
        if (d.action === 'cat-delete-ok') { confirmDeleteCategory(); return; }
        if (d.catColor) { catEditColor = d.catColor; renderCategoryEditor(); return; }
        if (d.catIcon) { catEditIcon = d.catIcon; renderCategoryEditor(); return; }
        if (d.catType) { catEditType = d.catType; if (!$('category-id').value) catEditIcon = catEditType === 'income' ? 'c-OtherIncome' : 'c-Other'; renderCategoryEditor(); return; }
        if (d.txType) { setTxType(d.txType); return; }
        if (d.confirmTx) { askMarkPaid(`tx:${d.confirmTx}`); return; }
        if (d.smsAdd) { smsAdd(d.smsAdd, el); return; }
        if (d.smsIgnore) { smsIgnore(d.smsIgnore, el); return; }
        if (d.smsMatch) { smsConfirmMatch(d.smsMatch, el); return; }
        if (d.smsEdit) { smsEdit(d.smsEdit); return; }
        if (d.smsMove) { smsEdit(d.smsMove, true); return; }
        if (d.bankApp) { toggleBankApp(d.bankApp); return; }
        if (d.bankFix) {
            const pl = smsPlugin();
            if (!pl) return;
            if (d.bankFix === 'check') {
                refreshBankStatus().then((s) => {
                    const ok = s && s.smsPermission === 'granted';
                    const app = s && s.listenerConnected;
                    if (s && s.notifEnabled && (!s.smsEnabled || !ok)) showToast(app ? 'Bank app tracking is connected' : s.notifAccess ? 'Access is allowed; Android is starting Vela’s listener' : 'Notification access is still off', app ? 'success' : 'info');
                    else showToast(ok ? 'SMS access is allowed' : 'SMS access is still off', ok ? 'success' : 'info');
                    // Allowed in App info while tracking was on: start reading bank SMS now.
                    if ((ok && s.smsEnabled) || app) scanSms();
                });
                return;
            }
            (d.bankFix === 'ntf' && pl.openNotificationAccess ? pl.openNotificationAccess() : pl.openAppSettings()).catch(() => {});
            return;
        }
        if (d.activityStatus) { activityStatus = d.activityStatus; renderActivity(); return; }
        if (d.statusFilter) { activityStatus = d.statusFilter; activityType = 'all'; activityCategory = 'all'; activityView = 'list'; switchTab('activity'); return; }
        if (d.txKind) { txKindTouched = true; setTxKind(d.txKind); return; }
        if (d.txStatus) { setTxStatus(d.txStatus === 'waiting'); return; }
        if (d.pick) { const p = txPicks[Number(d.pick)]; if (p) applyPick(p); return; }
        if (d.brandPick) { pickDescBrand(d.brandPick); return; }
        if (d.namePick) { pickName(d); return; }
        if (d.smsPairOnce) { smsPairOnce(d.smsPairOnce); return; }
        if (d.smsPairSplit) { smsPairSplit(d.smsPairSplit); return; }
        if (d.openTrip) { openTrips(d.openTrip); return; }
        if (d.secTemplate) { setupSections(d.secTemplate); return; }
        if (d.action === 'wipe-phone') { wipePhone(); return; }
        if (d.action === 'wipe-everywhere') { wipeEverywhere(); return; }
        if (d.fundIncome) { toggleFundIncomeCat(d.fundIncome); return; }
        if (d.action === 'tx-allocate') {
            const id = $('tx-allocate').dataset.id;
            if ($('tx-allocate').dataset.done === 'true') { undoDivide(id); return; }
            closeSheet('modal-tx');
            setTimeout(() => openDivide(id), 300);
            return;
        }
        if (d.secView) { openSectionView(d.secView); return; }
        if (d.fundAdd) { openSecMove(d.fundAdd, 'add'); return; }
        if (d.fundOut) { openSecMove(d.fundOut, 'out'); return; }
        if (d.fundMore) { openFundActions(d.fundMore); return; }
        if (d.action === 'fund-reset') { openOrSwap('modal-fund-reset'); return; }
        if (d.action === 'fund-reset-empty') { resetFunds('empty'); return; }
        if (d.action === 'fund-reset-all') {
            showConfirm({ title: 'Delete all funds?', message: `All ${plural(secList().length, 'fund')} and their history will be removed. Your entries and account balances stay the same. This can't be undone.`, confirmLabel: 'Delete all funds', onConfirm: () => resetFunds('all') });
            return;
        }
        if (d.fundRepair) { askRepairShort(d.fundRepair === 'all' ? null : d.fundRepair); return; }
        if (d.secDivide) { openDivide(d.secDivide); return; }
        if (d.secSkip) { skipDivide(d.secSkip); return; }
        if (d.secUndo) { undoDivide(d.secUndo); return; }
        if (d.secMode) { secEditMode = d.secMode; renderSectionEditor(); return; }
        if (d.secColor) { secEditColor = d.secColor; renderSectionEditor(); return; }
        if (d.secIcon) { secEditIcon = d.secIcon; renderSectionEditor(); return; }
        if (d.action === 'sec-once') { secEditOnce = !secEditOnce; renderSectionEditor(); return; }
        if (d.txSection !== undefined) { pickTxSection(d.txSection); return; }
        if (d.action === 'sec-new') { openSectionEditor(); return; }
        if (d.action === 'sec-edit') { openSectionEditor(secViewId); return; }
        if (d.action === 'sec-move') { openSecMove(secViewId && openSheets.includes('modal-section-view') ? secViewId : null, 'move'); return; }
        if (d.action === 'sec-add-money') { openSecMove(secViewId && openSheets.includes('modal-section-view') ? secViewId : null, 'add'); return; }
        if (d.action === 'sec-move-ok') { submitSecMove(); return; }
        if (d.action === 'sec-take-out') { openSecMove(secViewId && (openSheets.includes('modal-section-view') || openSheets.includes('modal-fund-actions')) ? secViewId : null, 'out'); return; }
        if (d.fundFix) {
            openSecMove(d.fundId, d.fundFix);
            $('sec-move-amount').value = round2(Number(d.fundAmount));
            // A fund using several accounts: spread the difference over them (free money / what each holds).
            let left = round2(Number(d.fundAmount));
            const por = fundPortions()[d.fundId] || {};
            document.querySelectorAll('[data-split-acc]').forEach((i) => {
                const room = d.fundFix === 'add' ? accountFreeMoney(i.dataset.splitAcc) : Math.max(0, por[i.dataset.splitAcc] || 0);
                const v = round2(Math.max(0, Math.min(left, room)));
                i.value = v > 0 ? v : '';
                left = round2(left - v);
            });
            $('sec-move-split').dispatchEvent(new Event('input'));
            if (d.fundFix === 'add') $('sec-move-note').value = 'Money not in any fund';
            return;
        }
        if (d.fundAction) {
            const id = secViewId;
            if (d.fundAction === 'view') openSectionView(id);
            else if (d.fundAction === 'add') openSecMove(id, 'add');
            else if (d.fundAction === 'out') openSecMove(id, 'out');
            else if (d.fundAction === 'move') openSecMove(id, 'move');
            else if (d.fundAction === 'edit') openSectionEditor(id);
            else if (d.fundAction === 'delete') { openSectionEditor(id); setTimeout(deleteSection, 350); }
            return;
        }
        if (d.action === 'sec-save') { submitSection(); return; }
        if (d.action === 'sec-delete') { deleteSection(); return; }
        if (d.action === 'sec-unassigned') { openUnassigned(); return; }
        if (d.action === 'sec-unassigned-ok') { saveUnassigned(); return; }
        if (d.action === 'divide-ok') { confirmDivide(); return; }
        if (d.divideShare) { setDivideShare(d.divideShare); return; }
        if (d.action === 'budget-toggle') { setBudgetOn(!budgetOn()); return; }
        if (d.recentAll !== undefined) { try { localStorage.setItem('VELA_RECENT_ALL', d.recentAll); } catch (e) { /* storage blocked */ } renderDashboard(); return; }
        if (d.action === 'divide-skip') { if (divideJob) skipDivide(divideJob.incomeId); return; }
        if (d.subPick !== undefined) { pickSubscription(d.subPick); return; }
        if (d.action === 'add-trip') { openTrips(); return; }
        if (d.action === 'add-subscription') { openSubscriptions(); return; }
        if (d.action === 'trip-start') { startTrip(); return; }
        if (d.action === 'trip-end') { endTrip(); return; }
        if (d.action === 'trip-delete') { deleteTrip(); return; }
        if (d.action === 'trip-new') { tripView = null; renderTripSheet(); return; }
        if (d.action === 'trip-add-expense') { openAddTx('expense'); return; }
        if (d.starterPick) { starterPick(d.starterPick); return; }
        if (d.budgetMode) { budgetModeDraft = d.budgetMode; syncBudgetModeUi(); return; }
        if (d.budgetSave !== undefined) { budgetSaveDraft = Number(d.budgetSave); syncBudgetModeUi(); return; }
        if (d.budgetInc !== undefined) { budgetSkipDraft = budgetSkipDraft.includes(d.budgetInc) ? budgetSkipDraft.filter((x) => x !== d.budgetInc) : [...budgetSkipDraft, d.budgetInc]; syncBudgetModeUi(); return; }
        if (d.botChip) { botHandle(d.botChip); return; }
        if (d.botSay) { botHandle(d.botSay); return; }
        if (d.botAdd) { botAdd(d.botAdd, el); return; }
        if (d.botEdit) { botEdit(d.botEdit); return; }
        if (d.botUndo) { botUndo(d.botUndo, el); return; }
        if (d.billType) { setBillType(d.billType); return; }
        if (d.debtDir) { setDebtDir(d.debtDir); return; }
        if (d.fundsMode) { setFundsMode(d.fundsMode); return; }
        if (d.activityType) { activityType = d.activityType; activityCategory = 'all'; renderActivity(); return; }
        if (d.filterCategory) { activityCategory = d.filterCategory; renderActivity(); return; }
        if (d.activityView) { activityView = d.activityView; activityDay = null; renderActivity(); return; }
        if (d.calDay) { activityDay = activityDay === d.calDay ? null : d.calDay; renderActivity(); return; }
        if (d.accountFilter) { activityAccount = d.accountFilter; activityType = 'all'; activityCategory = 'all'; activityView = 'list'; goToActivity('all', true); return; }
        if (d.displayCurrency) { setDisplayCurrency(d.displayCurrency); closeSheet('modal-currency'); return; }
        if (d.addCurrency) { addCurrency(d.addCurrency); return; }
        if (d.removeCurrency) { removeCurrency(d.removeCurrency); return; }
        if (d.editAccount) { openAccountEditor(d.editAccount); return; }
        if (d.smsPickAcc) { pickSmsAccount(d.smsPickAcc); return; }
        if (d.insightsScope) {
            try { localStorage.setItem(INSIGHTS_ALL_KEY, d.insightsScope === 'all' ? '1' : '0'); } catch (e) { /* storage blocked */ }
            renderViewBar();
            renderAnalytics();
            haptic();
            return;
        }
        if (d.hideBalance !== undefined) { if (d.hideBalance && d.hideBalance !== 'all') toggleBalanceHidden(d.hideBalance); else if (d.hideBalance === 'all' || !viewAccountObj()) toggleHideAll(); else toggleBalanceHidden(viewId()); return; }
        if (d.accAction) { accountAction(d.accAction); return; }
        if (d.viewAccount) {
            if (holdFired) { holdFired = false; return; } // the press was a hold: its menu is open
            setViewAccount(d.viewAccount); if (isSheetOpen('modal-accounts')) closeSheet('modal-accounts'); return;
        }
        if (d.lockAfter !== undefined) { setLockAfter(Number(d.lockAfter)); return; }
        if (d.bioMode) { setBioMode(d.bioMode); return; }
        if (d.notifOpen) { openNotif(d.notifOpen); return; }
        if (d.action === 'open-notifs') { openNotifs(); return; }
        if (d.action === 'clear-notifs') { notifLog = []; saveNotifLog(); updateNotifBell(); closeSheet('modal-notifs'); return; }
        if (d.approveNum) { decideSignIn(true, Number(d.approveNum)); return; }
        if (d.action === 'approve-deny') { decideSignIn(false); return; }
        if (d.action === 'approve-cancel') { endApproveWait(false, 'Signed out.'); return; }
        if (d.action === 'approve-resend') { resendApproval(); return; }
        if (d.action === 'approve-use-code') { useCodeInstead(); return; }
        if (d.action === 'toggle-mfa') { toggleMfa(); return; }
        if (d.action === 'mfa-ok') { submitMfa(); return; }
        if (d.action === 'mfa-cancel') { cancelMfa(); return; }
        if (d.deviceRemove) { removeDevice(d.deviceRemove, d.deviceName || 'this phone'); return; }
        if (d.action === 'open-notif-settings') { const pl = smsPlugin(); if (pl) (pl.openNotificationSettings ? pl.openNotificationSettings() : pl.openAppSettings()).catch(() => {}); return; }
        if (d.action === 'switch-account') { if (state.accounts.length > 1) openAccountManager(); return; }
        if (d.themeChoice) { setTheme(d.themeChoice, e); return; }
        if (d.currency) { setDisplayCurrency(d.currency); return; }
        if (el.hasAttribute('data-clear-filters')) {
            activityType = 'all';
            activityCategory = 'all';
            activityAccount = 'all';
            $('activity-search').value = '';
            renderActivity();
            return;
        }
        if (el.hasAttribute('data-close-sheet')) {
            const overlay = el.closest('.sheet-overlay');
            if (overlay) closeSheet(overlay.id);
            return;
        }
        switch (d.action) {
            case 'quick-add': haptic(); openSheet('modal-quick-add'); break;
            case 'add-expense': openAddTx('expense'); break;
            case 'add-income': openAddTx('income'); break;
            case 'add-goal': openAddGoal(); break;
            case 'deposit': openDeposit(); break;
            case 'add-bill': openAddBill(); break;
            case 'add-debt': openAddDebt(); break;
            case 'add-budget': openBudget(); break;
            case 'add-transfer': openTransfer(); break;
            case 'add-account': openAccountEditor(); break;
            case 'open-bot': haptic(); openBot(); break;
            case 'bot-new': newAiChat(); break;
            case 'sync-now': syncNow(el); break;
            case 'budget-from-income': {
                state.config.budgetMode = 'income';
                state.config.budgetSavePct = 0;
                saveState();
                showToast(`Your budget now follows your income: ${formatCurrency(monthStats().budget, dcur())} this month`, 'success');
                renderActive();
                break;
            }
            case 'bot-signin': closeSheet('modal-bot'); setTimeout(() => showAuth(1), 250); break;
            case 'open-accounts': openAccountManager(); break;
            case 'open-currencies': openCurrencySheet(); break;
            case 'pick-receipt': $('tx-receipt-input').click(); break;
            case 'remove-receipt': receiptDraft = { mode: 'remove', blob: null, url: null }; renderReceiptBox(); break;
            case 'view-receipt': openReceiptViewer(); break;
            case 'new-category-inline': catReturnToTx = true; catReturnToManager = false; openCategoryEditor(null, txType); break;
            default: break;
        }
    });

    document.querySelectorAll('.sheet-overlay').forEach((overlay) => {
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSheet(overlay.id); });
    });

    $('btn-confirm-ok').addEventListener('click', () => {
        const handler = confirmHandler;
        closeConfirm();
        if (handler) handler();
    });
    $('btn-confirm-cancel').addEventListener('click', closeConfirm);
    $('modal-confirm').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeConfirm(); });

    document.addEventListener('keydown', (e) => {
        if (isLocked()) {
            if (/^[0-9]$/.test(e.key)) onLockKey(e.key);
            else if (e.key === 'Backspace') onLockKey('del');
            return;
        }
        if (isSheetOpen('modal-pin') && /^[0-9]$/.test(e.key)) { onPinKey(e.key); return; }
        if (isSheetOpen('modal-pin') && e.key === 'Backspace') { onPinKey('del'); return; }
        if (e.key !== 'Escape') return;
        if (!$('receipt-viewer').hidden) { closeReceiptViewer(); return; }
        if (isConfirmOpen()) { closeConfirm(); return; }
        const top = openSheets[openSheets.length - 1];
        if (top) closeSheet(top);
    });

    window.addEventListener('popstate', (e) => {
        if (isConfirmOpen()) closeConfirm();
        if (openSheets.length) { hideSheet(openSheets[openSheets.length - 1]); return; }
        const st = e.state;
        if (st && st.tab && st.tab !== currentTab) switchTab(st.tab, { fromHistory: true });
    });

    $('theme-toggle-btn').addEventListener('click', (e) => setTheme(state.config.theme === 'dark' ? 'light' : 'dark', e));
    $('rate-chip').addEventListener('click', () => {
        switchTab('settings');
        setTimeout(() => { const b = $('setting-rate-block'); if (b) b.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60);
    });

    let ticking = false;
    window.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => { $('appbar').classList.toggle('is-scrolled', window.scrollY > 4); ticking = false; });
    }, { passive: true });

    $('tx-form').addEventListener('submit', (e) => { e.preventDefault(); submitTx(); });
    $('goal-form').addEventListener('submit', (e) => { e.preventDefault(); submitGoal(); });
    $('funds-form').addEventListener('submit', (e) => { e.preventDefault(); submitFunds(); });
    $('budget-form').addEventListener('submit', (e) => { e.preventDefault(); submitBudget(); });
    $('bill-form').addEventListener('submit', (e) => { e.preventDefault(); submitBill(); });
    $('debt-form').addEventListener('submit', (e) => { e.preventDefault(); submitDebt(); });
    $('repay-form').addEventListener('submit', (e) => { e.preventDefault(); submitRepay(); });
    $('category-form').addEventListener('submit', (e) => { e.preventDefault(); submitCategory(); });
    $('btn-delete-tx').addEventListener('click', () => deleteTx($('tx-id').value));
    $('btn-delete-goal').addEventListener('click', () => deleteGoal($('goal-id').value));
    $('btn-delete-budget').addEventListener('click', deleteBudget);
    $('btn-delete-bill').addEventListener('click', () => deleteBill($('bill-id').value));
    $('btn-delete-debt').addEventListener('click', () => deleteDebt($('debt-id').value));
    $('btn-delete-category').addEventListener('click', () => deleteCategory($('category-id').value, () => {
        if (catReturnToTx) { catReturnToTx = false; const keep = document.querySelector('input[name="tx-category"]:checked'); buildCategoryPicker(txType, keep && keep.value); }
    }));
    initCategoryHold();
    $('brand-pick-search').addEventListener('input', renderBrandPick);
    $('btn-repay-all').addEventListener('click', () => {
        const d = state.debts.find((x) => x.id === $('repay-id').value);
        if (d) $('repay-amount').value = round2(d.amount - d.repaid);
    });
    $('bill-auto').addEventListener('click', (e) => setSwitch(e.currentTarget, !isOn(e.currentTarget)));
    $('funds-goal').addEventListener('change', () => {
        const goal = state.savings.find((g) => g.id === $('funds-goal').value);
        if (goal) fillCurrencySelect($('funds-currency'), goal.currency);
        updateFundsHint();
    });
    $('funds-currency').addEventListener('change', updateFundsHint);
    $('btn-manage-categories').addEventListener('click', openCategoryManager);
    $('btn-add-category').addEventListener('click', () => { catReturnToTx = false; catReturnToManager = true; openCategoryEditor(); });

    let searchTimer = null;
    $('activity-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderActivity, 140); });
    $('month-prev').addEventListener('click', () => {
        const d = new Date(activityMonth.y, activityMonth.m - 1, 1);
        activityMonth = { y: d.getFullYear(), m: d.getMonth() };
        renderActivity();
    });
    $('month-next').addEventListener('click', () => {
        const d = new Date(activityMonth.y, activityMonth.m + 1, 1);
        if (d > new Date()) return;
        activityMonth = { y: d.getFullYear(), m: d.getMonth() };
        renderActivity();
    });

    document.querySelectorAll('.chart-time-btn').forEach((btn) => btn.addEventListener('click', () => {
        dashboardRange = btn.dataset.range;
        setPressed('.chart-time-btn', (b) => b === btn);
        renderTrendChart();
    }));
    document.querySelectorAll('.range-btn').forEach((btn) => btn.addEventListener('click', () => {
        analyticsRange = btn.dataset.analyticsRange;
        renderAnalytics();
    }));

    $('btn-save-rate').addEventListener('click', () => {
        const cur = $('setting-rate-currency').value;
        const value = toNumber($('setting-rate').value, NaN);
        if (!(value > 0)) { fieldError($('setting-rate'), `Enter how many ${cur} one US dollar buys, like ${formatRate(rateFor(cur))}.`); return; }
        state.config.rateOverrides[cur] = value;
        saveState();
        setRateStatus(rateStatus);
        renderActive();
        showToast(`Using your rate: 1 USD = ${formatRate(value)} ${cur}`, 'success');
    });
    $('setting-rate-currency').addEventListener('change', () => { $('setting-rate').value = formatRate(rateFor($('setting-rate-currency').value)); renderRateSetting(); });
    $('currency-btn').addEventListener('click', openCurrencySheet);
    $('activity-account').addEventListener('change', (e) => { activityAccount = e.target.value; renderActivity(); });
    $('account-form').addEventListener('submit', (e) => { e.preventDefault(); submitAccount(); });
    $('btn-delete-account').addEventListener('click', () => deleteAccount($('account-id').value));
    $('transfer-form').addEventListener('submit', (e) => { e.preventDefault(); submitTransfer(); });
    $('btn-delete-transfer').addEventListener('click', () => deleteTransfer($('transfer-id').value));
    ['transfer-from', 'transfer-to'].forEach((id) => $(id).addEventListener('change', updateTransferFields));
    $('transfer-amount').addEventListener('input', () => updateTransferFields(true));
    $('tx-account').addEventListener('change', () => {
        renderTxSuggest();
        updatePriceHint();
    });
    $('tx-currency').addEventListener('change', () => { renderTxSuggest(); updatePriceHint(); updateChargedRow(); });
    $('tx-charged').addEventListener('input', () => { txChargedTouched = true; updateChargedRow(); });
    $('tx-desc').addEventListener('input', (e) => { if (e.isTrusted) $('tx-desc').dataset.typing = '1'; onTxDescInput(); });
    $('account-name').addEventListener('input', () => { updateAccountNameLogo(); accountFeeHint(state.accounts.find((x) => x.id === $('account-id').value)); });
    Object.keys(NAME_BOXES).forEach((key) => {
        const input = $(NAME_BOXES[key].input);
        input.addEventListener('input', () => renderNameBox(key));
        input.addEventListener('focus', () => renderNameBox(key));
        input.addEventListener('blur', () => setTimeout(() => { $(NAME_BOXES[key].box).hidden = true; }, 200));
    });
    initAccountHold();
    updateNotifBell();
    $('switch-approval').addEventListener('click', toggleApproval);
    $('switch-secure-screen').addEventListener('click', toggleSecureScreen);
    initFundHold();
    initTxHold();
    ['sec-move-from', 'sec-move-to'].forEach((id) => $(id).addEventListener('change', () => { updateSecMoveHint(); renderSecSplit(); updateAllFreeBtn(); }));
    $('sec-move-all').addEventListener('click', fillAllFree);
    $('sec-move-split').addEventListener('input', (e) => {
        if (e.target && e.target.id === 'sec-split-all') {
            const parts = splitByShares(secMoveFund(), round2(Math.max(0, toNumber(e.target.value, 0))));
            document.querySelectorAll('[data-split-acc]').forEach((i) => { const v = parts[i.dataset.splitAcc]; i.value = v > 0 ? v : ''; });
        }
        const t = [...document.querySelectorAll('[data-split-acc]')].reduce((a, i) => a + Math.max(0, toNumber(i.value, 0)), 0);
        if ($('sec-split-total')) $('sec-split-total').textContent = formatCurrency(t, dcur());
    });
    ['section-name', 'section-value'].forEach((id) => $(id).addEventListener('input', updateSectionPreview));
    $('goal-name').addEventListener('change', () => { const v = $('goal-fund').value; const g = state.savings.find((x) => x.id === $('goal-id').value); fillGoalFundSelect(g); if (v) $('goal-fund').value = v; });
    ['goal-target', 'goal-saved', 'goal-deadline', 'goal-monthly', 'goal-currency'].forEach((id) => $(id).addEventListener(id === 'goal-deadline' || id === 'goal-currency' ? 'change' : 'input', updateGoalMonthlyHint));
    $('goal-monthly-suggest').addEventListener('click', () => { $('goal-monthly').value = $('goal-monthly-suggest').dataset.v; updateGoalMonthlyHint(); });
    $('section-accounts').addEventListener('change', renderSectionShares);
    $('section-shares').addEventListener('input', updateShareTotal);
    $('section-value').addEventListener('input', updateShareTotal);
    $('modal-divide').addEventListener('input', (e) => {
        const a = e.target.dataset.secAlloc;
        if (a && divideJob) { divideJob.alloc[a] = Math.max(0, toNumber(e.target.value, 0)); updateDivideLeft(); }
    });
    $('divide-keep').addEventListener('click', () => { divideKeepRest = !divideKeepRest; updateDivideLeft(); });
    $('divide-custom').addEventListener('input', () => { if (!divideJob) return; divideJob.base = Math.min(divideJob.total, Math.max(0, toNumber($('divide-custom').value, 0))); divideJob.alloc = planSplit(divideNumbers().pool).split; const keep = $('divide-custom').value; renderDivide(); $('divide-custom').value = keep; });
    $('modal-divide').addEventListener('change', (e) => {
        const c = e.target.dataset.secCarry;
        if (c && divideJob) {
            divideJob.carry[c] = e.target.value;
            // What's left to divide changed (a section below zero may need less): split again by the plan.
            divideJob.alloc = planSplit(divideNumbers().pool).split;
            renderDivide();
        }
    });
    $('tx-trip').addEventListener('click', () => { txTripId = txTripId ? null : $('tx-trip').dataset.trip; updateTripRow(); });
    $('tx-before').addEventListener('click', () => { txBefore = !txBefore; txBeforeTouched = true; updateBeforeRow(); });
    $('tx-amount').addEventListener('input', () => { resetTxCover(); if (!$('tx-parts-row').hidden) updatePartsRow(); });
    $('tx-desc').addEventListener('change', () => { if (!$('tx-parts-row').hidden) updatePartsRow(); });
    $('tx-inbudget').addEventListener('click', () => { txInBudget = !isOn($('tx-inbudget')); updateInBudgetRow(); });
    document.addEventListener('change', (e) => { if (e.target && e.target.name === 'tx-category') updateInBudgetRow(); });
    $('tx-date').addEventListener('change', updateBeforeRow);
    $('tx-time').addEventListener('change', updateBeforeRow);
    $('tx-account').addEventListener('change', () => { updateBeforeRow(); txChargedTouched = false; updateChargedRow(); renderTxSections(); });
    $('tx-date').addEventListener('change', () => { if (!$('tx-id').value && txType === 'expense') { txTripId = tripIdFor($('tx-date').value); updateTripRow(); } });
    $('mfa-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitMfa(); } });
    setInterval(pollSignInRequests, 8000);
    $('tx-logo-add').addEventListener('click', pickShopLogo);
    $('tx-logo-remove').addEventListener('click', removeShopLogo);
    $('shop-logo-input').addEventListener('change', onShopLogoPicked);
    $('account-kind').addEventListener('change', () => { accountKindTouched = true; });
    $('account-currency').addEventListener('change', () => accountFeeHint(state.accounts.find((x) => x.id === $('account-id').value)));
    document.addEventListener('change', (e) => {
        if (e.target && ACCOUNT_SELECTS.includes(e.target.id)) syncAccountLogos();
        // The account picked on a detected transaction (remembered for its card number when added).
        const smsAcc = e.target && e.target.dataset && e.target.dataset.smsAcc;
        if (smsAcc) {
            const i = smsQueue.find((x) => x.id === smsAcc);
            if (i && e.target.value) { i.accountId = e.target.value; e.target.closest('.sms-acc-select').classList.remove('is-undecided'); }
        }
    });
    $('tx-desc').addEventListener('blur', () => setTimeout(() => { delete $('tx-desc').dataset.typing; updateDescLogo(); }, 200));
    $('tx-date').addEventListener('input', updateDateHint);
    $('tx-repeat').addEventListener('click', (e) => setSwitch(e.currentTarget, !isOn(e.currentTarget)));
    $('budget-category').addEventListener('change', syncBudgetModeUi);
    $('tx-date').addEventListener('change', updateDateHint);
    $('tx-amount').addEventListener('input', () => { updatePriceHint(); updateChargedRow(); });
    $('tx-category-picker').addEventListener('change', () => { txCatTouched = true; syncTxSectionToCategory(); });
    $('bot-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const v = $('bot-input').value;
        $('bot-input').value = '';
        botHandle(v);
    });
    $('tx-receipt-input').addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) pickReceipt(file);
        e.target.value = '';
    });
    $('btn-close-viewer').addEventListener('click', closeReceiptViewer);
    $('receipt-viewer').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeReceiptViewer(); });
    $('btn-resend-email').addEventListener('click', (e) => withBusy(e.currentTarget, resendConfirmation));
    $('btn-sync-rate').addEventListener('click', (e) => withBusy(e.currentTarget, () => fetchLiveExchangeRate({ manual: true })));

    $('switch-lock').addEventListener('click', () => openPinFlow(state.config.lock.enabled ? 'disable' : 'set'));
    $('btn-change-pin').addEventListener('click', () => openPinFlow('change'));
    $('switch-biometric').addEventListener('click', toggleBiometric);
    $('switch-reminders').addEventListener('click', (e) => enableReminders(!isOn(e.currentTarget)));
    $('switch-sms').addEventListener('click', (e) => enableSmsTracking(!isOn(e.currentTarget)));
    $('switch-ntf').addEventListener('click', (e) => enableNotifTracking(!isOn(e.currentTarget)));
    $('tx-share').addEventListener('change', onShareChange);
    document.addEventListener('input', (e) => {
        const box = e.target.closest && e.target.closest('[data-sms-charged]');
        if (!box) return;
        const v = toNumber(box.value, NaN);
        if (v > 0) smsCharged[box.dataset.smsCharged] = round2(v); else delete smsCharged[box.dataset.smsCharged];
    });
    $('switch-sms-auto').addEventListener('click', (e) => {
        const on = !isOn(e.currentTarget);
        const q = smsPrefs(); q.autoAdd = on; saveSmsPrefs(q);
        setSwitch(e.currentTarget, on);
        showToast(on ? 'Confident bank transactions will be added automatically. Anything unclear still asks you.' : 'Vela will ask before adding every bank transaction.', 'success');
    });
    $('btn-sms-paste').addEventListener('click', openSmsPaste);
    $('switch-bank-pause').addEventListener('click', (e) => setBankPaused(!isOn(e.currentTarget)));
    $('btn-bank-delete').addEventListener('click', deleteDetectionRecords);
    $('btn-bank-disconnect').addEventListener('click', disconnectBank);
    $('btn-bank-review').addEventListener('click', showSmsSheet);
    $('btn-sms-check').addEventListener('click', checkPastedSms);
    // "Add all" only takes confident messages; anything that needs a check stays for review.
    $('btn-sms-ignore-all').addEventListener('click', () => {
        const n = smsQueue.length;
        if (!n) return;
        showConfirm({
            title: `Ignore ${plural(n, 'transaction', 'transactions')}?`,
            message: 'None of them will be added. You can still add any of them yourself later.',
            confirmLabel: 'Ignore all',
            onConfirm: () => smsHandled(smsQueue.map((i) => i.id))
        });
    });
    $('btn-sms-all').addEventListener('click', () => { [...smsQueue].filter(smsAddAllReady).forEach((i) => (smsMatchFor(i) ? smsConfirmMatch(i.id) : smsAdd(i.id))); });
    $('btn-forgot-pin').addEventListener('click', forgotPin);

    $('btn-report-pdf').addEventListener('click', (e) => withBusy(e.currentTarget, exportPdf));
    $('btn-export-csv').addEventListener('click', (e) => withBusy(e.currentTarget, exportCsv));
    $('btn-export-data').addEventListener('click', (e) => withBusy(e.currentTarget, exportBackup));
    $('btn-import-trigger').addEventListener('click', () => $('file-import').click());
    $('file-import').addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) importBackup(file);
        e.target.value = '';
    });
    $('btn-wipe-data').addEventListener('click', wipeData);

    $('profile-avatar-click-zone').addEventListener('click', () => $('profile-avatar-input').click());
    $('profile-avatar-input').addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) handleAvatarUpload(file);
        e.target.value = '';
    });
    $('btn-save-profile').addEventListener('click', (e) => withBusy(e.currentTarget, saveProfileChanges));
    $('profile-username').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('btn-save-profile').click(); } });
    $('btn-auth-logout').addEventListener('click', handleSignOut);
    $('btn-delete-my-account').addEventListener('click', deleteMyAccount);

    $('btn-toggle-signin').addEventListener('click', () => setAuthMode('signin'));
    $('btn-toggle-signup').addEventListener('click', () => setAuthMode('signup'));
    $('form-signin').addEventListener('submit', (e) => {
        e.preventDefault();
        const email = $('signin-email').value.trim();
        const password = $('signin-password').value;
        if (!/\S+@\S+\.\S+/.test(email)) { fieldError($('signin-email'), 'Enter the email you signed up with.'); return; }
        if (!password) { fieldError($('signin-password'), 'Enter your password.'); return; }
        withBusy($('btn-submit-signin'), () => handleSignIn(email, password));
    });
    $('form-signup').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = $('signup-name').value.trim();
        const email = $('signup-email').value.trim();
        const password = $('signup-password').value;
        if (!name) { fieldError($('signup-name'), 'Enter your name.'); return; }
        if (!/\S+@\S+\.\S+/.test(email)) { fieldError($('signup-email'), 'Enter a valid email address.'); return; }
        if (password.length < 6) { fieldError($('signup-password'), 'Use a password with at least 6 characters.'); return; }
        withBusy($('btn-submit-signup'), () => handleSignUp(email, password, name));
    });
    $('btn-google-login').addEventListener('click', (e) => withBusy(e.currentTarget, handleGoogleSignIn));
    $('btn-skip-auth').addEventListener('click', handleGuest);
    document.querySelectorAll('.btn-onboard-next').forEach((b) => b.addEventListener('click', () => goToStep(Number(b.dataset.nextStep))));
    document.querySelectorAll('.btn-onboard-prev').forEach((b) => b.addEventListener('click', () => goToStep(Number(b.dataset.prevStep))));
    $('btn-complete-onboarding').addEventListener('click', completeOnboarding);

    window.addEventListener('online', () => { flushSync().then(updateUserProfileUI); fetchLiveExchangeRate(); });
    setInterval(() => { if (pendingCount() && !document.hidden) flushSync().then(() => { if (currentTab === 'settings') updateUserProfileUI(); }); }, 60000);
    window.addEventListener('offline', () => {
        setRateStatus('offline');
        showToast("You're offline. Changes are saved on this device.", 'info');
    });
    document.addEventListener('visibilitychange', () => {
        if (isNative()) return; // the native app uses pause/resume
        if (document.visibilityState === 'hidden') onAppHidden();
        else onAppVisible();
    });
};

/* =========================================================================
   33. Currencies sheet
   ========================================================================= */
const renderCurrencySheet = () => {
    const mine = myCurrencies();
    const others = Object.keys(CURRENCIES).filter((c) => !mine.includes(c));
    const row = (c) => `<li class="cur-row">
        <button type="button" class="row-btn" data-display-currency="${c}" aria-pressed="${c === dcur()}">
            <span class="cur-code">${c}</span>
            <span class="row-label"><span>${escapeHtml(CURRENCIES[c].name)}</span><span>${c === 'USD' ? 'Base currency for rates' : `1 USD = ${formatRate(rateFor(c))} ${c}`}</span></span>
            ${c === dcur() ? `<span class="cur-check">${icon('i-check')}</span>` : ''}
        </button>
        ${mine.length > 1 && c !== dcur() ? `<button type="button" class="icon-btn" data-remove-currency="${c}" aria-label="Stop using ${escapeHtml(CURRENCIES[c].name)}">${icon('i-x')}</button>` : ''}
    </li>`;
    $('currency-body').innerHTML = `
        <p class="card-sub">Tap a currency to show all amounts in it. Entries keep the currency you logged them in.</p>
        <ul class="cat-manage">${mine.map(row).join('')}</ul>
        ${others.length ? `<div class="section-head"><h2>Add a currency</h2></div>
        <ul class="cat-manage">${others.map((c) => `<li><button type="button" class="row-btn" data-add-currency="${c}"><span class="cur-code">${c}</span><span class="row-label"><span>${escapeHtml(CURRENCIES[c].name)}</span></span>${icon('i-plus', 'ic chev')}</button></li>`).join('')}</ul>` : ''}`;
};

const openCurrencySheet = () => {
    renderCurrencySheet();
    openOrSwap('modal-currency');
};

const addCurrency = (c) => {
    if (!isCurrency(c) || state.config.currencies.includes(c)) return;
    state.config.currencies.push(c);
    state.syncSettings = true;
    saveState();
    flushSync();
    renderCurrencySheet();
    showToast(`${CURRENCIES[c].name} added. You can now log entries in ${c}.`, 'success');
    if (!state.config.rates[c]) fetchLiveExchangeRate();
    renderActive();
};

const removeCurrency = (c) => {
    if (c === dcur() || myCurrencies().length < 2) return;
    state.config.currencies = state.config.currencies.filter((x) => x !== c);
    state.syncSettings = true;
    saveState();
    flushSync();
    renderCurrencySheet();
    showToast(`${c} removed from your list. Entries already in ${c} keep it.`, 'success');
    renderActive();
};

/* =========================================================================
   34. Accounts and transfers
   ========================================================================= */
// The account form: the bank's logo shows inside the name box as soon as the name matches one ("Boc" -> BOC).
// A bank, card or wallet name also picks the matching type, until the person picks one themselves.
let accountKindTouched = false;
// The foreign purchase charge: automatic from the bank's own published charge when Vela knows the bank (from the
// account name), else the typical one; what you type, or what Vela learns from your bank SMS, wins.
const accountFeeHint = (a) => {
    const draft = { name: $('account-name').value, kind: $('account-kind').value || 'bank', currency: $('account-currency').value || dcur() };
    const bank = accountBankName(draft);
    const pub = bankFxFee(draft);
    const auto = pub ?? FX_FEE_TYPICAL[draft.currency] ?? 3;
    $('account-fee').placeholder = String(auto);
    $('account-fee-hint').textContent = a && fxFeeLearned(a) && String($('account-fee').value) === String(a.fxFee)
        ? `Set to ${a.fxFee}% (learned from what your bank charged, or typed in). Clear it to go back to automatic.`
        : pub !== undefined
            ? `Automatic: ${pub}%, ${bank}'s own published charge for foreign card payments. Leave it empty; change it only if your card's charge is different. Vela also learns it from your bank SMS.`
            : `Automatic: ${auto}%, the usual charge for ${draft.currency} cards${bank ? ` (${bank} doesn't publish its own)` : ''}. Leave it empty; Vela learns your bank's real charge from its SMS, or type it if you know it.`;
};
const updateAccountNameLogo = () => {
    const b = accountBrand({ name: $('account-name').value });
    $('account-name-logo').innerHTML = b ? brandBadge(b, ' is-field') : '';
    $('account-name-wrap').classList.toggle('has-brand', !!b);
    if (b && b.cat === null && !accountKindTouched && !$('account-id').value) {
        $('account-kind').value = /frimi|ez ?cash|mcash/i.test(b.name) ? 'mobile' : 'bank';
    }
};
// Hold an account card: Edit, Hide or show its balance, Delete.
let holdFired = false;
let holdAccountId = null;
const openAccountActions = (id) => {
    const a = state.accounts.find((x) => x.id === id);
    if (!a) return;
    holdAccountId = id;
    $('acc-actions-title').textContent = a.name;
    $('acc-actions-sub').textContent = balanceHidden(id) ? 'Balance hidden' : formatCurrency(accountBalance(a), a.currency);
    $('acc-action-hide').innerHTML = `${icon(balanceHidden(id) ? 'i-eye' : 'i-eye-off', 'ic')}<span>${balanceHidden(id) ? 'Show balance' : 'Hide balance'}</span>`;
    $('acc-action-delete').hidden = state.accounts.length < 2;
    haptic('MEDIUM');
    openSheet('modal-acc-actions');
};
const accountAction = (what) => {
    const id = holdAccountId;
    closeSheet('modal-acc-actions');
    if (!id) return;
    setTimeout(() => {
        if (what === 'edit') openAccountEditor(id);
        else if (what === 'hide') toggleBalanceHidden(id);
        else if (what === 'delete') deleteAccount(id);
    }, 260);
};
const initAccountHold = () => {
    let timer = null;
    let startX = 0;
    let startY = 0;
    const strip = $('account-strip');
    if (!strip) return;
    strip.addEventListener('pointerdown', (e) => {
        const chip = e.target.closest('[data-hold-account]');
        if (!chip) return;
        holdFired = false;
        startX = e.clientX; startY = e.clientY;
        clearTimeout(timer);
        timer = setTimeout(() => { holdFired = true; openAccountActions(chip.dataset.holdAccount); }, 520);
    });
    const cancel = () => clearTimeout(timer);
    strip.addEventListener('pointerup', cancel);
    strip.addEventListener('pointercancel', cancel);
    strip.addEventListener('pointerleave', cancel);
    strip.addEventListener('pointermove', (e) => { if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) clearTimeout(timer); });
    strip.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-hold-account]')) e.preventDefault(); });
};
// Two-step verification with a code from an authenticator app (Supabase MFA, TOTP).
let mfaGate = null;
const mfaReady = () => !!(supabaseClient && supabaseClient.auth && supabaseClient.auth.mfa);
const mfaFactor = async () => {
    if (!mfaReady()) return null;
    try { const { data } = await supabaseClient.auth.mfa.listFactors(); return ((data && data.totp) || []).find((f) => f.status === 'verified') || null; } catch (e) { return null; }
};
const needsMfaCode = async () => {
    if (!mfaReady()) return false;
    let level;
    try { level = (await supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel()).data; } catch (e) { return false; }
    return !!level && level.nextLevel === 'aal2' && level.currentLevel !== 'aal2';
};
const askMfaCode = async () => {
    const factor = await mfaFactor();
    if (!factor) return true;
    return new Promise((resolve) => {
        mfaGate = { mode: 'login', factorId: factor.id, resolve };
        showMfaSheet();
    });
};
const showMfaSheet = () => {
    const g = mfaGate;
    if (!g) return;
    const enrol = g.mode === 'enrol';
    $('mfa-title').textContent = enrol ? 'Turn on two-step verification' : 'Enter your code';
    $('mfa-intro').textContent = enrol
        ? 'Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator…), then type the 6-digit code it shows.'
        : 'Open your authenticator app and type the 6-digit code for Vela.';
    $('mfa-setup').hidden = !enrol;
    if (enrol) { $('mfa-qr').src = g.qr; $('mfa-secret').textContent = g.secret; }
    $('mfa-code').value = '';
    $('btn-mfa-cancel').textContent = g.mode === 'login' ? 'Sign out' : 'Cancel';
    openOrSwap('modal-mfa');
    setTimeout(() => $('mfa-code').focus(), 350);
};
const submitMfa = async () => {
    const g = mfaGate;
    const code = $('mfa-code').value.replace(/\D/g, '');
    if (!g) return;
    if (code.length !== 6) { fieldError($('mfa-code'), 'Type the 6 digits from your authenticator app.'); return; }
    await withBusy($('btn-mfa-ok'), async () => {
        const { error } = await supabaseClient.auth.mfa.challengeAndVerify({ factorId: g.factorId, code });
        if (error) { fieldError($('mfa-code'), 'That code didn’t work. Check the time on your phone and try the newest code.'); return; }
        if (g.mode === 'approve') {
            // The code proves it's you, so the server lets this phone in without the other phone.
            const err = await approveWithCode();
            if (err) { fieldError($('mfa-code'), approveCodeError(err)); return; }
        }
        mfaGate = null;
        closeSheet('modal-mfa');
        if (g.mode === 'enrol') { showToast('Two-step verification is on', 'success'); renderSettings(); }
        if (g.mode === 'approve') endApproveWait(true, null, 'code');
        if (g.resolve) g.resolve(true);
    });
};
const cancelMfa = async () => {
    const g = mfaGate;
    mfaGate = null;
    closeSheet('modal-mfa');
    if (!g || g.mode === 'approve') return; // back to waiting for the other phone
    if (g.mode === 'enrol') { try { await supabaseClient.auth.mfa.unenroll({ factorId: g.factorId }); } catch (e) { /* not finished: nothing to keep */ } return; }
    if (g.resolve) g.resolve(false);
    try { await supabaseClient.auth.signOut(); } catch (e) { /* offline */ }
    resetToSignedOut();
    showToast('Signed out: the code is needed to open this account.', 'info');
};
// Lets this phone in with the authenticator code. Fixes the two usual hiccups by itself: the phone not
// registered on the server yet, and the server not seeing the code's stronger sign-in yet.
const approveWithCode = async () => {
    const once = () => { const k = deviceKey(); return deviceRpc('vela_approve_with_code', { p_device: k.id, p_secret: k.secret }); };
    try { await once(); return null; } catch (e1) {
        const m = String((e1 && (e1.message || e1.code)) || '');
        try {
            if (/unknown device/i.test(m)) { await deviceCheck(); await once(); return null; }
            if (/authenticator code needed|aal/i.test(m)) { await supabaseClient.auth.refreshSession(); await once(); return null; }
        } catch (e2) { return e2; }
        return e1;
    }
};
const approveCodeError = (e) => {
    const m = String((e && (e.message || '')) || '');
    const code = String((e && e.code) || '');
    if (code === 'PGRST202' || code === '42883' || /could not find the function|does not exist/i.test(m)) return 'The code is right, but the Vela server doesn’t have the code check yet. In Supabase › SQL Editor, run device-approval.sql once more (it adds it), then type the newest code again.';
    if (/authenticator code needed|aal/i.test(m)) return 'The code is right, but the server didn’t see it yet. Wait 30 seconds and type the newest code.';
    if (/unknown device/i.test(m)) return 'The server doesn’t know this phone yet. Close this, sign in again, then use the code.';
    if (/not signed in|jwt|401/i.test(m)) return 'You were signed out while typing. Sign in again, then use the code.';
    return `The code is right, but the server said: ${m || code || 'unknown error'}`;
};
const useCodeInstead = async () => {
    const factor = await mfaFactor();
    if (!factor) { showToast('Turn on two-step verification in Settings first.', 'info'); return; }
    mfaGate = { mode: 'approve', factorId: factor.id };
    showMfaSheet();
};
const toggleMfa = async () => {
    if (!canSync()) { showToast('Sign in to Vela first.', 'info'); return; }
    const factor = await mfaFactor();
    if (factor) {
        showConfirm({
            title: 'Turn off two-step verification?',
            message: 'Signing in will no longer ask for a code from your authenticator app.',
            confirmLabel: 'Turn off',
            onConfirm: async () => {
                const { error } = await supabaseClient.auth.mfa.unenroll({ factorId: factor.id });
                if (error) { showToast('Couldn’t turn it off. Sign out and in again (with your code), then try.', 'error'); return; }
                showToast('Two-step verification is off', 'info');
                renderSettings();
            }
        });
        return;
    }
    const { data, error } = await supabaseClient.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Vela ${new Date().toISOString().slice(0, 10)}` });
    if (error || !data) { showToast(`Couldn’t start it: ${(error && error.message) || 'try again'}`, 'error'); return; }
    mfaGate = { mode: 'enrol', factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
    showMfaSheet();
};
const updateMfaRow = async () => {
    const row = $('btn-mfa');
    if (!row) return;
    row.hidden = !canSync() || !mfaReady();
    if (row.hidden) return;
    const on = !!(await mfaFactor());
    $('mfa-state').textContent = on ? 'On' : 'Off';
    $('mfa-state').dataset.on = String(on);
};
// Settings: approve-new-sign-ins switch and the list of your phones.
let devicesAt = 0;
let approvalOn = false;
const renderDevices = async (force = false) => {
    const row = $('approval-row');
    if (!row) return;
    if (!canSync() || !supabaseClient || typeof supabaseClient.rpc !== 'function') { row.hidden = true; return; }
    if (!force && Date.now() - devicesAt < 5000) return;
    devicesAt = Date.now();
    row.hidden = false;
    let devices = [];
    try {
        const set = await supabaseClient.from('vela_device_settings').select('require_approval').maybeSingle();
        if (set.error) throw set.error;
        approvalOn = !!(set.data && set.data.require_approval);
        const list = await supabaseClient.from('vela_devices').select('device_id, name, approved, last_seen').order('last_seen', { ascending: false });
        if (list.error) throw list.error;
        devices = list.data || [];
    } catch (e) {
        $('approval-desc').textContent = 'Needs a one-time setup on the Vela server first (supabase/device-approval.sql).';
        $('switch-approval').disabled = true;
        $('device-list').innerHTML = '';
        return;
    }
    $('switch-approval').disabled = false;
    $('approval-desc').textContent = 'A new phone signing in to your account needs OK from a phone you already use.';
    setSwitch($('switch-approval'), approvalOn);
    const me = deviceKey().id;
    $('device-list').innerHTML = approvalOn ? devices.map((d) => {
        const mine = d.device_id === me;
        const tag = mine ? 'This phone' : d.approved ? 'Approved' : 'Not approved';
        return `<li class="device-row">
            <span class="row-icon tint">${icon('i-lock')}</span>
            <span class="row-label"><span>${escapeHtml(d.name || 'Phone')}</span><span>${tag} · ${escapeHtml(relTime(new Date(d.last_seen).getTime()))}</span></span>
            ${mine ? '' : `<button type="button" class="btn btn-secondary btn-sm" data-device-remove="${escapeHtml(d.device_id)}" data-device-name="${escapeHtml(d.name || 'Phone')}">Remove</button>`}
        </li>`;
    }).join('') : '';
};
const toggleApproval = () => {
    if ($('switch-approval').disabled) return;
    const k = deviceKey();
    const turnOn = !approvalOn;
    const apply = async () => {
        try {
            if (turnOn) await deviceCheck();
            await deviceRpc('vela_set_approval', { p_on: turnOn, p_device: k.id, p_secret: k.secret });
            showToast(turnOn ? 'On: new sign-ins need OK from this phone' : 'Off: sign-ins don’t need approval', turnOn ? 'success' : 'info');
        } catch (e) {
            showToast('Couldn’t change it. Check the internet and try again.', 'error');
        }
        renderDevices(true);
    };
    if (!turnOn) { apply(); return; }
    showConfirm({
        title: 'Approve new sign-ins?',
        message: 'From now on, when anyone signs in to your Vela account on another phone, this phone shows "Is this you?" and they can only get in if you tap the right number. Your other phones will need your OK once too.',
        confirmLabel: 'Turn on',
        danger: false,
        onConfirm: apply
    });
};
const removeDevice = (id, name) => {
    showConfirm({
        title: `Remove ${name}?`,
        message: 'It will have to be approved again from this phone before it can open your Vela account.',
        confirmLabel: 'Remove',
        onConfirm: async () => {
            const k = deviceKey();
            try { await deviceRpc('vela_remove_device', { p_target: id, p_device: k.id, p_secret: k.secret }); showToast(`${name} removed`, 'info'); } catch (e) { showToast('Couldn’t remove it. Check the internet and try again.', 'error'); }
            renderDevices(true);
        }
    });
};
const renderAccountManager = () => {
    const v = viewId();
    const tick = (on) => (on ? `<span class="acc-current" aria-label="Showing now">${icon('i-check', 'ic ic-sm')}</span>` : '');
    $('accounts-body').innerHTML = `<p class="acc-hint">Tap an account to see only it, or All accounts to see everything together. Tap the pencil to edit.</p><ul class="cat-manage acc-list">${state.accounts.length > 1 ? `<li class="acc-row${v === 'all' ? ' is-current' : ''}"><button type="button" class="row-btn" data-view-account="all"><span class="row-icon tint">${icon('i-wallet')}</span><span class="row-label"><span>All accounts</span><span>Everything together</span></span><span class="amount ${!hideAll && netWorth() < 0 ? 'text-expense' : ''}">${escapeHtml(hideAll ? maskedMoney() : formatCurrency(netWorth(), dcur()))}</span>${tick(v === 'all')}</button><button type="button" class="icon-btn acc-edit" data-hide-balance="all" aria-pressed="${hideAll}" aria-label="${hideAll ? 'Show' : 'Hide'} total of all accounts">${icon(hideAll ? 'i-eye-off' : 'i-eye')}</button><span class="acc-gap" aria-hidden="true"></span></li>` : ''}${state.accounts.map((a) => {
        const bal = accountBalance(a);
        return `<li class="acc-row${v === a.id ? ' is-current' : ''}"><button type="button" class="row-btn" data-view-account="${escapeHtml(a.id)}">
            ${accountBadge(a, 'is-row', 'row-icon tint')}
            <span class="row-label"><span>${escapeHtml(a.name)}</span><span>${escapeHtml(ACCOUNT_KINDS[a.kind].label)}, ${a.currency}</span></span>
            <span class="amount ${!balanceHidden(a.id) && bal < 0 ? 'text-expense' : ''}">${escapeHtml(balanceHidden(a.id) ? maskedMoney() : formatDisplay(bal, a.currency))}</span>${tick(v === a.id)}
        </button><button type="button" class="icon-btn acc-edit" data-hide-balance="${escapeHtml(a.id)}" aria-pressed="${balanceHidden(a.id)}" aria-label="${balanceHidden(a.id) ? 'Show' : 'Hide'} ${escapeHtml(a.name)} balance">${icon(balanceHidden(a.id) ? 'i-eye-off' : 'i-eye')}</button><button type="button" class="icon-btn acc-edit" data-edit-account="${escapeHtml(a.id)}" aria-label="Edit ${escapeHtml(a.name)}">${icon('i-edit')}</button></li>`;
    }).join('')}</ul>`;
};

const openAccountManager = () => {
    renderAccountManager();
    openOrSwap('modal-accounts');
};

let accountReturnToManager = false;

const openAccountEditor = (id) => {
    const a = id ? state.accounts.find((x) => x.id === id) : null;
    accountReturnToManager = isSheetOpen('modal-accounts');
    $('account-form').reset();
    $('account-id').value = a ? a.id : '';
    $('account-title').textContent = a ? `Edit ${a.name}` : 'New account';
    $('account-name').value = a ? a.name : '';
    $('account-kind').value = a ? a.kind : 'bank';
    accountKindTouched = false;
    updateAccountNameLogo();
    fillCurrencySelect($('account-currency'), a ? a.currency : dcur());
    $('account-opening').value = a ? round2(accountBalance(a)) : '';
    $('account-balance-date').value = a ? (balanceDateOf(a) || todayISO()) : todayISO();
    $('account-fee').value = a && fxFeeLearned(a) ? a.fxFee : '';
    $('account-atm-fee').value = a && typeof a.atmFee === 'number' ? a.atmFee : '';
    $('account-ceft-fee').value = a && typeof a.ceftFee === 'number' ? a.ceftFee : '';
    $('account-atm-fee').placeholder = String(ATM_FEE_TYPICAL);
    $('account-ceft-fee').placeholder = String(CEFT_FEE_TYPICAL);
    accountFeeHint(a);
    $('account-balance-date').max = todayISO();
    $('account-opening-label').textContent = 'Balance right now';
    $('account-opening-hint').textContent = a
        ? 'Change this to match your real balance. Vela adjusts the starting amount; your entries stay as they are.'
        : 'What is in this account today. Use a minus sign for a card you owe on.';
    $('btn-delete-account').hidden = !a || state.accounts.length < 2;
    openOrSwap('modal-account');
};

const afterAccountChange = () => {
    state.syncSettings = true;
    saveState();
    flushSync();
    if (accountReturnToManager) {
        accountReturnToManager = false;
        hideSheet('modal-account');
        history.replaceState({ vela: 'sheet', id: 'modal-accounts', tab: currentTab }, '');
        renderAccountManager();
        showSheetElement('modal-accounts');
    } else {
        closeSheet('modal-account');
    }
    renderActive();
};

const submitAccount = () => {
    const id = $('account-id').value;
    const name = $('account-name').value.trim();
    const kind = ACCOUNT_KINDS[$('account-kind').value] ? $('account-kind').value : 'cash';
    const currency = normCur($('account-currency').value);
    const raw = $('account-opening').value.trim();
    const balance = raw === '' ? 0 : toNumber(raw, NaN);
    if (!name) return fieldError($('account-name'), 'Give the account a name, like "Cash" or "Commercial Bank".');
    if (!Number.isFinite(balance)) return fieldError($('account-opening'), 'Enter the balance as a number, like 25000.');
    if (state.accounts.some((a) => a.name.toLowerCase() === name.toLowerCase() && a.id !== id)) return fieldError($('account-name'), `You already have an account called "${name}".`);
    if (id) {
        const a = state.accounts.find((x) => x.id === id);
        if (!a) return false;
        a.name = name;
        a.kind = kind;
        a.currency = currency;
        // Keep entries untouched: move the starting amount so today's balance matches.
        const feeRaw = $('account-fee').value.trim();
        const feeNew = feeRaw === '' ? null : toNumber(feeRaw, NaN);
        if (feeRaw !== '' && !(feeNew >= -3 && feeNew <= 15)) return fieldError($('account-fee'), 'Enter a charge between 0 and 15%.');
        const feeChanged = (feeNew === null ? null : round2(feeNew)) !== (fxFeeLearned(a) ? a.fxFee : null);
        if (feeChanged) {
            if (feeNew === null) delete a.fxFee; else a.fxFee = round2(feeNew);
            const n = reestimateFx(a);
            if (n) setTimeout(() => showToast(`${plural(n, 'estimated foreign purchase')} worked out again with the new charge`, 'success'), 400);
        }
        for (const [field, key] of [['account-atm-fee', 'atmFee'], ['account-ceft-fee', 'ceftFee']]) {
            const raw = $(field).value.trim();
            if (raw === '') { delete a[key]; continue; }
            const v = toNumber(raw.replace(/,/g, ''), NaN);
            if (!(v >= 0 && v <= 1000)) return fieldError($(field), 'Enter a charge between 0 and 1,000.');
            a[key] = round2(v);
        }
        const before = accountBalance(a);
        a.opening = round2(a.opening + (balance - before));
        const chosen = $('account-balance-date').value;
        // The day this balance is correct on: what you picked, or today when you corrected the amount.
        if (isISODate(chosen) && chosen <= todayISO() && chosen !== balanceDateOf(a)) { a.balanceDate = chosen; if (chosen === todayISO()) a.balanceTime = nowTime(); else delete a.balanceTime; }
        else if (Math.abs(balance - before) > 0.004) { a.balanceDate = todayISO(); a.balanceTime = nowTime(); }
        showToast('Account saved', 'success');
    } else {
        const chosen = $('account-balance-date').value;
        const bd = isISODate(chosen) && chosen <= todayISO() ? chosen : todayISO();
        state.accounts.push({ id: generateId(), name, kind, currency, opening: round2(balance), createdAt: Date.now(), balanceDate: bd, ...(bd === todayISO() ? { balanceTime: nowTime() } : {}) });
        showToast(`${name} added`, 'success');
    }
    afterAccountChange();
    return true;
};

const deleteAccount = (id) => {
    const a = state.accounts.find((x) => x.id === id);
    if (!a || state.accounts.length < 2) return;
    const other = state.accounts.find((x) => x.id !== id);
    const used = state.transactions.filter((t) => t.accountId === id || t.toAccountId === id).length;
    showConfirm({
        title: `Delete ${a.name}?`,
        message: used ? `${plural(used, 'entry', 'entries')} will move to ${other.name}.` : 'This account has no entries.',
        onConfirm: () => {
            state.transactions.forEach((t) => {
                let changed = false;
                if (t.accountId === id) { t.accountId = other.id; changed = true; }
                if (t.toAccountId === id) { t.toAccountId = other.id; changed = true; }
                if (changed) queueSync('transaction', t.id, 'upsert', false);
            });
            // Transfers between the deleted account and the one taking its entries now go nowhere:
            // remove them here and in the account, or the next sync brings them back.
            state.transactions = state.transactions.filter((t) => {
                const selfTransfer = t.type === 'transfer' && t.accountId === t.toAccountId;
                if (selfTransfer) queueSync('transaction', t.id, 'delete', false);
                return !selfTransfer;
            });
            state.recurring.forEach((b) => { if (b.accountId === id) { b.accountId = other.id; queueSync('recurring', b.id, 'upsert', false); } });
            state.savings.forEach((g) => { if (g.accountId === id) { g.accountId = other.id; queueSync('goal', g.id, 'upsert', false); } });
            state.debts.forEach((d) => { if (d.accountId === id) { d.accountId = other.id; queueSync('debt', d.id, 'upsert', false); } });
            if (state.config.accountBudgets) delete state.config.accountBudgets[id];
            state.accounts = state.accounts.filter((x) => x.id !== id);
            if (activityAccount === id) activityAccount = 'all';
            showToast(`${a.name} deleted`, 'success');
            afterAccountChange();
        }
    });
};

const updateTransferFields = (fromAmount) => {
    const from = accountById($('transfer-from').value);
    const to = accountById($('transfer-to').value);
    $('transfer-currency').textContent = from.currency;
    $('transfer-received-currency').textContent = to.currency;
    const differ = from.currency !== to.currency;
    $('transfer-received-field').hidden = !differ;
    if (differ && (fromAmount === true || !$('transfer-received').value)) {
        const amt = toNumber($('transfer-amount').value, 0);
        $('transfer-received').value = amt > 0 ? round2(convertAmount(amt, from.currency, to.currency)) : '';
    }
};

const openTransfer = (id) => {
    smsEditing = null;
    if (state.accounts.length < 2) {
        showToast('Add a second account first, like a bank account or card, then move money between them.', 'info');
        openAccountEditor();
        return;
    }
    const t = id ? state.transactions.find((x) => x.id === id) : null;
    $('transfer-form').reset();
    $('transfer-id').value = t ? t.id : '';
    $('transfer-title').textContent = t ? 'Edit transfer' : 'Move money';
    $('btn-delete-transfer').hidden = !t;
    fillAccountSelect($('transfer-from'), t ? t.accountId : state.accounts[0].id);
    fillAccountSelect($('transfer-to'), t ? t.toAccountId : state.accounts[1].id);
    $('transfer-amount').value = t ? t.amount : '';
    $('transfer-received').value = t && t.toCurrency !== t.currency ? t.toAmount : '';
    $('transfer-date').value = t ? t.date : todayISO();
    $('transfer-note').value = t && t.desc !== 'Transfer' ? t.desc : '';
    updateTransferFields();
    openOrSwap('modal-transfer');
};

const submitTransfer = () => {
    const id = $('transfer-id').value;
    const from = accountById($('transfer-from').value);
    const to = accountById($('transfer-to').value);
    const amount = toNumber($('transfer-amount').value, NaN);
    const date = $('transfer-date').value;
    if (from.id === to.id) return fieldError($('transfer-to'), 'Pick two different accounts.');
    if (!(amount > 0)) return fieldError($('transfer-amount'), 'Enter an amount greater than zero.');
    if (!isISODate(date)) return fieldError($('transfer-date'), 'Pick a date.');
    // Money can't leave an account that doesn't have it (a credit card may go below zero; a future transfer waits).
    if (from.kind !== 'card' && date <= todayISO() && !smsEditing) {
        const prev = id && state.transactions.find((t) => t.id === id);
        const available = round2(accountBalance(from) + (prev && prev.accountId === from.id && !isUpcoming(prev) ? convertAmount(prev.amount, prev.currency, from.currency) : 0));
        if (amount > available + 0.004) return fieldError($('transfer-amount'), shortfallText(available, amount, from.currency));
    }
    let toAmount = amount;
    if (from.currency !== to.currency) {
        toAmount = toNumber($('transfer-received').value, NaN);
        if (!(toAmount > 0)) return fieldError($('transfer-received'), `Enter how much ${to.currency} arrived.`);
    }
    const data = {
        type: 'transfer', desc: $('transfer-note').value.trim() || 'Transfer', amount, currency: from.currency,
        accountId: from.id, toAccountId: to.id, toAmount, toCurrency: to.currency, date, category: 'Transfer', note: ''
    };
    let record;
    if (id) {
        const idx = state.transactions.findIndex((t) => t.id === id);
        if (idx === -1) return false;
        record = { ...state.transactions[idx], ...data };
        state.transactions[idx] = record;
    } else {
        record = { id: generateId(), ...data, createdAt: Date.now(), recurringId: null, receipt: null };
        state.transactions.push(record);
    }
    saveState();
    haptic('MEDIUM');
    queueSync('transaction', record.id, 'upsert');
    closeSheet('modal-transfer');
    if (smsEditing && !id) smsEditSaved(record);
    showToast(`Moved ${formatCurrency(amount, from.currency)} from ${from.name} to ${to.name}`, 'success');
    renderActive();
    return true;
};

const deleteTransfer = (id) => {
    const t = state.transactions.find((x) => x.id === id);
    if (!t) return;
    showConfirm({
        title: 'Delete this transfer?',
        message: `${formatCurrency(t.amount, t.currency)} from ${accountById(t.accountId).name} to ${accountById(t.toAccountId).name} will be removed, and both balances change back.`,
        onConfirm: () => {
            state.transactions = state.transactions.filter((x) => x.id !== id);
            saveState();
            queueSync('transaction', id, 'delete');
            closeSheet('modal-transfer');
            showToast('Transfer deleted', 'success');
            renderActive();
        }
    });
};

/* =========================================================================
   35. Receipt photos (kept on the device; uploaded to Supabase Storage when signed in)
   ========================================================================= */
const receiptStore = (() => {
    let dbPromise = null;
    const open = () => dbPromise || (dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open('vela', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('receipts');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => { dbPromise = null; reject(req.error); };
    }));
    const run = async (mode, fn) => {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('receipts', mode);
            const req = fn(tx.objectStore('receipts'));
            tx.oncomplete = () => resolve(req ? req.result : undefined);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    };
    return {
        get: (k) => run('readonly', (st) => st.get(k)),
        put: (k, v) => run('readwrite', (st) => st.put(v, k)),
        del: (k) => run('readwrite', (st) => st.delete(k))
    };
})();

let receiptDraft = { mode: 'none', blob: null, url: null };

const resizeToMax = (file, max = 1400, quality = 0.82) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process photo'))), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Unsupported image')); };
    img.src = url;
});

const receiptBlob = async (receipt) => {
    if (!receipt) return null;
    try {
        const local = await receiptStore.get(receipt.id);
        if (local) return local;
    } catch (err) { /* fall through to the cloud copy */ }
    if (receipt.path && canSync()) {
        const { data, error } = await supabaseClient.storage.from('receipts').createSignedUrl(receipt.path, 600);
        if (error) throw error;
        const res = await fetch(data.signedUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        receiptStore.put(receipt.id, blob).catch(() => {});
        return blob;
    }
    return null;
};

const setReceiptDraft = (t) => {
    if (receiptDraft.url) URL.revokeObjectURL(receiptDraft.url);
    receiptDraft = { mode: t && t.receipt ? 'keep' : 'none', blob: null, url: null, receipt: t ? t.receipt : null };
    renderReceiptBox();
    if (t && t.receipt) {
        receiptBlob(t.receipt).then((blob) => {
            if (blob && receiptDraft.mode === 'keep' && receiptDraft.receipt === t.receipt) {
                receiptDraft.url = URL.createObjectURL(blob);
                renderReceiptBox();
            }
        }).catch(() => {
            if (receiptDraft.receipt === t.receipt) { receiptDraft.missing = true; renderReceiptBox(); }
        });
    }
};

const renderReceiptBox = () => {
    const box = $('receipt-box');
    const has = receiptDraft.mode === 'new' || receiptDraft.mode === 'keep';
    if (!has) {
        box.innerHTML = `<button type="button" class="receipt-add" data-action="pick-receipt">${icon('i-camera')}<span>Add a photo of the receipt</span></button>`;
        return;
    }
    const thumb = receiptDraft.url
        ? `<button type="button" class="receipt-thumb" data-action="view-receipt" aria-label="View receipt photo"><img src="${receiptDraft.url}" alt=""></button>`
        : `<span class="receipt-thumb is-loading">${receiptDraft.missing ? 'Photo not on this device' : 'Loading…'}</span>`;
    box.innerHTML = `${thumb}<div class="receipt-actions">
        <button type="button" class="btn btn-secondary btn-sm" data-action="pick-receipt">${icon('i-camera', 'ic ic-sm')} Replace</button>
        <button type="button" class="btn btn-danger btn-sm" data-action="remove-receipt">${icon('i-trash', 'ic ic-sm')} Remove</button>
    </div>`;
};

const pickReceipt = async (file) => {
    if (!/^image\//.test(file.type)) { showToast('Choose a photo (JPG, PNG or similar).', 'error'); return; }
    try {
        const blob = await resizeToMax(file);
        if (receiptDraft.url) URL.revokeObjectURL(receiptDraft.url);
        receiptDraft = { mode: 'new', blob, url: URL.createObjectURL(blob), receipt: receiptDraft.receipt };
        renderReceiptBox();
    } catch (err) {
        showToast("That photo couldn't be read. Try another one.", 'error');
    }
};

const uploadReceipt = async (record) => {
    if (!canSync() || !record.receipt) return;
    try {
        const blob = await receiptStore.get(record.receipt.id);
        if (!blob) return;
        const path = `${state.auth.user.id}/${record.receipt.id}.jpg`;
        const { error } = await supabaseClient.storage.from('receipts').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
        if (error) throw error;
        const t = state.transactions.find((x) => x.id === record.id);
        if (t && t.receipt && t.receipt.id === record.receipt.id) {
            t.receipt = { ...t.receipt, path };
            saveState();
            queueSync('transaction', t.id, 'upsert');
        }
    } catch (err) {
        console.warn('Receipt upload failed; it stays on this device.', err);
    }
};

const removeReceipt = (receipt) => {
    receiptStore.del(receipt.id).catch(() => {});
    if (receipt.path && canSync()) supabaseClient.storage.from('receipts').remove([receipt.path]).catch(() => {});
};

const openReceiptViewer = () => {
    if (!receiptDraft.url) return;
    $('receipt-viewer-img').src = receiptDraft.url;
    $('receipt-viewer').hidden = false;
    $('btn-close-viewer').focus();
};

const closeReceiptViewer = () => {
    $('receipt-viewer').hidden = true;
    $('receipt-viewer-img').removeAttribute('src');
};

/* =========================================================================
   36. Start-up
   ========================================================================= */
const initSupabase = () => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
        console.warn('Supabase library unavailable (offline?). Running in local mode.');
        return;
    }
    try {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: { persistSession: true, autoRefreshToken: true, flowType: isNative() ? 'pkce' : 'implicit', detectSessionInUrl: !isNative() }
        });
    } catch (err) {
        console.error('Failed to start Supabase:', err);
        supabaseClient = null;
    }
};

const initNative = () => {
    if (!isNative()) return;
    const app = nativePlugin('App');
    if (app) {
        app.addListener('appUrlOpen', (event) => { if (!handleWidgetUrl(event && event.url)) handleNativeAuthRedirect(event && event.url); });
        if (typeof app.getLaunchUrl === 'function') {
            app.getLaunchUrl().then((res) => { if (res && res.url && !handleWidgetUrl(res.url)) handleNativeAuthRedirect(res.url); }).catch(() => {});
        }
        app.addListener('pause', onAppHidden);
        app.addListener('resume', onAppVisible);
    }
    const ln = nativePlugin('LocalNotifications');
    if (ln) ln.addListener('localNotificationActionPerformed', (a) => {
        const extra = (a && a.notification && a.notification.extra) || {};
        const key = extra.payKey || (extra.txId ? `tx:${extra.txId}` : null);
        if (key) splashDone.then(() => setTimeout(() => { payPopupShownAt = Date.now(); askMarkPaid(key); }, 400));
        else goToPlan('bills');
    });
    checkBiometric();
    initSms();
    if (state.config.reminders) setTimeout(() => scheduleReminders({ ask: true }), 2500);
    const splash = nativePlugin('SplashScreen');
    if (splash) setTimeout(() => splash.hide({ fadeOutDuration: 250 }).catch(() => {}), 150);
};

/* ---- Splash: the mark draws on, then the screen slides up after ~0.9 s ---- */
const SPLASH_MS = 760; // the logo is drawn by ~0.66 s
let splashEnded = false;
let splashResolve;
const splashDone = new Promise((r) => { splashResolve = r; });
const splashKey = (e) => { if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') endSplash(); };
const endSplash = () => {
    if (splashEnded) return;
    splashEnded = true;
    window.removeEventListener('keydown', splashKey);
    const el = $('splash');
    try { sessionStorage.setItem('vela-splash', '1'); } catch (e) { /* storage blocked */ }
    if (!el) { splashResolve(); return; }
    el.classList.add('out');
    setTimeout(() => { el.remove(); document.body.style.overflow = ''; splashResolve(); }, 500);
};
const runSplash = () => {
    const el = $('splash');
    if (!el) { splashEnded = true; splashResolve(); return; }
    document.body.style.overflow = 'hidden';
    el.addEventListener('click', endSplash, { once: true });
    window.addEventListener('keydown', splashKey);
    if (el.classList.contains('play')) { setTimeout(endSplash, Math.max(200, SPLASH_MS - performance.now())); return; }
    // Android app: start once Android's launch screen has faded (it hides shortly after start-up).
    setTimeout(() => { el.classList.add('play'); setTimeout(endSplash, SPLASH_MS); }, 120);
};

/* ---- Styled pickers: every drop-down in a sheet opens a list in Vela's own look (accounts, funds and categories
   with their icons) instead of the phone's plain menu. The real <select> stays underneath, so forms work as before. ---- */
const pickerIconFor = (sel, value) => {
    const acc = state.accounts.find((a) => a.id === value);
    if (acc) return accountBadge(acc, 'is-row', 'row-icon tint');
    const fund = secById(value);
    if (fund) return secBadge(fund, ' is-mini');
    if (/categor/.test(sel.id || '') && catById(value)) return catBadge(value, (catById(value) || {}).type || 'expense');
    return '';
};
const pickerTitleFor = (sel) => {
    const lab = sel.id && document.querySelector(`label[for="${sel.id}"]`);
    return (lab && lab.textContent.replace(/\(optional\)/i, '').trim()) || sel.getAttribute('aria-label') || 'Choose';
};
const enhanceSelect = (sel) => {
    if (sel._vpBtn || !sel.closest('.select')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'input vp-btn';
    sel.classList.add('vp-hidden');
    sel.tabIndex = -1;
    sel.after(btn);
    sel._vpBtn = btn;
    const refresh = () => {
        const o = sel.options[sel.selectedIndex];
        btn.innerHTML = `${o ? pickerIconFor(sel, o.value) : ''}<span class="vp-label">${escapeHtml(o ? o.text : 'Choose')}</span>${icon('i-chevron-down', 'ic ic-sm vp-chev')}`;
        btn.disabled = sel.disabled;
        btn.setAttribute('aria-label', `${pickerTitleFor(sel)}: ${o ? o.text : 'not chosen'}`);
    };
    sel._vpRefresh = refresh;
    refresh();
    new MutationObserver(refresh).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    sel.addEventListener('change', refresh);
    btn.addEventListener('click', () => openPicker(sel));
};
// Setting .value / .selectedIndex in code also updates the button.
(() => {
    for (const prop of ['value', 'selectedIndex']) {
        const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
        if (!d || !d.set) continue;
        Object.defineProperty(HTMLSelectElement.prototype, prop, {
            configurable: true, enumerable: d.enumerable,
            get() { return d.get.call(this); },
            set(v) { d.set.call(this, v); if (this._vpRefresh) this._vpRefresh(); }
        });
    }
})();
let pickerSel = null;
const closePicker = () => {
    const ov = $('vp-overlay');
    if (!ov) return;
    ov.classList.remove('open');
    const back = pickerSel && pickerSel._vpBtn;
    pickerSel = null;
    setTimeout(() => { if (!ov.classList.contains('open')) ov.hidden = true; }, 200);
    if (back) back.focus();
};
const openPicker = (sel) => {
    let ov = $('vp-overlay');
    if (!ov) {
        ov = document.createElement('div');
        ov.id = 'vp-overlay';
        ov.className = 'vp-overlay';
        ov.hidden = true;
        ov.innerHTML = '<div class="vp-card" role="dialog" aria-modal="true" aria-labelledby="vp-title"><div class="sheet-grabber" aria-hidden="true"></div><div class="vp-head"><h2 id="vp-title"></h2><button type="button" class="icon-btn" data-vp-close aria-label="Close">' + icon('i-x') + '</button></div><input type="search" class="input vp-search" id="vp-search" placeholder="Search" autocomplete="off" hidden><div class="vp-list" id="vp-list" role="listbox"></div></div>';
        document.body.appendChild(ov);
        ov.addEventListener('click', (e) => {
            if (e.target === ov || e.target.closest('[data-vp-close]')) { closePicker(); return; }
            const opt = e.target.closest('[data-vp-value]');
            if (!opt || !pickerSel) return;
            const sel = pickerSel;
            sel.value = opt.dataset.vpValue;
            sel.dispatchEvent(new Event('input', { bubbles: true }));
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            haptic();
            closePicker();
        });
        ov.querySelector('#vp-search').addEventListener('input', (e) => {
            const q = e.target.value.trim().toLowerCase();
            ov.querySelectorAll('[data-vp-value]').forEach((b) => { b.hidden = !!q && !b.textContent.toLowerCase().includes(q); });
        });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ov.hidden) closePicker(); });
    }
    pickerSel = sel;
    $('vp-title').textContent = pickerTitleFor(sel);
    const opts = [...sel.options].filter((o) => !o.disabled || o.selected);
    $('vp-search').hidden = opts.length < 9;
    $('vp-search').value = '';
    $('vp-list').innerHTML = opts.map((o) => `<button type="button" class="vp-opt" role="option" data-vp-value="${escapeHtml(o.value)}" aria-selected="${o.selected}">${pickerIconFor(sel, o.value) || '<span class="vp-dot" aria-hidden="true"></span>'}<span class="vp-label">${escapeHtml(o.text)}</span>${o.selected ? icon('i-check', 'ic ic-sm vp-tick') : ''}</button>`).join('');
    ov.hidden = false;
    requestAnimationFrame(() => ov.classList.add('open'));
    const cur = $('vp-list').querySelector('[aria-selected="true"]');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
};
const enhanceAllSelects = () => document.querySelectorAll('.select > select').forEach(enhanceSelect);
const init = () => {
    enhanceAllSelects();
    let vpTimer = null;
    new MutationObserver(() => { clearTimeout(vpTimer); vpTimer = setTimeout(enhanceAllSelects, 50); }).observe(document.body, { childList: true, subtree: true });
    runSplash();
    loadState();
    repairAccountKinds();
    { const fixed = fixBeforeBalance(); if (fixed) setTimeout(() => showToast(`Fixed ${plural(fixed, 'entry', 'entries')} dated before an account was added: they were taken off its balance twice.`, 'success'), 1600); }
    applyViewBudget();
    migrateBudgets();
    fixAccountCurrencies();
    tidyBankEntryNames();
    document.documentElement.setAttribute('data-theme', state.config.theme);

    initEvents();
    initSheetDrag();
    initPwaInstall();

    updateThemeChrome();
    updateCurrencyButtons();
    setRateStatus('offline');
    updateUserProfileUI();
    reportAuthErrorInUrl();

    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    history.replaceState({ vela: 'tab', tab: 'dashboard' }, '');
    switchTab('dashboard', { fromHistory: true });

    if (state.auth.completedOnboarding) hideAuth();
    else showAuth(1);
    if (state.config.lock.enabled) showLock();
    else document.documentElement.classList.remove('is-locked');

    initSupabase();
    initNative();
    if (supabaseClient) {
        // Defer work out of the callback: awaiting Supabase calls inside it can deadlock the client.
        supabaseClient.auth.onAuthStateChange((event, session) => { setTimeout(() => onAuthEvent(event, session), 0); });
    }

    processRecurring();
    scheduleReminders();
    fetchLiveExchangeRate();
    setTimeout(showPaymentsPopup, 1200);
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
