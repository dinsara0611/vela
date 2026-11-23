package io.github.dinsara0611.vela;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Home-screen widget: a title, one big figure, a short line and up to four rows, with an eye button that hides
 * the amounts. Amounts are hidden by default (anyone can see a home screen). The app sends the figures, already
 * formatted, whenever they change (see BalanceWidgetPlugin); the widget itself never reads Vela's data.
 * This class is the balances widget; BudgetWidget, BillsWidget, GoalsWidget and RecentWidget show other parts.
 */
public class BalanceWidget extends AppWidgetProvider {
    static final String PREFS = "vela_widget";
    static final String KEY_DATA = "data";
    static final String KEY_HIDDEN = "hidden";
    static final String ACTION_TOGGLE = "io.github.dinsara0611.vela.WIDGET_TOGGLE";
    static final String OPEN_URL = "io.github.dinsara0611.vela://widget/";
    private static final String MASK = "Rs. ••••";

    private static final int[] ROWS = { R.id.w_row1, R.id.w_row2, R.id.w_row3, R.id.w_row4 };
    private static final int[] NAMES = { R.id.w_name1, R.id.w_name2, R.id.w_name3, R.id.w_name4 };
    private static final int[] AMOUNTS = { R.id.w_amt1, R.id.w_amt2, R.id.w_amt3, R.id.w_amt4 };

    /** Which part of the figures this widget shows (a key in the data the app sends). */
    protected String kind() { return "balances"; }
    /** Where a tap on the widget opens Vela. */
    protected String opens() { return "home"; }
    protected String emptyTitle() { return "All accounts"; }

    private static String hiddenKey(String kind) { return "balances".equals(kind) ? KEY_HIDDEN : KEY_HIDDEN + "_" + kind; }

    static boolean isHidden(Context c) { return isHidden(c, "balances"); }

    static boolean isHidden(Context c, String kind) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(hiddenKey(kind), true);
    }

    /** Redraws every Vela widget on the home screen. */
    static void refreshAll(Context c) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(c);
        BalanceWidget[] all = { new BalanceWidget(), new BudgetWidget(), new BillsWidget(), new GoalsWidget(), new RecentWidget() };
        for (BalanceWidget w : all) {
            int[] ids = mgr.getAppWidgetIds(new ComponentName(c, w.getClass()));
            for (int id : ids) w.draw(c, mgr, id);
        }
        QuickAddWidget.refresh(c);
    }

    @Override
    public void onUpdate(Context c, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) draw(c, mgr, id);
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        super.onReceive(c, intent);
        if (ACTION_TOGGLE.equals(intent.getAction())) {
            SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String key = hiddenKey(kind());
            p.edit().putBoolean(key, !p.getBoolean(key, true)).apply();
            AppWidgetManager mgr = AppWidgetManager.getInstance(c);
            for (int id : mgr.getAppWidgetIds(new ComponentName(c, getClass()))) draw(c, mgr, id);
        }
    }

    static PendingIntent openApp(Context c, String what, int code) {
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(OPEN_URL + what), c, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(c, code, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context c, AppWidgetManager mgr, int id, android.os.Bundle options) {
        draw(c, mgr, id); // resized: the small or the wide layout
    }

    /** The small layout for this widget (its own icon, colour and name). */
    protected int smallLayout() { return R.layout.widget_small_balances; }
    protected int icon() { return R.drawable.ic_w_balances; }
    protected int badge() { return R.drawable.widget_badge_balances; }

    void draw(Context c, AppWidgetManager mgr, int id) {
        RemoteViews small = build(c, true);
        RemoteViews wide = build(c, false);
        if (android.os.Build.VERSION.SDK_INT >= 31) {
            // The launcher picks the layout that fits as the widget is resized.
            java.util.Map<android.util.SizeF, RemoteViews> bySize = new java.util.HashMap<>();
            bySize.put(new android.util.SizeF(100f, 40f), small);
            bySize.put(new android.util.SizeF(200f, 150f), wide);
            mgr.updateAppWidget(id, new RemoteViews(bySize));
        } else {
            android.os.Bundle o = mgr.getAppWidgetOptions(id);
            int w = o == null ? 0 : o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
            int h = o == null ? 0 : o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
            mgr.updateAppWidget(id, w >= 200 && h >= 150 ? wide : small);
        }
    }

    private RemoteViews build(Context c, boolean isSmall) {
        RemoteViews v = new RemoteViews(c.getPackageName(), isSmall ? smallLayout() : R.layout.widget_balance);
        int titleId = isSmall ? R.id.w_title2 : R.id.w_title;
        String kind = kind();
        boolean hidden = isHidden(c, kind);
        String big = MASK;
        String sub = "";
        String updated = "Open Vela to load your figures";
        int shown = 0;
        v.setImageViewResource(R.id.w_icon, icon());
        v.setInt(R.id.w_icon, "setBackgroundResource", badge());
        v.setTextViewText(titleId, emptyTitle());
        try {
            String raw = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_DATA, null);
            JSONObject all = raw == null ? null : new JSONObject(raw);
            JSONObject d = all == null ? null : all.optJSONObject(kind);
            if (d != null) {
                big = hidden ? MASK : d.optString("big", "");
                sub = hidden ? d.optString("subHidden", "") : d.optString("sub", "");
                updated = all.optString("updated", "");
                v.setTextViewText(titleId, d.optString("title", emptyTitle()));
                JSONArray list = d.optJSONArray("rows");
                if (!isSmall && list != null) {
                    for (int i = 0; i < list.length() && i < ROWS.length; i++) {
                        JSONObject a = list.getJSONObject(i);
                        v.setViewVisibility(ROWS[i], View.VISIBLE);
                        v.setTextViewText(NAMES[i], a.optString("name", ""));
                        v.setTextViewText(AMOUNTS[i], hidden ? "••••" : a.optString("amount", ""));
                        int color = hidden ? 0xFFEDEDEE : a.optBoolean("minus", false) ? 0xFFFF5C6C : a.optBoolean("plus", false) ? 0xFF1EE88A : 0xFFEDEDEE;
                        v.setTextColor(AMOUNTS[i], color);
                        shown++;
                    }
                }
                v.setTextColor(R.id.w_total, !hidden && d.optBoolean("minus", false) ? 0xFFFF5C6C : 0xFFFFFFFF);
            }
        } catch (Exception e) {
            // Unreadable figures: show the empty widget, never crash the home screen.
        }
        if (!isSmall) {
            for (int i = shown; i < ROWS.length; i++) v.setViewVisibility(ROWS[i], View.GONE);
            v.setTextViewText(R.id.w_updated, updated);
        }
        v.setTextViewText(R.id.w_total, big);
        // Long amounts step down so they fit the small widget.
        if (isSmall) v.setTextViewTextSize(R.id.w_total, android.util.TypedValue.COMPLEX_UNIT_SP, big.length() > 14 ? 15f : big.length() > 11 ? 17f : 20f);
        v.setTextViewText(R.id.w_sub, sub);
        v.setViewVisibility(R.id.w_sub, sub.isEmpty() ? View.GONE : View.VISIBLE);
        v.setImageViewResource(R.id.w_eye, hidden ? R.drawable.ic_widget_eye_off : R.drawable.ic_widget_eye);
        v.setContentDescription(R.id.w_eye, hidden ? "Show amounts" : "Hide amounts");

        int code = kind.hashCode() & 0xFFFF;
        Intent toggle = new Intent(c, getClass()).setAction(ACTION_TOGGLE);
        v.setOnClickPendingIntent(R.id.w_eye, PendingIntent.getBroadcast(c, code, toggle, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        v.setOnClickPendingIntent(R.id.w_body, openApp(c, opens(), code + 1));
        return v;
    }
}
