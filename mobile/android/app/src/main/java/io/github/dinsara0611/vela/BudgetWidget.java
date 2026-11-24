package io.github.dinsara0611.vela;

import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

/** Home-screen widget: this month's budget as a ring (how much is used), what is left, and on the big one the details. */
public class BudgetWidget extends BalanceWidget {
    @Override protected String kind() { return "budget"; }
    @Override protected String opens() { return "budget"; }
    @Override protected String emptyTitle() { return "Budget"; }
    @Override protected int smallLayout() { return R.layout.widget_budget_small; }
    @Override protected int bigLayout() { return R.layout.widget_budget_big; }

    @Override
    protected void fill(Context c, RemoteViews v, JSONObject d, boolean hidden, boolean small, boolean none) throws Exception {
        int pct = d.optInt("pct", -1);
        boolean noBudget = pct < 0;
        boolean over = d.optBoolean("minus", false);
        v.setTextViewText(R.id.w_title, d.optString("title", "Budget"));
        v.setImageViewBitmap(R.id.w_ring, ring(noBudget ? 0 : pct, GREEN));
        v.setTextViewText(R.id.w_pct, noBudget ? "—" : pct + "%");
        v.setTextViewText(R.id.w_pct_label, noBudget ? "no budget" : over ? "over" : "used");
        String big = hidden || none ? MASK : d.optString("big", MASK);
        v.setTextViewText(R.id.w_total, big);
        v.setTextColor(R.id.w_total, !hidden && over ? RED : WHITE);
        String what = none ? "Open Vela to load" : noBudget ? "spent this month" : over ? "over the budget" : "left to spend";
        if (small) {
            fit(v, R.id.w_total, big, 14f);
            v.setTextViewText(R.id.w_sub, what);
            return;
        }
        v.setTextViewText(R.id.w_label, noBudget ? "Spent this month" : over ? "Over the budget" : "Left to spend");
        v.setTextColor(R.id.w_label, over ? RED : GREEN);
        v.setTextViewText(R.id.w_s1, mask(hidden || none, d.optString("spent", "")));
        v.setTextViewText(R.id.w_s2, noBudget ? "—" : mask(hidden || none, d.optString("perDay", "")));
        v.setTextViewText(R.id.w_s3, noBudget ? "Not set" : mask(hidden || none, d.optString("limit", "")));
        v.setTextViewText(R.id.w_s4, d.optString("daysLeft", "—"));
    }

    @Override protected int shortLayout() { return R.layout.widget_budget_short; }

    @Override
    protected void fillShort(Context c, RemoteViews v, JSONObject d, boolean hidden, boolean none) throws Exception {
        int pct = d.optInt("pct", -1);
        boolean over = d.optBoolean("minus", false);
        v.setImageViewBitmap(R.id.w_ring, ring(pct < 0 ? 0 : pct, GREEN));
        v.setTextViewText(R.id.w_pct, pct < 0 ? "—" : pct + "%");
        v.setTextViewText(R.id.w_title, d.optString("title", "Budget"));
        v.setTextViewText(R.id.w_total, hidden || none ? MASK : d.optString("big", MASK));
        v.setTextColor(R.id.w_total, !hidden && over ? RED : WHITE);
        v.setTextViewText(R.id.w_sub, none ? "Open Vela to load" : pct < 0 ? "spent this month" : over ? "over the budget" : "left to spend");
    }
}
