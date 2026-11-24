package io.github.dinsara0611.vela;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Home-screen widgets, each with its own look (a bank card, a budget ring, a bills calendar, goal rings, a 7-day
 * chart) and two sizes, with an eye button that hides the amounts. Amounts are hidden by default (anyone can see a home screen). The app sends the figures, already
 * formatted, whenever they change (see BalanceWidgetPlugin); the widget itself never reads Vela's data.
 * This class is the balances widget; BudgetWidget, BillsWidget, GoalsWidget and RecentWidget show other parts.
 */
public class BalanceWidget extends AppWidgetProvider {
    static final String PREFS = "vela_widget";
    static final String KEY_DATA = "data";
    static final String KEY_HIDDEN = "hidden";
    static final String ACTION_TOGGLE = "io.github.dinsara0611.vela.WIDGET_TOGGLE";
    static final String OPEN_URL = "io.github.dinsara0611.vela://widget/";
    static final String MASK = "Rs. ••••";


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
        draw(c, mgr, id); // resized: the small or the big layout
    }

    /** Each widget has its own look: a small layout (2 x 2 and smaller) and a big one (wider and taller). */
    protected int smallLayout() { return R.layout.widget_balances_small; }
    protected int bigLayout() { return R.layout.widget_balances_big; }

    static final int WHITE = 0xFFFFFFFF, SOFT = 0xFFEDEDEE, RED = 0xFFFF5C6C, GREEN = 0xFF1EE88A;
    static final int[] ROWS = { R.id.w_row1, R.id.w_row2, R.id.w_row3, R.id.w_row4 };
    static final int[] NAMES = { R.id.w_name1, R.id.w_name2, R.id.w_name3, R.id.w_name4 };
    static final int[] AMOUNTS = { R.id.w_amt1, R.id.w_amt2, R.id.w_amt3, R.id.w_amt4 };

    static String mask(boolean hidden, String s) { return hidden ? "••••" : s; }

    /** Fills the layout with this widget's figures. d is empty when Vela has not sent any yet. */
    protected void fill(Context c, RemoteViews v, JSONObject d, boolean hidden, boolean small, boolean none) throws Exception {
        // Balances: a bank card with the total and, on the big card, each account with a bar for its share.
        v.setTextViewText(R.id.w_title, d.optString("title", "All accounts"));
        String big = hidden || none ? MASK : d.optString("big", MASK);
        v.setTextViewText(R.id.w_total, big);
        v.setTextColor(R.id.w_total, !hidden && d.optBoolean("minus", false) ? 0xFFFFB3BD : WHITE);
        if (small) fit(v, R.id.w_total, big, 20f);
        v.setTextViewText(R.id.w_sub, none ? "Open Vela to load" : d.optString("count", ""));
        if (small) return;
        JSONArray rows = d.optJSONArray("rows");
        int[] bars = { R.id.w_bar1, R.id.w_bar2, R.id.w_bar3, R.id.w_bar4 };
        for (int i = 0; i < ROWS.length; i++) {
            JSONObject a = rows != null && i < rows.length() ? rows.getJSONObject(i) : null;
            v.setViewVisibility(ROWS[i], a == null ? View.GONE : View.VISIBLE);
            if (a == null) continue;
            v.setTextViewText(NAMES[i], a.optString("name", ""));
            v.setTextViewText(AMOUNTS[i], mask(hidden, a.optString("amount", "")));
            v.setTextColor(AMOUNTS[i], !hidden && a.optBoolean("minus", false) ? 0xFFFFB3BD : WHITE);
            v.setProgressBar(bars[i], 100, hidden ? 0 : Math.max(2, a.optInt("share", 0)), false);
        }
    }

    /** Long amounts step down so they fit a small widget. */
    static void fit(RemoteViews v, int id, String text, float base) {
        v.setTextViewTextSize(id, android.util.TypedValue.COMPLEX_UNIT_SP, text.length() > 14 ? base - 5 : text.length() > 11 ? base - 3 : base);
    }

    /** A progress ring: a faint full circle and the done part in the colour (red and full when over 100%). */
    static Bitmap ring(int pct, int color) {
        int size = 240;
        float stroke = 24f;
        Bitmap b = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(b);
        RectF r = new RectF(stroke / 2 + 2, stroke / 2 + 2, size - stroke / 2 - 2, size - stroke / 2 - 2);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(stroke);
        p.setStrokeCap(Paint.Cap.ROUND);
        p.setColor((color & 0x00FFFFFF) | 0x33000000);
        cv.drawArc(r, 0, 360, false, p);
        boolean over = pct > 100;
        p.setColor(over ? RED : color);
        float sweep = over ? 360f : Math.max(0, pct) * 3.6f;
        if (sweep > 0) cv.drawArc(r, -90, Math.max(sweep, 2f), false, p);
        return b;
    }

    /** Seven bars, one per day (today last and brightest), with the day letters under them when there is room. */
    static Bitmap bars(JSONArray week, int color, boolean labels) {
        int w = 420, h = labels ? 150 : 130;
        Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(b);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        Paint t = new Paint(Paint.ANTI_ALIAS_FLAG);
        t.setColor(0xFFA8A8AA);
        t.setTextSize(24f);
        t.setTextAlign(Paint.Align.CENTER);
        int n = week == null ? 0 : Math.min(7, week.length());
        float slot = w / 7f, bw = slot * 0.5f, base = labels ? h - 32 : h - 2, top = 4;
        for (int i = 0; i < 7; i++) {
            JSONObject day = n == 7 ? week.optJSONObject(i) : null;
            int pct = day == null ? 0 : Math.max(0, Math.min(100, day.optInt("h", 0)));
            float bh = Math.max(bw * 0.6f, (base - top) * pct / 100f);
            float x = slot * i + (slot - bw) / 2;
            p.setColor(i == 6 ? color : (color & 0x00FFFFFF) | (pct > 0 ? 0x73000000 : 0x2E000000));
            cv.drawRoundRect(new RectF(x, base - bh, x + bw, base), bw / 2, bw / 2, p);
            if (labels && day != null) cv.drawText(day.optString("d", ""), x + bw / 2, h - 6, t);
        }
        return b;
    }

    void draw(Context c, AppWidgetManager mgr, int id) {
        RemoteViews small = build(c, true);
        RemoteViews big = build(c, false);
        if (android.os.Build.VERSION.SDK_INT >= 31) {
            // The launcher picks the layout that fits as the widget is resized.
            java.util.Map<android.util.SizeF, RemoteViews> bySize = new java.util.HashMap<>();
            bySize.put(new android.util.SizeF(100f, 40f), small);
            bySize.put(new android.util.SizeF(230f, 130f), big);
            mgr.updateAppWidget(id, new RemoteViews(bySize));
        } else {
            android.os.Bundle o = mgr.getAppWidgetOptions(id);
            int w = o == null ? 0 : o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
            int h = o == null ? 0 : o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
            mgr.updateAppWidget(id, w >= 230 && h >= 130 ? big : small);
        }
    }

    private RemoteViews build(Context c, boolean small) {
        RemoteViews v = new RemoteViews(c.getPackageName(), small ? smallLayout() : bigLayout());
        String kind = kind();
        boolean hidden = isHidden(c, kind);
        JSONObject d = null;
        try {
            String raw = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_DATA, null);
            JSONObject all = raw == null ? null : new JSONObject(raw);
            d = all == null ? null : all.optJSONObject(kind);
        } catch (Exception e) {
            d = null;
        }
        try {
            fill(c, v, d == null ? new JSONObject() : d, hidden, small, d == null);
        } catch (Exception e) {
            // Unreadable figures: keep the layout's own text, never crash the home screen.
        }
        v.setImageViewResource(R.id.w_eye, hidden ? R.drawable.ic_widget_eye_off : R.drawable.ic_widget_eye);
        v.setContentDescription(R.id.w_eye, hidden ? "Show amounts" : "Hide amounts");
        int code = kind.hashCode() & 0xFFFF;
        Intent toggle = new Intent(c, getClass()).setAction(ACTION_TOGGLE);
        v.setOnClickPendingIntent(R.id.w_eye, PendingIntent.getBroadcast(c, code, toggle, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        v.setOnClickPendingIntent(R.id.w_body, openApp(c, opens(), code + 1));
        return v;
    }
}
