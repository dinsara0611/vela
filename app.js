/**
 * Vela - Core Application Logic
 */

// --- APPLICATION STATE ---
let state = {
    expenses: [],       // Array of { id, desc, amount, currency, category, date, note }
    savings: [],        // Array of { id, name, target, currency, saved }
    config: {
        rate: 300.00,   // Default fallback: 1 USD = 300 LKR
        currency: 'USD', // Default display currency: USD
        theme: 'dark',  // Default theme: dark
        budget: 1000.00 // Default monthly spending budget limit (in USD)
    }
};

// --- INITIAL DATA SEEDING (IF EMPTY) ---
const seedData = () => {
    if (state.expenses.length === 0 && state.savings.length === 0) {
        const today = new Date();
        const createPastDate = (daysAgo) => {
            const d = new Date();
            d.setDate(today.getDate() - daysAgo);
            return d.toISOString().split('T')[0];
        };

        state.expenses = [
            { id: '1', desc: 'Grocery Store Buy', amount: 45.50, currency: 'USD', category: 'Food', date: createPastDate(2), note: 'Weekly groceries' },
            { id: '2', desc: 'Electricity Bill', amount: 15000.00, currency: 'LKR', category: 'Utilities', date: createPastDate(5), note: 'Monthly electricity bill' },
            { id: '3', desc: 'House Rental payment', amount: 400.00, currency: 'USD', category: 'Rent', date: createPastDate(12), note: 'Monthly house lease' },
            { id: '4', desc: 'Netflix Subscription', amount: 15.49, currency: 'USD', category: 'Entertainment', date: createPastDate(15), note: 'Streaming service' },
            { id: '5', desc: 'Uber Ride', amount: 2400.00, currency: 'LKR', category: 'Travel', date: createPastDate(18), note: 'Taxi to office' },
            { id: '6', desc: 'Pharmacy Meds', amount: 35.00, currency: 'USD', category: 'Health', date: createPastDate(25), note: 'Prescriptions' },
            { id: '7', desc: 'Office Chair Upgrade', amount: 120.00, currency: 'USD', category: 'Shopping', date: createPastDate(45), note: 'Ergonomic chair' },
            { id: '8', desc: 'Gas Station Refuel', amount: 8500.00, currency: 'LKR', category: 'Travel', date: createPastDate(60), note: 'Full tank fuel' },
            { id: '9', desc: 'Internet Broadband', amount: 4800.00, currency: 'LKR', category: 'Utilities', date: createPastDate(75), note: 'Fiber line' },
            { id: '10', desc: 'Fine Dining Dinner', amount: 95.00, currency: 'USD', category: 'Food', date: createPastDate(110), note: 'Birthday dinner' },
            { id: '11', desc: 'Software Course Subscription', amount: 200.00, currency: 'USD', category: 'Entertainment', date: createPastDate(200), note: 'E-learning site' },
            { id: '12', desc: 'Annual Car Insurance', amount: 380.00, currency: 'USD', category: 'Other', date: createPastDate(300), note: 'Full coverage insurance' }
        ];

        state.savings = [
            { id: 's1', name: 'Emergency Contingency Fund', target: 5000.00, currency: 'USD', saved: 2400.00 },
            { id: 's2', name: 'Next-Gen Macbook Pro M4', target: 2500.00, currency: 'USD', saved: 750.00 },
            { id: 's3', name: 'Local Travel Fund', target: 150000.00, currency: 'LKR', saved: 45000.00 }
        ];
        
        saveState();
    }
};

// --- DATA PERSISTENCE ---
const saveState = () => {
    localStorage.setItem('VELA_STATE', JSON.stringify(state));
};

const loadState = () => {
    const data = localStorage.getItem('VELA_STATE');
    if (data) {
        try {
            state = JSON.parse(data);
            // Ensure config defaults exist
            if (!state.config) state.config = {};
            if (state.config.rate === undefined) state.config.rate = 300.00;
            if (state.config.currency === undefined) state.config.currency = 'USD';
            if (state.config.theme === undefined) state.config.theme = 'dark';
            if (state.config.budget === undefined) state.config.budget = 1000.00;
        } catch (e) {
            console.error('Error loading stored Vela state:', e);
        }
    } else {
        const oldData = localStorage.getItem('NIXLEDGER_STATE');
        if (oldData) {
            try {
                state = JSON.parse(oldData);
                if (!state.config) state.config = {};
                if (state.config.theme === undefined) state.config.theme = 'dark';
                if (state.config.budget === undefined) state.config.budget = 1000.00;
                saveState();
                console.log('Migrated NixLedger storage key to Vela key.');
            } catch (e) {
                seedData();
            }
        } else {
            seedData();
        }
    }
};

// --- CURRENCY CONVERTER HELPERS ---
const convertAmount = (amount, fromCurrency, toCurrency) => {
    if (fromCurrency === toCurrency) return amount;
    
    const usdToLkrRate = state.config.rate;
    if (fromCurrency === 'USD' && toCurrency === 'LKR') {
        return amount * usdToLkrRate;
    } else if (fromCurrency === 'LKR' && toCurrency === 'USD') {
        return amount / usdToLkrRate;
    }
    return amount;
};

const formatCurrency = (amount, currencyCode) => {
    const symbol = currencyCode === 'USD' ? '$' : 'Rs. ';
    return `${symbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const convertToDisplayCurrency = (amount, originalCurrency) => {
    return convertAmount(amount, originalCurrency, state.config.currency);
};

const formatToDisplayCurrency = (amount, originalCurrency) => {
    const converted = convertToDisplayCurrency(amount, originalCurrency);
    return formatCurrency(converted, state.config.currency);
};

// --- THEME MANAGEMENT ---
const applyTheme = (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    state.config.theme = theme;
    saveState();
    
    // Refresh visual stats on active tab
    refreshActivePane();
};

const toggleTheme = () => {
    const currentTheme = state.config.theme || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
};

// Helper to retrieve color configuration based on theme for Chart.js
const getChartThemeColors = () => {
    const isLight = state.config.theme === 'light';
    return {
        grid: isLight ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.04)',
        text: isLight ? '#585866' : '#8e8e9f',
        tooltipBg: isLight ? '#ffffff' : '#161622',
        tooltipBorder: isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.1)',
        tooltipText: isLight ? '#191921' : '#fff'
    };
};

// --- LIVE EXCHANGE RATE FEED INTEGRATION ---
const fetchLiveExchangeRate = async (showNotification = false) => {
    const statusText = document.getElementById('connection-status');
    const statusDot = document.getElementById('connection-indicator');
    
    if (statusText) statusText.textContent = "Syncing Exchange Rates...";
    if (statusDot) {
        statusDot.style.backgroundColor = "var(--accent-orange)";
        statusDot.style.boxShadow = "0 0 8px var(--accent-orange-glow)";
    }

    try {
        const response = await fetch('https://open.er-api.com/v6/latest/USD');
        if (!response.ok) throw new Error('API request failed');
        const data = await response.json();
        
        if (data && data.rates && data.rates.LKR) {
            const rawRate = data.rates.LKR;
            state.config.rate = parseFloat(rawRate);
            saveState();
            
            document.getElementById('current-rate-display').textContent = `1 USD = ${state.config.rate.toFixed(2)} LKR`;
            const rateInput = document.getElementById('setting-rate');
            if (rateInput) rateInput.value = state.config.rate.toFixed(2);
            
            if (statusText) statusText.textContent = "Live Exchange Rates Synced";
            if (statusDot) {
                statusDot.style.backgroundColor = "var(--accent-green)";
                statusDot.style.boxShadow = "0 0 8px var(--accent-green)";
            }

            refreshActivePane();
            
            if (showNotification) {
                alert(`Successfully synced live rate: 1 USD = ${state.config.rate.toFixed(2)} LKR`);
            }
        } else {
            throw new Error('Invalid rate response format');
        }
    } catch (error) {
        console.warn('Unable to retrieve live rates. Falling back to cached rate.', error);
        
        if (statusText) statusText.textContent = "Cloud Offline Mode (Cached Rate)";
        if (statusDot) {
            statusDot.style.backgroundColor = "var(--text-muted)";
            statusDot.style.boxShadow = "none";
        }
        
        document.getElementById('current-rate-display').textContent = `1 USD = ${state.config.rate.toFixed(2)} LKR`;
        
        if (showNotification) {
            alert(`Unable to fetch live rates. Using last cached rate: 1 USD = ${state.config.rate.toFixed(2)} LKR`);
        }
    }
};

const refreshActivePane = () => {
    const activeItem = document.querySelector('.nav-item.active, .bottom-nav-item.active');
    if (!activeItem) return;
    const tabId = activeItem.getAttribute('data-tab');
    if (tabId === 'dashboard') renderDashboard();
    else if (tabId === 'expenses') renderExpensesList();
    else if (tabId === 'savings') renderSavingsGoals();
    else if (tabId === 'analytics') renderAnalyticsTab();
};

// --- CHARTS INSTANCE KEEPERS ---
let dashboardTrendChart = null;
let analyticsHistoryChart = null;
let analyticsCategoryChart = null;

// --- TAB ROUTING ---
const initTabRouting = () => {
    const navItems = document.querySelectorAll('.nav-item, .bottom-nav-item');
    const tabPanes = document.querySelectorAll('.tab-pane');

    const switchTab = (tabId) => {
        navItems.forEach(item => {
            if (item.getAttribute('data-tab') === tabId) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });

        tabPanes.forEach(pane => {
            if (pane.id === `tab-${tabId}`) {
                pane.classList.add('active');
            } else {
                pane.classList.remove('active');
            }
        });

        const headerTitle = document.getElementById('page-title');
        headerTitle.textContent = tabId.charAt(0).toUpperCase() + tabId.slice(1);

        if (tabId === 'dashboard') {
            renderDashboard();
        } else if (tabId === 'expenses') {
            renderExpensesList();
        } else if (tabId === 'savings') {
            renderSavingsGoals();
        } else if (tabId === 'analytics') {
            renderAnalyticsTab();
        } else if (tabId === 'settings') {
            renderSettingsTab();
        }
    };

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const tabId = item.getAttribute('data-tab');
            switchTab(tabId);
        });
    });

    switchTab('dashboard');
};

// --- UI DISPLAY DYNAMICS ---

// 1. DASHBOARD SCREEN
const renderDashboard = () => {
    const curr = state.config.currency;
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    // Calculate this month's spending
    const monthlyExpenses = state.expenses.filter(exp => {
        const expDate = new Date(exp.date);
        return expDate.getFullYear() === currentYear && expDate.getMonth() === currentMonth;
    });

    const totalSpentThisMonth = monthlyExpenses.reduce((sum, exp) => {
        return sum + convertToDisplayCurrency(exp.amount, exp.currency);
    }, 0);

    document.getElementById('dash-month-spend').textContent = formatCurrency(totalSpentThisMonth, curr);

    // Calculate spend trends
    const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const prevMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;
    
    const prevMonthlyExpenses = state.expenses.filter(exp => {
        const expDate = new Date(exp.date);
        return expDate.getFullYear() === prevMonthYear && expDate.getMonth() === prevMonth;
    });

    const totalSpentPrevMonth = prevMonthlyExpenses.reduce((sum, exp) => {
        return sum + convertToDisplayCurrency(exp.amount, exp.currency);
    }, 0);

    const spendTrendEl = document.getElementById('dash-spend-trend');
    if (totalSpentPrevMonth > 0) {
        const percentageDiff = ((totalSpentThisMonth - totalSpentPrevMonth) / totalSpentPrevMonth) * 100;
        if (percentageDiff > 0) {
            spendTrendEl.textContent = `+${percentageDiff.toFixed(1)}% vs last month`;
            spendTrendEl.className = 'trend-down';
        } else {
            spendTrendEl.textContent = `${percentageDiff.toFixed(1)}% vs last month`;
            spendTrendEl.className = 'trend-up';
        }
    } else {
        spendTrendEl.textContent = 'No records for last month';
        spendTrendEl.className = 'trend-neutral';
    }

    // Calculate Savings total pool
    const totalSavingsSaved = state.savings.reduce((sum, goal) => {
        return sum + convertToDisplayCurrency(goal.saved, goal.currency);
    }, 0);

    document.getElementById('dash-total-savings').textContent = formatCurrency(totalSavingsSaved, curr);
    document.getElementById('dash-savings-status').textContent = `${state.savings.length} active savings goals`;

    // Calculate Top expense category this month
    const categoryTotals = {};
    monthlyExpenses.forEach(exp => {
        const val = convertToDisplayCurrency(exp.amount, exp.currency);
        categoryTotals[exp.category] = (categoryTotals[exp.category] || 0) + val;
    });

    let topCategory = 'None';
    let topCategoryVal = 0;
    for (const cat in categoryTotals) {
        if (categoryTotals[cat] > topCategoryVal) {
            topCategoryVal = categoryTotals[cat];
            topCategory = cat;
        }
    }

    const topCategoryEl = document.getElementById('dash-top-category');
    const topCategoryAmtEl = document.getElementById('dash-top-category-amount');

    if (topCategory !== 'None') {
        topCategoryEl.textContent = topCategory;
        const totalMonthVal = monthlyExpenses.reduce((sum, exp) => sum + convertToDisplayCurrency(exp.amount, exp.currency), 0);
        const percent = totalMonthVal > 0 ? ((topCategoryVal / totalMonthVal) * 100).toFixed(0) : 0;
        topCategoryAmtEl.textContent = `${percent}% of total spend (${formatCurrency(topCategoryVal, curr)})`;
    } else {
        topCategoryEl.textContent = 'None';
        topCategoryAmtEl.textContent = '0% of total spend';
    }

    // --- MONTHLY BUDGET TRACKER STAT CARD ---
    const budgetInDisplay = convertToDisplayCurrency(state.config.budget, 'USD');
    document.getElementById('dash-budget-value').textContent = formatCurrency(budgetInDisplay, curr);
    
    const budgetProgressPct = budgetInDisplay > 0 ? (totalSpentThisMonth / budgetInDisplay) * 100 : 0;
    const budgetFillEl = document.getElementById('dash-budget-progress-fill');
    const budgetDescEl = document.getElementById('dash-budget-desc');
    const budgetIconWrapper = document.getElementById('budget-icon-wrapper');
    const budgetCard = document.getElementById('budget-stat-card');

    if (budgetFillEl) {
        budgetFillEl.style.width = Math.min(100, budgetProgressPct) + '%';
    }

    if (budgetDescEl) {
        budgetDescEl.textContent = `Spent ${budgetProgressPct.toFixed(0)}% of limit`;
        
        // Reset color indicators
        budgetDescEl.className = '';
        if (budgetProgressPct >= 100) {
            budgetDescEl.textContent += ' • Limit Exceeded!';
            budgetDescEl.classList.add('trend-down');
            if (budgetFillEl) budgetFillEl.style.background = 'var(--accent-pink)';
            if (budgetIconWrapper) budgetIconWrapper.style.backgroundColor = 'var(--accent-pink)';
        } else if (budgetProgressPct >= 80) {
            budgetDescEl.textContent += ' • Warning limit';
            budgetDescEl.classList.add('trend-neutral');
            if (budgetFillEl) budgetFillEl.style.background = 'var(--accent-orange)';
            if (budgetIconWrapper) budgetIconWrapper.style.backgroundColor = 'var(--accent-orange)';
        } else {
            budgetDescEl.textContent += ' • Safe Range';
            budgetDescEl.classList.add('trend-up');
            if (budgetFillEl) budgetFillEl.style.background = 'var(--accent-purple)';
            if (budgetIconWrapper) budgetIconWrapper.style.backgroundColor = '#6366f1';
        }
    }

    // Populate Recent Transactions
    const recentTbody = document.getElementById('recent-transactions-tbody');
    recentTbody.innerHTML = '';

    const sortedExpenses = [...state.expenses].sort((a, b) => new Date(b.date) - new Date(a.date));
    const last5 = sortedExpenses.slice(0, 5);

    if (last5.length === 0) {
        recentTbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="4" class="text-center">No transactions logged yet. Click "Add Expense" below!</td>
            </tr>
        `;
    } else {
        last5.forEach(exp => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <div style="font-weight: 600; color: var(--text-primary);">${escapeHtml(exp.desc)}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted);">${exp.note ? escapeHtml(exp.note) : ''}</div>
                </td>
                <td><span class="category-tag tag-${exp.category}">${exp.category}</span></td>
                <td style="color: var(--text-secondary); font-size: 0.85rem;">${formatDisplayDate(exp.date)}</td>
                <td class="text-right">
                    <div class="amount-usd">${formatToDisplayCurrency(exp.amount, exp.currency)}</div>
                    <div class="amount-lkr" style="font-size:0.75rem;">${exp.amount.toFixed(2)} ${exp.currency}</div>
                </td>
            `;
            recentTbody.appendChild(tr);
        });
    }

    renderMiniTrendChart(30);
};

// 2. EXPENSES LEDGER SCREEN
const renderExpensesList = () => {
    const tbody = document.getElementById('ledger-tbody');
    tbody.innerHTML = '';

    const searchQuery = document.getElementById('expense-search').value.toLowerCase();
    const filterCategory = document.getElementById('expense-filter-category').value;

    let filtered = [...state.expenses];

    if (searchQuery) {
        filtered = filtered.filter(exp => 
            exp.desc.toLowerCase().includes(searchQuery) || 
            (exp.note && exp.note.toLowerCase().includes(searchQuery))
        );
    }
    if (filterCategory !== 'all') {
        filtered = filtered.filter(exp => exp.category === filterCategory);
    }

    filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="6" class="text-center">No matching expenses found.</td>
            </tr>
        `;
        return;
    }

    filtered.forEach(exp => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="white-space: nowrap; font-size: 0.85rem; color: var(--text-secondary);">${formatDisplayDate(exp.date)}</td>
            <td>
                <div style="font-weight:600;">${escapeHtml(exp.desc)}</div>
                <div style="font-size:0.75rem; color: var(--text-muted);">${exp.note ? escapeHtml(exp.note) : ''}</div>
            </td>
            <td><span class="category-tag tag-${exp.category}">${exp.category}</span></td>
            <td style="font-size:0.85rem; color:var(--text-secondary);">${exp.amount.toFixed(2)} <span style="font-weight:600; color:var(--text-primary);">${exp.currency}</span></td>
            <td class="text-right amount-usd">${formatToDisplayCurrency(exp.amount, exp.currency)}</td>
            <td class="text-center">
                <div class="row-actions">
                    <button class="icon-btn edit" onclick="openEditExpenseModal('${exp.id}')" title="Edit">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="icon-btn delete" onclick="deleteExpense('${exp.id}')" title="Delete">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            <line x1="10" y1="11" x2="10" y2="17"/>
                            <line x1="14" y1="11" x2="14" y2="17"/>
                        </svg>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
};

// 3. SAVINGS GOALS SCREEN
const renderSavingsGoals = () => {
    const grid = document.getElementById('savings-grid');
    grid.innerHTML = '';

    if (state.savings.length === 0) {
        grid.innerHTML = `
            <div class="glass-card text-center" style="grid-column: 1 / -1; padding: 3rem;">
                <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="var(--text-secondary)" stroke-width="1.5" style="margin-bottom:1rem; opacity:0.6;">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                    <polyline points="17 21 17 13 7 13 7 21"/>
                    <polyline points="7 3 7 8 15 8"/>
                </svg>
                <h3 style="font-family:var(--font-heading); margin-bottom:0.5rem;">No savings goals established</h3>
                <p style="color:var(--text-secondary); font-size:0.85rem; margin-bottom:1.5rem;">Plan for the future by creating custom savings targets.</p>
                <button class="btn-primary" onclick="openAddSavingsGoalModal()">Establish First Goal</button>
            </div>
        `;
        return;
    }

    state.savings.forEach(goal => {
        const percent = Math.min(100, Math.max(0, (goal.saved / goal.target) * 100));
        
        const card = document.createElement('div');
        card.className = 'glass-card savings-card';
        card.innerHTML = `
            <div class="savings-card-header">
                <div>
                    <h4 class="savings-goal-title">${escapeHtml(goal.name)}</h4>
                    <span class="savings-goal-meta">Target currency: ${goal.target.toFixed(2)} ${goal.currency}</span>
                </div>
                <div class="row-actions">
                    <button class="icon-btn edit" onclick="openEditSavingsGoalModal('${goal.id}')" title="Edit Goal">
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="icon-btn delete" onclick="deleteSavingsGoal('${goal.id}')" title="Delete Goal">
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            </div>
            
            <div class="savings-card-body">
                <div class="progress-info">
                    <span class="saved-label">Current Saved</span>
                    <span class="saved-amount">${formatToDisplayCurrency(goal.saved, goal.currency)}</span>
                </div>
                <div class="progress-bar-bg">
                    <div class="progress-bar-fill" style="width: ${percent}%;"></div>
                </div>
                <div class="target-details">
                    <span>${percent.toFixed(1)}% Complete</span>
                    <span>Target: ${formatToDisplayCurrency(goal.target, goal.currency)}</span>
                </div>
            </div>
            
            <div class="savings-card-footer">
                <button class="btn-glass" style="flex:1;" onclick="openDepositModal('${goal.id}')">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px; vertical-align: middle;">
                        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    Log Deposit
                </button>
            </div>
        `;
        grid.appendChild(card);
    });
};

// 4. ANALYTICS TABS SCREEN
const renderAnalyticsTab = () => {
    const activeRangeBtn = document.querySelector('.range-btn.active');
    const range = activeRangeBtn ? activeRangeBtn.getAttribute('data-analytics-range') : '30';

    const filteredExpenses = filterExpensesByRange(range);
    const curr = state.config.currency;

    document.getElementById('metric-total-items').textContent = filteredExpenses.length;

    let maxSpendVal = 0;
    let maxSpendTitle = 'N/A';
    filteredExpenses.forEach(exp => {
        const val = convertToDisplayCurrency(exp.amount, exp.currency);
        if (val > maxSpendVal) {
            maxSpendVal = val;
            maxSpendTitle = exp.desc;
        }
    });
    document.getElementById('metric-max-spend').textContent = formatCurrency(maxSpendVal, curr);
    document.getElementById('metric-max-spend-title').textContent = maxSpendTitle;

    let daysDiff = 30;
    if (range === '360') daysDiff = 360;
    else if (range === 'lifetime') {
        if (state.expenses.length > 1) {
            const sorted = [...state.expenses].sort((a, b) => new Date(a.date) - new Date(b.date));
            const firstDate = new Date(sorted[0].date);
            const lastDate = new Date(sorted[sorted.length - 1].date);
            const diffTime = Math.abs(lastDate - firstDate);
            daysDiff = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
        } else {
            daysDiff = 1;
        }
    }

    const totalValInRange = filteredExpenses.reduce((sum, exp) => sum + convertToDisplayCurrency(exp.amount, exp.currency), 0);
    const avgDailyVal = totalValInRange / daysDiff;
    document.getElementById('metric-avg-daily').textContent = formatCurrency(avgDailyVal, curr);

    drawAnalyticsTrendChart(range, filteredExpenses);
    drawAnalyticsCategoryChart(filteredExpenses);
};

// 5. SETTINGS SCREEN
const renderSettingsTab = () => {
    document.getElementById('setting-rate').value = state.config.rate.toFixed(2);
    
    // Display budget limit converted to active currency in settings
    const budgetInDisplay = convertToDisplayCurrency(state.config.budget, 'USD');
    document.getElementById('setting-budget').value = Math.round(budgetInDisplay);
    document.getElementById('setting-budget-currency-suffix').textContent = state.config.currency;
};

// --- DATA FILTERING BY TIME RANGE ---
const filterExpensesByRange = (range) => {
    const today = new Date();
    let filterDate = new Date();
    
    if (range === '30') {
        filterDate.setDate(today.getDate() - 30);
    } else if (range === '360') {
        filterDate.setDate(today.getDate() - 360);
    } else {
        return [...state.expenses];
    }
    
    return state.expenses.filter(exp => new Date(exp.date) >= filterDate);
};

// --- CHART GRAPHICS IMPLEMENTATION ---
const renderMiniTrendChart = (range) => {
    const ctx = document.getElementById('dashboard-trend-chart').getContext('2d');
    const filtered = filterExpensesByRange(range);
    
    filtered.sort((a, b) => new Date(a.date) - new Date(b.date));

    const grouped = {};
    filtered.forEach(exp => {
        const val = convertToDisplayCurrency(exp.amount, exp.currency);
        grouped[exp.date] = (grouped[exp.date] || 0) + val;
    });

    if (filtered.length === 0) {
        const todayStr = new Date().toISOString().split('T')[0];
        grouped[todayStr] = 0;
    }

    const labels = Object.keys(grouped).map(d => formatShortDate(d));
    const data = Object.values(grouped);

    if (dashboardTrendChart) {
        dashboardTrendChart.destroy();
    }

    const themeColors = getChartThemeColors();
    const gradient = ctx.createLinearGradient(0, 0, 0, 240);
    gradient.addColorStop(0, 'rgba(155, 81, 224, 0.35)');
    gradient.addColorStop(1, 'rgba(155, 81, 224, 0.01)');

    dashboardTrendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: `Daily Spend (${state.config.currency})`,
                data: data,
                borderColor: '#9b51e0',
                borderWidth: 2.5,
                backgroundColor: gradient,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#9b51e0',
                pointHoverRadius: 6,
                pointRadius: 1.5,
                pointHitRadius: 10
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: themeColors.tooltipBg,
                    titleColor: themeColors.text,
                    bodyColor: themeColors.tooltipText,
                    borderColor: themeColors.tooltipBorder,
                    borderWidth: 1,
                    displayColors: false,
                    callbacks: {
                        label: function(context) {
                            return formatCurrency(context.parsed.y, state.config.currency);
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false, drawBorder: false },
                    ticks: { color: themeColors.text, font: { size: 10, family: 'Outfit' } }
                },
                y: {
                    grid: { color: themeColors.grid, drawBorder: false },
                    ticks: {
                        color: themeColors.text,
                        font: { size: 10, family: 'Outfit' },
                        callback: function(value) {
                            return formatCurrency(value, state.config.currency).split('.')[0];
                        }
                    }
                }
            }
        }
    });
};

const drawAnalyticsTrendChart = (range, filteredExpenses) => {
    const ctx = document.getElementById('analytics-history-chart').getContext('2d');
    const sorted = [...filteredExpenses].sort((a, b) => new Date(a.date) - new Date(b.date));

    let labels = [];
    let data = [];

    if (range === '30') {
        const grouped = {};
        sorted.forEach(exp => {
            const val = convertToDisplayCurrency(exp.amount, exp.currency);
            grouped[exp.date] = (grouped[exp.date] || 0) + val;
        });
        labels = Object.keys(grouped).map(d => formatShortDate(d));
        data = Object.values(grouped);
    } else {
        const monthlyGrouped = {};
        sorted.forEach(exp => {
            const val = convertToDisplayCurrency(exp.amount, exp.currency);
            const dateObj = new Date(exp.date);
            const monthStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
            monthlyGrouped[monthStr] = (monthlyGrouped[monthStr] || 0) + val;
        });

        labels = Object.keys(monthlyGrouped).map(mStr => {
            const [y, m] = mStr.split('-');
            const date = new Date(y, m - 1, 1);
            return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        });
        data = Object.values(monthlyGrouped);
    }

    if (labels.length === 0) {
        labels = ['No Data'];
        data = [0];
    }

    if (analyticsHistoryChart) {
        analyticsHistoryChart.destroy();
    }

    const themeColors = getChartThemeColors();
    const gradient = ctx.createLinearGradient(0, 0, 0, 320);
    gradient.addColorStop(0, 'rgba(255, 42, 95, 0.35)');
    gradient.addColorStop(1, 'rgba(255, 42, 95, 0.01)');

    analyticsHistoryChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: `Amount Spent (${state.config.currency})`,
                data: data,
                borderColor: '#ff2a5f',
                borderWidth: 2.5,
                backgroundColor: gradient,
                fill: true,
                tension: 0.35,
                pointBackgroundColor: '#ff2a5f',
                pointHoverRadius: 6,
                pointRadius: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: themeColors.tooltipBg,
                    titleColor: themeColors.text,
                    bodyColor: themeColors.tooltipText,
                    borderColor: themeColors.tooltipBorder,
                    borderWidth: 1,
                    displayColors: false,
                    callbacks: {
                        label: function(context) {
                            return formatCurrency(context.parsed.y, state.config.currency);
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false, drawBorder: false },
                    ticks: { color: themeColors.text, font: { size: 10, family: 'Outfit' } }
                },
                y: {
                    grid: { color: themeColors.grid, drawBorder: false },
                    ticks: {
                        color: themeColors.text,
                        font: { size: 10, family: 'Outfit' },
                        callback: function(value) {
                            return formatCurrency(value, state.config.currency).split('.')[0];
                        }
                    }
                }
            }
        }
    });
};

const drawAnalyticsCategoryChart = (filteredExpenses) => {
    const ctx = document.getElementById('analytics-category-chart').getContext('2d');
    
    const categoryTotals = {};
    filteredExpenses.forEach(exp => {
        const val = convertToDisplayCurrency(exp.amount, exp.currency);
        categoryTotals[exp.category] = (categoryTotals[exp.category] || 0) + val;
    });

    const categories = Object.keys(categoryTotals);
    const totals = Object.values(categoryTotals);

    if (analyticsCategoryChart) {
        analyticsCategoryChart.destroy();
    }

    if (categories.length === 0) {
        analyticsCategoryChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['No Data'],
                datasets: [{
                    data: [1],
                    backgroundColor: ['rgba(255, 255, 255, 0.05)'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                }
            }
        });
        return;
    }

    const isLight = state.config.theme === 'light';
    const colorsMap = {
        'Food': '#ff2a5f',
        'Utilities': '#9b51e0',
        'Rent': '#ff7300',
        'Entertainment': '#00e676',
        'Travel': '#00b8d4',
        'Health': '#ffd600',
        'Shopping': '#e91e63',
        'Other': '#8e8e9f'
    };

    const backgroundColors = categories.map(cat => colorsMap[cat] || '#8e8e9f');
    const themeColors = getChartThemeColors();

    analyticsCategoryChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: categories,
            datasets: [{
                data: totals,
                backgroundColor: backgroundColors,
                borderWidth: 2,
                borderColor: isLight ? '#ffffff' : '#0b0b11',
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'right',
                    labels: {
                        color: themeColors.text,
                        font: { size: 10, family: 'Outfit' },
                        boxWidth: 8,
                        padding: 10
                    }
                },
                tooltip: {
                    backgroundColor: themeColors.tooltipBg,
                    titleColor: themeColors.text,
                    bodyColor: themeColors.tooltipText,
                    borderColor: themeColors.tooltipBorder,
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            const val = context.parsed;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percent = ((val / total) * 100).toFixed(0);
                            return ` ${context.label}: ${formatCurrency(val, state.config.currency)} (${percent}%)`;
                        }
                    }
                }
            },
            cutout: '72%'
        }
    });
};

// --- DATA LOGGING & OPERATIONS ---
const generateUniqueId = () => {
    return '_' + Math.random().toString(36).substr(2, 9);
};

const escapeHtml = (text) => {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, function(m) { return map[m]; });
};

const formatDisplayDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatShortDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const deleteExpense = (id) => {
    if (confirm('Are you sure you want to delete this expense record?')) {
        state.expenses = state.expenses.filter(exp => exp.id !== id);
        saveState();
        renderExpensesList();
    }
};

const deleteSavingsGoal = (id) => {
    if (confirm('Are you sure you want to delete this savings goal? All contribution logs will be deleted.')) {
        state.savings = state.savings.filter(goal => goal.id !== id);
        saveState();
        renderSavingsGoals();
    }
};

const toggleModal = (modalId, isOpen) => {
    const modal = document.getElementById(modalId);
    if (isOpen) {
        modal.classList.add('active');
        if (modalId === 'modal-expense') {
            document.getElementById('expense-date').value = new Date().toISOString().split('T')[0];
        }
    } else {
        modal.classList.remove('active');
    }
};

window.openEditExpenseModal = (id) => {
    const exp = state.expenses.find(e => e.id === id);
    if (!exp) return;

    document.getElementById('expense-modal-title').textContent = 'Edit Expense Record';
    document.getElementById('expense-id').value = exp.id;
    document.getElementById('expense-desc').value = exp.desc;
    document.getElementById('expense-amount').value = exp.amount;
    document.getElementById('expense-currency').value = exp.currency;
    document.getElementById('expense-category').value = exp.category;
    document.getElementById('expense-date').value = exp.date;
    document.getElementById('expense-note').value = exp.note || '';

    toggleModal('modal-expense', true);
};

window.openEditSavingsGoalModal = (id) => {
    const goal = state.savings.find(g => g.id === id);
    if (!goal) return;

    document.getElementById('savings-goal-modal-title').textContent = 'Edit Savings Goal';
    document.getElementById('savings-goal-id').value = goal.id;
    document.getElementById('savings-goal-name').value = goal.name;
    document.getElementById('savings-goal-target').value = goal.target;
    document.getElementById('savings-goal-currency').value = goal.currency;
    document.getElementById('savings-goal-initial').value = goal.saved;
    document.getElementById('savings-goal-initial').previousElementSibling.textContent = 'Current Saved Amount';

    toggleModal('modal-savings-goal', true);
};

window.openDepositModal = (goalId) => {
    const select = document.getElementById('funds-select-goal');
    select.innerHTML = '';
    
    state.savings.forEach(goal => {
        const option = document.createElement('option');
        option.value = goal.id;
        option.textContent = goal.name;
        if (goal.id === goalId) option.selected = true;
        select.appendChild(option);
    });

    toggleModal('modal-savings-funds', true);
};

// --- ACTION EVENT HANDLERS ---
const initActionListeners = () => {
    // Top Theme toggler
    document.getElementById('theme-toggle-btn').addEventListener('click', () => {
        toggleTheme();
    });

    document.getElementById('go-to-expenses-btn').addEventListener('click', () => {
        const expensesTabBtn = document.querySelector('[data-tab="expenses"]');
        if (expensesTabBtn) expensesTabBtn.click();
    });

    document.getElementById('btn-quick-add-expense').addEventListener('click', () => {
        document.getElementById('expense-modal-title').textContent = 'Log Expense';
        document.getElementById('expense-form').reset();
        document.getElementById('expense-id').value = '';
        toggleModal('modal-expense', true);
    });
    
    document.getElementById('btn-add-expense-main').addEventListener('click', () => {
        document.getElementById('expense-modal-title').textContent = 'Log Expense';
        document.getElementById('expense-form').reset();
        document.getElementById('expense-id').value = '';
        toggleModal('modal-expense', true);
    });

    document.getElementById('btn-close-expense-modal').addEventListener('click', () => toggleModal('modal-expense', false));
    document.getElementById('btn-cancel-expense-modal').addEventListener('click', () => toggleModal('modal-expense', false));

    document.getElementById('btn-quick-add-savings').addEventListener('click', () => {
        document.getElementById('savings-goal-modal-title').textContent = 'Create Savings Goal';
        document.getElementById('savings-goal-form').reset();
        document.getElementById('savings-goal-id').value = '';
        document.getElementById('savings-goal-initial').previousElementSibling.textContent = 'Initial Savings Balance';
        toggleModal('modal-savings-goal', true);
    });

    document.getElementById('btn-add-savings-main').addEventListener('click', () => {
        document.getElementById('savings-goal-modal-title').textContent = 'Create Savings Goal';
        document.getElementById('savings-goal-form').reset();
        document.getElementById('savings-goal-id').value = '';
        document.getElementById('savings-goal-initial').previousElementSibling.textContent = 'Initial Savings Balance';
        toggleModal('modal-savings-goal', true);
    });

    document.getElementById('btn-close-savings-goal-modal').addEventListener('click', () => toggleModal('modal-savings-goal', false));
    document.getElementById('btn-cancel-savings-goal-modal').addEventListener('click', () => toggleModal('modal-savings-goal', false));

    document.getElementById('btn-quick-log-funds').addEventListener('click', () => {
        if (state.savings.length === 0) {
            alert('Please create a savings goal first.');
            return;
        }
        openDepositModal(state.savings[0].id);
    });

    document.getElementById('btn-close-funds-modal').addEventListener('click', () => toggleModal('modal-savings-funds', false));
    document.getElementById('btn-cancel-funds-modal').addEventListener('click', () => toggleModal('modal-savings-funds', false));

    document.getElementById('expense-form').addEventListener('submit', (e) => {
        e.preventDefault();
        
        const id = document.getElementById('expense-id').value;
        const desc = document.getElementById('expense-desc').value;
        const amount = parseFloat(document.getElementById('expense-amount').value);
        const currency = document.getElementById('expense-currency').value;
        const category = document.getElementById('expense-category').value;
        const date = document.getElementById('expense-date').value;
        const note = document.getElementById('expense-note').value;

        if (id) {
            const index = state.expenses.findIndex(exp => exp.id === id);
            if (index !== -1) {
                state.expenses[index] = { id, desc, amount, currency, category, date, note };
            }
        } else {
            const newId = generateUniqueId();
            state.expenses.push({ id: newId, desc, amount, currency, category, date, note });
        }

        saveState();
        toggleModal('modal-expense', false);
        
        const activeTab = document.querySelector('.nav-item.active, .bottom-nav-item.active').getAttribute('data-tab');
        if (activeTab === 'dashboard') renderDashboard();
        else if (activeTab === 'expenses') renderExpensesList();
    });

    document.getElementById('savings-goal-form').addEventListener('submit', (e) => {
        e.preventDefault();

        const id = document.getElementById('savings-goal-id').value;
        const name = document.getElementById('savings-goal-name').value;
        const target = parseFloat(document.getElementById('savings-goal-target').value);
        const currency = document.getElementById('savings-goal-currency').value;
        const saved = parseFloat(document.getElementById('savings-goal-initial').value) || 0;

        if (id) {
            const index = state.savings.findIndex(g => g.id === id);
            if (index !== -1) {
                state.savings[index] = { id, name, target, currency, saved };
            }
        } else {
            const newId = generateUniqueId();
            state.savings.push({ id: newId, name, target, currency, saved });
        }

        saveState();
        toggleModal('modal-savings-goal', false);

        const activeTab = document.querySelector('.nav-item.active, .bottom-nav-item.active').getAttribute('data-tab');
        if (activeTab === 'dashboard') renderDashboard();
        else if (activeTab === 'savings') renderSavingsGoals();
    });

    document.getElementById('savings-funds-form').addEventListener('submit', (e) => {
        e.preventDefault();

        const goalId = document.getElementById('funds-select-goal').value;
        const amount = parseFloat(document.getElementById('funds-amount').value);
        const currency = document.getElementById('funds-currency').value;

        const goalIndex = state.savings.findIndex(g => g.id === goalId);
        if (goalIndex !== -1) {
            const goal = state.savings[goalIndex];
            const convertedContribution = convertAmount(amount, currency, goal.currency);
            state.savings[goalIndex].saved += convertedContribution;
            
            saveState();
            toggleModal('modal-savings-funds', false);
            document.getElementById('savings-funds-form').reset();

            const activeTab = document.querySelector('.nav-item.active, .bottom-nav-item.active').getAttribute('data-tab');
            if (activeTab === 'dashboard') renderDashboard();
            else if (activeTab === 'savings') renderSavingsGoals();
        }
    });

    const currencyUSD = document.getElementById('currency-usd');
    const currencyLKR = document.getElementById('currency-lkr');

    const updateDisplayCurrency = (curr) => {
        state.config.currency = curr;
        saveState();

        if (curr === 'USD') {
            currencyUSD.classList.add('active');
            currencyLKR.classList.remove('active');
        } else {
            currencyUSD.classList.remove('active');
            currencyLKR.classList.add('active');
        }

        const activeTab = document.querySelector('.nav-item.active, .bottom-nav-item.active').getAttribute('data-tab');
        if (activeTab === 'dashboard') renderDashboard();
        else if (activeTab === 'expenses') renderExpensesList();
        else if (activeTab === 'savings') renderSavingsGoals();
        else if (activeTab === 'analytics') renderAnalyticsTab();
        else if (activeTab === 'settings') renderSettingsTab();
    };

    currencyUSD.addEventListener('click', () => updateDisplayCurrency('USD'));
    currencyLKR.addEventListener('click', () => updateDisplayCurrency('LKR'));

    // Save Benchmark Rate
    document.getElementById('btn-save-rate').addEventListener('click', () => {
        const rateInput = document.getElementById('setting-rate');
        const value = parseFloat(rateInput.value);
        if (value > 0) {
            state.config.rate = value;
            saveState();
            document.getElementById('current-rate-display').textContent = `1 USD = ${value.toFixed(2)} LKR`;
            alert(`Exchange rate set to 1 USD = ${value.toFixed(2)} LKR successfully.`);
        } else {
            alert('Please input a valid conversion rate.');
        }
    });

    // Save Monthly Budget Limit
    document.getElementById('btn-save-budget').addEventListener('click', () => {
        const budgetInput = document.getElementById('setting-budget');
        const value = parseFloat(budgetInput.value);
        if (value > 0) {
            // Treat input value as current display currency; convert to base currency (USD) for storage
            const budgetInUsd = convertAmount(value, state.config.currency, 'USD');
            state.config.budget = budgetInUsd;
            saveState();
            
            alert(`Monthly spending limit set to ${formatCurrency(value, state.config.currency)} successfully.`);
            refreshActivePane();
        } else {
            alert('Please input a valid budget ceiling.');
        }
    });

    // Sync Live rate
    document.getElementById('btn-sync-rate').addEventListener('click', () => {
        fetchLiveExchangeRate(true);
    });

    // Backup Data Export
    document.getElementById('btn-export-data').addEventListener('click', () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `vela_backup_${new Date().toISOString().split('T')[0]}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
    });

    const importTrigger = document.getElementById('btn-import-trigger');
    const fileImportInput = document.getElementById('file-import');
    importTrigger.addEventListener('click', () => fileImportInput.click());

    fileImportInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedState = JSON.parse(event.target.result);
                if (importedState.expenses && importedState.savings && importedState.config) {
                    state = importedState;
                    saveState();
                    alert('Vela data import successful!');
                    window.location.reload();
                } else {
                    alert('Invalid file format. Make sure you use a file generated by Vela.');
                }
            } catch (err) {
                alert('Failed to parse JSON file.');
            }
        };
        reader.readAsText(file);
    });

    document.getElementById('btn-wipe-data').addEventListener('click', () => {
        if (confirm('CAUTION: This will permanently delete your entire local Vela database. This action cannot be undone. Proceed?')) {
            localStorage.removeItem('VELA_STATE');
            window.location.reload();
        }
    });

    document.getElementById('expense-search').addEventListener('input', renderExpensesList);
    document.getElementById('expense-filter-category').addEventListener('change', renderExpensesList);

    const rangeButtons = document.querySelectorAll('.range-btn');
    rangeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            rangeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderAnalyticsTab();
        });
    });

    const chartTimeButtons = document.querySelectorAll('.chart-time-btn');
    chartTimeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            chartTimeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const range = parseInt(btn.getAttribute('data-range'));
            renderMiniTrendChart(range);
        });
    });
};

// --- PROGRESSIVE WEB APP (PWA) INSTALL LOGIC ---
let deferredPrompt = null;
const initPwaInstallation = () => {
    const installCard = document.getElementById('install-card');
    const installBtn = document.getElementById('btn-install-pwa');

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        if (installCard) {
            installCard.classList.remove('hidden');
        }
    });

    if (installBtn) {
        installBtn.addEventListener('click', () => {
            if (deferredPrompt) {
                deferredPrompt.prompt();
                deferredPrompt.userChoice.then((choiceResult) => {
                    if (choiceResult.outcome === 'accepted') {
                        console.log('User accepted PWA install prompt');
                        if (installCard) installCard.classList.add('hidden');
                    }
                    deferredPrompt = null;
                });
            }
        });
    }

    window.addEventListener('appinstalled', () => {
        console.log('Vela app successfully installed.');
        if (installCard) installCard.classList.add('hidden');
    });
};

// --- INITIALIZE APPLICATION ON LOAD ---
document.addEventListener('DOMContentLoaded', () => {
    // 1. Load State
    loadState();
    
    // 2. Set theme configurations
    const activeTheme = state.config.theme || 'dark';
    document.documentElement.setAttribute('data-theme', activeTheme);
    
    // 3. Set display rate
    document.getElementById('current-rate-display').textContent = `1 USD = ${state.config.rate.toFixed(2)} LKR`;
    
    const curr = state.config.currency;
    if (curr === 'USD') {
        document.getElementById('currency-usd').classList.add('active');
        document.getElementById('currency-lkr').classList.remove('active');
    } else {
        document.getElementById('currency-usd').classList.remove('active');
        document.getElementById('currency-lkr').classList.add('active');
    }

    // 4. Init handlers
    initTabRouting();
    initActionListeners();
    initPwaInstallation();
    
    // 5. Query live currency feed
    fetchLiveExchangeRate(false);
});
