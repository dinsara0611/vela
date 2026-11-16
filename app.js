/**
 * Vela 3.0 — money tracker (phone first): expenses, income, budgets, bills,
 * savings goals, debts, reports, app lock. Runs as a website and as the
 * Android app (Capacitor) from the same code.
 */
'use strict';

/* =========================================================================
   1. Constants
   ========================================================================= */
const APP_VERSION = '4.19.0';
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
        budgetMode: 'fixed',       // 'fixed' = the amount typed in; 'income' = this month's income
        budgetSavePct: 0,          // with 'income': the part of income kept aside for saving
        lastCategory: { expense: 'Food', income: 'Salary' },
        priceBook: {},             // currency -> item name -> { price, added?, category? } (your own prices)
        lock: { enabled: false, hash: null, salt: null, biometric: false },
        reminders: false,
        reminderIds: []
    },
    auth: { user: null, isMock: true, completedOnboarding: false },
    sync: {},            // id -> { kind, op: 'upsert' | 'delete' }
    syncSettings: false, // settings changed and not yet sent
    settingsUser: null,  // account whose cloud settings are loaded on this phone (before that, nothing is sent)
    settingsSig: null    // the settings as last sent or loaded, to spot changes
});

let state = createDefaultState();
let supabaseClient = null;
let currentTab = 'dashboard';
let planTab = 'budgets';
let activityType = 'all';
let activityStatus = 'all'; // all | paid | unpaid | upcoming | overdue | bank
let activityCategory = 'all';
let activityAccount = 'all';
let activityView = 'list';
let activityDay = null;
let activityMonth = { y: new Date().getFullYear(), m: new Date().getMonth() };
let dashboardRange = '30';
let analyticsRange = '30';
let onboardingPreference = 'fresh';
let deferredInstallPrompt = null;
let handledUserId = null;
let confirmHandler = null;
let storageWarningShown = false;
let biometricAvailable = false;
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
const parseDate = (s) => {
    if (!isISODate(s)) return new Date(NaN);
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
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

const relativeDayLabel = (dateStr) => {
    const d = parseDate(dateStr);
    if (isNaN(d)) return '';
    const diff = daysBetween(d, new Date());
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff === -1) return 'Tomorrow';
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString('en-US', sameYear
        ? { weekday: 'short', month: 'short', day: 'numeric' }
        : { month: 'short', day: 'numeric', year: 'numeric' });
};
const shortDate = (s) => {
    const d = parseDate(s);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('en-US', d.getFullYear() === new Date().getFullYear()
        ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
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
// Fits an amount into its box: the full amount with commas, then without cents, and only if it
// still doesn't fit the short form ("Rs. 1.2M"). Boxes that aren't visible yet keep the full amount.
const fitAmount = (el) => {
    if (!el || !el.isConnected || el.dataset.v === undefined) return;
    const v = Number(el.dataset.v);
    const cur = el.dataset.cur;
    const signed = el.dataset.signed === 'true';
    const full = signed ? formatSigned(v, cur) : formatCurrency(v, cur);
    const whole = formatWhole(v, cur, signed);
    // [text, font scale]: shrink the text a little before dropping cents, and only then shorten.
    const tries = [[full, 1], [full, 0.86], [whole, 1], [whole, 0.86], [whole, 0.74], [`${signed && v > 0 ? '+' : ''}${formatCompact(v, cur)}`, 1], [`${signed && v > 0 ? '+' : ''}${formatCompact(v, cur)}`, 0.8], [`${signed && v > 0 ? '+' : ''}${formatCompact(v, cur)}`, 0.66]];
    const box = el.clientWidth ? el : el.parentElement;
    el.style.fontSize = '';
    if (!box || !box.clientWidth) { el.textContent = full; return; }
    for (const [text, scale] of tries) {
        el.textContent = text;
        el.style.fontSize = scale === 1 ? '' : `${scale}em`;
        const fits = el.clientWidth ? el.scrollWidth <= el.clientWidth + 1 : el.getBoundingClientRect().width <= box.clientWidth + 1;
        if (fits) return;
    }
};
const refitAmounts = (root = document) => { root.querySelectorAll('[data-v]').forEach(fitAmount); root.querySelectorAll('.hero-amount').forEach((el) => shrinkToFit(el)); };
const moneyAttrs = (v, cur, signed = false) => `data-v="${Number(v)}" data-cur="${escapeHtml(cur)}"${signed ? ' data-signed="true"' : ''}`;
const setMoney = (el, v, cur, max = 11, signed = false) => {
    if (!el) return;
    el.dataset.v = String(v);
    el.dataset.cur = cur;
    el.dataset.signed = String(!!signed);
    el.title = signed ? formatSigned(v, cur) : formatCurrency(v, cur);
    fitAmount(el);
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
const accountBalance = (acc) => {
    let bal = acc.opening;
    state.transactions.forEach((t) => {
        if (isUpcoming(t)) return;
        if (t.type === 'transfer') {
            if (t.accountId === acc.id) bal -= convertAmount(t.amount, t.currency, acc.currency);
            if (t.toAccountId === acc.id) bal += convertAmount(t.toAmount, t.toCurrency, acc.currency);
        } else if (t.accountId === acc.id) {
            bal += (t.type === 'income' ? 1 : -1) * convertAmount(t.amount, t.currency, acc.currency);
        }
    });
    return bal;
};
const netWorth = () => state.accounts.reduce((s, a) => s + toDisplay(accountBalance(a), a.currency), 0);
const fillAccountSelect = (sel, value, { all = false } = {}) => {
    if (!sel) return;
    sel.innerHTML = (all ? ['<option value="all">All accounts</option>'] : [])
        .concat(state.accounts.map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)} (${a.currency})</option>`)).join('');
    sel.value = value && (value === 'all' || state.accounts.some((a) => a.id === value)) ? value : (all ? 'all' : state.accounts[0].id);
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
        // Fixed expenses: rent, internet, subscriptions... Entries logged from a bill are always fixed.
        fixed: type === 'expense' && (t.fixed === true || !!t.recurringId),
        // Money that hasn't come in / gone out yet: counts once confirmed. Old future-dated entries become waiting.
        pending: type !== 'transfer' && (t.pending === true || (t.pending === undefined && (cleanDate(t.date) || '') > toISODate()))
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
        autoLog: b.autoLog !== false,
        createdAt: stamp(b.createdAt)
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
        createdAt: stamp(a.createdAt)
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
    base.config.budgetMode = cfg.budgetMode === 'income' ? 'income' : 'fixed';
    base.config.budgetSavePct = Math.min(90, Math.max(0, Math.round(toNumber(cfg.budgetSavePct, 0))));
    if (cfg.categoryBudgets && typeof cfg.categoryBudgets === 'object') {
        Object.keys(cfg.categoryBudgets).forEach((k) => {
            const v = toNumber(cfg.categoryBudgets[k], 0);
            if (v > 0) base.config.categoryBudgets[k] = v;
        });
    }
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
        currency: c.currency,
        currencies: c.currencies,
        rateOverrides: c.rateOverrides,
        theme: c.theme,
        priceBook: c.priceBook,
        lastCategory: c.lastCategory,
        lastAccount: c.lastAccount,
        reminders: !!c.reminders,
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
    if (d.budgetMode === 'income' || d.budgetMode === 'fixed') c.budgetMode = d.budgetMode;
    if (d.budgetSavePct !== undefined) c.budgetSavePct = Math.min(90, Math.max(0, Math.round(toNumber(d.budgetSavePct, 0))));
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
};

const saveState = () => {
    watchSettings();
    const ok = storage.set(STORAGE_KEY, JSON.stringify(state));
    if (!ok && !storageWarningShown) {
        storageWarningShown = true;
        showToast("This device isn't letting Vela save. Check that storage is allowed and not full.", 'error');
    }
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
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const updateThemeChrome = () => {
    const bg = cssVar('--bg') || '#07070b';
    const meta = $('meta-theme-color');
    if (meta) meta.setAttribute('content', bg);
    setPressed('[data-theme-choice]', (b) => b.dataset.themeChoice === state.config.theme);
    const statusBar = nativePlugin('StatusBar');
    if (statusBar) {
        statusBar.setStyle({ style: state.config.theme === 'light' ? 'LIGHT' : 'DARK' }).catch(() => {});
        statusBar.setBackgroundColor({ color: bg }).catch(() => {});
    }
};

const applyTheme = (theme) => {
    state.config.theme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', state.config.theme);
    saveState();
    updateThemeChrome();
    renderActive();
};

const setTheme = (theme, originEvent) => {
    if (theme === state.config.theme) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || reduce) { applyTheme(theme); return; }
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    if (originEvent && originEvent.clientX) { x = originEvent.clientX; y = originEvent.clientY; }
    const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    // The animated reveal needs the browser to draw a frame. If it can't (busy or background tab),
    // switch the theme anyway so the button never appears to do nothing.
    let applied = false;
    const run = () => { if (!applied) { applied = true; applyTheme(theme); } };
    const transition = document.startViewTransition(run);
    setTimeout(run, 400);
    transition.ready.then(() => {
        document.documentElement.animate(
            { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`] },
            { duration: 480, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', pseudoElement: '::view-transition-new(root)' }
        );
    }).catch(() => {});
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

const renderActive = () => {
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
    if (!keepAccount) activityAccount = 'all';
    const now = new Date();
    activityMonth = { y: now.getFullYear(), m: now.getMonth() };
    if (currentTab === 'activity') renderActivity();
    else switchTab('activity');
};

/* =========================================================================
   11. Calculations
   ========================================================================= */
const expenses = () => state.transactions.filter((t) => t.type === 'expense' && !isUpcoming(t));
const inAccount = (t, accId) => accId === 'all' || t.accountId === accId || (t.type === 'transfer' && t.toAccountId === accId);
const sortByNewest = (list) => [...list].sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));
const sumDisplay = (list) => list.reduce((s, e) => s + toDisplay(e.amount, e.currency), 0);
const inMonth = (t, y, m) => { const d = parseDate(t.date); return d.getFullYear() === y && d.getMonth() === m; };

/* ---- Budgets keep the currency you typed them in ---- */
const budgetCur = () => state.config.budgetCurrency || 'USD';
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

const monthStats = (y = new Date().getFullYear(), m = new Date().getMonth()) => {
    const list = state.transactions.filter((t) => inMonth(t, y, m) && !isUpcoming(t));
    const spentList = list.filter((t) => t.type === 'expense');
    const incomeList = list.filter((t) => t.type === 'income');
    const spent = sumDisplay(spentList);
    const income = sumDisplay(incomeList);

    const ref = new Date();
    const prevStart = new Date(y, m - 1, 1);
    const prevEnd = new Date(y, m - 1, Math.min(ref.getDate(), daysInMonth(y, m - 1)));
    const prevSpent = sumDisplay(expenses().filter((e) => { const d = parseDate(e.date); return d >= prevStart && d <= prevEnd; }));

    // From income: every income of this month counts, including income dated later this month
    // (rent on the 17th), because you plan the month's spending with it.
    const plannedIncome = sumDisplay(state.transactions.filter((t) => t.type === 'income' && inMonth(t, y, m)));
    const fromIncome = state.config.budgetMode === 'income';
    const budget = fromIncome ? plannedIncome * (1 - state.config.budgetSavePct / 100) : budgetIn(state.config.budget, dcur());
    const byCat = {};
    spentList.forEach((e) => { byCat[e.category] = (byCat[e.category] || 0) + toDisplay(e.amount, e.currency); });
    return { list, spentList, incomeList, spent, income, net: income - spent, prevSpent, budget, budgetPct: budget > 0 ? (spent / budget) * 100 : (spent > 0 && fromIncome ? 100 : 0), byCat, fromIncome, plannedIncome };
};

const rangeBounds = (range) => {
    const today = startOfDay(new Date());
    let start;
    if (range === '30') start = addDays(today, -29);
    else if (range === '12m') start = new Date(today.getFullYear(), today.getMonth() - 11, 1);
    else {
        const dates = state.transactions.map((e) => parseDate(e.date)).filter((d) => !isNaN(d) && d <= today);
        start = dates.length ? new Date(Math.min(...dates)) : today;
    }
    return { start, end: today };
};

const txInRange = (range) => {
    const { start, end } = rangeBounds(range);
    return state.transactions.filter((e) => { const d = parseDate(e.date); return d >= start && d <= end; });
};

const debtTotals = () => {
    let owedToYou = 0;
    let youOwe = 0;
    state.debts.forEach((d) => {
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
    state.recurring.filter((b) => b.type === 'expense').forEach((b) => {
        state.transactions.filter((t) => t.recurringId === b.id && t.type === 'expense' && inMonth(t, y, m)).forEach((t) => {
            items.push({ name: t.desc, amount: toDisplay(t.amount, t.currency), date: t.date, paid: !isUpcoming(t), billId: b.id, txId: t.id });
        });
        billDatesInMonth(b, y, m).filter((d) => d >= b.nextDate).forEach((d) => {
            items.push({ name: b.name, amount: toDisplay(b.amount, b.currency), date: d, paid: false, billId: b.id });
        });
    });
    // One-off fixed entries, and entries whose repeating fixed expense was deleted (they still happened).
    const billIds = new Set(state.recurring.map((b) => b.id));
    state.transactions.filter((t) => t.type === 'expense' && t.fixed && (!t.recurringId || !billIds.has(t.recurringId)) && inMonth(t, y, m)).forEach((t) => {
        items.push({ name: t.desc, amount: toDisplay(t.amount, t.currency), date: t.date, paid: !isUpcoming(t), txId: t.id });
    });
    items.sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));
    const total = items.reduce((s, i) => s + i.amount, 0);
    const income = sumDisplay(state.transactions.filter((t) => t.type === 'income' && inMonth(t, y, m)));
    const paid = items.filter((i) => i.paid).reduce((s, i) => s + i.amount, 0);
    return { items, total, paid, due: total - paid, income, left: income - total };
};

const fixedSummaryHtml = ({ list = false, link = false } = {}) => {
    const cur = dcur();
    const f = fixedForMonth();
    const pct = f.income > 0 ? Math.min(100, (f.total / f.income) * 100) : (f.total > 0 ? 100 : 0);
    const rows = list && f.items.length ? `<ul class="fx-items">${f.items.map((i) => `<li><span class="fx-item-name">${escapeHtml(i.name)}</span><span class="fx-item-when ${i.paid ? 'is-paid' : ''}">${i.paid ? `${icon('i-check', 'ic ic-sm')} Paid ${escapeHtml(shortDate(i.date))}` : `Due ${escapeHtml(shortDate(i.date))}`}</span><span class="amount">${escapeHtml(formatCurrency(i.amount, cur))}</span></li>`).join('')}</ul>` : '';
    return `<article class="card fx-card glow" style="--glow:var(--pal-cyan)">
        <div class="card-head"><h2 class="card-title">After fixed expenses</h2>${link ? '<button type="button" class="link-btn" data-goto-plan="bills">Details</button>' : `<span class="card-sub">${escapeHtml(monthName(new Date().getFullYear(), new Date().getMonth(), { month: 'long' }))}</span>`}</div>
        <div class="fx-rows">
            <div class="fx-row"><span>Income</span><strong class="amount text-income">${escapeHtml(formatCurrency(f.income, cur))}</strong></div>
            <div class="fx-row"><span>Fixed expenses${f.items.length ? ` (${f.items.length})` : ''}</span><strong class="amount text-expense">${f.total > 0 ? '−' : ''}${escapeHtml(formatCurrency(f.total, cur))}</strong></div>
            <div class="fx-row fx-total"><span>${f.left >= 0 ? 'Left for everything else' : 'Short this month'}</span><strong class="amount ${f.left < 0 ? 'text-expense' : ''}">${escapeHtml(formatCurrency(Math.abs(f.left), cur))}</strong></div>
        </div>
        ${meterHtml(pct, pct >= 100 ? 'over' : pct >= 80 ? 'warn' : null, 'Share of income going to fixed expenses')}
        <div class="meter-row" style="margin-top:var(--sp-2)"><span>${f.income > 0 ? `${Math.round((f.total / f.income) * 100)}% of income is fixed` : 'Add this month\u2019s income to see what\u2019s left'}</span><span>${f.due > 0 ? `${escapeHtml(formatCurrency(f.due, cur))} still due` : (f.total > 0 ? 'All paid' : '')}</span></div>
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

const logBill = (bill, date) => {
    const tx = {
        id: generateId(),
        type: bill.type,
        desc: bill.name,
        amount: bill.amount,
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
        if (!bill.autoLog) return;
        let guard = 0;
        let changed = false;
        while (bill.nextDate <= today && guard < 60) {
            logBill(bill, bill.nextDate);
            bill.nextDate = advanceDate(bill.nextDate, bill.frequency, bill.anchorDay);
            guard++;
            created++;
            changed = true;
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

const markBillPaid = (id) => {
    const bill = state.recurring.find((b) => b.id === id);
    if (!bill) return;
    // Recorded on the day it was really paid; the due date is kept on the entry.
    const tx = logBill(bill, todayISO());
    tx.dueDate = bill.nextDate;
    tx.paidAt = new Date().toISOString();
    cancelPaymentReminders(`bill:${bill.id}`);
    bill.nextDate = advanceDate(bill.nextDate, bill.frequency, bill.anchorDay);
    queueSync('recurring', bill.id, 'upsert', false);
    saveState();
    flushSync();
    haptic('MEDIUM');
    scheduleReminders();
    showToast(`${bill.name} ${bill.type === 'income' ? 'received' : 'paid'}: ${formatCurrency(bill.amount, bill.currency)}. Next ${shortDate(bill.nextDate)}.`, 'success');
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

const sendTestNotification = async () => {
    const ln = nativePlugin('LocalNotifications');
    if (!ln) { showToast('Notifications work in the Android app.', 'info'); return; }
    if (!(await ensureNotifPermission(ln, true))) {
        showToast('Notifications are blocked. Open Android Settings > Apps > Vela > Notifications and allow them.', 'warning');
        renderSettings();
        return;
    }
    await ensureChannel(ln);
    try {
        await ln.schedule({ notifications: [{ ...notifStyle, id: 900002, title: 'Vela notifications work', body: 'You’ll get bill reminders like this one.', schedule: { at: new Date(Date.now() + 3000), allowWhileIdle: true } }] });
        showToast('Test notification coming in 3 seconds', 'success');
    } catch (err) {
        showToast(`Couldn't send it: ${err.message || err}`, 'error');
    }
};

/* =========================================================================
   14. Rendering — shared pieces
   ========================================================================= */
const transferLine = (t) => `${accountById(t.accountId).name} to ${accountById(t.toAccountId).name}`;

const txRow = (t, { showDate = true } = {}) => {
    const when = showDate ? `<span class="tx-when">${escapeHtml(relativeDayLabel(t.date))}</span>` : '';
    if (t.type === 'transfer') {
        return `<li><button type="button" class="tx" data-edit-tx="${escapeHtml(t.id)}" data-upcoming="${isUpcoming(t)}">
            <span class="cat-badge" style="--cat:var(--text-2)">${icon('i-swap')}</span>
            <span class="tx-main"><span class="tx-title">${escapeHtml(t.desc)}</span><span class="tx-sub"><span>${escapeHtml(transferLine(t))}</span></span></span>
            <span class="tx-amt"><span class="amount is-transfer">${escapeHtml(formatCurrency(t.amount, t.currency))}</span>${when}</span>
        </button></li>`;
    }
    const cat = catById(t.category, t.type);
    const value = toDisplay(t.amount, t.currency);
    const signed = formatSigned(t.type === 'income' ? value : -value, dcur());
    const orig = t.currency !== dcur() ? `<span class="tx-orig-inline">${escapeHtml(formatCurrency(t.amount, t.currency))}</span>` : '';
    const label = showDate ? cat.name : (t.note || cat.name);
    const st = t.pending ? payStatus(t.date) : null;
    const waitingStrip = t.pending ? `<div class="tx-confirm" data-status="${st}"><span>${st === 'overdue' ? `${t.type === 'income' ? 'Expected' : 'Was due'} ${escapeHtml(shortDate(t.date))}` : st === 'due' ? (t.type === 'income' ? 'Expected today' : 'Due today') : `Due ${escapeHtml(shortDate(t.date))}`}</span><button type="button" class="btn btn-xs ${t.type === 'income' ? 'btn-income' : 'btn-primary'}" data-pay="tx:${escapeHtml(t.id)}">${icon('i-check', 'ic ic-sm')} ${t.type === 'income' ? 'Mark as received' : 'Mark as paid'}</button></div>` : '';
    return `<li class="${t.pending ? 'tx-li-pending' : ''}"><button type="button" class="tx" data-edit-tx="${escapeHtml(t.id)}" data-upcoming="${isUpcoming(t)}">
        ${catBadge(t.category, t.type)}
        <span class="tx-main"><span class="tx-title">${escapeHtml(t.desc)}</span><span class="tx-sub">${t.pending ? `<span class="tx-upcoming" data-status="${st}">${payStatusLabel(st, t.type)}</span>` : (t.dueDate || t.paidAt ? `<span class="tx-paid">${t.type === 'income' ? 'Received' : 'Paid'}</span>` : '')}${t.bank ? `<span class="tx-bank" title="${escapeHtml(`${t.bank.bank} – ${sourceLabel(t.bank.sources || ['sms'])}`)}">${icon('i-check', 'ic ic-sm')}${escapeHtml(sourceShort(t.bank.sources || ['sms']))}</span>` : ''}${t.fixed ? '<span class="tx-fixed">Fixed</span>' : ''}${t.recurringId ? icon('i-repeat') : ''}${t.receipt ? icon('i-image') : ''}<span>${escapeHtml(label)}</span>${orig}</span></span>
        <span class="tx-amt"><span class="amount ${t.type === 'income' ? 'is-income' : ''}">${escapeHtml(signed)}</span>${when}</span>
    </button>${waitingStrip}</li>`;
};

/* ---- Bank SMS tracking (Android): a structured parser for bank transaction messages ----
   Starts with Commercial Bank of Ceylon; other Sri Lankan banks are read too but always shown for review.
   Nothing is added without the user's confirmation unless they turn on automatic adding for confident
   messages. OTPs, promotions, login alerts, balance messages and failed or declined payments are never used. */
const SMS_KEY = 'VELA_SMS';
const smsPrefs = () => {
    const base = { enabled: false, paused: false, autoAdd: false, since: 0, seen: [], accountId: null, lastDetected: 0, lastSync: 0, windowMin: 15 };
    try { return { ...base, ...(JSON.parse(localStorage.getItem(SMS_KEY) || '{}')) }; } catch (e) { return base; }
};
const saveSmsPrefs = (p) => { try { localStorage.setItem(SMS_KEY, JSON.stringify({ ...p, seen: p.seen.slice(-800) })); } catch (e) { /* storage blocked */ } };
const smsPlugin = () => nativePlugin('SmsReader');
let smsQueue = [];
let smsEditing = null; // the message being edited in the entry form

// Sender IDs and names. Commercial Bank is the bank this parser is tuned for.
const SMS_BANKS = [
    { name: 'Commercial Bank', sender: /^(combank|com ?bank|commercial|cbc|combnk)/i, body: /\b(combank|com ?bank|commercial bank)\b/i, tuned: true },
    { name: 'BOC', sender: /^boc\b|bankofceylon/i, body: /\bbank of ceylon\b/i },
    { name: 'HNB', sender: /^hnb\b/i, body: /\bhatton national\b/i },
    { name: 'Sampath Bank', sender: /^sampath/i, body: /\bsampath bank\b/i },
    { name: "People's Bank", sender: /^people'?s/i, body: /\bpeople'?s bank\b/i },
    { name: 'NSB', sender: /^nsb\b/i, body: /\bnational savings bank\b/i },
    { name: 'Nations Trust', sender: /^(ntb|nations)/i, body: /\bnations trust\b/i },
    { name: 'Seylan Bank', sender: /^seylan/i, body: /\bseylan\b/i },
    { name: 'DFCC', sender: /^dfcc/i, body: /\bdfcc\b/i },
    { name: 'NDB', sender: /^ndb\b/i, body: /\bndb bank\b/i },
    { name: 'Pan Asia Bank', sender: /^(pabc|panasia)/i, body: /\bpan asia bank\b/i },
    { name: 'Amana Bank', sender: /^amana/i, body: /\bamana bank\b/i }
];
// Messages that are never transactions.
const SMS_IGNORE = [
    [/\b(otp|one[- ]?time (pass(word|code)?|pin)|verification code|security code|passcode)\b/i, 'one-time code'],
    [/\b(declined|was not successful|unsuccessful|failed|rejected|could not be (processed|completed)|insufficient (funds|balance))\b/i, 'failed or declined'],
    [/\b(log(ged)?[- ]?in|sign(ed)?[- ]?in|login attempt|new device|password (was )?changed|pin (was )?changed)\b/i, 'login or security alert'],
    [/(\d+ ?% ?off|\boffer\b|\bdiscount\b|\bcashback\b|\bwin\b|\bcongratulations\b|\bapply now\b|\binstalment plan\b|\bpromo)/i, 'promotion'],
    [/\b(will be debited|is due on|payment due|due date|minimum (payment|due)|reminder)\b/i, 'reminder, not a transaction'],
    [/\b(security (alert|warning)|beware of|scheduled maintenance|system maintenance|will be unavailable|temporarily unavailable|auth(entication)? code)\b/i, 'security warning or announcement']
];
const SMS_AMOUNT_RE = /(LKR|SLR|Rs\.?|USD|US\$)\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/gi;
// Numbers that are a balance or a limit, not what moved.
const SMS_BALANCE_BEFORE = /(bal(ance)?|avl|avail(able)?|a\/?v ?bal|limit|outstanding|o\/s|current bal|ledger)[^0-9]{0,18}$/i;
// Kinds of transaction, most specific first. dir: 'out' expense, 'in' income, 'move' transfer to cash, 'rev' reversal.
const SMS_KINDS = [
    { kind: 'reversal', dir: 'rev', label: 'Reversal', re: /\b(revers(al|ed)|reverted|void(ed)?|cancell?ed transaction|transaction cancell?ed)\b/i },
    { kind: 'refund', dir: 'in', label: 'Refund', re: /\brefund(ed)?\b/i },
    { kind: 'fee', dir: 'out', label: 'Bank charge', re: /\b((service|annual|sms|alert|ledger|maintenance|card|stamp|commission|bank|atm)[ -]?(fee|fees|charge|charges)|charges? (of|debited|levied)|fee (of|debited))\b/i },
    { kind: 'atm', dir: 'move', label: 'ATM withdrawal', re: /\b(atm|cash withdrawal|cash wdl|withdrawn at|cdm)\b/i },
    { kind: 'transfer_in', dir: 'in', label: 'Transfer in', re: /\b((fund|ceft|slips|online|inward|ib) ?transfer|transfer(red)?)\b.{0,60}\b(received|credited)\b|\b(received|credited)\b.{0,60}\b(from|via ceft|by transfer)\b|\binward (fund )?transfer\b|\btransfer(red)? from\b(?!.{0,60}\bto\b)/i },
    { kind: 'transfer_out', dir: 'out', label: 'Transfer out', re: /\b((fund|ceft|slips|online|outward|ib) ?transfer|transfer(red)?|sent)\b.{0,60}\bto\b/i },
    { kind: 'online', dir: 'out', label: 'Online payment', re: /\b(online|e-?commerce|internet|card not present|ecom|web)\b.{0,40}\b(purchase|payment|transaction|txn|debited|spent)\b|\b(purchase|payment|transaction)\b.{0,30}\b(online|internet)\b|\bat\s+[A-Z0-9 .*]*\.(COM|LK|NET)\b/i },
    { kind: 'card', dir: 'out', label: 'Card payment', re: /\b(pos|purchase|purchased|card (was )?used|spent|paid at|payment at|txn at|transaction at)\b|\b(payment|transaction|txn) of\b.{0,30}\bat\b/i },
    { kind: 'bill', dir: 'out', label: 'Bill payment', re: /\b(bill payment|utility payment|paid to|payment to)\b/i },
    { kind: 'salary', dir: 'in', label: 'Salary', re: /\bsalary\b/i },
    { kind: 'deposit', dir: 'in', label: 'Deposit', re: /\b(cash deposit|deposited|deposit of|cdm deposit)\b/i },
    { kind: 'debit', dir: 'out', label: 'Debit', re: /\b(debited|debit of|withdrawn|deducted|charged|has been debited)\b/i, generic: true },
    { kind: 'credit', dir: 'in', label: 'Credit', re: /\b(credited|credit of|has been credited)\b/i, generic: true }
];
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const titleCase = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
// Account and card numbers are shown as their last 4 digits only.
const maskSms = (body) => String(body || '')
    .replace(/\b(?:[0-9][0-9 *xX#-]{6,}[0-9])\b/g, (m) => { const d = m.replace(/\D/g, ''); return d.length >= 8 ? `••${d.slice(-4)}` : m; })
    .replace(/\b[xX*#]{2,}\s?([0-9]{3,4})\b/g, '••$1');
// Date written in the message (Sri Lankan banks use day/month), checked against when it arrived.
const smsDateTime = (body, receivedMs) => {
    const got = new Date(receivedMs || Date.now());
    let d = null;
    let m = /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/.exec(body);
    if (m) { const y = Number(m[3].length === 2 ? `20${m[3]}` : m[3]); d = new Date(y, Number(m[2]) - 1, Number(m[1])); }
    if (!d && (m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(body))) d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (!d && (m = /\b(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s,-]+(\d{2,4})\b/.exec(body)) && MONTHS[m[2].toLowerCase()] !== undefined) d = new Date(Number(m[3].length === 2 ? `20${m[3]}` : m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));
    const t = /\b(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?\b/.exec(body);
    let time = null;
    if (t) { let hh = Number(t[1]); if (t[3] && /p/i.test(t[3]) && hh < 12) hh += 12; if (t[3] && /a/i.test(t[3]) && hh === 12) hh = 0; if (hh < 24) time = `${pad2(hh)}:${t[2]}`; }
    const valid = d && !isNaN(d) && Math.abs(daysBetween(d, got)) <= 45;
    return { date: toISODate(valid ? d : got), time, fromMessage: !!valid };
};

/* Reads one SMS. Returns null (with the reason in smsLastReason) when it isn't a transaction, or
   { type: 'expense' | 'income' | 'atm' | 'reversal', kind, amount, currency, bank, desc, merchant, date, time,
     ref, last4, confidence: 'high' | 'medium', checks: [...], dedupe, masked } */
let smsLastReason = '';
const parseBankSms = (msg) => {
    smsLastReason = '';
    const body = String(msg.body || '').replace(/\s+/g, ' ').trim();
    const address = String(msg.address || '').trim();
    const no = (why) => { smsLastReason = why; return null; };
    if (!body) return no('empty');
    const ignored = SMS_IGNORE.find(([re]) => re.test(body));
    if (ignored) return no(ignored[1]);
    const bankBySender = SMS_BANKS.find((b) => b.sender.test(address.replace(/[^A-Za-z']/g, '')));
    const bankByBody = SMS_BANKS.find((b) => b.body.test(body));
    const bank = bankBySender || bankByBody;
    const source = msg.source === 'notification' ? 'notification' : (msg.shared || /^shared|^pasted/i.test(address) || msg.source === 'shared') ? 'shared' : 'sms';
    const shared = source === 'shared';
    // Notifications come from a verified Commercial Bank app (checked on the phone by its package name).
    const fromBankApp = source === 'notification';
    const bankApp = fromBankApp ? SMS_BANKS[0] : null;
    if (!bank && !shared && !fromBankApp) return no('not from a known bank');

    // Amounts: drop the ones that are a balance or a limit.
    const all = [];
    let m;
    SMS_AMOUNT_RE.lastIndex = 0;
    while ((m = SMS_AMOUNT_RE.exec(body))) all.push({ cur: /^us/i.test(m[1]) ? 'USD' : 'LKR', value: toNumber(m[2], NaN), at: m.index, before: body.slice(Math.max(0, m.index - 30), m.index) });
    const moved = all.filter((a) => a.value > 0 && !SMS_BALANCE_BEFORE.test(a.before));
    if (!moved.length) return no(all.length ? 'only a balance, no transaction' : 'no amount');
    const kindHit = SMS_KINDS.find((k) => k.re.test(body));
    if (!kindHit) return no('no transaction wording');
    const checks = [];
    // Two different amounts (e.g. LKR and the USD it was charged in): take the first, ask to check.
    const amt = moved[0];
    if (moved.some((a) => a.cur === amt.cur && Math.abs(a.value - amt.value) > 0.005)) checks.push('more than one amount in the message');

    const when = smsDateTime(body, msg.date);
    // A bank-app notification is posted as the transaction happens, so the time it arrived is the date.
    if (!when.fromMessage && !fromBankApp) checks.push('date taken from when the message arrived');
    const ref = (/\b(?:ref(?:erence)?(?: ?no\.?| ?number)?|txn ?(?:id|no)|trx ?(?:id|no)|transaction (?:id|no)|auth(?:orization)? code|approval code|rrn|trace no)\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9\-\/]{3,24})/i.exec(body) || [])[1] || null;
    const last4 = (/(?:card|a\/c|acc(?:oun)?t|acct)\b[^0-9]{0,25}(?:[0-9xX*#•]{0,14})?([0-9]{4})\b/i.exec(body) || /\bending(?: in| with)?\s*#?\s*([0-9]{4})\b/i.exec(body) || [])[1] || null;
    const place = /\b(?:at|@)\s+([A-Za-z0-9][A-Za-z0-9 &'.*\-\/]{1,40}?)(?=\s+(?:on|for|via|ref|dated|from|using|with|\d{1,2}[\/.-])\b|\s*[.,;(]|\s*$)/i.exec(body);
    const party = kindHit.dir === 'in'
        ? /\bfrom\s+([A-Za-z][A-Za-z0-9 &'.\-]{1,40}?)(?=\s+(?:on|to|ref|dated|via|into|credited|a\/c|acc)\b|\s*[.,;(]|\s*$)/i.exec(body)
        : /\bto\s+([A-Za-z][A-Za-z0-9 &'.\-]{1,40}?)(?=\s+(?:on|from|ref|dated|via|a\/c|acc)\b|\s*[.,;(]|\s*$)/i.exec(body);
    let merchant = place && !/^(atm|your|the|a\/c)\b/i.test(place[1]) ? place[1].trim() : (party && !/^(your|the|a\/c|acc)/i.test(party[1]) ? party[1].trim() : '');
    if (/^\d|^(on|ref)$/i.test(merchant)) merchant = '';
    merchant = merchant ? titleCase(merchant.replace(/\s{2,}/g, ' ')) : '';
    if (!merchant && (kindHit.kind === 'card' || kindHit.kind === 'online')) checks.push('no shop name in the message');
    if (kindHit.generic) checks.push('the message does not say what kind of payment it was');
    const theBank = bankApp || bank;
    if (!theBank || !theBank.tuned) checks.push(theBank ? `${theBank.name} messages are read with general rules` : 'sender not recognised as a bank');
    // Pasted or shared text didn't come straight from the bank's number: always look before adding.
    else if (shared) checks.push(SMS_CHECK_SHARED);

    const bankName = theBank ? theBank.name : 'Bank';
    const type = kindHit.dir === 'in' ? 'income' : kindHit.dir === 'out' ? 'expense' : kindHit.dir === 'move' ? 'atm' : 'reversal';
    const desc = kindHit.kind === 'atm' ? 'ATM withdrawal'
        : kindHit.kind === 'fee' ? `${bankName} charges`
        : kindHit.kind === 'refund' ? `Refund${merchant ? `: ${merchant}` : ''}`
        : kindHit.kind === 'reversal' ? `Reversal${merchant ? `: ${merchant}` : ''}`
        : merchant || (kindHit.kind === 'salary' ? 'Salary' : `${bankName} ${kindHit.label.toLowerCase()}`);
    let category = type === 'income'
        ? (kindHit.kind === 'salary' || /\bsalary\b/i.test(body) ? 'Salary' : 'OtherIncome')
        : kindHit.kind === 'fee' ? 'Other' : (guessCategory(merchant) || (kindHit.kind === 'bill' ? 'Utilities' : 'Other'));
    const catType = type === 'income' ? 'income' : 'expense';
    if (!state.categories.some((c) => c.id === category && c.type === catType)) category = FALLBACK_CATEGORY[catType];
    const confidence = checks.length ? 'medium' : 'high';
    const dedupe = ref ? `ref:${bankName}:${ref.toUpperCase()}` : `sig:${bankName}:${kindHit.dir}:${amt.cur}:${amt.value}:${when.date}:${when.time || ''}:${last4 || ''}`;
    return {
        id: String(msg.id), type, kind: kindHit.kind, kindLabel: kindHit.label, amount: amt.value, currency: amt.cur,
        bank: bankName, desc: desc.slice(0, 80), merchant, category, date: when.date, time: when.time, ref, last4,
        confidence, checks, dedupe, masked: maskSms(body).slice(0, 400),
        source, sources: [source], sourceIds: [String(msg.id)], bodyKeys: [hashToInt(body.toLowerCase())], arrivedAt: Number(msg.date) || Date.now(), fromMessage: when.fromMessage || fromBankApp
    };
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
    sources: sourceList(i), sourceIds: i.sourceIds || [i.id], bodyKeys: i.bodyKeys || [], arrivedAt: i.arrivedAt || null,
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
const sameDetection = (a, b) => {
    if (!a || !b) return null;
    // The same text is a repeat (resent SMS, inbox + live copy, notification update) only close in time:
    // a shop that sends identical texts for two purchases hours apart is two purchases.
    // A shared or pasted copy is a copy whenever it comes (even when the pasted text doesn't name the bank).
    // Repeated SMS arrive seconds apart; separate notifications already have their own ids on the phone.
    const sameText = (a.bodyKeys || []).some((k) => (b.bodyKeys || []).includes(k));
    const copyShared = sourceList(a).includes('shared') || sourceList(b).includes('shared');
    if (sameText && copyShared) return 'same';
    if (a.bank !== b.bank) return null;
    const onlyNotif = (x) => sourceList(x).every((s) => s === 'notification');
    if (sameText && !(onlyNotif(a) && onlyNotif(b)) && a.arrivedAt && b.arrivedAt && Math.abs(a.arrivedAt - b.arrivedAt) <= 2 * 60000) return 'same';
    if (a.ref && b.ref) return a.ref.toUpperCase() === b.ref.toUpperCase() ? 'same' : null;
    if (a.type !== b.type || a.currency !== b.currency || Math.abs(a.amount - b.amount) > 0.005) return null;
    const sa = sourceList(a);
    const sb = sourceList(b);
    if (sa.some((s) => sb.includes(s))) return null;
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
    sources: t.bank.sources || ['sms'], bodyKeys: t.bank.bodyKeys || [], arrivedAt: t.bank.arrivedAt
});
// The confirmed transaction a detection is already recorded as (by id, reference, same text, or the other source).
const recordedMatch = (i) => state.transactions.find((t) => t.bank && (
    t.bank.smsId === i.id || (t.bank.sourceIds || []).includes(i.id) || (i.dedupe && i.ref && t.bank.dedupe === i.dedupe) || sameDetection(i, recordedAsDetection(t)) === 'same'));
const smsAlreadyRecorded = (i) => !!recordedMatch(i);
// Two detections of one transaction become one: sources are listed together and missing details filled in.
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
const smsAccountFor = (item) => {
    const p = smsPrefs();
    if (p.accountId && state.accounts.some((a) => a.id === p.accountId)) return p.accountId;
    const first = item.bank.toLowerCase().split(' ')[0];
    const named = state.accounts.find((a) => a.name.toLowerCase().includes(first));
    const bank = state.accounts.find((a) => a.kind === 'bank' || a.kind === 'card');
    return (named || bank || state.accounts[0]).id;
};
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
    if (i.type === 'atm') return null;
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
    const pay = paymentItems({ horizonDays: 7 }).find((p) => p.type === i.type && sameMoney(p.amount, p.currency, i.amount, i.currency, 0.01) && Math.abs(daysBetween(parseDate(p.due), parseDate(i.date))) <= 7);
    if (pay) return { how: 'pay', pay };
    const t = state.transactions.find((x) => x.type === i.type && !x.pending && !x.bank && sameMoney(x.amount, x.currency, i.amount, i.currency) && Math.abs(daysBetween(parseDate(x.date), parseDate(i.date))) <= 2);
    return t ? { how: 'link', tx: t } : null;
};

const smsCardHtml = (i) => {
    const match = smsMatchFor(i);
    const typeText = i.type === 'atm' ? 'ATM withdrawal (moved to Cash)' : i.type === 'reversal' ? 'Reversal (cancels an earlier payment)' : `${i.type === 'income' ? 'Income' : 'Expense'} · ${i.kindLabel}`;
    const amountText = `${i.type === 'income' ? '+' : i.type === 'reversal' ? '' : '−'}${formatCurrency(i.amount, i.currency)}`;
    const rows = [
        ['Amount', `<strong class="amount ${i.type === 'income' ? 'text-income' : ''}">${escapeHtml(amountText)}</strong>`],
        ['Bank', escapeHtml(`${i.bank}${i.last4 ? ` · ••${i.last4}` : ''}`)],
        ['Type', escapeHtml(typeText)],
        ['Description', escapeHtml(i.desc)],
        ['Date', escapeHtml(`${relativeDayLabel(i.date)}${i.time ? `, ${i.time}` : ''}`)],
        ...(i.ref ? [['Reference', escapeHtml(i.ref)]] : []),
        ['Detected through', `<span class="sms-sources">${sourceList(i).map((s) => `<span class="sms-source" data-source="${s}">${escapeHtml(SOURCE_NAMES[s] || s)}</span>`).join('<span class="faint" aria-hidden="true">+</span>')}</span>`]
    ];
    const moveBtn = /^transfer_/.test(i.kind) ? `<button type="button" class="link-btn sms-move" data-sms-move="${escapeHtml(i.id)}">Between my own accounts? Record it as a transfer</button>` : '';
    let actions;
    const refundNote = i.kind === 'refund' && !match ? '<p class="sms-note">No matching purchase found, so this is added as income labelled Refund.</p>' : '';
    if (i.type === 'reversal') {
        actions = match
            ? `<button type="button" class="btn btn-secondary btn-sm" data-sms-ignore="${escapeHtml(i.id)}">Ignore</button><button type="button" class="btn btn-primary btn-sm" data-sms-match="${escapeHtml(i.id)}">Remove “${escapeHtml(match.tx.desc)}”</button>`
            : `<span class="sms-note">No matching payment found to reverse, so nothing is added.</span><button type="button" class="btn btn-secondary btn-sm" data-sms-ignore="${escapeHtml(i.id)}">OK</button>`;
    } else {
        const matchBtn = match ? `<button type="button" class="btn ${i.type === 'income' ? 'btn-income' : 'btn-primary'} btn-sm btn-block" data-sms-match="${escapeHtml(i.id)}">${icon('i-check', 'ic ic-sm')} ${match.how === 'refund' ? `Refund for “${escapeHtml(match.tx.desc)}”: lower that expense` : match.how === 'pay' ? `Mark “${escapeHtml(match.pay.name)}” as ${i.type === 'income' ? 'received' : 'paid'}` : `Link to “${escapeHtml(match.tx.desc)}” (already recorded)`}</button>` : '';
        actions = `${matchBtn}<div class="sms-actions"><button type="button" class="btn btn-secondary btn-sm" data-sms-ignore="${escapeHtml(i.id)}">Ignore</button><button type="button" class="btn btn-secondary btn-sm" data-sms-edit="${escapeHtml(i.id)}">Edit details</button>${match && match.how !== 'refund' ? '' : `<button type="button" class="btn ${i.type === 'income' ? 'btn-income' : 'btn-primary'} btn-sm" data-sms-add="${escapeHtml(i.id)}">${match ? 'Add as income' : 'Confirm &amp; add'}</button>`}</div>${moveBtn}`;
    }
    return `<li class="sms-card" data-confidence="${i.confidence}">
        ${i.confidence === 'medium' ? `<p class="sms-check">${icon('i-alert', 'ic ic-sm')}<span>Please check these details: ${escapeHtml(i.checks.join('; '))}.</span></p>` : ''}
        <dl class="sms-fields">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
        <details class="sms-original"><summary>Original message (numbers hidden)</summary><p>${escapeHtml(i.masked)}</p></details>
        ${refundNote}${actions}
    </li>`;
};
const renderSmsSheet = () => {
    const list = $('sms-list');
    if (!smsQueue.length) { list.innerHTML = ''; return; }
    $('sms-account').innerHTML = state.accounts.map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join('');
    $('sms-account').value = smsAccountFor(smsQueue[0]);
    $('sms-count').textContent = `${plural(smsQueue.length, 'transaction', 'transactions')} to review`;
    list.innerHTML = smsQueue.map(smsCardHtml).join('');
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
const smsChosenAccount = (i) => {
    const sel = $('sms-account');
    const id = sel && sel.value ? sel.value : smsAccountFor(i);
    const p = smsPrefs();
    p.accountId = id;
    saveSmsPrefs(p);
    return id;
};
// Adds one confirmed message. ATM withdrawals become a move from the bank account to Cash, so the cash
// isn't counted as spent twice (once when withdrawn, again when spent).
const smsApply = (i, accountId) => {
    if (i.type === 'atm') {
        const from = accountById(accountId);
        const cash = state.accounts.find((a) => a.kind === 'cash' && a.id !== from.id);
        if (cash) {
            const record = { id: generateId(), type: 'transfer', desc: 'ATM withdrawal', amount: i.amount, currency: i.currency, accountId: from.id, toAccountId: cash.id, toAmount: round2(convertAmount(i.amount, i.currency, cash.currency)), toCurrency: cash.currency, category: 'Transfer', date: i.date, note: `From ${i.bank} (${sourceShort(i.sources)})`, createdAt: Date.now(), recurringId: null, receipt: null, bank: bankMeta(i) };
            state.transactions.push(record);
            saveState();
            queueSync('transaction', record.id, 'upsert');
            renderActive();
            return record;
        }
        const rec = quickSaveTx({ type: 'expense', desc: 'ATM withdrawal', amount: i.amount, currency: i.currency, category: 'Other', date: i.date, accountId, note: `From ${i.bank} (${sourceShort(i.sources)})` });
        rec.bank = bankMeta(i);
        saveState();
        queueSync('transaction', rec.id, 'upsert');
        return rec;
    }
    const rec = quickSaveTx({ type: i.type, desc: i.desc, amount: i.amount, currency: i.currency, category: i.category, date: i.date, accountId, note: `From ${i.bank} (${sourceShort(i.sources)})` });
    rec.pending = false; // it already happened: the bank says so
    rec.bank = bankMeta(i);
    saveState();
    queueSync('transaction', rec.id, 'upsert');
    renderActive();
    return rec;
};
const smsAdd = (id) => {
    const i = smsQueue.find((x) => x.id === id);
    if (!i) return;
    if (smsAlreadyRecorded(i)) { showToast('That transaction is already in Vela.', 'info'); smsHandled([id]); return; }
    smsApply(i, smsChosenAccount(i));
    showToast(`Added from ${i.bank}: ${formatCurrency(i.amount, i.currency)}`, 'success');
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
        if (t) { t.bank = bankMeta(i); saveState(); queueSync('transaction', t.id, 'upsert'); }
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
    renderActive();
    smsHandled([id]);
};
// Edit before adding: opens the normal form, filled in; saving it marks the message as done.
const smsEdit = (id, asMove = false) => {
    const i = smsQueue.find((x) => x.id === id);
    if (!i) return;
    const accountId = smsChosenAccount(i);
    // Money moved between two of the user's own accounts: a transfer, so it's neither income nor spending.
    if (asMove) {
        openTransfer();
        smsEditing = i;
        const other = state.accounts.find((a) => a.id !== accountId);
        $('transfer-from').value = i.type === 'income' && other ? other.id : accountId;
        $('transfer-to').value = i.type === 'income' ? accountId : (other ? other.id : accountId);
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
    $('tx-note').value = `From ${i.bank} (${sourceShort(i.sources)})`;
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
        if (same.length > 1 || maybe.length) {
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
        const auto = fresh.filter((i) => i.confidence === 'high' && i.type !== 'reversal' && !smsMatchFor(i));
        auto.forEach((i) => smsApply(i, smsAccountFor(i)));
        if (auto.length) {
            showToast(`Added ${plural(auto.length, 'bank transaction')} automatically`, 'success');
            const ids = [].concat(...auto.map((i) => i.sourceIds || [i.id]));
            const q = smsPrefs(); q.seen = [...new Set(q.seen.concat(ids))]; saveSmsPrefs(q);
            const plugin = smsPlugin();
            if (plugin) plugin.clearHandled({ ids }).catch(() => {});
        }
        smsQueue = smsQueue.concat(fresh.filter((i) => !auto.includes(i)));
        return fresh.length;
    }
    smsQueue = smsQueue.concat(fresh);
    return fresh.length;
};
// On start and whenever Vela comes back: messages that came while it was closed, plus the inbox since last time.
const scanSms = async () => {
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
    if (smsQueue.length) showSmsSheet();
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
const initSms = () => {
    const plugin = smsPlugin();
    if (!plugin) return;
    plugin.addListener('smsReceived', (m) => { const n = smsTake([m]); if (n) haptic('MEDIUM'); if (smsQueue.length) showSmsSheet(); refreshBankStatus(); });
    // Tapped "Bank transaction detected": open the review screen once the app is ready.
    plugin.addListener('reviewRequested', async () => { await splashDone; await scanSms(); if (!smsQueue.length) showToast('That transaction was already added or ignored.', 'info'); });
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
const renderBankConnections = () => {
    const plugin = smsPlugin();
    const p = smsPrefs();
    const s = bankStatus;
    // The standard and Google Play editions leave SMS out (Play Protect blocks it for apps installed from WhatsApp
    // or a browser, and Google Play only allows it after approval): explain sharing instead of a switch that can't work.
    const noSms = !!(s && s.smsAvailable === false);
    const shareOnly = !plugin || noSms;
    $('bank-web-note').hidden = !shareOnly;
    $('bank-web-note').innerHTML = !plugin
        ? 'Automatic SMS detection works in the Vela Android app. Here you can paste a bank SMS to add it.'
        : 'This version of Vela doesn’t read SMS by itself (Google blocks SMS access for apps installed from WhatsApp, a browser or Google Play without approval). Add ComBank transactions by <strong>sharing a bank SMS to Vela</strong> from your Messages app, or tap <strong>Check a bank SMS</strong>. Automatic detection needs <strong>Vela Full</strong>.';
    $('bank-conns').hidden = shareOnly;
    $('bank-options').hidden = shareOnly;
    $('btn-bank-disconnect').hidden = shareOnly;
    const sms = noSms ? { state: 'off', text: 'Not in this version' } : smsConnState(s);
    setSwitch($('switch-sms'), !noSms && !!(s ? s.smsEnabled : p.enabled));
    setSwitch($('switch-bank-pause'), !!(s ? s.paused : p.paused));
    setSwitch($('switch-sms-auto'), p.autoAdd);
    $('bank-sms-state').dataset.state = sms.state;
    $('bank-sms-state').textContent = sms.text;
    $('bank-sms-help').hidden = !sms.help;
    $('bank-sms-help').innerHTML = sms.help || '';
    const overall = !plugin ? { state: 'off', text: 'Android only' } : noSms ? { state: 'off', text: 'Share & paste' } : (s && s.paused) ? { state: 'paused', text: 'Paused' }
        : sms.state === 'on' ? { state: 'on', text: 'Connected' } : sms.state === 'warn' ? { state: 'warn', text: 'Needs attention' } : { state: 'off', text: 'Not connected' };
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
    const warnNotif = s && s.smsEnabled && !s.postNotifications;
    $('bank-sub').textContent = warnNotif ? 'Vela’s notifications are off: you’ll see new transactions when you open Vela.' : 'Detects your transactions from bank SMS';
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
    title: 'Disconnect Commercial Bank?',
    message: 'Vela stops reading bank SMS and deletes everything waiting for review. Transactions you already added stay. To remove the permission too, open App info › Permissions › SMS › Don’t allow.',
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
        showToast('Commercial Bank disconnected', 'success');
    }
});

/* ---- Payments: entries waiting to be paid, and fixed expenses you pay yourself ---- */
const paymentItems = ({ horizonDays = 7 } = {}) => {
    const horizon = toISODate(addDays(new Date(), horizonDays));
    const items = [];
    state.transactions.filter((t) => t.pending && t.type !== 'transfer').forEach((t) => items.push({
        key: `tx:${t.id}`, kind: 'tx', id: t.id, name: t.desc, type: t.type, amount: t.amount, currency: t.currency, category: t.category, due: t.date, status: payStatus(t.date)
    }));
    state.recurring.filter((b) => !b.autoLog).forEach((b) => items.push({
        key: `bill:${b.id}`, kind: 'bill', id: b.id, name: b.name, type: b.type, amount: b.amount, currency: b.currency, category: b.category, due: b.nextDate, status: payStatus(b.nextDate)
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
const askMarkPaid = (key) => {
    const i = paymentByKey(key);
    if (!i) return;
    const income = i.type === 'income';
    showConfirm({
        title: income ? 'Has this money arrived?' : 'Have you completed this payment?',
        message: `${i.name} · ${formatCurrency(i.amount, i.currency)} · ${i.status === 'overdue' ? 'was due' : 'due'} ${shortDate(i.due)}. It will be recorded as ${income ? 'received' : 'paid'} today and counted in your balance.`,
        confirmLabel: income ? 'Yes, mark as received' : 'Yes, mark as paid',
        cancelLabel: 'Not yet',
        danger: false,
        onConfirm: () => markPaid(key)
    });
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
        ${catBadge(i.category, i.type)}
        <div class="pay-main"><span class="pay-name">${escapeHtml(i.name)}</span><span class="pay-meta"><span class="pay-pill" data-status="${i.status}">${payStatusLabel(i.status, i.type)}</span>${escapeHtml(when)}</span></div>
        <div class="pay-end"><span class="amount ${income ? 'text-income' : ''}">${escapeHtml(formatCurrency(i.amount, i.currency))}</span>
        <button type="button" class="btn btn-xs ${income ? 'btn-income' : 'btn-primary'}" data-pay="${escapeHtml(i.key)}">${income ? 'Mark received' : 'Mark as paid'}</button></div>
    </li>`;
};
const paymentSummary = (items) => {
    const n = (s) => items.filter((i) => i.status === s).length;
    return [n('overdue') ? `${n('overdue')} overdue` : '', n('due') ? `${n('due')} due today` : '', n('upcoming') ? `${n('upcoming')} upcoming` : ''].filter(Boolean).join(' · ');
};
const renderPaymentsHome = () => {
    const items = paymentItems();
    const autoSoon = state.recurring.filter((b) => b.autoLog && b.type === 'expense' && b.nextDate <= toISODate(addDays(new Date(), 7))).sort((a, b) => (a.nextDate > b.nextDate ? 1 : -1));
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
    const items = paymentItems().filter((i) => i.status !== 'upcoming');
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
    const items = paymentItems().filter((i) => i.status !== 'upcoming');
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
    let size = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > el.clientWidth + 1 && size > 18) {
        size -= 2;
        el.style.fontSize = `${size}px`;
    }
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

    $('dash-month-label').textContent = `${now.toLocaleDateString('en-US', { month: 'long' })} balance`;
    countUp($('dash-balance'), s.net, cur);
    const nowD = new Date();
    const coming = state.transactions.filter((t) => isUpcoming(t) && t.type === 'income' && inMonth(t, nowD.getFullYear(), nowD.getMonth()))
        .sort((a, b) => (a.date > b.date ? 1 : -1));
    const comingNote = coming.length ? ` · ${formatCompact(sumDisplay(coming), cur)} coming ${shortDate(coming[0].date)}` : '';
    $('dash-balance-sub').textContent = (s.income > 0
        ? `${Math.max(0, Math.round((s.net / s.income) * 100))}% of this month's income left`
        : (s.spent > 0 ? "Add your income to see what's left" : 'Income minus spending this month')) + comingNote;
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

    setMeter($('dash-budget-fill'), s.budgetPct, budgetState(s.budgetPct));
    $('dash-budget-meter').setAttribute('aria-valuenow', String(Math.round(Math.min(100, s.budgetPct))));
    $('dash-budget-desc').textContent = s.fromIncome && s.plannedIncome <= 0 ? 'Add income to set your budget' : `${Math.round(s.budgetPct)}% of ${fitMoney(s.budget, cur, 11)} budget${s.fromIncome ? ' (from income)' : ''}`;
    const left = s.budget - s.spent;
    $('dash-budget-left').innerHTML = left >= 0
        ? `<strong>${escapeHtml(fitMoney(left, cur, 12))}</strong> left`
        : `<strong>${escapeHtml(fitMoney(-left, cur, 12))}</strong> over`;

    const savedTotal = state.savings.reduce((sum, g) => sum + toDisplay(g.saved, g.currency), 0);
    setMoney($('dash-total-savings'), savedTotal, cur, 12);
    $('dash-savings-status').textContent = state.savings.length ? `across ${plural(state.savings.length, 'goal')}` : 'Tap to create a goal';

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
    setMoney($('networth'), netWorth(), cur, 16);
    $('account-strip').innerHTML = state.accounts.map((a) => {
        const bal = accountBalance(a);
        return `<button type="button" class="account-chip" data-account-filter="${escapeHtml(a.id)}" aria-label="${escapeHtml(a.name)}: ${escapeHtml(formatCurrency(bal, a.currency))}. Show its activity">
            <span class="account-chip-top"><span class="account-icon">${icon(accountIcon(a))}</span><span class="account-name">${escapeHtml(a.name)}</span></span>
            <span class="account-bal amount ${bal < 0 ? 'text-expense' : ''}" title="${escapeHtml(formatCurrency(bal, a.currency))}" ${moneyAttrs(bal, a.currency)}>${escapeHtml(formatCurrency(bal, a.currency))}</span>
        </button>`;
    }).join('') + `<button type="button" class="account-chip account-add" data-action="add-account">${icon('i-plus')}<span>Add account</span></button>`;

    // Waiting payments live in the Payments card above; Recent is money that really moved.
    const recent = sortByNewest(state.transactions.filter((t) => !t.pending)).slice(0, 6);
    $('recent-list').innerHTML = recent.length
        ? recent.map((t) => txRow(t)).join('')
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
    fillAccountSelect($('activity-account'), activityAccount, { all: true });
    activityAccount = $('activity-account').value;
    $('activity-account-wrap').hidden = state.accounts.length < 2;

    const chipCats = activityType === 'all' ? state.categories : catsOfType(activityType);
    if (activityCategory !== 'all' && !chipCats.some((c) => c.id === activityCategory)) activityCategory = 'all';
    $('activity-chips').innerHTML = [`<button type="button" class="chip" data-filter-category="all" aria-pressed="${activityCategory === 'all'}">All</button>`]
        .concat(chipCats.map((c) => `<button type="button" class="chip" data-filter-category="${escapeHtml(c.id)}" aria-pressed="${activityCategory === c.id}" style="--cat:${catColor(c)}"><span class="chip-dot"></span>${escapeHtml(c.name)}</button>`))
        .join('');

    const scoped = state.transactions.filter((t) => inAccount(t, activityAccount));
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
    $('activity-status').innerHTML = [['all', 'All'], ['paid', 'Paid'], ['unpaid', 'Unpaid'], ['upcoming', 'Upcoming'], ['overdue', 'Overdue'], ['bank', 'From bank']]
        .map(([v, label]) => `<button type="button" class="chip" data-activity-status="${v}" aria-pressed="${activityStatus === v}">${label}${v !== 'all' && v !== 'paid' ? ` <span class="chip-count">${scoped.filter(STATUS_TEST[v]).length}</span>` : ''}</button>`).join('');
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
    list.forEach((t) => {
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
        const label = `${shortDate(iso)}${out ? `, spent ${formatCurrency(out, cur)}` : ''}${inc ? `, earned ${formatCurrency(inc, cur)}` : ''}`;
        cells.push(`<button type="button" class="cal-day" data-cal-day="${iso}" style="--heat:${heat.toFixed(2)}" ${heat > 0.55 ? 'data-hot="true"' : ''} aria-pressed="${activityDay === iso}" ${iso === today ? 'aria-current="date"' : ''} aria-label="${escapeHtml(label)}">
            <span class="cal-num">${d}</span>
            ${out ? `<span class="cal-amt">${escapeHtml(formatCompact(out, cur).replace(/^[^\d-]+/, ''))}</span>` : ''}
            ${inc ? '<span class="cal-dot" aria-hidden="true"></span>' : ''}
        </button>`);
    }
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    el.innerHTML = `<div class="cal-grid">${names.map((n) => `<span class="cal-head" aria-hidden="true">${n.slice(0, 2)}</span>`).join('')}${cells.join('')}</div>
        <div class="cal-legend"><span><i class="cal-swatch"></i>More spending is a deeper green</span><span><i class="cal-dot"></i>Income</span></div>`;
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

    return `
    <article class="card glow" style="--glow:var(--pal-violet)">
        <div class="card-head"><h2 class="card-title">Monthly budget</h2><button type="button" class="btn btn-secondary btn-xs" data-edit-budget="__overall">${icon('i-edit', 'ic ic-sm')} Edit</button></div>
        <div class="big-number ${left < 0 ? 'text-expense' : ''}">${escapeHtml(formatCurrency(Math.abs(left), cur))}</div>
        <div class="card-sub" style="margin-bottom:var(--sp-3)">${s.fromIncome && s.plannedIncome <= 0
            ? 'Your budget follows your income. Add this month\u2019s salary or rent and it fills in by itself.'
            : left >= 0 ? `left of ${escapeHtml(formatCurrency(s.budget, cur))}. That's about ${escapeHtml(formatCurrency(perDay, cur))} a day for the next ${plural(daysLeft, 'day')}.` : `over your ${escapeHtml(formatCurrency(s.budget, cur))} budget`}</div>
        ${s.fromIncome ? `<div class="budget-source">${icon('i-arrow-down', 'ic ic-sm')}<span>From your income: ${escapeHtml(formatCurrency(s.plannedIncome, cur))} this month${state.config.budgetSavePct ? `, keeping ${state.config.budgetSavePct}% (${escapeHtml(formatCurrency(s.plannedIncome - s.budget, cur))}) for saving` : ''}</span></div>`
            : (s.plannedIncome > 0 ? `<button type="button" class="link-btn budget-switch" data-action="budget-from-income">${icon('i-arrow-down', 'ic ic-sm')} Use my income (${escapeHtml(formatCurrency(s.plannedIncome, cur))}) as the budget</button>` : '')}
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
            ${catBadge(b.category, b.type)}
            <span class="row-main"><span class="row-title">${escapeHtml(b.name)}</span><span class="row-sub">${FREQ_PHRASE[b.frequency]}, ${how}</span></span>
            <span class="row-end"><span class="amount ${b.type === 'income' ? 'text-income' : ''}">${escapeHtml(formatDisplay(b.amount, b.currency))}</span><span class="badge-due" data-tone="${dl.tone}">${escapeHtml(label)}</span></span>
        </button>
        ${b.autoLog ? '' : `<button type="button" class="btn btn-secondary btn-sm paid-btn" data-bill-paid="${escapeHtml(b.id)}">${icon('i-check', 'ic ic-sm')} ${b.type === 'income' ? 'Mark received' : 'Mark paid'}</button>`}
    </div>`;
};

const planBillsHtml = () => {
    const cur = dcur();
    const sorted = [...state.recurring].sort((a, b) => (a.nextDate > b.nextDate ? 1 : -1));
    const bills = sorted.filter((b) => b.type === 'expense');
    const inc = sorted.filter((b) => b.type === 'income');
    const billIds = new Set(state.recurring.map((b) => b.id));
    const oneOffFixed = state.transactions.filter((t) => t.type === 'expense' && t.fixed && (!t.recurringId || !billIds.has(t.recurringId)) && inMonth(t, new Date().getFullYear(), new Date().getMonth()));
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
    if (!state.savings.length) {
        return `<div class="card">${emptyState({ iconId: 'i-target', title: 'No savings goals yet', text: 'Pick something to save for, set a date, and Vela tells you how much to put away each month.', actionLabel: 'Create a goal', action: 'add-goal' })}</div>`;
    }
    const saved = state.savings.reduce((s, g) => s + toDisplay(g.saved, g.currency), 0);
    const target = state.savings.reduce((s, g) => s + toDisplay(g.target, g.currency), 0);
    const pct = target > 0 ? (saved / target) * 100 : 0;
    const cards = state.savings.map((g) => {
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
        return `<article class="card row-card plan-half">
            <div class="row-top"><span class="cat-badge" style="--cat:var(--pal-${done ? 'green' : 'violet'})">${icon('i-target')}</span><div class="row-main"><span class="row-title">${escapeHtml(g.name)}</span><span class="row-sub">${g.currency !== cur ? `Saving in ${g.currency}` : 'Savings goal'}</span></div><span class="goal-pct" data-done="${done}">${Math.floor(Math.min(p, 999))}%</span></div>
            <div class="goal-figures"><span class="amount">${escapeHtml(formatDisplay(g.saved, g.currency))}</span><span>of ${escapeHtml(formatDisplay(g.target, g.currency))}</span></div>
            ${meterHtml(p, done ? 'done' : null, `${g.name} progress`)}
            <div class="goal-hint">${hint}</div>
            <div class="row-actions">
                <button type="button" class="btn btn-primary btn-sm" data-deposit-goal="${escapeHtml(g.id)}">${icon('i-deposit', 'ic ic-sm')} Deposit</button>
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
    </article>
    ${cards}`;
};

const planDebtsHtml = () => {
    const cur = dcur();
    if (!state.debts.length) {
        return `<div class="card">${emptyState({ iconId: 'i-users', title: 'No debts tracked', text: 'Keep track of money you lent to friends or borrowed, and record repayments as they come.', actionLabel: 'Add a debt', action: 'add-debt' })}</div>`;
    }
    const { owedToYou, youOwe } = debtTotals();
    const open = state.debts.filter((d) => d.repaid < d.amount);
    const settled = state.debts.filter((d) => d.repaid >= d.amount);
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
    const cur = dcur();
    setPressed('.range-btn', (b) => b.dataset.analyticsRange === analyticsRange);
    $('analytics-range-label').textContent = RANGE_LABELS[analyticsRange];

    const list = txInRange(analyticsRange);
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
    setSwitch($('switch-biometric'), lock.biometric);
    const native = !!nativePlugin('LocalNotifications');
    setSwitch($('switch-reminders'), native && state.config.reminders && notifPermission !== 'denied');
    $('reminders-desc').textContent = !native
        ? 'Works in the Android app. Here, bills due soon show on Home.'
        : state.config.reminders && notifPermission === 'denied'
            ? 'Blocked by Android. Allow notifications for Vela in Android settings, then turn this on.'
            : 'The day before each bill, and every evening at 8 pm.';
    $('btn-test-notif').hidden = !native;
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

const baseOptions = (t) => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: reducedMotion() ? 0 : 450 },
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
        x: { grid: { display: false }, border: { display: false }, ticks: { color: t.text, font: { family: 'Inter', size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } },
        y: { beginAtZero: true, grid: { color: t.grid }, border: { display: false }, ticks: { color: t.text, font: { family: 'Inter', size: 10 }, maxTicksLimit: 5, callback: (v) => formatCompact(v, dcur()) } }
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
            labels.push(c.toLocaleDateString('en-US', span > 366 ? { month: 'short', year: '2-digit' } : { month: 'short' }));
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
            labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
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
    destroyChart(key);
    if (!chartsReady()) { showChartMessage(emptyId, 'Charts load when you are online.'); return; }
    const t = chartTheme();
    const has = data.income.some((v) => v > 0) || data.spent.some((v) => v > 0);
    showChartMessage(emptyId, has ? '' : 'Nothing logged in this period');
    const ds = (label, values, color) => ({ label, data: values, backgroundColor: hexToRgba(color, 0.85), hoverBackgroundColor: color, borderRadius: 4, borderSkipped: false, maxBarThickness: 16, categoryPercentage: 0.8, barPercentage: 0.9 });
    charts[key] = new Chart($(canvasId), {
        type: 'bar',
        data: { labels: data.labels, datasets: [ds('Income', data.income, t.income), ds('Spent', data.spent, t.expense)] },
        options: baseOptions(t)
    });
};

const renderTrendChart = () => {
    const today = startOfDay(new Date());
    const start = dashboardRange === '30' ? addDays(today, -29) : new Date(today.getFullYear(), today.getMonth() - 11, 1);
    const list = state.transactions.filter((x) => { const d = parseDate(x.date); return d >= start && d <= today; });
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
            animation: { duration: reducedMotion() ? 0 : 450 },
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
const setTxKind = (kind) => {
    const editing = $('tx-id').value ? state.transactions.find((t) => t.id === $('tx-id').value) : null;
    const fromBill = !!(editing && editing.recurringId);
    txKind = fromBill ? 'fixed' : kind;
    setPressed('[data-tx-kind]', (b) => b.dataset.txKind === txKind);
    document.querySelectorAll('[data-tx-kind]').forEach((b) => { b.disabled = fromBill; });
    $('tx-kind-field').hidden = txType !== 'expense';
    $('tx-repeat-row').hidden = !(txType === 'expense' && txKind === 'fixed' && !editing);
    $('tx-kind-hint').textContent = fromBill
        ? `Logged from your fixed expense "${(state.recurring.find((b) => b.id === editing.recurringId) || {}).name || editing.desc}". Change it in Plan > Fixed.`
        : txKind === 'fixed' ? 'Fixed: the same every month, like rent or internet. It is taken off your income for the month.' : 'Variable: changes from month to month, like food or transport.';
};

const buildCategoryPicker = (type, selected) => {
    $('tx-category-picker').innerHTML = catsOfType(type).map((c) => `
        <label class="cat-option" style="--cat:${catColor(c)}">
            <input type="radio" name="tx-category" value="${escapeHtml(c.id)}" ${c.id === selected ? 'checked' : ''}>
            <span class="cat-option-box">${catBadge(c.id, type)}<span>${escapeHtml(c.name)}</span></span>
        </label>`).join('') + `
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
    if ($('tx-source')) $('tx-source').hidden = true;
    $('tx-form').reset();
    txHistory = historyStats();
    txCatTouched = false;
    txKind = 'variable';
    txKindTouched = false;
    setSwitch($('tx-repeat'), true);
    $('tx-id').value = '';
    $('btn-delete-tx').hidden = true;
    fillAccountSelect($('tx-account'), activityAccount !== 'all' ? activityAccount : state.config.lastAccount);
    $('tx-account-field').hidden = state.accounts.length < 2;
    setReceiptDraft(null);
    fillCurrencySelect($('tx-currency'), dcur());
    $('tx-date').value = todayISO();
    txWaiting = false;
    setTxType(type);
    openOrSwap('modal-tx');
};

const openEditTx = (id) => {
    smsEditing = null;
    const t = state.transactions.find((x) => x.id === id);
    if (!t) return;
    if (t.type === 'transfer') { openTransfer(t.id); return; }
    $('tx-form').reset();
    txHistory = historyStats();
    txCatTouched = true;
    txKind = t.fixed ? 'fixed' : 'variable';
    txKindTouched = true;
    fillAccountSelect($('tx-account'), t.accountId);
    $('tx-account-field').hidden = state.accounts.length < 2;
    setReceiptDraft(t);
    $('tx-id').value = t.id;
    $('btn-delete-tx').hidden = false;
    $('tx-amount').value = t.amount;
    fillCurrencySelect($('tx-currency'), t.currency);
    $('tx-desc').value = t.desc;
    $('tx-date').value = t.date;
    $('tx-note').value = t.note || '';
    txWaiting = t.pending === true;
    setTxType(t.type, t.category);
    $('tx-source').hidden = false;
    $('tx-source').innerHTML = t.bank
        ? `${icon('i-check', 'ic ic-sm')}<span>${escapeHtml(`${t.bank.bank} – ${sourceLabel(t.bank.sources || ['sms'])}`)}${t.bank.ref ? ` · Ref ${escapeHtml(t.bank.ref)}` : ''}${t.bank.last4 ? ` · ••${escapeHtml(t.bank.last4)}` : ''} · Bank-verified</span>`
        : '<span>Manual entry</span>';
    openOrSwap('modal-tx');
};

const budgetAlert = (categoryId) => {
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
    if (!desc) return fieldError($('tx-desc'), txType === 'income' ? 'Add where the money came from, like "Salary".' : 'Add a short description, like "Groceries".');
    if (!isISODate(date)) return fieldError($('tx-date'), 'Pick a date.');

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
        record = { ...prev, type: txType, desc, amount, currency, category, date, note, accountId, receipt, fixed: txType === 'expense' && (txKind === 'fixed' || !!prev.recurringId), pending: waiting };
        // Marked done here: same as tapping Received / Paid. Marked not done: it waits again, with reminders.
        if (prev.pending && !waiting) { record.paidAt = new Date().toISOString(); record.dueDate = prev.dueDate || prev.date; cancelPaymentReminders(`tx:${id}`); }
        if (!prev.pending && waiting) delete record.paidAt;
        if (prev.pending !== waiting) setTimeout(scheduleReminders, 0);
        state.transactions[idx] = record;
    } else {
        record = { id: generateId(), type: txType, desc, amount, currency, category, date, note, createdAt: Date.now(), recurringId: null, accountId, receipt, fixed: txType === 'expense' && txKind === 'fixed', pending: date > todayISO() || txWaiting };
        if (record.pending) setTimeout(scheduleReminders, 0);
        // A new fixed expense that repeats becomes a monthly fixed expense (a bill); this entry is its first payment.
        if (record.fixed && isOn($('tx-repeat'))) {
            const day = parseDate(date).getDate();
            const bill = { id: generateId(), type: 'expense', name: desc, amount, currency, category, frequency: 'monthly', nextDate: advanceDate(date, 'monthly', day), anchorDay: day, autoLog: true, accountId, createdAt: Date.now() };
            state.recurring.push(bill);
            record.recurringId = bill.id;
            queueSync('recurring', bill.id, 'upsert', false);
            setTimeout(scheduleReminders, 0);
        }
        state.transactions.push(record);
    }
    state.config.lastCategory[txType] = category;
    state.config.lastAccount = accountId;
    if (smsEditing && !id) smsEditSaved(record);
    saveState();
    haptic('MEDIUM');
    queueSync('transaction', record.id, 'upsert');
    if (receipt && !receipt.path) uploadReceipt(record);
    closeSheet('modal-tx');
    if (txType === 'income') {
        const d = parseDate(date);
        const f = fixedForMonth(d.getFullYear(), d.getMonth());
        const c = dcur();
        showToast(f.total > 0
            ? `${monthName(d.getFullYear(), d.getMonth(), { month: 'long' })}: income ${formatCurrency(f.income, c)} − fixed ${formatCurrency(f.total, c)} = ${formatCurrency(f.left, c)} left${isUpcoming(record) ? ` (this income counts from ${shortDate(date)})` : ''}`
            : (isUpcoming(record) ? `Saved as waiting: ${formatCurrency(amount, currency)} on ${shortDate(date)}. Tap “Received” when it arrives and it counts in your balance.` : `Income added: ${formatCurrency(amount, currency)}`), 'success');
    } else if (isUpcoming(record)) {
        showToast(`Saved as waiting: ${formatCurrency(amount, currency)} on ${shortDate(date)}. Tap “Paid” when it’s done and it counts in your balance.`, 'info');
    } else {
        showToast(id ? 'Saved' : `${txType === 'income' ? 'Income' : 'Expense'} added: ${formatCurrency(amount, currency)}`, 'success');
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
            if (t.receipt) removeReceipt(t.receipt);
            state.transactions = state.transactions.filter((x) => x.id !== id);
            saveState();
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
let txCatTouched = false;
let txPicks = [];

const selectTxCategory = (id) => {
    const input = document.querySelector(`input[name="tx-category"][value="${CSS.escape(id)}"]`);
    if (input) input.checked = true;
};

const renderTxSuggest = () => {
    const wrap = $('tx-suggest');
    const show = txType === 'expense' && !$('tx-id').value;
    wrap.hidden = !show;
    if (!show) return;
    const cur = normCur($('tx-currency').value);
    const q = normDesc($('tx-desc').value);
    const book = priceList(cur);

    let picks = smartPicks(cur, 999);
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
    if (!txKindTouched) txKind = FIXED_HINT.test(p.name) || p.category === 'Rent' || p.category === 'Utilities' ? 'fixed' : 'variable';
    $('tx-desc').value = p.name;
    $('tx-amount').value = p.price;
    if (expenseCatExists(p.category)) { selectTxCategory(p.category); txCatTouched = true; }
    clearFieldErrors($('tx-form'));
    haptic();
    renderTxSuggest();
    updatePriceHint();
};

const guessCategory = (desc) => {
    const key = normDesc(desc);
    if (key.length < 2) return null;
    const g = txHistory.get(key);
    if (g && expenseCatExists(g.last.category)) return g.last.category;
    const item = priceList(normCur($('tx-currency').value)).items.find((i) => normDesc(i.name) === key);
    if (item) return item.category;
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
        const item = priceList(cur).items.find((i) => normDesc(i.name) === key);
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
    if (txType === 'expense' && !txKindTouched && !$('tx-id').value) setTxKind(FIXED_HINT.test($('tx-desc').value) ? 'fixed' : 'variable');
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
    const usual = [...hist.values()].filter((g) => g.count >= 2).map((g) => {
        const sameTime = state.transactions.filter((t) => t.type === 'expense' && t.createdAt && normDesc(t.desc) === g.key && daySlot(new Date(t.createdAt)) === slot).length;
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
        <div class="bot-card-row">${catBadge(d.category, d.type)}<div class="bot-card-main"><strong>${escapeHtml(d.desc)}</strong><span>${escapeHtml(cat.name)} · ${escapeHtml(relativeDayLabel(d.date))}</span></div>
        <span class="amount ${d.type === 'income' ? 'text-income' : ''}">${escapeHtml(formatCurrency(d.amount, d.currency))}</span></div>
        <div class="bot-card-actions"><button type="button" class="btn btn-secondary btn-sm" data-bot-edit="${id}">Change</button><button type="button" class="btn ${d.type === 'income' ? 'btn-income' : 'btn-primary'} btn-sm" data-bot-add="${id}">Add ${d.type}</button></div>
    </div>`;
};

const quickSaveTx = (d) => {
    if (!state.accounts.length) ensureAccounts(state);
    const acc = state.accounts.find((a) => a.id === d.accountId) || state.accounts.find((a) => a.id === state.config.lastAccount) || state.accounts[0];
    const record = { id: generateId(), type: d.type, desc: d.desc, amount: d.amount, currency: d.currency, category: d.category, date: d.date, note: d.note || '', createdAt: Date.now(), recurringId: null, accountId: acc.id, receipt: null, fixed: d.type === 'expense' && !!d.fixed, pending: d.date > todayISO() };
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
    openOrSwap('modal-goal');
};

const submitGoal = () => {
    const id = $('goal-id').value;
    const name = $('goal-name').value.trim();
    const target = toNumber($('goal-target').value, NaN);
    const currency = normCur($('goal-currency').value);
    const savedRaw = $('goal-saved').value.trim();
    const saved = savedRaw === '' ? 0 : toNumber(savedRaw, NaN);
    const deadline = $('goal-deadline').value || null;
    if (!name) return fieldError($('goal-name'), 'Give your goal a name.');
    if (!(target > 0)) return fieldError($('goal-target'), 'Enter a target greater than zero.');
    if (!(saved >= 0)) return fieldError($('goal-saved'), "The saved amount can't be negative.");
    let record;
    if (id) {
        const idx = state.savings.findIndex((g) => g.id === id);
        if (idx === -1) return false;
        record = { ...state.savings[idx], name, target, currency, saved, deadline };
        state.savings[idx] = record;
    } else {
        record = { id: generateId(), name, target, currency, saved, deadline, createdAt: Date.now() };
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
    if (!state.savings.length) {
        showToast('Create a savings goal first, then deposit into it.', 'info');
        openAddGoal();
        return;
    }
    const select = $('funds-goal');
    select.innerHTML = state.savings.map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join('');
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
    const wasDone = goal.saved >= goal.target;
    goal.saved = round2(Math.max(0, goal.saved + (fundsMode === 'withdraw' ? -delta : delta)));
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
const syncBudgetModeUi = () => {
    const overall = $('budget-category').value === '__overall';
    const income = overall && budgetModeDraft === 'income';
    $('budget-mode-field').hidden = !overall;
    $('budget-income-field').hidden = !income;
    $('budget-amount-field').hidden = income;
    setPressed('[data-budget-mode]', (b) => b.dataset.budgetMode === budgetModeDraft);
    setPressed('[data-budget-save]', (b) => Number(b.dataset.budgetSave) === budgetSaveDraft);
    if (income) {
        const now = new Date();
        const s = monthStats(now.getFullYear(), now.getMonth());
        const cur = dcur();
        const budget = s.plannedIncome * (1 - budgetSaveDraft / 100);
        $('budget-income-hint').textContent = s.plannedIncome > 0
            ? `This month's income is ${formatCurrency(s.plannedIncome, cur)}, so your budget is ${formatCurrency(budget, cur)}${budgetSaveDraft ? ` and ${formatCurrency(s.plannedIncome - budget, cur)} goes to saving` : ''}. It grows by itself when you add income.`
            : 'No income added this month yet. Add your salary or rent and your budget fills in by itself.';
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
    syncBudgetModeUi();
    openOrSwap('modal-budget');
};

const submitBudget = () => {
    const catId = $('budget-category').value;
    if (catId === '__overall' && budgetModeDraft === 'income') {
        state.config.budgetMode = 'income';
        state.config.budgetSavePct = budgetSaveDraft;
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
    fillBillCategories(type, selected);
    $('bill-name').placeholder = type === 'income' ? 'e.g. Salary' : 'e.g. Netflix, Rent';
};

const openAddBill = (type = 'expense') => {
    $('bill-form').reset();
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
    $('bill-id').value = b.id;
    $('bill-title').textContent = b.type === 'income' ? 'Edit regular income' : 'Edit bill';
    $('btn-delete-bill').hidden = false;
    $('bill-name').value = b.name;
    $('bill-amount').value = b.amount;
    fillCurrencySelect($('bill-currency'), b.currency);
    $('bill-frequency').value = b.frequency;
    $('bill-next').value = b.nextDate;
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
        autoLog: isOn($('bill-auto')),
        accountId: $('bill-account').value || state.accounts[0].id
    };
    let record;
    if (id) {
        const idx = state.recurring.findIndex((b) => b.id === id);
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

const setDebtDir = (dir) => {
    debtDir = dir;
    setPressed('[data-debt-dir]', (b) => b.dataset.debtDir === dir);
    $('debt-person-label').textContent = dir === 'lent' ? 'Who did you lend to?' : 'Who did you borrow from?';
};

const openAddDebt = () => {
    $('debt-form').reset();
    $('debt-id').value = '';
    $('debt-title').textContent = 'New debt';
    $('btn-delete-debt').hidden = true;
    fillCurrencySelect($('debt-currency'), dcur());
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
    const data = { direction: debtDir, person, amount, currency, repaid, dueDate: $('debt-due').value || null, note: $('debt-note').value.trim() };
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
    showToast(id ? 'Saved' : `${debtDir === 'lent' ? `${person} owes you` : `You owe ${person}`} ${formatCurrency(amount, currency)}`, 'success');
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

const renderCategoryManager = () => {
    const section = (type, title) => `
        <div class="section-head"><h2>${title}</h2></div>
        <ul class="cat-manage">${catsOfType(type).map((c) => `
            <li><button type="button" class="row-btn" data-edit-category="${escapeHtml(c.id)}">
                ${catBadge(c.id, type)}
                <span class="row-label"><span>${escapeHtml(c.name)}</span><span>${c.builtIn ? 'Built in. You can rename it or change its look.' : 'Added by you'}</span></span>
                ${icon('i-chevron', 'ic chev')}
            </button></li>`).join('')}</ul>`;
    $('categories-body').innerHTML = section('expense', 'Expenses') + section('income', 'Income');
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
    catEditType = c ? c.type : (presetType || 'expense');
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
    saveState();
    queueSync('category', record.id, 'upsert');
    showToast(id ? 'Category updated' : `Category "${name}" added`, 'success');
    if (catReturnToTx && !id) {
        catReturnToTx = false;
        state.config.lastCategory[catEditType] = record.id;
        hideSheet('modal-category');
        history.replaceState({ vela: 'sheet', id: 'modal-tx', tab: currentTab }, '');
        showSheetElement('modal-tx');
        buildCategoryPicker(txType, record.id);
    } else if (catReturnToManager) {
        backToCategoryManager();
    } else {
        closeSheet('modal-category');
    }
    renderActive();
    return true;
};

const deleteCategory = (id) => {
    const c = state.categories.find((x) => x.id === id);
    if (!c || c.builtIn) return;
    const used = state.transactions.filter((t) => t.category === id).length + state.recurring.filter((b) => b.category === id).length;
    const fallback = catById(FALLBACK_CATEGORY[c.type], c.type);
    showConfirm({
        title: `Delete "${c.name}"?`,
        message: used ? `${plural(used, 'entry', 'entries')} will move to "${fallback.name}".` : 'This category is not used yet.',
        onConfirm: () => {
            state.transactions.forEach((t) => { if (t.category === id) { t.category = fallback.id; queueSync('transaction', t.id, 'upsert', false); } });
            state.recurring.forEach((b) => { if (b.category === id) { b.category = fallback.id; queueSync('recurring', b.id, 'upsert', false); } });
            if (state.config.categoryBudgets[id]) { delete state.config.categoryBudgets[id]; state.syncSettings = true; }
            state.categories = state.categories.filter((x) => x.id !== id);
            saveState();
            queueSync('category', id, 'delete');
            if (catReturnToManager) backToCategoryManager();
            else closeSheet('modal-category');
            showToast('Category deleted', 'success');
            renderActive();
        }
    });
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
        state.transactions = by.transaction.map((t) => normalizeTx(t)).filter(Boolean);
        state.savings = by.goal.map(normalizeGoal).filter(Boolean);
        state.recurring = by.recurring.map(normalizeBill).filter(Boolean);
        state.debts = by.debt.map(normalizeDebt).filter(Boolean);
        state.categories = mergeCategories(by.category);
        const hadSettings = !set.error && set.data && set.data.data;
        if (hadSettings) applyCloudSettings(set.data.data);
        recoverAccounts();
        ensureAccounts(state);
        state.settingsUser = state.auth.user.id;
        if (hadSettings) {
            // In step with the account; only real changes from here on are sent.
            state.settingsSig = settingsSigNow();
            state.syncSettings = false;
        } else if (!set.error) {
            state.syncSettings = true; // the account has no settings yet: save this phone's
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

const handleSession = async (session) => {
    if (!session || !session.user) return;
    const user = session.user;
    if (handledUserId === user.id) return;
    handledUserId = user.id;

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
    if (!url || !url.startsWith(NATIVE_AUTH_REDIRECT)) return;
    const browser = nativePlugin('Browser');
    if (browser) browser.close().catch(() => {});
    if (!supabaseClient) return;
    let parsed;
    try { parsed = new URL(url); } catch (err) { return; }
    const query = parsed.searchParams;
    const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''));
    const errorText = query.get('error_description') || hash.get('error_description');
    if (errorText) { showToast(`Sign-in didn't finish: ${errorText}`, 'error'); return; }
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
            await handleSession(session);
            if (state.auth.completedOnboarding) showToast(`Signed in as ${displayName()}`, 'success');
        }
    } catch (err) {
        console.error('Could not finish sign-in:', err);
        showToast(friendlyAuthError(err), 'error');
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
            try { localStorage.removeItem(SMS_KEY); } catch (e) { /* ignore */ }
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

const seedData = () => {
    const today = new Date();
    const ago = (n) => toISODate(addDays(today, -n));
    const ahead = (n) => toISODate(addDays(today, n));
    const now = Date.now();
    const tx = (type, desc, amount, currency, category, daysAgo, note = '') => ({ id: generateId(), type, desc, amount, currency, category, date: ago(daysAgo), note, createdAt: now - daysAgo * 1000, recurringId: null });
    const firstOf = (monthsBack) => toISODate(new Date(today.getFullYear(), today.getMonth() - monthsBack, 1));
    state.transactions = [
        tx('expense', 'Groceries at Keells', 45.5, 'USD', 'Food', 1, 'Weekly shop'),
        tx('expense', 'Electricity bill', 15000, 'LKR', 'Utilities', 4, 'CEB monthly bill'),
        tx('expense', 'Apartment rent', 400, 'USD', 'Rent', 9),
        tx('expense', 'Netflix', 15.49, 'USD', 'Entertainment', 12),
        tx('expense', 'PickMe ride', 2400, 'LKR', 'Travel', 14, 'To the office'),
        tx('expense', 'Pharmacy', 35, 'USD', 'Health', 20, 'Prescriptions'),
        tx('expense', 'Lunch with team', 4200, 'LKR', 'Food', 3),
        tx('expense', 'Office chair', 120, 'USD', 'Shopping', 38),
        tx('expense', 'Fuel', 8500, 'LKR', 'Travel', 47, 'Full tank'),
        tx('expense', 'Fibre internet', 4800, 'LKR', 'Utilities', 64),
        tx('expense', 'Birthday dinner', 95, 'USD', 'Food', 101),
        tx('expense', 'Online course', 200, 'USD', 'Entertainment', 190),
        tx('income', 'Freelance website', 250, 'USD', 'Freelance', 6, 'Client: Lanka Tea Co.'),
        tx('income', 'Birthday gift', 10000, 'LKR', 'Gift', 101)
    ];
    [0, 1, 2].forEach((mb) => {
        state.transactions.push({ id: generateId(), type: 'income', desc: 'Salary', amount: 350000, currency: 'LKR', category: 'Salary', date: firstOf(mb), note: '', createdAt: now - mb * 1e6, recurringId: null });
    });
    state.savings = [
        { id: generateId(), name: 'Emergency fund', target: 5000, currency: 'USD', saved: 2400, deadline: toISODate(new Date(today.getFullYear() + 1, 5, 30)), createdAt: now },
        { id: generateId(), name: 'New laptop', target: 2500, currency: 'USD', saved: 750, deadline: null, createdAt: now },
        { id: generateId(), name: 'Trip to Ella', target: 150000, currency: 'LKR', saved: 45000, deadline: toISODate(new Date(today.getFullYear(), today.getMonth() + 4, 15)), createdAt: now }
    ];
    const bill = (type, name, amount, currency, category, frequency, nextDate, autoLog) => ({ id: generateId(), type, name, amount, currency, category, frequency, nextDate, anchorDay: parseDate(nextDate).getDate(), autoLog, createdAt: now });
    state.recurring = [
        bill('expense', 'Apartment rent', 400, 'USD', 'Rent', 'monthly', ahead(2), false),
        bill('expense', 'Netflix', 15.49, 'USD', 'Entertainment', 'monthly', ahead(5), true),
        bill('expense', 'Electricity', 15000, 'LKR', 'Utilities', 'monthly', ahead(12), false),
        bill('expense', 'Gym membership', 60000, 'LKR', 'Health', 'yearly', ahead(40), false),
        bill('income', 'Salary', 350000, 'LKR', 'Salary', 'monthly', firstOf(-1), true)
    ];
    state.debts = [
        { id: generateId(), direction: 'lent', person: 'Kasun', amount: 20000, currency: 'LKR', repaid: 5000, dueDate: ahead(20), note: 'Phone repair', createdAt: now },
        { id: generateId(), direction: 'borrowed', person: 'Amaya', amount: 50, currency: 'USD', repaid: 0, dueDate: ahead(10), note: 'Concert tickets', createdAt: now }
    ];
    state.config.categoryBudgets = { Food: 150, Entertainment: 50, Travel: 80 };
    state.accounts = [
        { id: 'acc-cash', name: 'Cash', kind: 'cash', currency: 'LKR', opening: 18000, createdAt: now },
        { id: generateId(), name: 'Commercial Bank', kind: 'bank', currency: 'LKR', opening: 420000, createdAt: now },
        { id: generateId(), name: 'Visa card', kind: 'card', currency: 'USD', opening: 0, createdAt: now }
    ];
    const [cash, bank, card] = state.accounts;
    state.transactions.forEach((t) => {
        t.accountId = t.type === 'income' ? bank.id : t.currency === 'USD' ? card.id : cash.id;
        t.receipt = null;
    });
    state.recurring.forEach((b) => { b.accountId = b.type === 'income' ? bank.id : b.currency === 'USD' ? card.id : bank.id; });
    state.transactions.push({ id: generateId(), type: 'transfer', desc: 'ATM withdrawal', amount: 20000, currency: 'LKR', accountId: bank.id, toAccountId: cash.id, toAmount: 20000, toCurrency: 'LKR', category: 'Transfer', date: ago(5), note: '', createdAt: now, recurringId: null, receipt: null });
    state.config.budget = 1500;
    state.config.budgetCurrency = 'USD';
    // Sample budgets are written in dollars; show them as round numbers in the main currency.
    const to = dcur();
    if (to !== 'USD') {
        state.config.budget = tidyBudget(convertAmount(state.config.budget, 'USD', to));
        Object.keys(state.config.categoryBudgets).forEach((k) => { state.config.categoryBudgets[k] = tidyBudget(convertAmount(state.config.categoryBudgets[k], 'USD', to)); });
        state.config.budgetCurrency = to;
    }
};

const completeOnboarding = async () => {
    await withBusy($('btn-complete-onboarding'), async () => {
        if (onboardingPreference === 'demo' && !state.transactions.length && !state.savings.length) {
            seedData();
            if (canSync()) queueAllForUpload();
        }
        state.auth.completedOnboarding = true;
        saveState();
        hideAuth();
        updateUserProfileUI();
        switchTab('dashboard', { fromHistory: true });
        flushSync();
        scheduleReminders();
        showToast(onboardingPreference === 'demo' ? 'Sample data added. Explore away!' : "You're all set. Tap + to add your first entry.", 'success');
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
        if (k === 'bio') return `<button type="button" class="key plain" data-${prefix}-key="bio" aria-label="Use fingerprint">${icon('i-fingerprint')}</button>`;
        return `<button type="button" class="key" data-${prefix}-key="${k}">${k}</button>`;
    }).join('');
};

const paintDots = (dotsEl, n) => dotsEl.querySelectorAll('span').forEach((s, i) => s.classList.toggle('filled', i < n));
const shake = (el) => { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); };
const isLocked = () => $('lock-screen').classList.contains('active');


/* ---- Fingerprint scanner: animated states for the lock screen ---- */
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
const fpPaths = (cls) => FP_PATHS.map((d, i) => `<path class="${cls}" pathLength="1" style="--i:${i}" d="${d}"/>`).join('');
const fpCoreHtml = () => `<svg class="fp-svg" viewBox="0 0 64 64" aria-hidden="true">
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
        if (!$('fp-core').firstChild) $('fp-core').innerHTML = fpCoreHtml();
        if (!bioBusy) setScanner('idle', 'Touch the sensor to unlock');
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
};

const tryBiometricUnlock = async () => {
    const bio = nativePlugin('NativeBiometric');
    if (!bio || bioBusy || !isLocked()) return;
    bioBusy = true;
    await splashDone;
    if (!isLocked()) { bioBusy = false; return; }
    setScanner('scanning', 'Scanning…');
    const started = Date.now();
    try {
        await bio.verifyIdentity({ reason: 'Unlock Vela', title: 'Unlock Vela', subtitle: 'Use your fingerprint or face', negativeButtonText: 'Use PIN', maxAttempts: 3 });
        await wait(Math.max(0, 1100 - (Date.now() - started))); // let the scan finish on screen
        setScanner('success', 'Welcome back');
        haptic('MEDIUM');
        await wait(750);
        unlockAnimated();
    } catch (err) {
        const why = String((err && (err.message || err.code)) || '');
        if (/cancel|negative|use pin|user/i.test(why)) {
            setScanner('idle', 'Tap the fingerprint to try again');
        } else {
            setScanner('error', 'Not recognised. Try again or use your PIN');
            haptic('HEAVY');
            await wait(1600);
            if (isLocked()) setScanner('idle', 'Tap the fingerprint to try again');
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
        await bio.verifyIdentity({ reason: 'Turn on fingerprint unlock', title: "Confirm it's you", negativeButtonText: 'Cancel' });
        state.config.lock.biometric = true;
        saveState();
        showToast('Fingerprint unlock is on', 'success');
    } catch (err) {
        showToast("Fingerprint wasn't confirmed, so it stays off.", 'info');
    }
    renderSettings();
};

const checkBiometric = async () => {
    const bio = nativePlugin('NativeBiometric');
    if (!bio) return;
    try {
        const res = await bio.isAvailable();
        biometricAvailable = !!(res && res.isAvailable);
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
        categories: state.categories
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
                state.config = { ...incoming.config, theme: state.config.theme, lock: state.config.lock, reminders: state.config.reminders, reminderIds: state.config.reminderIds };
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

const wipeData = () => {
    const cloud = canSync();
    showConfirm({
        title: 'Delete data on this device?',
        message: cloud
            ? 'Everything stored on this device will be removed. Your synced data stays in your account and comes back when the app reloads.'
            : `This permanently deletes ${plural(state.transactions.length, 'entry', 'entries')}, ${plural(state.savings.length, 'goal')}, bills and debts. Back up first if you might need them.`,
        confirmLabel: 'Delete everything',
        onConfirm: async () => {
            const ln = nativePlugin('LocalNotifications');
            if (ln && state.config.reminderIds.length) { try { await ln.cancel({ notifications: state.config.reminderIds.map((id) => ({ id })) }); } catch (e) { /* ignore */ } }
            storage.remove(STORAGE_KEY);
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
const onAppVisible = () => {
    if (state.config.lock.enabled && hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS && !isLocked()) showLock();
    hiddenAt = 0;
    processRecurring();
    if (pendingCount()) flushSync();
    renderActive();
    scanSms();
    refreshBankStatus();
    setTimeout(showPaymentsPopup, 900);
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
    document.addEventListener('click', (e) => {
        const el = e.target.closest('button, [data-tab], [data-goto]');
        if (!el) return;
        const d = el.dataset;

        if (d.lockKey) { onLockKey(d.lockKey); return; }
        if (d.pinKey) { onPinKey(d.pinKey); return; }
        if (d.tab) { switchTab(d.tab); return; }
        if (d.goto) { switchTab(d.goto); return; }
        if (d.gotoPlan) { goToPlan(d.gotoPlan); return; }
        if (d.gotoActivity) { goToActivity(d.gotoActivity); return; }
        if (d.planTab) { planTab = d.planTab; renderPlan(); return; }
        if (d.editTx) { openEditTx(d.editTx); return; }
        if (d.editGoal) { openEditGoal(d.editGoal); return; }
        if (d.depositGoal) { openDeposit(d.depositGoal); return; }
        if (d.editBudget) { openBudget(d.editBudget); return; }
        if (d.newBudget) { openBudget(); $('budget-category').value = d.newBudget; return; }
        if (d.editBill) { openEditBill(d.editBill); return; }
        if (d.billPaid) { askMarkPaid(`bill:${d.billPaid}`); return; }
        if (d.pay) { askMarkPaid(d.pay); return; }
        if (d.editDebt) { openEditDebt(d.editDebt); return; }
        if (d.repayDebt) { openRepay(d.repayDebt); return; }
        if (d.editCategory) { catReturnToTx = false; catReturnToManager = true; openCategoryEditor(d.editCategory); return; }
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
        if (d.bankFix) {
            const pl = smsPlugin();
            if (!pl) return;
            if (d.bankFix === 'check') {
                refreshBankStatus().then((s) => {
                    const ok = s && s.smsPermission === 'granted';
                    showToast(ok ? 'SMS access is allowed' : 'SMS access is still off', ok ? 'success' : 'info');
                    // Allowed in App info while tracking was on: start reading bank SMS now.
                    if (ok && s.smsEnabled) scanSms();
                });
                return;
            }
            pl.openAppSettings().catch(() => {});
            return;
        }
        if (d.activityStatus) { activityStatus = d.activityStatus; renderActivity(); return; }
        if (d.statusFilter) { activityStatus = d.statusFilter; activityType = 'all'; activityCategory = 'all'; activityView = 'list'; switchTab('activity'); return; }
        if (d.txKind) { txKindTouched = true; setTxKind(d.txKind); return; }
        if (d.txStatus) { setTxStatus(d.txStatus === 'waiting'); return; }
        if (d.pick) { const p = txPicks[Number(d.pick)]; if (p) applyPick(p); return; }
        if (d.starterPick) { starterPick(d.starterPick); return; }
        if (d.budgetMode) { budgetModeDraft = d.budgetMode; syncBudgetModeUi(); return; }
        if (d.budgetSave !== undefined) { budgetSaveDraft = Number(d.budgetSave); syncBudgetModeUi(); return; }
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
    $('btn-delete-category').addEventListener('click', () => deleteCategory($('category-id').value));
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
    $('tx-currency').addEventListener('change', () => { renderTxSuggest(); updatePriceHint(); });
    $('tx-desc').addEventListener('input', onTxDescInput);
    $('tx-date').addEventListener('input', updateDateHint);
    $('tx-repeat').addEventListener('click', (e) => setSwitch(e.currentTarget, !isOn(e.currentTarget)));
    $('budget-category').addEventListener('change', syncBudgetModeUi);
    $('tx-date').addEventListener('change', updateDateHint);
    $('tx-amount').addEventListener('input', updatePriceHint);
    $('tx-category-picker').addEventListener('change', () => { txCatTouched = true; });
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
    $('btn-test-notif').addEventListener('click', sendTestNotification);
    $('switch-sms').addEventListener('click', (e) => enableSmsTracking(!isOn(e.currentTarget)));
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
    $('btn-sms-all').addEventListener('click', () => { [...smsQueue].filter((i) => i.confidence === 'high' && i.type !== 'reversal').forEach((i) => (smsMatchFor(i) ? smsConfirmMatch(i.id) : smsAdd(i.id))); });
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
    ['opt-fresh-start', 'opt-demo-data'].forEach((id) => $(id).addEventListener('click', () => {
        onboardingPreference = id === 'opt-demo-data' ? 'demo' : 'fresh';
        $('opt-fresh-start').setAttribute('aria-pressed', String(onboardingPreference === 'fresh'));
        $('opt-demo-data').setAttribute('aria-pressed', String(onboardingPreference === 'demo'));
    }));
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
const renderAccountManager = () => {
    $('accounts-body').innerHTML = `<ul class="cat-manage">${state.accounts.map((a) => {
        const bal = accountBalance(a);
        return `<li><button type="button" class="row-btn" data-edit-account="${escapeHtml(a.id)}">
            <span class="row-icon tint">${icon(accountIcon(a))}</span>
            <span class="row-label"><span>${escapeHtml(a.name)}</span><span>${escapeHtml(ACCOUNT_KINDS[a.kind].label)}, ${a.currency}</span></span>
            <span class="amount ${bal < 0 ? 'text-expense' : ''}">${escapeHtml(formatCurrency(bal, a.currency))}</span>
        </button></li>`;
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
    fillCurrencySelect($('account-currency'), a ? a.currency : dcur());
    $('account-opening').value = a ? round2(accountBalance(a)) : '';
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
        a.opening = round2(a.opening + (balance - accountBalance(a)));
        showToast('Account saved', 'success');
    } else {
        state.accounts.push({ id: generateId(), name, kind, currency, opening: round2(balance), createdAt: Date.now() });
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
        app.addListener('appUrlOpen', (event) => handleNativeAuthRedirect(event && event.url));
        if (typeof app.getLaunchUrl === 'function') {
            app.getLaunchUrl().then((res) => { if (res && res.url) handleNativeAuthRedirect(res.url); }).catch(() => {});
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

/* ---- Splash: the mark draws on, then the screen slides up after ~1.1 s ---- */
const SPLASH_MS = 1080;
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
    setTimeout(() => { el.classList.add('play'); setTimeout(endSplash, SPLASH_MS); }, 420);
};

const init = () => {
    runSplash();
    loadState();
    migrateBudgets();
    fixAccountCurrencies();
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
