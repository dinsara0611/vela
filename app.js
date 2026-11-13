/**
 * Vela 2.0 — expense & savings tracker (phone first)
 */
'use strict';

/* =========================================================================
   1. Constants
   ========================================================================= */
const APP_VERSION = '2.0.0';
const STORAGE_KEY = 'VELA_STATE';
const RATE_URL = 'https://open.er-api.com/v6/latest/USD';

// Supabase project (the publishable key is safe to ship in client code; access is enforced by RLS).
const SUPABASE_URL = 'https://kxtpcswywdvtasxanccz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_TVtBSlap2TpS9mtyZv455Q_0pc-TNYH';

const CATEGORIES = ['Food', 'Utilities', 'Rent', 'Entertainment', 'Travel', 'Health', 'Shopping', 'Other'];
const TAB_TITLES = {
    dashboard: 'Home',
    expenses: 'Expenses',
    savings: 'Savings',
    analytics: 'Insights',
    settings: 'Settings'
};
const RANGE_LABELS = { '30': 'Last 30 days', '12m': 'Last 12 months', all: 'All time' };

/* =========================================================================
   2. State
   ========================================================================= */
const prefersLight = () => !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);

const createDefaultState = () => ({
    expenses: [],   // { id, desc, amount, currency, category, date (YYYY-MM-DD), note, createdAt }
    savings: [],    // { id, name, target, currency, saved, createdAt }
    config: {
        rate: 300,
        rateLocked: false,
        rateUpdatedAt: null,
        currency: 'USD',
        theme: prefersLight() ? 'light' : 'dark',
        budget: 1000,        // stored in USD
        lastCategory: 'Food'
    },
    auth: {
        user: null,          // { id, email, full_name, avatar_url }
        isMock: true,        // true = guest / local only
        completedOnboarding: false
    },
    sync: { expenses: {}, savings: {} } // id -> 'upsert' | 'delete' (pending cloud writes)
});

let state = createDefaultState();
let supabaseClient = null;
let currentTab = 'dashboard';
let expenseFilter = 'all';
let dashboardRange = '30';
let analyticsRange = '30';
let onboardingPreference = 'fresh';
let deferredInstallPrompt = null;
let handledUserId = null;
let confirmHandler = null;
let storageWarningShown = false;
const openSheets = [];
const charts = { trend: null, history: null, category: null };

const $ = (id) => document.getElementById(id);

/* =========================================================================
   3. Utilities
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

const generateId = () => {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
};

const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
}[c]));

const icon = (id, cls = 'ic') => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
const catVar = (cat) => `var(--cat-${String(cat).toLowerCase()})`;
const catBadge = (cat) => `<span class="cat-badge" style="--cat:${catVar(cat)}">${icon('c-' + cat)}</span>`;
const plural = (n, word, many = word + 's') => `${n} ${n === 1 ? word : many}`;

/* ---- Dates (always local time; "YYYY-MM-DD" strings are calendar days) ---- */
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
const monthKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;

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

const shortDayLabel = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

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
const formatCurrency = (amount, cur) => {
    const sign = amount < 0 ? '-' : '';
    return `${sign}${symbolFor(cur)}${money2.format(Math.abs(amount))}`;
};
const formatCompact = (amount, cur) => `${symbolFor(cur).trim()}${cur === 'LKR' ? ' ' : ''}${moneyCompact.format(amount)}`;
const formatDisplay = (amount, cur) => formatCurrency(toDisplay(amount, cur), state.config.currency);

/* =========================================================================
   4. Persistence
   ========================================================================= */
const normalizeExpense = (e) => {
    if (!e || typeof e !== 'object') return null;
    const amount = toNumber(e.amount, NaN);
    if (!(amount > 0)) return null;
    const desc = String(e.desc != null ? e.desc : (e.description != null ? e.description : '')).trim().slice(0, 120);
    return {
        id: String(e.id || generateId()),
        desc: desc || 'Expense',
        amount,
        currency: e.currency === 'LKR' ? 'LKR' : 'USD',
        category: CATEGORIES.includes(e.category) ? e.category : 'Other',
        date: isISODate(e.date) ? e.date : (typeof e.date === 'string' && isISODate(e.date.slice(0, 10)) ? e.date.slice(0, 10) : toISODate()),
        note: e.note ? String(e.note).slice(0, 500) : '',
        createdAt: toNumber(e.createdAt, 0) || (e.created_at ? Date.parse(e.created_at) || 0 : 0)
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
        createdAt: toNumber(g.createdAt, 0) || (g.created_at ? Date.parse(g.created_at) || 0 : 0)
    };
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
    base.config.lastCategory = CATEGORIES.includes(cfg.lastCategory) ? cfg.lastCategory : 'Food';

    base.expenses = Array.isArray(raw.expenses) ? raw.expenses.map(normalizeExpense).filter(Boolean) : [];
    base.savings = Array.isArray(raw.savings) ? raw.savings.map(normalizeGoal).filter(Boolean) : [];

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
        // v1 stored fake "mock-user" accounts; they were local only.
        if (base.auth.user && /^(mock-|guest-local)/.test(base.auth.user.id)) base.auth.isMock = true;
    }

    if (raw.sync && typeof raw.sync === 'object') {
        ['expenses', 'savings'].forEach((k) => {
            const q = raw.sync[k];
            if (q && typeof q === 'object') {
                Object.keys(q).forEach((id) => {
                    if (q[id] === 'upsert' || q[id] === 'delete') base.sync[k][id] = q[id];
                });
            }
        });
    }
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
   5. Feedback: toasts & confirm dialog
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

/* =========================================================================
   6. Sheets (bottom sheets on phones, dialogs on desktop) + Back button
   ========================================================================= */
const isSheetOpen = (id) => openSheets.includes(id);
const finePointer = () => !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);

const showSheetElement = (id) => {
    const overlay = $(id);
    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
    openSheets.push(id);
    document.body.classList.add('sheet-open');
    if (finePointer()) {
        const first = overlay.querySelector('input:not([type=hidden]):not([hidden]), select, textarea, .action-item');
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
    // Opening a sheet adds a history entry so the phone's Back button closes it.
    history.pushState({ vela: 'sheet', id, tab: currentTab }, '');
    showSheetElement(id);
};

// Replace one open sheet with another without touching history (avoids Back-button races).
const swapSheet = (fromId, toId) => {
    if (!isSheetOpen(fromId)) { openSheet(toId); return; }
    hideSheet(fromId);
    history.replaceState({ vela: 'sheet', id: toId, tab: currentTab }, '');
    showSheetElement(toId);
};

const closeSheet = (id) => {
    if (!isSheetOpen(id)) return;
    const st = history.state;
    if (st && st.vela === 'sheet' && st.id === id) {
        history.back(); // popstate hides it
    } else {
        hideSheet(id);
    }
};

const openOrSwap = (id) => {
    const top = openSheets[openSheets.length - 1];
    if (top && top !== id) swapSheet(top, id);
    else openSheet(id);
};

const initSheetDrag = () => {
    document.querySelectorAll('.sheet-overlay').forEach((overlay) => {
        const sheet = overlay.querySelector('.sheet');
        const handles = sheet.querySelectorAll('.sheet-grabber, .sheet-head');
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
            if (dy > 110 || (dy > 30 && velocity > 0.6)) {
                closeSheet(overlay.id);
            } else {
                sheet.style.transform = '';
            }
        };
        handles.forEach((h) => {
            h.addEventListener('pointerdown', onDown);
            h.addEventListener('pointermove', onMove);
            h.addEventListener('pointerup', onUp);
            h.addEventListener('pointercancel', onUp);
        });
    });
};

/* =========================================================================
   7. Theme
   ========================================================================= */
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const updateThemeChrome = () => {
    const meta = $('meta-theme-color');
    if (meta) meta.setAttribute('content', cssVar('--bg') || '#0b0c14');
    document.querySelectorAll('[data-theme-choice]').forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.themeChoice === state.config.theme));
    });
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
    if (!document.startViewTransition || reduce) {
        applyTheme(theme);
        return;
    }
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    const target = originEvent && originEvent.currentTarget;
    if (originEvent && originEvent.clientX) {
        x = originEvent.clientX;
        y = originEvent.clientY;
    } else if (target && target.getBoundingClientRect) {
        const r = target.getBoundingClientRect();
        x = r.left + r.width / 2;
        y = r.top + r.height / 2;
    }
    const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const transition = document.startViewTransition(() => applyTheme(theme));
    transition.ready.then(() => {
        document.documentElement.animate(
            { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`] },
            { duration: 480, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', pseudoElement: '::view-transition-new(root)' }
        );
    }).catch(() => { /* transition skipped */ });
};

/* =========================================================================
   8. Exchange rate
   ========================================================================= */
let rateStatus = 'offline';

const setRateStatus = (status) => {
    rateStatus = status;
    const dot = $('connection-indicator');
    const text = $('current-rate-display');
    const chip = $('rate-chip');
    const rateText = `1 USD = ${state.config.rate.toFixed(2)} LKR`;
    if (text) text.textContent = status === 'syncing' ? 'Updating rate…' : rateText;
    if (dot) dot.dataset.status = status;
    const titles = {
        live: 'Live exchange rate',
        syncing: 'Updating exchange rate',
        manual: 'Your manual exchange rate',
        offline: 'Saved exchange rate (offline)'
    };
    if (chip) chip.title = `${titles[status] || ''}. Tap to change.`;
    renderRateSetting();
};

const fetchLiveExchangeRate = async ({ manual = false } = {}) => {
    if (state.config.rateLocked && !manual) {
        setRateStatus('manual');
        return;
    }
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
   9. Navigation
   ========================================================================= */
const switchTab = (tab, { fromHistory = false } = {}) => {
    if (!TAB_TITLES[tab]) tab = 'dashboard';

    if (!fromHistory) {
        const st = history.state || {};
        if (tab === currentTab) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }
        if (currentTab === 'dashboard') {
            history.pushState({ vela: 'tab', tab, fromHome: true }, '');
        } else if (tab === 'dashboard' && st.fromHome) {
            history.back(); // popstate brings us home, so Back from Home leaves the app
            return;
        } else {
            history.replaceState({ vela: 'tab', tab, fromHome: !!st.fromHome }, '');
        }
    }

    currentTab = tab;
    document.body.dataset.view = tab;
    document.querySelectorAll('[data-tab]').forEach((el) => {
        const active = el.dataset.tab === tab && !el.classList.contains('sidebar-profile');
        el.classList.toggle('active', active);
        if (el.classList.contains('tab') || el.classList.contains('side-link')) {
            if (active) el.setAttribute('aria-current', 'page');
            else el.removeAttribute('aria-current');
        }
    });
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `tab-${tab}`));
    $('page-title').textContent = TAB_TITLES[tab];
    document.title = tab === 'dashboard' ? 'Vela · Expenses & Savings' : `${TAB_TITLES[tab]} · Vela`;
    window.scrollTo(0, 0);
    renderActive();
};

const renderActive = () => {
    if (currentTab === 'dashboard') renderDashboard();
    else if (currentTab === 'expenses') renderExpensesList();
    else if (currentTab === 'savings') renderSavingsGoals();
    else if (currentTab === 'analytics') renderAnalyticsTab();
    else if (currentTab === 'settings') renderSettingsTab();
};

/* =========================================================================
   10. Calculations
   ========================================================================= */
const sortByNewest = (list) => [...list].sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));
const sumDisplay = (list) => list.reduce((s, e) => s + toDisplay(e.amount, e.currency), 0);

const monthStats = (ref = new Date()) => {
    const y = ref.getFullYear();
    const m = ref.getMonth();
    const thisMonth = state.expenses.filter((e) => { const d = parseDate(e.date); return d.getFullYear() === y && d.getMonth() === m; });
    const total = sumDisplay(thisMonth);

    // Compare with the same days of last month (1st → today's date), not the whole month.
    const prevStart = new Date(y, m - 1, 1);
    const prevDays = new Date(y, m, 0).getDate();
    const prevEnd = new Date(y, m - 1, Math.min(ref.getDate(), prevDays));
    const prevSame = state.expenses.filter((e) => { const d = parseDate(e.date); return d >= prevStart && d <= prevEnd; });
    const prevTotal = sumDisplay(prevSame);

    const budget = convertAmount(state.config.budget, 'USD', state.config.currency);
    const budgetPct = budget > 0 ? (total / budget) * 100 : 0;
    return { thisMonth, total, prevTotal, budget, budgetPct };
};

const rangeBounds = (range) => {
    const today = startOfDay(new Date());
    let start;
    if (range === '30') start = addDays(today, -29);
    else if (range === '12m') start = new Date(today.getFullYear(), today.getMonth() - 11, 1);
    else {
        const dates = state.expenses.map((e) => parseDate(e.date)).filter((d) => !isNaN(d) && d <= today);
        start = dates.length ? new Date(Math.min(...dates)) : today;
    }
    return { start, end: today };
};

const expensesInRange = (range) => {
    const { start, end } = rangeBounds(range);
    return state.expenses.filter((e) => { const d = parseDate(e.date); return d >= start && d <= end; });
};

/* =========================================================================
   11. Rendering — shared pieces
   ========================================================================= */
const txRow = (exp, { showDate = true } = {}) => {
    const sub = showDate ? `${exp.category} · ${relativeDayLabel(exp.date)}` : (exp.note || exp.category);
    const orig = exp.currency !== state.config.currency
        ? `<span class="tx-orig">${escapeHtml(formatCurrency(exp.amount, exp.currency))}</span>` : '';
    return `<li><button type="button" class="tx" data-edit-expense="${escapeHtml(exp.id)}">
        ${catBadge(exp.category)}
        <span class="tx-main"><span class="tx-title">${escapeHtml(exp.desc)}</span><span class="tx-sub">${escapeHtml(sub)}</span></span>
        <span class="tx-amt"><span class="amount">${escapeHtml(formatDisplay(exp.amount, exp.currency))}</span>${orig}</span>
    </button></li>`;
};

const emptyState = ({ iconId, title, text, actionLabel, action }) => `
    <div class="empty">
        <span class="empty-icon">${icon(iconId)}</span>
        <span class="empty-title">${escapeHtml(title)}</span>
        <span class="empty-text">${escapeHtml(text)}</span>
        ${actionLabel ? `<button type="button" class="btn btn-primary btn-sm" data-action="${action}">${escapeHtml(actionLabel)}</button>` : ''}
    </div>`;

const setMeter = (fill, pct, stateName) => {
    if (!fill) return;
    fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    if (stateName) fill.dataset.state = stateName;
    else delete fill.dataset.state;
};

/* =========================================================================
   12. Rendering — Home
   ========================================================================= */
const renderDashboard = () => {
    const cur = state.config.currency;
    const now = new Date();
    const { thisMonth, total, prevTotal, budget, budgetPct } = monthStats(now);

    $('dash-month-label').textContent = `Spent in ${now.toLocaleDateString('en-US', { month: 'long' })}`;
    $('dash-month-spend').textContent = formatCurrency(total, cur);

    const pill = $('dash-spend-trend');
    const pillText = $('dash-spend-trend-text');
    if (prevTotal > 0) {
        const diff = ((total - prevTotal) / prevTotal) * 100;
        const rounded = Math.round(Math.abs(diff));
        pill.dataset.trend = rounded === 0 ? 'flat' : (diff > 0 ? 'up' : 'down');
        pillText.textContent = rounded === 0 ? 'Same as last month' : `${rounded}% vs last month`;
        pill.title = rounded === 0 ? '' : `${rounded}% ${diff > 0 ? 'more' : 'less'} than the same days last month`;
    } else {
        pill.dataset.trend = 'flat';
        pillText.textContent = total > 0 ? 'Nothing to compare yet' : 'No spending yet';
    }

    const fill = $('dash-budget-progress-fill');
    const meterState = budgetPct >= 100 ? 'over' : budgetPct >= 80 ? 'warn' : null;
    setMeter(fill, budgetPct, meterState);
    $('dash-budget-meter').setAttribute('aria-valuenow', String(Math.round(Math.min(100, budgetPct))));
    $('dash-budget-desc').textContent = `${Math.round(budgetPct)}% of ${formatCurrency(budget, cur)} budget`;
    const left = budget - total;
    $('dash-budget-left').innerHTML = left >= 0
        ? `<strong>${escapeHtml(formatCurrency(left, cur))}</strong> left`
        : `<strong>${escapeHtml(formatCurrency(-left, cur))}</strong> over`;

    const savedTotal = state.savings.reduce((s, g) => s + toDisplay(g.saved, g.currency), 0);
    $('dash-total-savings').textContent = formatCurrency(savedTotal, cur);
    $('dash-savings-status').textContent = state.savings.length ? `across ${plural(state.savings.length, 'goal')}` : 'No goals yet';

    const byCat = {};
    thisMonth.forEach((e) => { byCat[e.category] = (byCat[e.category] || 0) + toDisplay(e.amount, e.currency); });
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
    if (top) {
        $('dash-top-category').textContent = top[0];
        $('dash-top-category-amount').textContent = `${Math.round((top[1] / total) * 100)}% · ${formatCurrency(top[1], cur)}`;
    } else {
        $('dash-top-category').textContent = '—';
        $('dash-top-category-amount').textContent = 'Nothing spent this month';
    }

    const recent = sortByNewest(state.expenses).slice(0, 5);
    $('recent-list').innerHTML = recent.length
        ? recent.map((e) => txRow(e)).join('')
        : `<li>${emptyState({ iconId: 'i-receipt', title: 'No expenses yet', text: 'Tap + to log your first expense.', actionLabel: 'Add expense', action: 'add-expense' })}</li>`;

    renderTrendChart();
};

/* =========================================================================
   13. Rendering — Expenses
   ========================================================================= */
const buildFilterChips = () => {
    const wrap = $('expense-filter-chips');
    wrap.innerHTML = [`<button type="button" class="chip" data-filter-category="all" aria-pressed="true">All</button>`]
        .concat(CATEGORIES.map((c) => `<button type="button" class="chip" data-filter-category="${c}" aria-pressed="false" style="--cat:${catVar(c)}"><span class="chip-dot"></span>${c}</button>`))
        .join('');
};

const buildCategoryPicker = () => {
    $('expense-category-picker').innerHTML = CATEGORIES.map((c) => `
        <label class="cat-option" style="--cat:${catVar(c)}">
            <input type="radio" name="expense-category" value="${c}">
            <span class="cat-option-box">${catBadge(c)}<span>${c === 'Entertainment' ? 'Fun' : c}</span></span>
        </label>`).join('');
};

const renderExpensesList = () => {
    const query = $('expense-search').value.trim().toLowerCase();
    document.querySelectorAll('[data-filter-category]').forEach((chip) => {
        chip.setAttribute('aria-pressed', String(chip.dataset.filterCategory === expenseFilter));
    });

    let list = state.expenses;
    if (expenseFilter !== 'all') list = list.filter((e) => e.category === expenseFilter);
    if (query) {
        list = list.filter((e) => e.desc.toLowerCase().includes(query)
            || (e.note && e.note.toLowerCase().includes(query))
            || e.category.toLowerCase().includes(query));
    }
    list = sortByNewest(list);

    const summary = $('expense-summary');
    const container = $('ledger-list');

    if (!state.expenses.length) {
        summary.innerHTML = '';
        container.innerHTML = `<div class="card">${emptyState({ iconId: 'i-receipt', title: 'No expenses yet', text: 'Everything you log shows up here, grouped by day.', actionLabel: 'Add expense', action: 'add-expense' })}</div>`;
        return;
    }
    if (!list.length) {
        summary.innerHTML = '';
        container.innerHTML = `<div class="card"><div class="empty"><span class="empty-icon">${icon('i-search')}</span><span class="empty-title">No matches</span><span class="empty-text">Try another search or category.</span><button type="button" class="btn btn-secondary btn-sm" data-clear-filters>Clear filters</button></div></div>`;
        return;
    }

    const total = sumDisplay(list);
    summary.innerHTML = `<span>${plural(list.length, 'expense')}</span><span>Total <strong class="amount">${escapeHtml(formatCurrency(total, state.config.currency))}</strong></span>`;

    const groups = [];
    list.forEach((e) => {
        const last = groups[groups.length - 1];
        if (last && last.date === e.date) last.items.push(e);
        else groups.push({ date: e.date, items: [e] });
    });

    container.innerHTML = groups.map((g) => `
        <div class="day-group">
            <div class="day-head"><span>${escapeHtml(relativeDayLabel(g.date))}</span><span class="amount">${escapeHtml(formatCurrency(sumDisplay(g.items), state.config.currency))}</span></div>
            <div class="card card-list"><ul class="tx-list">${g.items.map((e) => txRow(e, { showDate: false })).join('')}</ul></div>
        </div>`).join('');
};

/* =========================================================================
   14. Rendering — Savings
   ========================================================================= */
const renderSavingsGoals = () => {
    const cur = state.config.currency;
    const grid = $('savings-grid');
    const summary = $('savings-summary');

    if (!state.savings.length) {
        summary.hidden = true;
        grid.innerHTML = `<div class="card">${emptyState({ iconId: 'i-target', title: 'No savings goals yet', text: 'Pick something to save for and track every deposit toward it.', actionLabel: 'Create a goal', action: 'add-goal' })}</div>`;
        return;
    }

    summary.hidden = false;
    const saved = state.savings.reduce((s, g) => s + toDisplay(g.saved, g.currency), 0);
    const target = state.savings.reduce((s, g) => s + toDisplay(g.target, g.currency), 0);
    const pct = target > 0 ? (saved / target) * 100 : 0;
    $('savings-total').textContent = formatCurrency(saved, cur);
    setMeter($('savings-total-fill'), pct, pct >= 100 ? 'done' : null);
    $('savings-total-pct').textContent = `${Math.round(pct)}% of all targets`;
    $('savings-total-target').textContent = `Target ${formatCurrency(target, cur)}`;

    grid.innerHTML = state.savings.map((g) => {
        const p = g.target > 0 ? (g.saved / g.target) * 100 : 0;
        const done = p >= 100;
        const remaining = Math.max(0, g.target - g.saved);
        const sameCur = g.currency === cur;
        return `
        <article class="card goal">
            <div class="goal-head">
                <div class="goal-title-wrap">
                    <h3 class="goal-title">${escapeHtml(g.name)}</h3>
                    <div class="goal-meta">${done ? 'Goal reached' : `${escapeHtml(formatDisplay(remaining, g.currency))} to go`}</div>
                </div>
                <span class="goal-pct" data-done="${done}">${Math.floor(Math.min(p, 999))}%</span>
            </div>
            <div class="goal-figures">
                <span class="amount">${escapeHtml(formatDisplay(g.saved, g.currency))}</span>
                <span>of ${escapeHtml(formatDisplay(g.target, g.currency))}</span>
            </div>
            <div class="meter" role="progressbar" aria-label="${escapeHtml(g.name)} progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.min(100, p))}">
                <div class="meter-fill" style="width:${Math.min(100, p)}%" ${done ? 'data-state="done"' : ''}></div>
            </div>
            ${sameCur ? '' : `<div class="goal-meta">Saved in ${g.currency}: ${escapeHtml(formatCurrency(g.saved, g.currency))} of ${escapeHtml(formatCurrency(g.target, g.currency))}</div>`}
            <div class="goal-actions">
                <button type="button" class="btn btn-primary btn-sm" data-deposit-goal="${escapeHtml(g.id)}">${icon('i-deposit', 'ic ic-sm')} Deposit</button>
                <button type="button" class="btn btn-secondary btn-sm" data-edit-goal="${escapeHtml(g.id)}">${icon('i-edit', 'ic ic-sm')} Edit</button>
            </div>
        </article>`;
    }).join('');
};

/* =========================================================================
   15. Rendering — Insights
   ========================================================================= */
const renderAnalyticsTab = () => {
    const cur = state.config.currency;
    document.querySelectorAll('.range-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.analyticsRange === analyticsRange)));
    $('analytics-range-label').textContent = RANGE_LABELS[analyticsRange];

    const list = expensesInRange(analyticsRange);
    const { start, end } = rangeBounds(analyticsRange);
    const days = Math.max(1, daysBetween(start, end) + 1);
    const total = sumDisplay(list);

    $('metric-total').textContent = formatCurrency(total, cur);
    $('metric-total-items').textContent = plural(list.length, 'expense');
    $('metric-avg-daily').textContent = formatCurrency(total / days, cur);
    $('metric-avg-days').textContent = `over ${plural(days, 'day')}`;

    let biggest = null;
    list.forEach((e) => {
        const v = toDisplay(e.amount, e.currency);
        if (!biggest || v > biggest.v) biggest = { v, e };
    });
    $('metric-max-spend').textContent = formatCurrency(biggest ? biggest.v : 0, cur);
    $('metric-max-spend-title').textContent = biggest ? biggest.e.desc : '—';

    const { budgetPct, budget } = monthStats();
    $('metric-budget').textContent = `${Math.round(budgetPct)}%`;
    $('metric-budget').className = `metric-value ${budgetPct >= 100 ? 'text-expense' : budgetPct >= 80 ? 'text-warning' : ''}`;
    $('metric-budget-sub').textContent = `of ${formatCompact(budget, cur)} this month`;

    renderHistoryChart(list, start, end);
    renderCategoryChart(list, total);
};

/* =========================================================================
   16. Rendering — Settings
   ========================================================================= */
const renderRateSetting = () => {
    const input = $('setting-rate');
    if (!input) return;
    if (document.activeElement !== input) input.value = state.config.rate.toFixed(2);
    const desc = $('rate-mode-desc');
    if (state.config.rateLocked) {
        desc.textContent = 'Using your own rate. Tap "Live rate" to go back to automatic updates.';
    } else if (rateStatus === 'live' && state.config.rateUpdatedAt) {
        desc.textContent = `Live rate, updated ${new Date(state.config.rateUpdatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.`;
    } else if (rateStatus === 'syncing') {
        desc.textContent = 'Getting the latest rate…';
    } else {
        desc.textContent = state.config.rateUpdatedAt
            ? `Offline. Using the rate from ${new Date(state.config.rateUpdatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.`
            : 'Updates automatically when you are online.';
    }
};

const renderSettingsTab = () => {
    renderRateSetting();
    const budgetInput = $('setting-budget');
    if (document.activeElement !== budgetInput) {
        const v = convertAmount(state.config.budget, 'USD', state.config.currency);
        budgetInput.value = state.config.currency === 'USD' ? (Math.round(v * 100) / 100) : Math.round(v);
    }
    $('setting-budget-currency-suffix').textContent = state.config.currency;
    updateThemeChrome();
    updateUserProfileUI();
};

/* =========================================================================
   17. Charts
   ========================================================================= */
const chartsReady = () => typeof window.Chart !== 'undefined';

const hexToRgba = (hex, alpha) => {
    const h = hex.replace('#', '');
    if (h.length !== 6) return hex;
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

const chartTheme = () => ({
    text: cssVar('--text-3'),
    grid: cssVar('--chart-grid'),
    primary: cssVar('--primary'),
    surface: cssVar('--surface'),
    tooltipBg: cssVar('--bg-elevated'),
    tooltipText: cssVar('--text'),
    tooltipBorder: cssVar('--border-strong'),
    track: cssVar('--surface-2')
});

const baseOptions = (t) => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
        legend: { display: false },
        tooltip: {
            backgroundColor: t.tooltipBg,
            titleColor: t.text,
            bodyColor: t.tooltipText,
            borderColor: t.tooltipBorder,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 10,
            displayColors: false,
            titleFont: { family: 'Inter', size: 11, weight: '600' },
            bodyFont: { family: 'Outfit', size: 14, weight: '600' },
            callbacks: { label: (ctx) => formatCurrency(ctx.parsed.y, state.config.currency) }
        }
    }
});

const axisOptions = (t) => ({
    x: {
        grid: { display: false },
        border: { display: false },
        ticks: { color: t.text, font: { family: 'Inter', size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 }
    },
    y: {
        beginAtZero: true,
        grid: { color: t.grid },
        border: { display: false },
        ticks: { color: t.text, font: { family: 'Inter', size: 10 }, maxTicksLimit: 5, callback: (v) => formatCompact(v, state.config.currency) }
    }
});

const destroyChart = (key) => {
    if (charts[key]) { charts[key].destroy(); charts[key] = null; }
};

const showChartMessage = (id, message) => {
    const el = $(id);
    if (!el) return;
    el.hidden = !message;
    el.textContent = message || '';
};

const renderTrendChart = () => {
    destroyChart('trend');
    if (!chartsReady()) { showChartMessage('dashboard-chart-empty', 'Charts load when you are online.'); return; }

    const t = chartTheme();
    const today = startOfDay(new Date());
    const labels = [];
    const values = [];

    if (dashboardRange === '30') {
        const buckets = new Map();
        for (let i = 29; i >= 0; i--) {
            const d = addDays(today, -i);
            buckets.set(toISODate(d), 0);
            labels.push(shortDayLabel(d));
        }
        state.expenses.forEach((e) => {
            if (buckets.has(e.date)) buckets.set(e.date, buckets.get(e.date) + toDisplay(e.amount, e.currency));
        });
        values.push(...buckets.values());
    } else {
        const buckets = new Map();
        for (let i = 11; i >= 0; i--) {
            const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
            buckets.set(monthKey(d), 0);
            labels.push(d.toLocaleDateString('en-US', { month: 'short' }));
        }
        state.expenses.forEach((e) => {
            const k = e.date.slice(0, 7);
            if (buckets.has(k)) buckets.set(k, buckets.get(k) + toDisplay(e.amount, e.currency));
        });
        values.push(...buckets.values());
    }

    const hasData = values.some((v) => v > 0);
    showChartMessage('dashboard-chart-empty', hasData ? '' : (dashboardRange === '30' ? 'No spending in the last 30 days' : 'No spending in the last 12 months'));

    const last = values.length - 1;
    charts.trend = new Chart($('dashboard-trend-chart'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: values.map((_, i) => (i === last ? t.primary : hexToRgba(t.primary, 0.45))),
                hoverBackgroundColor: t.primary,
                borderRadius: dashboardRange === '30' ? 4 : 6,
                borderSkipped: false,
                maxBarThickness: 28
            }]
        },
        options: { ...baseOptions(t), scales: axisOptions(t) }
    });
};

const renderHistoryChart = (list, start, end) => {
    destroyChart('history');
    if (!chartsReady()) { showChartMessage('analytics-history-empty', 'Charts load when you are online.'); return; }
    const t = chartTheme();
    const span = daysBetween(start, end) + 1;
    const byMonth = analyticsRange === '12m' || (analyticsRange === 'all' && span > 62);

    const labels = [];
    const totals = [];
    if (byMonth) {
        const buckets = new Map();
        const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
        while (cursor <= end) {
            buckets.set(monthKey(cursor), 0);
            labels.push(cursor.toLocaleDateString('en-US', { month: 'short', year: span > 366 ? '2-digit' : undefined }));
            cursor.setMonth(cursor.getMonth() + 1);
        }
        list.forEach((e) => {
            const k = e.date.slice(0, 7);
            if (buckets.has(k)) buckets.set(k, buckets.get(k) + toDisplay(e.amount, e.currency));
        });
        totals.push(...buckets.values());
    } else {
        const buckets = new Map();
        for (let i = 0; i < span; i++) {
            const d = addDays(start, i);
            buckets.set(toISODate(d), 0);
            labels.push(shortDayLabel(d));
        }
        list.forEach((e) => {
            if (buckets.has(e.date)) buckets.set(e.date, buckets.get(e.date) + toDisplay(e.amount, e.currency));
        });
        totals.push(...buckets.values());
    }

    let running = 0;
    const cumulative = totals.map((v) => (running += v));
    const hasData = running > 0;
    showChartMessage('analytics-history-empty', hasData ? '' : 'No spending in this period');

    const canvas = $('analytics-history-chart');
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 240);
    gradient.addColorStop(0, hexToRgba(t.primary, 0.32));
    gradient.addColorStop(1, hexToRgba(t.primary, 0));

    charts.history = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                data: cumulative,
                borderColor: t.primary,
                borderWidth: 2.5,
                backgroundColor: gradient,
                fill: true,
                tension: 0.3,
                pointRadius: cumulative.map((_, i) => (i === cumulative.length - 1 ? 4 : 0)),
                pointBackgroundColor: t.primary,
                pointHoverRadius: 5
            }]
        },
        options: { ...baseOptions(t), scales: axisOptions(t) }
    });
};

const renderCategoryChart = (list, total) => {
    destroyChart('category');
    const cur = state.config.currency;
    const byCat = {};
    list.forEach((e) => { byCat[e.category] = (byCat[e.category] || 0) + toDisplay(e.amount, e.currency); });
    const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

    $('donut-total').textContent = formatCompact(total, cur);
    $('category-breakdown').innerHTML = entries.length
        ? entries.map(([cat, v]) => {
            const pct = total > 0 ? (v / total) * 100 : 0;
            return `<li style="--cat:${catVar(cat)}">
                ${catBadge(cat)}
                <span class="breakdown-name">${cat}</span>
                <span class="breakdown-val amount">${escapeHtml(formatCurrency(v, cur))}</span>
                <span class="breakdown-bar"><span class="meter"><span class="meter-fill" style="display:block;width:${pct}%"></span></span><span class="breakdown-pct">${pct < 1 && pct > 0 ? '<1' : Math.round(pct)}%</span></span>
            </li>`;
        }).join('')
        : `<li style="display:block" class="faint">No expenses in this period.</li>`;

    if (!chartsReady()) return;
    const t = chartTheme();
    const colors = entries.map(([cat]) => cssVar(`--cat-${cat.toLowerCase()}`));
    charts.category = new Chart($('analytics-category-chart'), {
        type: 'doughnut',
        data: {
            labels: entries.length ? entries.map(([c]) => c) : ['None'],
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
            animation: { duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: entries.length > 0,
                    backgroundColor: t.tooltipBg,
                    titleColor: t.text,
                    bodyColor: t.tooltipText,
                    borderColor: t.tooltipBorder,
                    borderWidth: 1,
                    padding: 10,
                    cornerRadius: 10,
                    callbacks: {
                        label: (ctx) => {
                            const pct = total > 0 ? Math.round((ctx.parsed / total) * 100) : 0;
                            return ` ${ctx.label}: ${formatCurrency(ctx.parsed, cur)} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
};

/* =========================================================================
   18. Expense, goal & deposit sheets
   ========================================================================= */
const setCategoryChoice = (cat) => {
    const radio = document.querySelector(`input[name="expense-category"][value="${CATEGORIES.includes(cat) ? cat : 'Other'}"]`);
    if (radio) radio.checked = true;
};

const openAddExpense = () => {
    $('expense-form').reset();
    $('expense-id').value = '';
    $('expense-modal-title').textContent = 'New expense';
    $('btn-submit-expense').textContent = 'Add expense';
    $('btn-delete-expense').hidden = true;
    $('expense-currency').value = state.config.currency;
    $('expense-date').value = toISODate();
    setCategoryChoice(state.config.lastCategory);
    openOrSwap('modal-expense');
};

const openEditExpense = (id) => {
    const exp = state.expenses.find((e) => e.id === id);
    if (!exp) return;
    $('expense-form').reset();
    $('expense-id').value = exp.id;
    $('expense-modal-title').textContent = 'Edit expense';
    $('btn-submit-expense').textContent = 'Save changes';
    $('btn-delete-expense').hidden = false;
    $('expense-amount').value = exp.amount;
    $('expense-currency').value = exp.currency;
    $('expense-desc').value = exp.desc;
    $('expense-date').value = exp.date;
    $('expense-note').value = exp.note || '';
    setCategoryChoice(exp.category);
    openOrSwap('modal-expense');
};

const fieldError = (input, message) => {
    showToast(message, 'error');
    if (input) input.focus();
    return false;
};

const submitExpense = () => {
    const id = $('expense-id').value;
    const amount = toNumber($('expense-amount').value, NaN);
    const currency = $('expense-currency').value === 'LKR' ? 'LKR' : 'USD';
    const desc = $('expense-desc').value.trim();
    const date = $('expense-date').value;
    const note = $('expense-note').value.trim();
    const catInput = document.querySelector('input[name="expense-category"]:checked');
    const category = catInput ? catInput.value : 'Other';

    if (!(amount > 0)) return fieldError($('expense-amount'), 'Enter an amount greater than zero.');
    if (!desc) return fieldError($('expense-desc'), 'Add a short description, like "Groceries".');
    if (!isISODate(date)) return fieldError($('expense-date'), 'Pick a date for this expense.');

    let record;
    if (id) {
        const idx = state.expenses.findIndex((e) => e.id === id);
        if (idx === -1) return false;
        record = { ...state.expenses[idx], desc, amount, currency, category, date, note };
        state.expenses[idx] = record;
    } else {
        record = { id: generateId(), desc, amount, currency, category, date, note, createdAt: Date.now() };
        state.expenses.push(record);
    }
    state.config.lastCategory = category;
    saveState();
    queueSync('expenses', record.id, 'upsert');
    closeSheet('modal-expense');
    showToast(id ? 'Expense updated' : `Added ${formatCurrency(amount, currency)} for ${desc}`, 'success');
    renderActive();
    return true;
};

const deleteExpense = (id) => {
    const exp = state.expenses.find((e) => e.id === id);
    if (!exp) return;
    showConfirm({
        title: 'Delete this expense?',
        message: `"${exp.desc}" (${formatCurrency(exp.amount, exp.currency)}) will be removed.`,
        confirmLabel: 'Delete',
        onConfirm: () => {
            state.expenses = state.expenses.filter((e) => e.id !== id);
            saveState();
            queueSync('expenses', id, 'delete');
            closeSheet('modal-expense');
            showToast('Expense deleted', 'success');
            renderActive();
        }
    });
};

const openAddGoal = () => {
    $('savings-goal-form').reset();
    $('savings-goal-id').value = '';
    $('savings-goal-modal-title').textContent = 'New savings goal';
    $('btn-submit-savings-goal').textContent = 'Create goal';
    $('savings-goal-initial-label').textContent = 'Already saved';
    $('btn-delete-goal').hidden = true;
    $('savings-goal-currency').value = state.config.currency;
    openOrSwap('modal-savings-goal');
};

const openEditGoal = (id) => {
    const g = state.savings.find((x) => x.id === id);
    if (!g) return;
    $('savings-goal-form').reset();
    $('savings-goal-id').value = g.id;
    $('savings-goal-modal-title').textContent = 'Edit goal';
    $('btn-submit-savings-goal').textContent = 'Save changes';
    $('savings-goal-initial-label').textContent = 'Saved so far';
    $('btn-delete-goal').hidden = false;
    $('savings-goal-name').value = g.name;
    $('savings-goal-target').value = g.target;
    $('savings-goal-currency').value = g.currency;
    $('savings-goal-initial').value = Math.round(g.saved * 100) / 100;
    openOrSwap('modal-savings-goal');
};

const submitGoal = () => {
    const id = $('savings-goal-id').value;
    const name = $('savings-goal-name').value.trim();
    const target = toNumber($('savings-goal-target').value, NaN);
    const currency = $('savings-goal-currency').value === 'LKR' ? 'LKR' : 'USD';
    const savedRaw = $('savings-goal-initial').value.trim();
    const saved = savedRaw === '' ? 0 : toNumber(savedRaw, NaN);

    if (!name) return fieldError($('savings-goal-name'), 'Give your goal a name.');
    if (!(target > 0)) return fieldError($('savings-goal-target'), 'Enter a target greater than zero.');
    if (!(saved >= 0)) return fieldError($('savings-goal-initial'), 'The saved amount can’t be negative.');

    let record;
    if (id) {
        const idx = state.savings.findIndex((g) => g.id === id);
        if (idx === -1) return false;
        record = { ...state.savings[idx], name, target, currency, saved };
        state.savings[idx] = record;
    } else {
        record = { id: generateId(), name, target, currency, saved, createdAt: Date.now() };
        state.savings.push(record);
    }
    saveState();
    queueSync('savings', record.id, 'upsert');
    closeSheet('modal-savings-goal');
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
        confirmLabel: 'Delete',
        onConfirm: () => {
            state.savings = state.savings.filter((x) => x.id !== id);
            saveState();
            queueSync('savings', id, 'delete');
            closeSheet('modal-savings-goal');
            showToast('Goal deleted', 'success');
            renderActive();
        }
    });
};

const updateDepositHint = () => {
    const goal = state.savings.find((g) => g.id === $('funds-select-goal').value);
    const cur = $('funds-currency').value;
    const hint = $('funds-hint');
    if (!goal) { hint.textContent = ''; return; }
    hint.textContent = goal.currency === cur
        ? `Saved so far: ${formatCurrency(goal.saved, goal.currency)} of ${formatCurrency(goal.target, goal.currency)}`
        : `Converted to ${goal.currency} at 1 USD = ${state.config.rate.toFixed(2)} LKR.`;
};

const openDeposit = (goalId) => {
    if (!state.savings.length) {
        showToast('Create a savings goal first, then deposit into it.', 'info');
        openAddGoal();
        return;
    }
    const select = $('funds-select-goal');
    select.innerHTML = state.savings.map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join('');
    const goal = state.savings.find((g) => g.id === goalId) || state.savings[0];
    select.value = goal.id;
    $('funds-amount').value = '';
    $('funds-currency').value = goal.currency;
    updateDepositHint();
    openOrSwap('modal-savings-funds');
};

const submitDeposit = () => {
    const goalId = $('funds-select-goal').value;
    const amount = toNumber($('funds-amount').value, NaN);
    const currency = $('funds-currency').value === 'LKR' ? 'LKR' : 'USD';
    if (!(amount > 0)) return fieldError($('funds-amount'), 'Enter an amount greater than zero.');
    const idx = state.savings.findIndex((g) => g.id === goalId);
    if (idx === -1) return fieldError($('funds-select-goal'), 'Choose a goal to deposit into.');

    const goal = state.savings[idx];
    goal.saved = Math.round((goal.saved + convertAmount(amount, currency, goal.currency)) * 100) / 100;
    saveState();
    queueSync('savings', goal.id, 'upsert');
    closeSheet('modal-savings-funds');
    showToast(`Deposited ${formatCurrency(amount, currency)} to ${goal.name}`, 'success');
    renderActive();
    return true;
};

/* =========================================================================
   19. Cloud sync (Supabase)
   ========================================================================= */
const canSync = () => !!(supabaseClient && !state.auth.isMock && state.auth.user && state.auth.user.id);
const pendingCount = () => Object.keys(state.sync.expenses).length + Object.keys(state.sync.savings).length;

const expenseRow = (e) => ({
    id: e.id,
    user_id: state.auth.user.id,
    description: e.desc,
    amount: e.amount,
    currency: e.currency,
    category: e.category,
    date: e.date,
    note: e.note || null
});

const goalRow = (g) => ({
    id: g.id,
    user_id: state.auth.user.id,
    name: g.name,
    target: g.target,
    currency: g.currency,
    saved: g.saved
});

let flushPromise = null;
let flushAgain = false;

const flushSync = () => {
    if (!canSync() || (typeof navigator.onLine === 'boolean' && !navigator.onLine)) return Promise.resolve(pendingCount() === 0);
    if (flushPromise) { flushAgain = true; return flushPromise; }

    flushPromise = (async () => {
        try {
            for (const kind of ['expenses', 'savings']) {
                const queue = state.sync[kind];
                const ids = Object.keys(queue);
                if (!ids.length) continue;
                const upserts = ids.filter((id) => queue[id] === 'upsert');
                const deletes = ids.filter((id) => queue[id] === 'delete');

                if (upserts.length) {
                    const rows = state[kind].filter((r) => upserts.includes(r.id)).map(kind === 'expenses' ? expenseRow : goalRow);
                    if (rows.length) {
                        const { error } = await supabaseClient.from(kind).upsert(rows);
                        if (error) throw error;
                    }
                    upserts.forEach((id) => { if (queue[id] === 'upsert') delete queue[id]; });
                }
                if (deletes.length) {
                    const { error } = await supabaseClient.from(kind).delete().in('id', deletes);
                    if (error) throw error;
                    deletes.forEach((id) => { if (queue[id] === 'delete') delete queue[id]; });
                }
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
        }
    })();
    return flushPromise;
};

const queueSync = (kind, id, op) => {
    if (!canSync()) return;
    state.sync[kind][id] = op;
    saveState();
    flushSync();
};

const queueAllForUpload = () => {
    state.expenses.forEach((e) => { state.sync.expenses[e.id] = 'upsert'; });
    state.savings.forEach((g) => { state.sync.savings[g.id] = 'upsert'; });
    saveState();
};

// Replace local data with the cloud copy (only after local changes have been sent).
const pullLedgerFromSupabase = async () => {
    if (!canSync()) return false;
    const flushed = await flushSync();
    if (!flushed || pendingCount() > 0) return false;
    try {
        const [ex, sv] = await Promise.all([
            supabaseClient.from('expenses').select('*'),
            supabaseClient.from('savings').select('*')
        ]);
        if (ex.error) throw ex.error;
        if (sv.error) throw sv.error;
        state.expenses = (ex.data || []).map((r) => normalizeExpense({ ...r, desc: r.description })).filter(Boolean);
        state.savings = (sv.data || []).map(normalizeGoal).filter(Boolean);
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
        const [ex, sv] = await Promise.all([
            supabaseClient.from('expenses').select('id').limit(1),
            supabaseClient.from('savings').select('id').limit(1)
        ]);
        return !!((ex.data && ex.data.length) || (sv.data && sv.data.length));
    } catch (err) {
        console.warn('Could not check cloud data:', err);
        return false;
    }
};

/* =========================================================================
   20. Profile
   ========================================================================= */
const initialsFor = (name) => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'V';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
};

const displayName = () => (state.auth.user && state.auth.user.full_name) || 'Guest';

const updateUserProfileUI = () => {
    const user = state.auth.user;
    const name = displayName();
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
    document.querySelectorAll('[data-user-name]').forEach((el) => { el.textContent = name; });
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
        logout.innerHTML = cloud
            ? `${icon('i-logout')} <span>Sign out</span>`
            : `${icon('i-cloud')} <span>Sign in to sync</span>`;
    }
};

// Shrink a picked photo to a 256px JPEG so it fits in storage and uploads fast.
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
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
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
    try {
        resized = await resizeImage(file);
    } catch (err) {
        showToast("That image couldn't be read. Try a JPG or PNG.", 'error');
        return;
    }

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
            const { error } = await supabaseClient.from('profiles').upsert({
                id: state.auth.user.id, full_name: name, username: name, updated_at: new Date().toISOString()
            });
            if (error) throw error;
            showToast('Name saved', 'success');
        } catch (err) {
            console.error('Profile update failed:', err);
            showToast("Name saved on this device, but it couldn't sync. It will update next time.", 'warning');
        }
    } else {
        showToast('Name saved', 'success');
    }
};

/* =========================================================================
   21. Authentication & onboarding
   ========================================================================= */
const goToStep = (step) => {
    document.querySelectorAll('.auth-step').forEach((s) => s.classList.toggle('active', s.id === `auth-step-${step}`));
    const dots = $('auth-step-indicators');
    dots.hidden = step === 1;
    dots.querySelectorAll('span').forEach((d) => d.classList.toggle('active', Number(d.dataset.step) === step));
    const overlay = $('auth-overlay-container');
    overlay.scrollTop = 0;
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
    return msg || 'Something went wrong. Try again.';
};

const requireCloud = () => {
    if (supabaseClient) return true;
    showToast("Sign-in needs an internet connection. You can keep using Vela on this device.", 'warning');
    return false;
};

const handleSession = async (session) => {
    if (!session || !session.user) return;
    const user = session.user;
    if (handledUserId === user.id) return;
    handledUserId = user.id;

    const wasGuestWithData = state.auth.isMock && state.auth.completedOnboarding && (state.expenses.length > 0 || state.savings.length > 0);
    const previousCloudUser = !state.auth.isMock && state.auth.user ? state.auth.user.id : null;
    if (previousCloudUser && previousCloudUser !== user.id) {
        // Another account's cached data must not leak into this one.
        state.expenses = [];
        state.savings = [];
        state.sync = { expenses: {}, savings: {} };
    }

    const meta = user.user_metadata || {};
    let fullName = meta.full_name || meta.name || (user.email ? user.email.split('@')[0] : 'Vela user');
    let avatarUrl = meta.avatar_url || meta.picture || null;
    try {
        const { data: profile } = await supabaseClient.from('profiles').select('*').eq('id', user.id).maybeSingle();
        if (profile) {
            fullName = profile.full_name || profile.username || fullName;
            avatarUrl = profile.avatar_url || avatarUrl;
        }
    } catch (err) {
        console.warn('Could not load profile:', err);
    }

    state.auth.user = { id: user.id, email: user.email || null, full_name: fullName, avatar_url: avatarUrl };
    state.auth.isMock = false;
    saveState();

    if (wasGuestWithData) {
        queueAllForUpload(); // keep what the guest already logged
    }

    const hasRemote = await remoteHasData();
    if (hasRemote || wasGuestWithData || state.auth.completedOnboarding) {
        state.auth.completedOnboarding = true;
        if (!hasRemote && (state.expenses.length || state.savings.length)) queueAllForUpload();
        await pullLedgerFromSupabase();
        saveState();
        hideAuth();
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
    state.expenses = [];
    state.savings = [];
    state.sync = { expenses: {}, savings: {} };
    state.auth = { user: null, isMock: true, completedOnboarding: false };
    saveState();
    updateUserProfileUI();
    renderActive();
    showAuth(1);
};

const onAuthEvent = (event, session) => {
    if (event === 'INITIAL_SESSION') {
        if (session) {
            handleSession(session);
        } else if (!state.auth.isMock && state.auth.user) {
            // The saved session is gone (expired or signed out elsewhere).
            if (pendingCount() > 0) {
                showToast('Sign in again to sync changes made on this device.', 'warning');
                showAuth(1);
            } else {
                resetToSignedOut();
            }
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
        options: { data: { full_name: fullName, username: fullName }, emailRedirectTo: window.location.origin + window.location.pathname }
    });
    if (error) { showToast(friendlyAuthError(error), 'error'); return; }
    if (data.session) {
        await handleSession(data.session);
        showToast(`Account created. Welcome, ${fullName}!`, 'success');
    } else {
        // Email confirmation is switched on for this project.
        setAuthMode('signin');
        $('signin-email').value = email;
        showToast(`Check ${email} for a confirmation link, then sign in here.`, 'info');
    }
};

// OAuth leaves the page immediately, so check the auth server is reachable first;
// otherwise the user lands on a browser error page instead of a clear message.
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

const handleGoogleSignIn = async () => {
    if (!requireCloud()) return;
    if (!(await authServerReachable())) {
        showToast("Can't reach the sign-in server right now. You can keep using Vela without an account.", 'error');
        return;
    }
    const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + window.location.pathname }
    });
    if (error) showToast(friendlyAuthError(error), 'error');
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
            try { if (supabaseClient) await supabaseClient.auth.signOut(); } catch (err) { console.warn('Sign out error:', err); }
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
    const now = Date.now();
    const e = (desc, amount, currency, category, daysAgo, note) => ({ id: generateId(), desc, amount, currency, category, date: ago(daysAgo), note, createdAt: now - daysAgo * 1000 });
    state.expenses = [
        e('Groceries at Keells', 45.5, 'USD', 'Food', 1, 'Weekly shop'),
        e('Electricity bill', 15000, 'LKR', 'Utilities', 4, 'CEB monthly bill'),
        e('Apartment rent', 400, 'USD', 'Rent', 9, ''),
        e('Netflix', 15.49, 'USD', 'Entertainment', 12, ''),
        e('PickMe ride', 2400, 'LKR', 'Travel', 14, 'To the office'),
        e('Pharmacy', 35, 'USD', 'Health', 20, 'Prescriptions'),
        e('Office chair', 120, 'USD', 'Shopping', 38, ''),
        e('Fuel', 8500, 'LKR', 'Travel', 47, 'Full tank'),
        e('Fibre internet', 4800, 'LKR', 'Utilities', 64, ''),
        e('Birthday dinner', 95, 'USD', 'Food', 101, ''),
        e('Online course', 200, 'USD', 'Entertainment', 190, ''),
        e('Car insurance', 380, 'USD', 'Other', 290, 'Annual')
    ];
    state.savings = [
        { id: generateId(), name: 'Emergency fund', target: 5000, currency: 'USD', saved: 2400, createdAt: now },
        { id: generateId(), name: 'New laptop', target: 2500, currency: 'USD', saved: 750, createdAt: now },
        { id: generateId(), name: 'Trip to Ella', target: 150000, currency: 'LKR', saved: 45000, createdAt: now }
    ];
};

const completeOnboarding = async () => {
    const btn = $('btn-complete-onboarding');
    await withBusy(btn, async () => {
        if (onboardingPreference === 'demo' && !state.expenses.length && !state.savings.length) {
            seedData();
            if (canSync()) queueAllForUpload();
        }
        state.auth.completedOnboarding = true;
        saveState();
        hideAuth();
        updateUserProfileUI();
        switchTab('dashboard', { fromHistory: true });
        flushSync();
        showToast(onboardingPreference === 'demo' ? 'Sample data added. Explore away!' : "You're all set. Tap + to log your first expense.", 'success');
    });
};

/* =========================================================================
   22. Backup, import, wipe
   ========================================================================= */
const exportBackup = () => {
    const payload = {
        app: 'vela',
        version: APP_VERSION,
        exportedAt: new Date().toISOString(),
        config: { ...state.config },
        expenses: state.expenses,
        savings: state.savings
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vela-backup-${toISODate()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast(`Backup saved (${plural(state.expenses.length, 'expense')}, ${plural(state.savings.length, 'goal')})`, 'success');
};

const importBackup = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
        let parsed;
        try {
            parsed = JSON.parse(reader.result);
        } catch (err) {
            showToast("That file isn't a valid Vela backup (.json).", 'error');
            return;
        }
        if (!parsed || (!Array.isArray(parsed.expenses) && !Array.isArray(parsed.savings))) {
            showToast("That file doesn't contain any Vela expenses or goals.", 'error');
            return;
        }
        const incoming = normalizeState({
            config: { ...state.config, ...(parsed.config || {}), theme: state.config.theme },
            expenses: parsed.expenses || [],
            savings: parsed.savings || []
        });
        showConfirm({
            title: 'Replace your data?',
            message: `This backup has ${plural(incoming.expenses.length, 'expense')} and ${plural(incoming.savings.length, 'goal')}. They will replace what's on this device.`,
            confirmLabel: 'Replace',
            danger: false,
            onConfirm: () => {
                state.expenses = incoming.expenses;
                state.savings = incoming.savings;
                state.config = { ...incoming.config, theme: state.config.theme };
                if (canSync()) queueAllForUpload();
                saveState();
                flushSync();
                updateCurrencyButtons();
                setRateStatus(state.config.rateLocked ? 'manual' : rateStatus);
                renderActive();
                showToast('Backup imported', 'success');
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
            : `This permanently deletes ${plural(state.expenses.length, 'expense')} and ${plural(state.savings.length, 'goal')}. Export a backup first if you might need them.`,
        confirmLabel: 'Delete everything',
        onConfirm: () => {
            storage.remove(STORAGE_KEY);
            window.location.reload();
        }
    });
};

/* =========================================================================
   23. PWA install
   ========================================================================= */
const initPwaInstall = () => {
    const btn = $('btn-install-pwa');
    const guide = $('install-guide');
    const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
    if (standalone && guide) guide.hidden = true;

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
        if (btn) btn.hidden = true;
        if (guide) guide.hidden = true;
        showToast('Vela is installed. Open it from your home screen.', 'success');
    });
};

/* =========================================================================
   24. Events
   ========================================================================= */
const updateCurrencyButtons = () => {
    $('currency-usd').setAttribute('aria-pressed', String(state.config.currency === 'USD'));
    $('currency-lkr').setAttribute('aria-pressed', String(state.config.currency === 'LKR'));
};

const setDisplayCurrency = (cur) => {
    if (cur === state.config.currency) return;
    state.config.currency = cur;
    saveState();
    updateCurrencyButtons();
    renderActive();
};

const initEvents = () => {
    // One delegated click handler for the whole app.
    document.addEventListener('click', (e) => {
        const el = e.target.closest('button, [data-tab], [data-goto]');
        if (!el) return;
        const d = el.dataset;

        if (d.tab) { switchTab(d.tab); return; }
        if (d.goto) { switchTab(d.goto); return; }
        if (d.editExpense) { openEditExpense(d.editExpense); return; }
        if (d.editGoal) { openEditGoal(d.editGoal); return; }
        if (d.depositGoal) { openDeposit(d.depositGoal); return; }
        if (d.filterCategory) { expenseFilter = d.filterCategory; renderExpensesList(); return; }
        if (d.themeChoice) { setTheme(d.themeChoice, e); return; }
        if (d.currency) { setDisplayCurrency(d.currency); return; }
        if (el.hasAttribute('data-clear-filters')) {
            expenseFilter = 'all';
            $('expense-search').value = '';
            renderExpensesList();
            return;
        }
        if (el.hasAttribute('data-close-sheet')) {
            const overlay = el.closest('.sheet-overlay');
            if (overlay) closeSheet(overlay.id);
            return;
        }
        switch (d.action) {
            case 'quick-add': openSheet('modal-quick-add'); break;
            case 'add-expense': openAddExpense(); break;
            case 'add-goal': openAddGoal(); break;
            case 'deposit': openDeposit(); break;
            default: break;
        }
    });

    // Tap on the dimmed backdrop closes a sheet.
    document.querySelectorAll('.sheet-overlay').forEach((overlay) => {
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSheet(overlay.id); });
    });

    // Confirm dialog
    $('btn-confirm-ok').addEventListener('click', () => {
        const handler = confirmHandler;
        closeConfirm();
        if (handler) handler();
    });
    $('btn-confirm-cancel').addEventListener('click', closeConfirm);
    $('modal-confirm').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeConfirm(); });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (isConfirmOpen()) { closeConfirm(); return; }
        const top = openSheets[openSheets.length - 1];
        if (top) closeSheet(top);
    });

    // Phone Back button / browser history
    window.addEventListener('popstate', (e) => {
        if (isConfirmOpen()) closeConfirm();
        if (openSheets.length) {
            hideSheet(openSheets[openSheets.length - 1]);
            return;
        }
        const st = e.state;
        if (st && st.tab && st.tab !== currentTab) switchTab(st.tab, { fromHistory: true });
    });

    // Header
    $('theme-toggle-btn').addEventListener('click', (e) => setTheme(state.config.theme === 'dark' ? 'light' : 'dark', e));
    $('rate-chip').addEventListener('click', () => {
        switchTab('settings');
        setTimeout(() => {
            const block = $('setting-rate-block');
            if (block) block.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 60);
    });

    let ticking = false;
    window.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            $('appbar').classList.toggle('is-scrolled', window.scrollY > 4);
            ticking = false;
        });
    }, { passive: true });

    // Forms
    $('expense-form').addEventListener('submit', (e) => { e.preventDefault(); submitExpense(); });
    $('savings-goal-form').addEventListener('submit', (e) => { e.preventDefault(); submitGoal(); });
    $('savings-funds-form').addEventListener('submit', (e) => { e.preventDefault(); submitDeposit(); });
    $('btn-delete-expense').addEventListener('click', () => deleteExpense($('expense-id').value));
    $('btn-delete-goal').addEventListener('click', () => deleteGoal($('savings-goal-id').value));
    $('funds-select-goal').addEventListener('change', () => {
        const goal = state.savings.find((g) => g.id === $('funds-select-goal').value);
        if (goal) $('funds-currency').value = goal.currency;
        updateDepositHint();
    });
    $('funds-currency').addEventListener('change', updateDepositHint);

    // Expenses search
    let searchTimer = null;
    $('expense-search').addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(renderExpensesList, 120);
    });

    // Chart ranges
    document.querySelectorAll('.chart-time-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            dashboardRange = btn.dataset.range;
            document.querySelectorAll('.chart-time-btn').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
            renderTrendChart();
        });
    });
    document.querySelectorAll('.range-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            analyticsRange = btn.dataset.analyticsRange;
            renderAnalyticsTab();
        });
    });

    // Settings
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
    $('btn-save-budget').addEventListener('click', () => {
        const value = toNumber($('setting-budget').value, NaN);
        if (!(value > 0)) { fieldError($('setting-budget'), 'Enter a monthly budget greater than zero.'); return; }
        state.config.budget = convertAmount(value, state.config.currency, 'USD');
        saveState();
        showToast(`Monthly budget set to ${formatCurrency(value, state.config.currency)}`, 'success');
        renderActive();
    });
    $('btn-export-data').addEventListener('click', exportBackup);
    $('btn-import-trigger').addEventListener('click', () => $('file-import').click());
    $('file-import').addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) importBackup(file);
        e.target.value = '';
    });
    $('btn-wipe-data').addEventListener('click', wipeData);

    // Profile
    $('profile-avatar-click-zone').addEventListener('click', () => $('profile-avatar-input').click());
    $('profile-avatar-input').addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) handleAvatarUpload(file);
        e.target.value = '';
    });
    $('btn-save-profile').addEventListener('click', (e) => withBusy(e.currentTarget, saveProfileChanges));
    $('profile-username').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('btn-save-profile').click(); } });
    $('btn-auth-logout').addEventListener('click', handleSignOut);

    // Auth & onboarding
    $('btn-toggle-signin').addEventListener('click', () => setAuthMode('signin'));
    $('btn-toggle-signup').addEventListener('click', () => setAuthMode('signup'));
    $('form-signin').addEventListener('submit', (e) => {
        e.preventDefault();
        const email = $('signin-email').value.trim();
        const password = $('signin-password').value;
        if (!email || !/\S+@\S+\.\S+/.test(email)) { fieldError($('signin-email'), 'Enter the email you signed up with.'); return; }
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
    ['opt-fresh-start', 'opt-demo-data'].forEach((id) => {
        $(id).addEventListener('click', () => {
            onboardingPreference = id === 'opt-demo-data' ? 'demo' : 'fresh';
            $('opt-fresh-start').setAttribute('aria-pressed', String(onboardingPreference === 'fresh'));
            $('opt-demo-data').setAttribute('aria-pressed', String(onboardingPreference === 'demo'));
        });
    });
    $('btn-complete-onboarding').addEventListener('click', completeOnboarding);

    // Connectivity & app resume
    window.addEventListener('online', () => {
        flushSync().then(() => updateUserProfileUI());
        fetchLiveExchangeRate();
    });
    window.addEventListener('offline', () => {
        if (!state.config.rateLocked) setRateStatus('offline');
        showToast("You're offline. Changes are saved on this device.", 'info');
    });
    let lastDay = toISODate();
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        if (toISODate() !== lastDay) { lastDay = toISODate(); renderActive(); }
        if (pendingCount()) flushSync();
    });
};

/* =========================================================================
   25. Start-up
   ========================================================================= */
const initSupabase = () => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
        console.warn('Supabase library unavailable (offline?). Running in local mode.');
        return;
    }
    try {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch (err) {
        console.error('Failed to start Supabase:', err);
        supabaseClient = null;
    }
};

const init = () => {
    loadState();
    document.documentElement.setAttribute('data-theme', state.config.theme);

    buildFilterChips();
    buildCategoryPicker();
    initEvents();
    initSheetDrag();
    initPwaInstall();

    updateThemeChrome();
    updateCurrencyButtons();
    setRateStatus(state.config.rateLocked ? 'manual' : 'offline');
    updateUserProfileUI();

    // We manage scroll ourselves; the browser restoring old positions on Back looks broken.
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    history.replaceState({ vela: 'tab', tab: 'dashboard' }, '');
    switchTab('dashboard', { fromHistory: true });

    if (state.auth.completedOnboarding) hideAuth();
    else showAuth(1);

    initSupabase();
    if (supabaseClient) {
        // Defer work out of the callback: awaiting Supabase calls inside it can deadlock the client.
        supabaseClient.auth.onAuthStateChange((event, session) => {
            setTimeout(() => onAuthEvent(event, session), 0);
        });
    }

    fetchLiveExchangeRate();
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
