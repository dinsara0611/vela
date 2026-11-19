package io.github.dinsara0611.vela;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Home-screen widget: the total and up to four accounts, with an eye button that hides the amounts.
 * Amounts are hidden by default (anyone can see a home screen). The app sends the figures, already formatted,
 * whenever they change (see BalanceWidgetPlugin); the widget itself never reads Vela's data.
 */
public class BalanceWidget extends AppWidgetProvider {
    static final String PREFS = "vela_widget";
    static final String KEY_DATA = "data";
    static final String KEY_HIDDEN = "hidden";
    static final String ACTION_TOGGLE = "io.github.dinsara0611.vela.WIDGET_TOGGLE";
    private static final String MASK = "Rs. ••••";

    private static final int[] ROWS = { R.id.w_row1, R.id.w_row2, R.id.w_row3, R.id.w_row4 };
    private static final int[] NAMES = { R.id.w_name1, R.id.w_name2, R.id.w_name3, R.id.w_name4 };
    private static final int[] AMOUNTS = { R.id.w_amt1, R.id.w_amt2, R.id.w_amt3, R.id.w_amt4 };

    static boolean isHidden(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_HIDDEN, true);
    }

    /** Redraws every Vela widget on the home screen. */
    static void refreshAll(Context c) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(c);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(c, BalanceWidget.class));
        for (int id : ids) draw(c, mgr, id);
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
            p.edit().putBoolean(KEY_HIDDEN, !p.getBoolean(KEY_HIDDEN, true)).apply();
            refreshAll(c);
        }
    }

    private static void draw(Context c, AppWidgetManager mgr, int id) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_balance);
        boolean hidden = isHidden(c);
        String total = MASK;
        String updated = "Open Vela to load your balances";
        int shown = 0;
        try {
            String raw = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_DATA, null);
            if (raw != null) {
                JSONObject d = new JSONObject(raw);
                total = hidden ? MASK : d.optString("total", "");
                updated = d.optString("updated", "");
                v.setTextViewText(R.id.w_title, d.optString("title", "All accounts"));
                JSONArray list = d.optJSONArray("accounts");
                if (list != null) {
                    for (int i = 0; i < list.length() && i < ROWS.length; i++) {
                        JSONObject a = list.getJSONObject(i);
                        v.setViewVisibility(ROWS[i], View.VISIBLE);
                        v.setTextViewText(NAMES[i], a.optString("name", ""));
                        v.setTextViewText(AMOUNTS[i], hidden ? "••••" : a.optString("amount", ""));
                        v.setTextColor(AMOUNTS[i], !hidden && a.optBoolean("minus", false) ? 0xFFFF5C6C : 0xFFEDEDEE);
                        shown++;
                    }
                }
                v.setTextColor(R.id.w_total, !hidden && d.optBoolean("minus", false) ? 0xFFFF5C6C : 0xFFFFFFFF);
            }
        } catch (Exception e) {
            // Unreadable figures: show the empty widget, never crash the home screen.
        }
        for (int i = shown; i < ROWS.length; i++) v.setViewVisibility(ROWS[i], View.GONE);
        v.setTextViewText(R.id.w_total, total);
        v.setTextViewText(R.id.w_updated, updated);
        v.setImageViewResource(R.id.w_eye, hidden ? R.drawable.ic_widget_eye_off : R.drawable.ic_widget_eye);
        v.setContentDescription(R.id.w_eye, hidden ? "Show amounts" : "Hide amounts");

        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        Intent toggle = new Intent(c, BalanceWidget.class).setAction(ACTION_TOGGLE);
        v.setOnClickPendingIntent(R.id.w_eye, PendingIntent.getBroadcast(c, 0, toggle, flags));
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        v.setOnClickPendingIntent(R.id.w_body, PendingIntent.getActivity(c, 1, open, flags));
        mgr.updateAppWidget(id, v);
    }
}
