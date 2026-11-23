package io.github.dinsara0611.vela;

/** Home-screen widget: Bills and payments still to pay. Same look and eye button as the balances widget. */
public class BillsWidget extends BalanceWidget {
    @Override protected String kind() { return "bills"; }
    @Override protected String opens() { return "bills"; }
    @Override protected String emptyTitle() { return "Bills coming"; }
    @Override protected int smallLayout() { return R.layout.widget_small_bills; }
    @Override protected int icon() { return R.drawable.ic_w_bills; }
    @Override protected int badge() { return R.drawable.widget_badge_bills; }
}
