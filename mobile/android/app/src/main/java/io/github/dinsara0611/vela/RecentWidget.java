package io.github.dinsara0611.vela;

/** Home-screen widget: Your latest entries and today's spending. Same look and eye button as the balances widget. */
public class RecentWidget extends BalanceWidget {
    @Override protected String kind() { return "recent"; }
    @Override protected String opens() { return "activity"; }
    @Override protected String emptyTitle() { return "Recent"; }
    @Override protected int smallLayout() { return R.layout.widget_small_recent; }
    @Override protected int icon() { return R.drawable.ic_w_recent; }
    @Override protected int badge() { return R.drawable.widget_badge_recent; }
}
