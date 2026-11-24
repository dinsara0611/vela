package io.github.dinsara0611.vela;

import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Home-screen widget: bills still to pay, as calendar pages (the next one big, and a list on the big widget). */
public class BillsWidget extends BalanceWidget {
    @Override protected String kind() { return "bills"; }
    @Override protected String opens() { return "bills"; }
    @Override protected String emptyTitle() { return "Bills coming"; }
    @Override protected int smallLayout() { return R.layout.widget_bills_small; }
    @Override protected int bigLayout() { return R.layout.widget_bills_big; }

    private static final int ORANGE = 0xFFFFA24C;

    @Override
    protected void fill(Context c, RemoteViews v, JSONObject d, boolean hidden, boolean small, boolean none) throws Exception {
        JSONArray items = d.optJSONArray("items");
        int n = items == null ? 0 : items.length();
        if (small) {
            Date now = new Date();
            JSONObject first = n > 0 ? items.getJSONObject(0) : null;
            v.setTextViewText(R.id.w_mon, first != null ? first.optString("mon", "") : new SimpleDateFormat("MMM", Locale.US).format(now).toUpperCase(Locale.US));
            v.setTextViewText(R.id.w_day, first != null ? first.optString("day", "") : new SimpleDateFormat("d", Locale.US).format(now));
            v.setTextViewText(R.id.w_title, first != null ? first.optString("name", "") : "No bills to pay");
            boolean late = first != null && first.optBoolean("late", false);
            v.setTextViewText(R.id.w_when, none ? "Open Vela to load" : first != null ? first.optString("when", "") : "All paid this month");
            v.setTextColor(R.id.w_when, late ? RED : first == null && !none ? GREEN : ORANGE);
            v.setTextViewText(R.id.w_total, first != null ? (hidden ? MASK : first.optString("amount", "")) : "");
            return;
        }
        v.setTextViewText(R.id.w_title, "Bills coming");
        v.setTextViewText(R.id.w_total, hidden || none ? MASK : d.optString("big", MASK));
        v.setTextViewText(R.id.w_sub, none ? "Open Vela to load" : d.optString("count", ""));
        int[] mons = { R.id.w_mon1, R.id.w_mon2, R.id.w_mon3, R.id.w_mon4 };
        int[] days = { R.id.w_day1, R.id.w_day2, R.id.w_day3, R.id.w_day4 };
        int[] whens = { R.id.w_when1, R.id.w_when2, R.id.w_when3, R.id.w_when4 };
        for (int i = 0; i < ROWS.length; i++) {
            JSONObject b = i < n ? items.getJSONObject(i) : null;
            v.setViewVisibility(ROWS[i], b == null ? View.GONE : View.VISIBLE);
            if (b == null) continue;
            v.setTextViewText(mons[i], b.optString("mon", ""));
            v.setTextViewText(days[i], b.optString("day", ""));
            v.setTextViewText(NAMES[i], b.optString("name", ""));
            v.setTextViewText(whens[i], b.optString("when", ""));
            v.setTextColor(whens[i], b.optBoolean("late", false) ? RED : ORANGE);
            v.setTextViewText(AMOUNTS[i], mask(hidden, b.optString("amount", "")));
        }
    }
}
