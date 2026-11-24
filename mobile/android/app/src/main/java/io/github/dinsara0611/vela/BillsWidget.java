package io.github.dinsara0611.vela;

import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

/** Home-screen widget: bills still to pay. Small: the next bill as a calendar page. Big and tall: the month as a calendar. */
public class BillsWidget extends BalanceWidget {
    @Override protected String kind() { return "bills"; }
    @Override protected String opens() { return "bills"; }
    @Override protected String emptyTitle() { return "Bills coming"; }
    @Override protected int smallLayout() { return R.layout.widget_bills_small; }
    @Override protected int bigLayout() { return R.layout.widget_bills_big; }

    private static final int ORANGE = 0xFFFFA24C;
    private static final int[] CELLS = { R.id.w_c0, R.id.w_c1, R.id.w_c2, R.id.w_c3, R.id.w_c4, R.id.w_c5, R.id.w_c6, R.id.w_c7, R.id.w_c8, R.id.w_c9, R.id.w_c10, R.id.w_c11, R.id.w_c12, R.id.w_c13, R.id.w_c14, R.id.w_c15, R.id.w_c16, R.id.w_c17, R.id.w_c18, R.id.w_c19, R.id.w_c20, R.id.w_c21, R.id.w_c22, R.id.w_c23, R.id.w_c24, R.id.w_c25, R.id.w_c26, R.id.w_c27, R.id.w_c28, R.id.w_c29, R.id.w_c30, R.id.w_c31, R.id.w_c32, R.id.w_c33, R.id.w_c34, R.id.w_c35, R.id.w_c36, R.id.w_c37, R.id.w_c38, R.id.w_c39, R.id.w_c40, R.id.w_c41 };

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
        // Big: this month as a calendar (Monday first), bill days marked, today ringed; the next bill on the right.
        Calendar cal = Calendar.getInstance();
        int today = cal.get(Calendar.DAY_OF_MONTH);
        int dim = cal.getActualMaximum(Calendar.DAY_OF_MONTH);
        cal.set(Calendar.DAY_OF_MONTH, 1);
        int offset = (cal.get(Calendar.DAY_OF_WEEK) + 5) % 7;
        v.setTextViewText(R.id.w_month, d.optString("month", new SimpleDateFormat("MMMM", Locale.US).format(new Date())));
        java.util.Map<Integer, Boolean> marks = new java.util.HashMap<>();
        JSONArray days = d.optJSONArray("days");
        for (int k = 0; days != null && k < days.length(); k++) {
            JSONObject m = days.getJSONObject(k);
            marks.put(m.optInt("d"), m.optBoolean("late", false));
        }
        int weeks = (offset + dim + 6) / 7;
        int[] wk = { R.id.w_wk1, R.id.w_wk2, R.id.w_wk3, R.id.w_wk4, R.id.w_wk5, R.id.w_wk6 };
        for (int r = 0; r < wk.length; r++) v.setViewVisibility(wk[r], r < weeks ? View.VISIBLE : View.GONE);
        for (int k = 0; k < 42; k++) {
            int id = CELLS[k];
            int day = k - offset + 1;
            boolean in = day >= 1 && day <= dim;
            v.setTextViewText(id, in ? String.valueOf(day) : "");
            Boolean late = in ? marks.get(day) : null;
            v.setInt(id, "setBackgroundResource", late != null ? (late ? R.drawable.widget_cal_late : R.drawable.widget_cal_bill) : in && day == today ? R.drawable.widget_cal_today : R.drawable.widget_cal_none);
            v.setTextColor(id, late != null ? WHITE : in && day == today ? ORANGE : in && day < today ? 0xFF6E6E73 : 0xE6FFFFFF);
        }
        v.setTextViewText(R.id.w_total, hidden || none ? MASK : d.optString("big", MASK));
        v.setTextViewText(R.id.w_sub, none ? "Open Vela to load" : d.optString("count", ""));
        JSONObject first = n > 0 ? items.getJSONObject(0) : null;
        v.setViewVisibility(R.id.w_label, first == null ? View.GONE : View.VISIBLE);
        v.setTextViewText(R.id.w_title, first == null ? (none ? "" : "Nothing to pay") : first.optString("name", ""));
        v.setTextViewText(R.id.w_when, first == null ? "" : first.optString("when", ""));
        v.setTextColor(R.id.w_when, first != null && first.optBoolean("late", false) ? RED : ORANGE);
        v.setTextViewText(R.id.w_amt, first == null ? "" : mask(hidden, first.optString("amount", "")));
    }

    @Override protected int shortLayout() { return R.layout.widget_bills_short; }
    /** Square or tall: a small month calendar on top, the next bill underneath. */
    @Override protected int tallLayout() { return R.layout.widget_bills_tall; }

    @Override
    protected void fillShort(Context c, RemoteViews v, JSONObject d, boolean hidden, boolean none) throws Exception {
        JSONArray items = d.optJSONArray("items");
        JSONObject first = items != null && items.length() > 0 ? items.getJSONObject(0) : null;
        Date now = new Date();
        v.setTextViewText(R.id.w_mon, first != null ? first.optString("mon", "") : new SimpleDateFormat("MMM", Locale.US).format(now).toUpperCase(Locale.US));
        v.setTextViewText(R.id.w_day, first != null ? first.optString("day", "") : new SimpleDateFormat("d", Locale.US).format(now));
        v.setTextViewText(R.id.w_title, first != null ? first.optString("name", "") : "Bills coming");
        v.setTextViewText(R.id.w_total, first != null ? (hidden ? MASK : first.optString("amount", "")) : none ? MASK : "Nothing to pay");
        v.setTextViewText(R.id.w_sub, none ? "Open Vela to load" : first != null ? first.optString("when", "") : "All paid this month");
        v.setTextColor(R.id.w_sub, first != null && first.optBoolean("late", false) ? RED : ORANGE);
    }
}
