/**
 * Vela 3.0 — money tracker (phone first): expenses, income, budgets, bills,
 * savings goals, debts, reports, app lock. Runs as a website and as the
 * Android app (Capacitor) from the same code.
 */
'use strict';

/* =========================================================================
   1. Constants
   ========================================================================= */
const APP_VERSION = '3.1.0';
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
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c, builtIn: true })),
    config: {
        rate: 300,
        rateLocked: false,
        rateUpdatedAt: null,
        currency: 'USD',
        theme: prefersLight() ? 'light' : 'dark',
        budget: 1000,              // overall monthly budget, USD
        categoryBudgets: {},       // categoryId -> monthly limit, USD
        lastCategory: { expense: 'Food', income: 'Salary' },
        lock: { enabled: false, hash: null, salt: null, biometric: false },
        reminders: false,
        reminderIds: []
    },
    auth: { user: null, isMock: true, completedOnboarding: false },
    sync: {},            // id -> { kind, op: 'upsert' | 'delete' }
    syncSettings: false  // budgets / currency changed and not yet sent
});

let state = createDefaultState();
let supabaseClient = null;
let currentTab = 'dashboard';
let planTab = 'budgets';
let activityType = 'all';
let activityCategory = 'all';
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
    const n = typeof value === 'number' ? value : parseFloat(value);
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

/* ---- Money ---- */
const money2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyCompact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const symbolFor = (cur) => (cur === 'USD' ? '$' : 'Rs. ');
const convertAmount = (amount, from, to) => {
    if (from === to) return amount;
    const rate = state.config.rate;
    if (from === 'USD' && to === 'LKR') return amount * rate;
    if (from === 'LKR' && to === 'USD') return amount / rate;
    return amount;
};
const toDisplay = (amount, cur) => convertAmount(amount, cur, state.config.currency);
const formatCurrency = (amount, cur) => `${amount < 0 ? '-' : ''}${symbolFor(cur)}${money2.format(Math.abs(amount))}`;
const formatSigned = (amount, cur) => `${amount > 0 ? '+' : amount < 0 ? '−' : ''}${symbolFor(cur)}${money2.format(Math.abs(amount))}`;
const formatCompact = (amount, cur) => `${amount < 0 ? '-' : ''}${symbolFor(cur).trim()}${cur === 'LKR' ? ' ' : ''}${moneyCompact.format(Math.abs(amount))}`;
const formatDisplay = (amount, cur) => formatCurrency(toDisplay(amount, cur), state.config.currency);
const dcur = () => state.config.currency;
// Small boxes on phones: full amount when it fits, "Rs. 599.3K" when it doesn't (full value in the tooltip).
const fitMoney = (v, cur, max = 11) => {
    const full = formatCurrency(v, cur);
    return full.length > max ? formatCompact(v, cur) : full;
};
const setMoney = (el, v, cur, max = 11, signed = false) => {
    if (!el) return;
    const full = signed ? formatSigned(v, cur) : formatCurrency(v, cur);
    el.textContent = full.length > max ? `${signed && v > 0 ? '+' : ''}${formatCompact(v, cur)}` : full;
    el.title = full;
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

/* =========================================================================
   5. Persistence & migration
   ========================================================================= */
const cleanDate = (v) => (isISODate(v) ? v : (typeof v === 'string' && isISODate(v.slice(0, 10)) ? v.slice(0, 10) : null));
const stamp = (v) => toNumber(v, 0) || (typeof v === 'string' ? Date.parse(v) || 0 : 0);

const normalizeTx = (t, forcedType) => {
    if (!t || typeof t !== 'object') return null;
    const amount = toNumber(t.amount, NaN);
    if (!(amount > 0)) return null;
    const type = forcedType || (t.type === 'income' ? 'income' : 'expense');
    const desc = String(t.desc != null ? t.desc : (t.description != null ? t.description : '')).trim().slice(0, 120);
    return {
        id: String(t.id || generateId()),
        type,
        desc: desc || (type === 'income' ? 'Income' : 'Expense'),
        amount,
        currency: t.currency === 'LKR' ? 'LKR' : 'USD',
        category: String(t.category || FALLBACK_CATEGORY[type]),
        date: cleanDate(t.date) || toISODate(),
        note: t.note ? String(t.note).slice(0, 500) : '',
        createdAt: stamp(t.createdAt) || stamp(t.created_at),
        recurringId: t.recurringId ? String(t.recurringId) : null
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
        currency: g.currency === 'LKR' ? 'LKR' : 'USD',
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
        currency: b.currency === 'LKR' ? 'LKR' : 'USD',
        category: String(b.category || FALLBACK_CATEGORY[type]),
        frequency: FREQ_LABELS[b.frequency] ? b.frequency : 'monthly',
        nextDate,
        anchorDay: Math.min(31, Math.max(1, toNumber(b.anchorDay, parseDate(nextDate).getDate()))),
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
        currency: d.currency === 'LKR' ? 'LKR' : 'USD',
        repaid: Math.min(amount, Math.max(0, toNumber(d.repaid, 0))),
        dueDate: cleanDate(d.dueDate),
        note: d.note ? String(d.note).slice(0, 500) : '',
        createdAt: stamp(d.createdAt)
    };
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
    const rate = toNumber(cfg.rate, 300);
    base.config.rate = rate > 0 ? rate : 300;
    base.config.rateLocked = !!cfg.rateLocked;
    base.config.rateUpdatedAt = cfg.rateUpdatedAt || null;
    base.config.currency = cfg.currency === 'LKR' ? 'LKR' : 'USD';
    if (cfg.theme === 'light' || cfg.theme === 'dark') base.config.theme = cfg.theme;
    const budget = toNumber(cfg.budget, 1000);
    base.config.budget = budget > 0 ? budget : 1000;
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
    return base;
};

const saveState = () => {
    const ok = storage.set(STORAGE_KEY, JSON.stringify(state));
    if (!ok && !storageWarningShown) {
        storageWarningShown = true;
        showToast("This device isn't letting Vela save. Check that storage is allowed and not full.", 'error');
    }
};

const loadState = () => {
    const raw = storage.get(STORAGE_KEY);
    if (!raw) { state = createDefaultState(); return; }
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

const showConfirm = ({ title, message, confirmLabel = 'Delete', danger = true, onConfirm }) => {
    const overlay = $('modal-confirm');
    $('confirm-title').textContent = title;
    $('confirm-message').textContent = message;
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
    const transition = document.startViewTransition(() => applyTheme(theme));
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

const setRateStatus = (status) => {
    rateStatus = status;
    const dot = $('connection-indicator');
    const text = $('current-rate-display');
    if (text) text.textContent = status === 'syncing' ? 'Updating rate…' : `$1 = Rs. ${state.config.rate.toFixed(2)}`;
    if (dot) dot.dataset.status = status;
    const chip = $('rate-chip');
    const titles = { live: 'Live exchange rate', syncing: 'Updating exchange rate', manual: 'Your own exchange rate', offline: 'Saved exchange rate (offline)' };
    if (chip) chip.title = `${titles[status] || ''}. Tap to change.`;
    renderRateSetting();
};

const fetchLiveExchangeRate = async ({ manual = false } = {}) => {
    if (state.config.rateLocked && !manual) { setRateStatus('manual'); return; }
    setRateStatus('syncing');
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 9000) : null;
    try {
        const res = await fetch(RATE_URL, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const rate = Number(data && data.rates && data.rates.LKR);
        if (!(rate > 0)) throw new Error('No LKR rate in response');
        state.config.rate = rate;
        state.config.rateLocked = false;
        state.config.rateUpdatedAt = Date.now();
        saveState();
        setRateStatus('live');
        renderActive();
        if (manual) showToast(`Live rate updated: 1 USD = ${rate.toFixed(2)} LKR`, 'success');
    } catch (err) {
        console.warn('Live exchange rate unavailable:', err);
        setRateStatus(state.config.rateLocked ? 'manual' : 'offline');
        if (manual) showToast(`Couldn't reach the rate service. Still using 1 USD = ${state.config.rate.toFixed(2)} LKR.`, 'warning');
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
};

const goToPlan = (sub) => {
    planTab = sub;
    if (currentTab === 'plan') renderPlan();
    else switchTab('plan');
};

const goToActivity = (type) => {
    activityType = type || 'all';
    activityCategory = 'all';
    const now = new Date();
    activityMonth = { y: now.getFullYear(), m: now.getMonth() };
    if (currentTab === 'activity') renderActivity();
    else switchTab('activity');
};

/* =========================================================================
   11. Calculations
   ========================================================================= */
const expenses = () => state.transactions.filter((t) => t.type === 'expense');
const sortByNewest = (list) => [...list].sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));
const sumDisplay = (list) => list.reduce((s, e) => s + toDisplay(e.amount, e.currency), 0);
const inMonth = (t, y, m) => { const d = parseDate(t.date); return d.getFullYear() === y && d.getMonth() === m; };

const monthStats = (y = new Date().getFullYear(), m = new Date().getMonth()) => {
    const list = state.transactions.filter((t) => inMonth(t, y, m));
    const spentList = list.filter((t) => t.type === 'expense');
    const incomeList = list.filter((t) => t.type === 'income');
    const spent = sumDisplay(spentList);
    const income = sumDisplay(incomeList);

    const ref = new Date();
    const prevStart = new Date(y, m - 1, 1);
    const prevEnd = new Date(y, m - 1, Math.min(ref.getDate(), daysInMonth(y, m - 1)));
    const prevSpent = sumDisplay(expenses().filter((e) => { const d = parseDate(e.date); return d >= prevStart && d <= prevEnd; }));

    const budget = convertAmount(state.config.budget, 'USD', dcur());
    const byCat = {};
    spentList.forEach((e) => { byCat[e.category] = (byCat[e.category] || 0) + toDisplay(e.amount, e.currency); });
    return { list, spentList, incomeList, spent, income, net: income - spent, prevSpent, budget, budgetPct: budget > 0 ? (spent / budget) * 100 : 0, byCat };
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
        recurringId: bill.id
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
    const date = bill.nextDate < todayISO() ? bill.nextDate : todayISO();
    logBill(bill, date);
    bill.nextDate = advanceDate(bill.nextDate, bill.frequency, bill.anchorDay);
    queueSync('recurring', bill.id, 'upsert', false);
    saveState();
    flushSync();
    haptic('MEDIUM');
    scheduleReminders();
    showToast(`${bill.name} ${bill.type === 'income' ? 'received' : 'paid'}: ${formatCurrency(bill.amount, bill.currency)}. Next ${shortDate(bill.nextDate)}.`, 'success');
    renderActive();
};

/* =========================================================================
   13. Bill reminders (Android notifications)
   ========================================================================= */
const hashToInt = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return 1000 + (Math.abs(h) % 1000000);
};

const scheduleReminders = async () => {
    const ln = nativePlugin('LocalNotifications');
    if (!ln) return;
    try {
        if (state.config.reminderIds.length) {
            await ln.cancel({ notifications: state.config.reminderIds.map((id) => ({ id })) });
        }
        state.config.reminderIds = [];
        if (!state.config.reminders) { saveState(); return; }
        const now = Date.now();
        const notifications = [];
        state.recurring.filter((b) => b.type === 'expense').forEach((bill) => {
            const due = parseDate(bill.nextDate);
            const dayBefore = new Date(due.getFullYear(), due.getMonth(), due.getDate() - 1, 9, 0, 0);
            const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate(), 9, 0, 0);
            const at = dayBefore.getTime() > now ? dayBefore : (dueDay.getTime() > now ? dueDay : null);
            if (!at) return;
            notifications.push({
                id: hashToInt(bill.id),
                title: `${bill.name} is due ${at === dayBefore ? 'tomorrow' : 'today'}`,
                body: `${formatCurrency(bill.amount, bill.currency)}${bill.autoLog ? '. Vela will log it automatically.' : '. Open Vela to mark it paid.'}`,
                schedule: { at, allowWhileIdle: true }
            });
        });
        if (notifications.length) await ln.schedule({ notifications });
        state.config.reminderIds = notifications.map((n) => n.id);
        saveState();
    } catch (err) {
        console.warn('Could not schedule reminders:', err);
    }
};

const enableReminders = async (on) => {
    const ln = nativePlugin('LocalNotifications');
    if (!ln) {
        showToast('Reminders work in the Android app. Bills due soon also show on Home.', 'info');
        setSwitch($('switch-reminders'), false);
        return;
    }
    if (on) {
        try {
            const perm = await ln.requestPermissions();
            if (perm.display !== 'granted') {
                setSwitch($('switch-reminders'), false);
                showToast('Notifications are blocked. Allow them for Vela in Android settings.', 'warning');
                return;
            }
        } catch (err) {
            setSwitch($('switch-reminders'), false);
            return;
        }
    }
    state.config.reminders = on;
    saveState();
    await scheduleReminders();
    showToast(on ? "Reminders on. You'll get a notification the day before each bill." : 'Reminders off', 'success');
    renderSettings();
};

/* =========================================================================
   14. Rendering — shared pieces
   ========================================================================= */
const txRow = (t, { showDate = true } = {}) => {
    const cat = catById(t.category, t.type);
    const value = toDisplay(t.amount, t.currency);
    const signed = formatSigned(t.type === 'income' ? value : -value, dcur());
    const orig = t.currency !== dcur() ? `<span class="tx-orig-inline">${escapeHtml(formatCurrency(t.amount, t.currency))}</span>` : '';
    const label = showDate ? cat.name : (t.note || cat.name);
    return `<li><button type="button" class="tx" data-edit-tx="${escapeHtml(t.id)}">
        ${catBadge(t.category, t.type)}
        <span class="tx-main"><span class="tx-title">${escapeHtml(t.desc)}</span><span class="tx-sub">${t.recurringId ? icon('i-repeat') : ''}<span>${escapeHtml(label)}</span>${orig}</span></span>
        <span class="tx-amt"><span class="amount ${t.type === 'income' ? 'is-income' : ''}">${escapeHtml(signed)}</span>${showDate ? `<span class="tx-when">${escapeHtml(relativeDayLabel(t.date))}</span>` : ''}</span>
    </button></li>`;
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

/* =========================================================================
   15. Rendering — Home
   ========================================================================= */
const renderDashboard = () => {
    const cur = dcur();
    const now = new Date();
    const s = monthStats();

    $('dash-month-label').textContent = `${now.toLocaleDateString('en-US', { month: 'long' })} balance`;
    $('dash-balance').textContent = formatCurrency(s.net, cur);
    $('dash-balance-sub').textContent = s.income > 0
        ? `${Math.max(0, Math.round((s.net / s.income) * 100))}% of this month's income left`
        : (s.spent > 0 ? "Add your income to see what's left" : 'Income minus spending this month');
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
    $('dash-budget-desc').textContent = `${Math.round(s.budgetPct)}% of ${fitMoney(s.budget, cur, 11)} budget`;
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

    // Bills due in the next 7 days (or overdue).
    const horizon = toISODate(addDays(new Date(), 7));
    const due = state.recurring.filter((b) => b.type === 'expense' && b.nextDate <= horizon).sort((a, b) => (a.nextDate > b.nextDate ? 1 : -1));
    $('due-section').hidden = !due.length;
    $('due-list').innerHTML = due.map((b) => {
        const dl = dueLabel(b.nextDate);
        return `<div class="card due-card glow" style="--glow:${catColor(catById(b.category))}">
            <div class="due-top">${catBadge(b.category, 'expense')}<div style="min-width:0"><div class="due-name">${escapeHtml(b.name)}</div><div class="due-when" data-urgent="${dl.tone === 'soon'}" data-overdue="${dl.tone === 'late'}">${escapeHtml(dl.text)}</div></div></div>
            <div class="due-bottom"><span class="amount">${escapeHtml(formatDisplay(b.amount, b.currency))}</span>
            ${b.autoLog ? '<span class="badge-due" data-tone="auto">Auto</span>' : `<button type="button" class="btn btn-primary btn-xs" data-bill-paid="${escapeHtml(b.id)}">Mark paid</button>`}</div>
        </div>`;
    }).join('');

    const recent = sortByNewest(state.transactions).slice(0, 6);
    $('recent-list').innerHTML = recent.length
        ? recent.map((t) => txRow(t)).join('')
        : `<li>${emptyState({ iconId: 'i-wallet', title: 'Nothing logged yet', text: 'Tap + to add your first expense or income.', actionLabel: 'Add expense', action: 'add-expense' })}</li>`;

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

    const chipCats = activityType === 'all' ? state.categories : catsOfType(activityType);
    if (activityCategory !== 'all' && !chipCats.some((c) => c.id === activityCategory)) activityCategory = 'all';
    $('activity-chips').innerHTML = [`<button type="button" class="chip" data-filter-category="all" aria-pressed="${activityCategory === 'all'}">All</button>`]
        .concat(chipCats.map((c) => `<button type="button" class="chip" data-filter-category="${escapeHtml(c.id)}" aria-pressed="${activityCategory === c.id}" style="--cat:${catColor(c)}"><span class="chip-dot"></span>${escapeHtml(c.name)}</button>`))
        .join('');

    const base = query ? state.transactions : state.transactions.filter((t) => inMonth(t, y, m));
    let list = base;
    if (activityType !== 'all') list = list.filter((t) => t.type === activityType);
    if (activityCategory !== 'all') list = list.filter((t) => t.category === activityCategory);
    if (query) {
        list = list.filter((t) => t.desc.toLowerCase().includes(query)
            || (t.note && t.note.toLowerCase().includes(query))
            || catById(t.category, t.type).name.toLowerCase().includes(query));
    }
    list = sortByNewest(list);

    const summarySrc = query ? list : base;
    const inc = sumDisplay(summarySrc.filter((t) => t.type === 'income'));
    const out = sumDisplay(summarySrc.filter((t) => t.type === 'expense'));
    setMoney($('act-income'), inc, cur, 11);
    setMoney($('act-spent'), out, cur, 11);
    setMoney($('act-net'), inc - out, cur, 11, true);
    $('act-net').className = `amount ${inc - out >= 0 ? 'text-income' : 'text-expense'}`;

    const container = $('activity-list');
    if (!state.transactions.length) {
        container.innerHTML = `<div class="card">${emptyState({ iconId: 'i-activity', title: 'No activity yet', text: 'Expenses and income you add show up here, grouped by day.', actionLabel: 'Add expense', action: 'add-expense' })}</div>`;
        return;
    }
    if (!list.length) {
        const what = activityType === 'all' ? 'entries' : activityType === 'income' ? 'income' : 'expenses';
        container.innerHTML = `<div class="card"><div class="empty"><span class="empty-icon">${icon('i-search')}</span><span class="empty-title">Nothing here</span><span class="empty-text">${query ? 'No entries match your search.' : `No ${what} in ${escapeHtml(monthName(y, m, { month: 'long' }))}.`}</span>${(activityType !== 'all' || activityCategory !== 'all' || query) ? '<button type="button" class="btn btn-secondary btn-sm" data-clear-filters>Clear filters</button>' : ''}</div></div>`;
        return;
    }

    const groups = [];
    list.forEach((t) => {
        const last = groups[groups.length - 1];
        if (last && last.date === t.date) last.items.push(t);
        else groups.push({ date: t.date, items: [t] });
    });
    container.innerHTML = groups.map((g) => {
        const net = sumDisplay(g.items.filter((t) => t.type === 'income')) - sumDisplay(g.items.filter((t) => t.type === 'expense'));
        return `<div class="day-group">
            <div class="day-head"><span>${escapeHtml(relativeDayLabel(g.date))}</span><span class="amount">${escapeHtml(formatSigned(net, cur))}</span></div>
            <div class="card card-list"><ul class="tx-list">${g.items.map((t) => txRow(t, { showDate: false })).join('')}</ul></div>
        </div>`;
    }).join('');
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
        const limit = convertAmount(state.config.categoryBudgets[id], 'USD', cur);
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
        <div class="card-sub" style="margin-bottom:var(--sp-3)">${left >= 0 ? `left of ${escapeHtml(formatCurrency(s.budget, cur))}. That's about ${escapeHtml(formatCurrency(perDay, cur))} a day for the next ${plural(daysLeft, 'day')}.` : `over your ${escapeHtml(formatCurrency(s.budget, cur))} budget`}</div>
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
    if (!sorted.length) {
        return `<div class="card">${emptyState({ iconId: 'i-repeat', title: 'No bills or regular income', text: 'Add rent, subscriptions or your salary once. Vela logs them on time and reminds you before bills are due.', actionLabel: 'Add a bill', action: 'add-bill' })}</div>`;
    }
    const monthlyOut = bills.reduce((s, b) => s + monthlyEquivalent(b), 0);
    const monthlyIn = inc.reduce((s, b) => s + monthlyEquivalent(b), 0);
    return `
    <div class="duo">
        <div class="card glow metric" style="--glow:var(--pal-pink)"><span class="metric-label">Bills per month</span><span class="metric-value text-expense" title="${escapeHtml(formatCurrency(monthlyOut, cur))}">${escapeHtml(fitMoney(monthlyOut, cur, 13))}</span><span class="metric-sub">${plural(bills.length, 'bill')}</span></div>
        <div class="card glow metric" style="--glow:var(--pal-green)"><span class="metric-label">Regular income</span><span class="metric-value text-income" title="${escapeHtml(formatCurrency(monthlyIn, cur))}">${escapeHtml(fitMoney(monthlyIn, cur, 13))}</span><span class="metric-sub">per month</span></div>
    </div>
    <div class="section-head"><h2>Bills and subscriptions</h2><button type="button" class="btn btn-primary btn-xs" data-action="add-bill">${icon('i-plus', 'ic ic-sm')} Add</button></div>
    <div class="plan-half stack">${bills.length ? `<div class="card plan-list">${bills.map(billRow).join('')}</div>` : '<p class="card-sub" style="padding:0 4px">No bills yet.</p>'}</div>
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
        <div class="card glow metric" style="--glow:var(--pal-green)"><span class="metric-label">Owed to you</span><span class="metric-value text-income" title="${escapeHtml(formatCurrency(owedToYou, cur))}">${escapeHtml(fitMoney(owedToYou, cur, 13))}</span><span class="metric-sub">${plural(open.filter((d) => d.direction === 'lent').length, 'person', 'people')}</span></div>
        <div class="card glow metric" style="--glow:var(--pal-pink)"><span class="metric-label">You owe</span><span class="metric-value text-expense" title="${escapeHtml(formatCurrency(youOwe, cur))}">${escapeHtml(fitMoney(youOwe, cur, 13))}</span><span class="metric-sub">${plural(open.filter((d) => d.direction === 'borrowed').length, 'person', 'people')}</span></div>
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
    if (!input) return;
    if (document.activeElement !== input) input.value = state.config.rate.toFixed(2);
    const desc = $('rate-mode-desc');
    if (state.config.rateLocked) desc.textContent = 'Using your own rate. Tap "Live rate" to go back to automatic updates.';
    else if (rateStatus === 'live' && state.config.rateUpdatedAt) desc.textContent = `Live rate, updated ${new Date(state.config.rateUpdatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.`;
    else if (rateStatus === 'syncing') desc.textContent = 'Getting the latest rate…';
    else desc.textContent = state.config.rateUpdatedAt ? `Offline. Using the rate from ${new Date(state.config.rateUpdatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.` : 'Updates automatically when you are online.';
};

const renderSettings = () => {
    renderRateSetting();
    updateThemeChrome();
    updateUserProfileUI();
    const custom = state.categories.filter((c) => !c.builtIn).length;
    $('categories-count').textContent = `${state.categories.length} categories${custom ? ` (${custom} of your own)` : ''}. Add your own.`;
    const lock = state.config.lock;
    setSwitch($('switch-lock'), lock.enabled);
    $('btn-change-pin').hidden = !lock.enabled;
    $('biometric-row').hidden = !(lock.enabled && biometricAvailable);
    setSwitch($('switch-biometric'), lock.biometric);
    const native = !!nativePlugin('LocalNotifications');
    setSwitch($('switch-reminders'), native && state.config.reminders);
    $('reminders-desc').textContent = native
        ? 'A notification the day before each bill is due.'
        : 'Works in the Android app. Here, bills due soon show on Home.';
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
    income: cssVar('--income'), expense: cssVar('--expense'), surface: cssVar('--surface'),
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
};

const openAddTx = (type = 'expense') => {
    $('tx-form').reset();
    $('tx-id').value = '';
    $('btn-delete-tx').hidden = true;
    $('tx-currency').value = dcur();
    $('tx-date').value = todayISO();
    setTxType(type);
    openOrSwap('modal-tx');
};

const openEditTx = (id) => {
    const t = state.transactions.find((x) => x.id === id);
    if (!t) return;
    $('tx-form').reset();
    $('tx-id').value = t.id;
    $('btn-delete-tx').hidden = false;
    $('tx-amount').value = t.amount;
    $('tx-currency').value = t.currency;
    $('tx-desc').value = t.desc;
    $('tx-date').value = t.date;
    $('tx-note').value = t.note || '';
    setTxType(t.type, t.category);
    openOrSwap('modal-tx');
};

const budgetAlert = (categoryId) => {
    const s = monthStats();
    const limitUsd = state.config.categoryBudgets[categoryId];
    if (limitUsd) {
        const limit = convertAmount(limitUsd, 'USD', dcur());
        const pct = ((s.byCat[categoryId] || 0) / limit) * 100;
        const name = catById(categoryId).name;
        if (pct >= 100) { showToast(`You're over your ${name} budget this month (${Math.round(pct)}%).`, 'warning'); return; }
        if (pct >= 80) { showToast(`You've used ${Math.round(pct)}% of your ${name} budget.`, 'warning'); return; }
    }
    if (s.budgetPct >= 100) showToast(`You're over this month's budget (${Math.round(s.budgetPct)}%).`, 'warning');
    else if (s.budgetPct >= 80) showToast(`You've used ${Math.round(s.budgetPct)}% of this month's budget.`, 'warning');
};

const submitTx = () => {
    const id = $('tx-id').value;
    const amount = toNumber($('tx-amount').value, NaN);
    const currency = $('tx-currency').value === 'LKR' ? 'LKR' : 'USD';
    const desc = $('tx-desc').value.trim();
    const date = $('tx-date').value;
    const note = $('tx-note').value.trim();
    const catInput = document.querySelector('input[name="tx-category"]:checked');
    const category = catInput ? catInput.value : FALLBACK_CATEGORY[txType];

    if (!(amount > 0)) return fieldError($('tx-amount'), 'Enter an amount greater than zero.');
    if (!desc) return fieldError($('tx-desc'), txType === 'income' ? 'Add where the money came from, like "Salary".' : 'Add a short description, like "Groceries".');
    if (!isISODate(date)) return fieldError($('tx-date'), 'Pick a date.');

    let record;
    if (id) {
        const idx = state.transactions.findIndex((t) => t.id === id);
        if (idx === -1) return false;
        record = { ...state.transactions[idx], type: txType, desc, amount, currency, category, date, note };
        state.transactions[idx] = record;
    } else {
        record = { id: generateId(), type: txType, desc, amount, currency, category, date, note, createdAt: Date.now(), recurringId: null };
        state.transactions.push(record);
    }
    state.config.lastCategory[txType] = category;
    saveState();
    haptic('MEDIUM');
    queueSync('transaction', record.id, 'upsert');
    closeSheet('modal-tx');
    showToast(id ? 'Saved' : `${txType === 'income' ? 'Income' : 'Expense'} added: ${formatCurrency(amount, currency)}`, 'success');
    const now = new Date();
    if (txType === 'expense' && inMonth(record, now.getFullYear(), now.getMonth())) setTimeout(() => budgetAlert(category), 400);
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
            saveState();
            queueSync('transaction', id, 'delete');
            closeSheet('modal-tx');
            showToast('Deleted', 'success');
            renderActive();
        }
    });
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
    $('goal-currency').value = dcur();
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
    $('goal-currency').value = g.currency;
    $('goal-saved').value = round2(g.saved);
    $('goal-deadline').value = g.deadline || '';
    openOrSwap('modal-goal');
};

const submitGoal = () => {
    const id = $('goal-id').value;
    const name = $('goal-name').value.trim();
    const target = toNumber($('goal-target').value, NaN);
    const currency = $('goal-currency').value === 'LKR' ? 'LKR' : 'USD';
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
        : `Converted to ${goal.currency} at 1 USD = ${state.config.rate.toFixed(2)} LKR.`;
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
    $('funds-currency').value = goal.currency;
    setFundsMode('deposit');
    updateFundsHint();
    openOrSwap('modal-funds');
};

const submitFunds = () => {
    const goal = state.savings.find((g) => g.id === $('funds-goal').value);
    const amount = toNumber($('funds-amount').value, NaN);
    const currency = $('funds-currency').value === 'LKR' ? 'LKR' : 'USD';
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
const openBudget = (catId) => {
    const sel = $('budget-category');
    sel.innerHTML = ['<option value="__overall">Whole month (all spending)</option>']
        .concat(catsOfType('expense').map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`)).join('');
    const isOverall = catId === '__overall';
    const existing = isOverall ? state.config.budget : (catId ? state.config.categoryBudgets[catId] : null);
    const firstFree = catsOfType('expense').find((c) => !state.config.categoryBudgets[c.id]);
    sel.value = catId || (firstFree ? firstFree.id : 'Food');
    sel.disabled = !!catId && (isOverall || !!existing);
    $('budget-amount').value = existing ? round2(convertAmount(existing, 'USD', dcur())) : '';
    $('budget-currency').textContent = dcur();
    $('budget-title').textContent = existing ? 'Edit budget' : 'Set a budget';
    $('btn-delete-budget').hidden = !(existing && !isOverall);
    openOrSwap('modal-budget');
};

const submitBudget = () => {
    const catId = $('budget-category').value;
    const value = toNumber($('budget-amount').value, NaN);
    if (!(value > 0)) return fieldError($('budget-amount'), 'Enter a monthly limit greater than zero.');
    const usd = convertAmount(value, dcur(), 'USD');
    if (catId === '__overall') state.config.budget = usd;
    else state.config.categoryBudgets[catId] = usd;
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
    $('bill-currency').value = dcur();
    $('bill-next').value = todayISO();
    setSwitch($('bill-auto'), true);
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
    $('bill-currency').value = b.currency;
    $('bill-frequency').value = b.frequency;
    $('bill-next').value = b.nextDate;
    setSwitch($('bill-auto'), b.autoLog);
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
        currency: $('bill-currency').value === 'LKR' ? 'LKR' : 'USD',
        category: $('bill-category').value,
        frequency: FREQ_LABELS[$('bill-frequency').value] ? $('bill-frequency').value : 'monthly',
        nextDate,
        anchorDay: parseDate(nextDate).getDate(),
        autoLog: isOn($('bill-auto'))
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
    $('debt-currency').value = dcur();
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
    $('debt-currency').value = d.currency;
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
    const currency = $('debt-currency').value === 'LKR' ? 'LKR' : 'USD';
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
const pendingCount = () => Object.keys(state.sync).length + (state.syncSettings ? 1 : 0);
const findRecord = (kind, id) => (state[KIND_STORE[kind]] || []).find((r) => r.id === id);
// Records are keyed per user, so ids that repeat across users (built-in categories) need a user prefix.
const rowId = (kind, id) => (kind === 'category' ? `${state.auth.user.id}:${id}` : id);

let flushPromise = null;
let flushAgain = false;

const flushSync = () => {
    if (!canSync() || (typeof navigator.onLine === 'boolean' && !navigator.onLine)) return Promise.resolve(pendingCount() === 0);
    if (flushPromise) { flushAgain = true; return flushPromise; }
    flushPromise = (async () => {
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
            if (state.syncSettings) {
                const { error } = await supabaseClient.from('vela_settings').upsert({
                    user_id: state.auth.user.id,
                    data: { budget: state.config.budget, categoryBudgets: state.config.categoryBudgets, currency: state.config.currency },
                    updated_at: now
                });
                if (error) throw error;
                state.syncSettings = false;
            }
            saveState();
            return true;
        } catch (err) {
            console.warn('Cloud sync failed; changes are kept on this device and will retry.', err);
            saveState();
            return false;
        } finally {
            flushPromise = null;
            if (flushAgain) { flushAgain = false; setTimeout(flushSync, 0); }
            if (currentTab === 'settings') updateUserProfileUI();
        }
    })();
    return flushPromise;
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
    if (!flushed || pendingCount() > 0) return false;
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
        if (!set.error && set.data && set.data.data) {
            const d = set.data.data;
            if (toNumber(d.budget, 0) > 0) state.config.budget = toNumber(d.budget, 1000);
            if (d.categoryBudgets && typeof d.categoryBudgets === 'object') state.config.categoryBudgets = { ...d.categoryBudgets };
        }
        saveState();
        return true;
    } catch (err) {
        console.error('Could not load your data from the cloud:', err);
        showToast("Couldn't load your synced data. Showing what's on this device.", 'warning');
        return false;
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
        $('profile-badge-text').textContent = cloud ? (pending ? `${pending} waiting to sync` : 'Synced') : 'Guest';
    }
    const nameInput = $('profile-username');
    if (nameInput && document.activeElement !== nameInput) nameInput.value = user && user.full_name ? user.full_name : '';
    const logout = $('btn-auth-logout');
    if (logout) {
        logout.className = cloud ? 'btn btn-danger btn-block' : 'btn btn-primary btn-block';
        logout.innerHTML = cloud ? `${icon('i-logout')} <span>Sign out</span>` : `${icon('i-cloud')} <span>Sign in to sync</span>`;
    }
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
    if (/rate limit/i.test(msg)) return 'Too many attempts. Wait a minute and try again.';
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
        state.sync = {};
    }

    const meta = user.user_metadata || {};
    let fullName = meta.full_name || meta.name || (user.email ? user.email.split('@')[0] : 'Vela user');
    let avatarUrl = meta.avatar_url || meta.picture || null;
    try {
        const { data: profile } = await supabaseClient.from('profiles').select('*').eq('id', user.id).maybeSingle();
        if (profile) { fullName = profile.full_name || profile.username || fullName; avatarUrl = profile.avatar_url || avatarUrl; }
    } catch (err) { /* profile is optional */ }

    state.auth.user = { id: user.id, email: user.email || null, full_name: fullName, avatar_url: avatarUrl };
    state.auth.isMock = false;
    saveState();
    if (wasGuestWithData) queueAllForUpload();

    const hasRemote = await remoteHasData();
    if (hasRemote || wasGuestWithData || state.auth.completedOnboarding) {
        state.auth.completedOnboarding = true;
        if (!hasRemote && hasLocal) queueAllForUpload();
        await pullFromCloud();
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
    state.sync = {};
    state.syncSettings = false;
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
    if (error) { showToast(friendlyAuthError(error), 'error'); return; }
    await handleSession(data.session);
    if (state.auth.completedOnboarding) showToast(`Welcome back, ${displayName()}`, 'success');
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
        setAuthMode('signin');
        $('signin-email').value = email;
        showToast(`Check ${email} for a confirmation link, then sign in here.`, 'info');
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
    state.config.budget = 1500;
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

const showLock = () => {
    if (!state.config.lock.enabled) { document.documentElement.classList.remove('is-locked'); return; }
    lockBuffer = '';
    paintDots($('lock-dots'), 0);
    $('lock-msg').textContent = '';
    $('lock-msg').dataset.error = 'false';
    buildKeypad($('lock-keypad'), 'lock', state.config.lock.biometric && biometricAvailable);
    $('lock-screen').classList.add('active');
    document.documentElement.classList.add('is-locked');
    if (state.config.lock.biometric && biometricAvailable) setTimeout(tryBiometricUnlock, 350);
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
    if (!bio) return;
    try {
        await bio.verifyIdentity({ reason: 'Unlock Vela', title: 'Unlock Vela', subtitle: 'Use your fingerprint or face', negativeButtonText: 'Use PIN', maxAttempts: 3 });
        unlock();
    } catch (err) { /* user chose PIN or failed */ }
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
    if (ok) { unlock(); return; }
    lockFails++;
    shake($('lock-dots'));
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
    if (isLocked() && state.config.lock.biometric && biometricAvailable) {
        buildKeypad($('lock-keypad'), 'lock', true);
        tryBiometricUnlock();
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
    const rows = [['Date', 'Type', 'Description', 'Category', 'Amount', 'Currency', `Amount (${cur})`, 'Note']];
    sortByNewest(state.transactions).forEach((t) => rows.push([
        t.date, t.type === 'income' ? 'Income' : 'Expense', t.desc, catById(t.category, t.type).name,
        t.amount.toFixed(2), t.currency, toDisplay(t.amount, t.currency).toFixed(2), t.note || ''
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

const pdfMoney = (v, cur) => `${v < 0 ? '-' : ''}${cur === 'USD' ? '$' : 'Rs. '}${money2.format(Math.abs(v))}`;

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
    doc.text(`${displayName()} - generated ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - amounts in ${cur} (1 USD = ${state.config.rate.toFixed(2)} LKR)`, L, 32);
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
            const limit = convertAmount(state.config.categoryBudgets[id], 'USD', cur);
            const spent = s.byCat[id] || 0;
            tableRow([catById(id).name, money(spent), money(limit), `${Math.round((spent / limit) * 100)}%`], [80, 36, 36, 26], { alignRight: [1, 2, 3] });
        });
        y += 6;
    }

    sectionTitle(`All entries (${s.list.length})`);
    if (s.list.length) {
        tableRow(['Date', 'Description', 'Category', 'Amount'], [24, 78, 40, 36], { header: true, alignRight: [3] });
        sortByNewest(s.list).forEach((t) => tableRow([
            shortDate(t.date), t.desc, catById(t.category, t.type).name,
            `${t.type === 'income' ? '+' : '-'}${money(toDisplay(t.amount, t.currency))}`
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
        transactions: state.transactions, savings: state.savings, recurring: state.recurring, debts: state.debts,
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
                ['transactions', 'savings', 'recurring', 'debts', 'categories'].forEach((k) => { state[k] = incoming[k]; });
                state.config = { ...incoming.config, theme: state.config.theme, lock: state.config.lock, reminders: state.config.reminders, reminderIds: state.config.reminderIds };
                if (canSync()) queueAllForUpload();
                saveState();
                flushSync();
                updateCurrencyButtons();
                setRateStatus(state.config.rateLocked ? 'manual' : rateStatus);
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
    $('currency-usd').setAttribute('aria-pressed', String(dcur() === 'USD'));
    $('currency-lkr').setAttribute('aria-pressed', String(dcur() === 'LKR'));
};

const setDisplayCurrency = (cur) => {
    if (cur === dcur()) return;
    state.config.currency = cur;
    state.syncSettings = true;
    saveState();
    flushSync();
    updateCurrencyButtons();
    renderActive();
};

const onAppHidden = () => { hiddenAt = Date.now(); };
const onAppVisible = () => {
    if (state.config.lock.enabled && hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS && !isLocked()) showLock();
    hiddenAt = 0;
    processRecurring();
    if (pendingCount()) flushSync();
    renderActive();
};

const initEvents = () => {
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
        if (d.billPaid) { markBillPaid(d.billPaid); return; }
        if (d.editDebt) { openEditDebt(d.editDebt); return; }
        if (d.repayDebt) { openRepay(d.repayDebt); return; }
        if (d.editCategory) { catReturnToTx = false; catReturnToManager = true; openCategoryEditor(d.editCategory); return; }
        if (d.catColor) { catEditColor = d.catColor; renderCategoryEditor(); return; }
        if (d.catIcon) { catEditIcon = d.catIcon; renderCategoryEditor(); return; }
        if (d.catType) { catEditType = d.catType; if (!$('category-id').value) catEditIcon = catEditType === 'income' ? 'c-OtherIncome' : 'c-Other'; renderCategoryEditor(); return; }
        if (d.txType) { setTxType(d.txType); return; }
        if (d.billType) { setBillType(d.billType); return; }
        if (d.debtDir) { setDebtDir(d.debtDir); return; }
        if (d.fundsMode) { setFundsMode(d.fundsMode); return; }
        if (d.activityType) { activityType = d.activityType; activityCategory = 'all'; renderActivity(); return; }
        if (d.filterCategory) { activityCategory = d.filterCategory; renderActivity(); return; }
        if (d.themeChoice) { setTheme(d.themeChoice, e); return; }
        if (d.currency) { setDisplayCurrency(d.currency); return; }
        if (el.hasAttribute('data-clear-filters')) {
            activityType = 'all';
            activityCategory = 'all';
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
        if (goal) $('funds-currency').value = goal.currency;
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
        const value = toNumber($('setting-rate').value, NaN);
        if (!(value > 0)) { fieldError($('setting-rate'), 'Enter a rate greater than zero, like 300.50.'); return; }
        state.config.rate = value;
        state.config.rateLocked = true;
        saveState();
        setRateStatus('manual');
        renderActive();
        showToast(`Using your rate: 1 USD = ${value.toFixed(2)} LKR`, 'success');
    });
    $('btn-sync-rate').addEventListener('click', (e) => withBusy(e.currentTarget, () => fetchLiveExchangeRate({ manual: true })));

    $('switch-lock').addEventListener('click', () => openPinFlow(state.config.lock.enabled ? 'disable' : 'set'));
    $('btn-change-pin').addEventListener('click', () => openPinFlow('change'));
    $('switch-biometric').addEventListener('click', toggleBiometric);
    $('switch-reminders').addEventListener('click', (e) => enableReminders(!isOn(e.currentTarget)));
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
    window.addEventListener('offline', () => {
        if (!state.config.rateLocked) setRateStatus('offline');
        showToast("You're offline. Changes are saved on this device.", 'info');
    });
    document.addEventListener('visibilitychange', () => {
        if (isNative()) return; // the native app uses pause/resume
        if (document.visibilityState === 'hidden') onAppHidden();
        else onAppVisible();
    });
};

/* =========================================================================
   33. Start-up
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
    if (ln) ln.addListener('localNotificationActionPerformed', () => goToPlan('bills'));
    checkBiometric();
    const splash = nativePlugin('SplashScreen');
    if (splash) setTimeout(() => splash.hide({ fadeOutDuration: 250 }).catch(() => {}), 150);
};

const init = () => {
    loadState();
    document.documentElement.setAttribute('data-theme', state.config.theme);

    initEvents();
    initSheetDrag();
    initPwaInstall();

    updateThemeChrome();
    updateCurrencyButtons();
    setRateStatus(state.config.rateLocked ? 'manual' : 'offline');
    updateUserProfileUI();

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
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
