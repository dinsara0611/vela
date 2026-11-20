package io.github.dinsara0611.vela;

/** Home-screen widget: Your goals and how much is saved. Same look and eye button as the balances widget. */
public class GoalsWidget extends BalanceWidget {
    @Override protected String kind() { return "goals"; }
    @Override protected String opens() { return "goals"; }
    @Override protected String emptyTitle() { return "Goals"; }
}
