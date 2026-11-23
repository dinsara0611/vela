package io.github.dinsara0611.vela;

/** Home-screen widget: Budget this month: what's left to spend. Same look and eye button as the balances widget. */
public class BudgetWidget extends BalanceWidget {
    @Override protected String kind() { return "budget"; }
    @Override protected String opens() { return "budget"; }
    @Override protected String emptyTitle() { return "Budget"; }
    @Override protected int smallLayout() { return R.layout.widget_small_budget; }
    @Override protected int icon() { return R.drawable.ic_w_budget; }
    @Override protected int badge() { return R.drawable.widget_badge_budget; }
}
