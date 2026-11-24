package io.github.dinsara0611.vela;

import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

/** Home-screen widget: savings goals as rings (one ring when small, up to three goals on the big widget). */
public class GoalsWidget extends BalanceWidget {
    @Override protected String kind() { return "goals"; }
    @Override protected String opens() { return "goals"; }
    @Override protected String emptyTitle() { return "Goals"; }
    @Override protected int smallLayout() { return R.layout.widget_goals_small; }
    @Override protected int bigLayout() { return R.layout.widget_goals_big; }

    private static final int[] COLORS = { 0xFFFF6FB5, 0xFFB17AFF, 0xFF4CC9F0 };

    @Override
    protected void fill(Context c, RemoteViews v, JSONObject d, boolean hidden, boolean small, boolean none) throws Exception {
        JSONArray items = d.optJSONArray("items");
        int n = items == null ? 0 : items.length();
        v.setTextViewText(R.id.w_title, "Goals");
        if (small) {
            JSONObject one = n == 1 ? items.getJSONObject(0) : null;
            int pct = one != null ? one.optInt("pct", 0) : d.optInt("pct", 0);
            v.setImageViewBitmap(R.id.w_ring, ring(pct, COLORS[0]));
            v.setTextViewText(R.id.w_pct, pct + "%");
            v.setTextViewText(R.id.w_name, none ? "Open Vela to load" : n == 0 ? "No goals yet" : one != null ? one.optString("name", "") : n + " goals");
            String amt = one != null ? one.optString("amount", "") : d.optString("big", "");
            v.setTextViewText(R.id.w_total, n == 0 ? (none ? MASK : "Tap to add one") : hidden ? MASK : amt);
            return;
        }
        v.setTextViewText(R.id.w_total, hidden || none ? MASK : d.optString("big", MASK));
        v.setTextViewText(R.id.w_sub, none ? "Open Vela to load" : hidden ? d.optString("subHidden", "") : d.optString("sub", ""));
        int[] cols = { R.id.w_g1, R.id.w_g2, R.id.w_g3 };
        int[] rings = { R.id.w_gring1, R.id.w_gring2, R.id.w_gring3 };
        int[] pcts = { R.id.w_gpct1, R.id.w_gpct2, R.id.w_gpct3 };
        int[] names = { R.id.w_gname1, R.id.w_gname2, R.id.w_gname3 };
        int[] amts = { R.id.w_gamt1, R.id.w_gamt2, R.id.w_gamt3 };
        for (int i = 0; i < cols.length; i++) {
            JSONObject g = i < n ? items.getJSONObject(i) : null;
            boolean show = g != null || i == 0;
            v.setViewVisibility(cols[i], show ? View.VISIBLE : View.GONE);
            if (!show) continue;
            int pct = g == null ? 0 : g.optInt("pct", 0);
            v.setImageViewBitmap(rings[i], ring(pct, COLORS[i]));
            v.setTextViewText(pcts[i], pct + "%");
            v.setTextViewText(names[i], g == null ? "Add a goal" : g.optString("name", ""));
            v.setTextViewText(amts[i], g == null ? "" : mask(hidden, g.optString("amount", "")));
        }
    }

    @Override protected int shortLayout() { return R.layout.widget_goals_short; }

    @Override
    protected void fillShort(Context c, RemoteViews v, JSONObject d, boolean hidden, boolean none) throws Exception {
        JSONArray items = d.optJSONArray("items");
        int n = items == null ? 0 : items.length();
        JSONObject one = n == 1 ? items.getJSONObject(0) : null;
        int pct = one != null ? one.optInt("pct", 0) : d.optInt("pct", 0);
        v.setImageViewBitmap(R.id.w_ring, ring(pct, COLORS[0]));
        v.setTextViewText(R.id.w_pct, pct + "%");
        v.setTextViewText(R.id.w_title, one != null ? one.optString("name", "Goals") : "Goals");
        v.setTextViewText(R.id.w_total, n == 0 && !none ? "No goals yet" : hidden || none ? MASK : one != null ? one.optString("amount", "") : d.optString("big", ""));
        v.setTextViewText(R.id.w_sub, none ? "Open Vela to load" : n == 0 ? "Tap twice to add one" : hidden ? d.optString("subHidden", "") : d.optString("sub", ""));
    }
}
