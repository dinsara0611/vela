package io.github.dinsara0611.vela;

import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

/** Home-screen widget: spent today, a 7-day spending chart and (big) the newest entries. */
public class RecentWidget extends BalanceWidget {
    @Override protected String kind() { return "recent"; }
    @Override protected String opens() { return "activity"; }
    @Override protected String emptyTitle() { return "Today"; }
    @Override protected int smallLayout() { return R.layout.widget_recent_small; }
    @Override protected int bigLayout() { return R.layout.widget_recent_big; }

    private static final int BLUE = 0xFF4CC9F0;

    @Override
    protected void fill(Context c, RemoteViews v, JSONObject d, boolean hidden, boolean small, boolean none) throws Exception {
        v.setTextViewText(R.id.w_title, "Spent today");
        String big = hidden || none ? MASK : d.optString("big", MASK);
        v.setTextViewText(R.id.w_total, big);
        if (small) fit(v, R.id.w_total, big, 18f);
        v.setTextViewText(R.id.w_sub, none ? "Open Vela to load" : d.optString("count", ""));
        if (!none) v.setImageViewBitmap(R.id.w_chart, bars(d.optJSONArray("week"), BLUE, !small));
        if (small) return;
        JSONArray items = d.optJSONArray("items");
        int n = items == null ? 0 : items.length();
        int[] rows = { R.id.w_row1, R.id.w_row2, R.id.w_row3 };
        int[] icons = { R.id.w_ricon1, R.id.w_ricon2, R.id.w_ricon3 };
        int[] whens = { R.id.w_when1, R.id.w_when2, R.id.w_when3 };
        for (int i = 0; i < rows.length; i++) {
            JSONObject t = i < n ? items.getJSONObject(i) : null;
            v.setViewVisibility(rows[i], t == null ? View.GONE : View.VISIBLE);
            if (t == null) continue;
            String k = t.optString("kind", "out");
            v.setImageViewResource(icons[i], "in".equals(k) ? R.drawable.ic_w_income : "move".equals(k) ? R.drawable.ic_w_transfer : R.drawable.ic_w_expense);
            v.setInt(icons[i], "setBackgroundResource", "in".equals(k) ? R.drawable.widget_dot_in : "move".equals(k) ? R.drawable.widget_dot_move : R.drawable.widget_dot_out);
            v.setTextViewText(NAMES[i], t.optString("name", ""));
            v.setTextViewText(whens[i], t.optString("when", ""));
            v.setTextViewText(AMOUNTS[i], mask(hidden, t.optString("amount", "")));
            v.setTextColor(AMOUNTS[i], hidden ? SOFT : "in".equals(k) ? GREEN : "move".equals(k) ? SOFT : 0xFFFF7A88);
        }
    }
}
