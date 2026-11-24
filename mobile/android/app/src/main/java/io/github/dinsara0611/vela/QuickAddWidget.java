package io.github.dinsara0611.vela;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/** Home-screen widget: three buttons that open Vela at a new expense, income or transfer (double tap). No amounts shown. */
public class QuickAddWidget extends AppWidgetProvider {
    static void refresh(Context c) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(c);
        for (int id : mgr.getAppWidgetIds(new ComponentName(c, QuickAddWidget.class))) draw(c, mgr, id);
    }

    @Override
    public void onUpdate(Context c, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) draw(c, mgr, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context c, AppWidgetManager mgr, int id, android.os.Bundle options) {
        draw(c, mgr, id);
    }

    private static final String[][] BUTTONS = { { "add-expense", "Tap again to add an expense" }, { "add-income", "Tap again to add income" },
        { "add-transfer", "Tap again to add a transfer" }, { "home", "Tap again to open Vela" } };

    @Override
    public void onReceive(Context c, Intent intent) {
        super.onReceive(c, intent);
        if (!BalanceWidget.ACTION_TAP.equals(intent.getAction())) return;
        // First tap on a button: get ready. A second tap on the same button soon after opens it.
        String what = intent.getStringExtra("what");
        String hint = "Tap again to open Vela";
        for (String[] b : BUTTONS) if (b[0].equals(what)) hint = b[1];
        BalanceWidget.arm(c, "quick_" + what, hint, () -> refresh(c), goAsync());
    }

    private static PendingIntent tap(Context c, String what, int code) {
        if (BalanceWidget.armed(c, "quick_" + what)) return BalanceWidget.openApp(c, what, code);
        Intent i = new Intent(c, QuickAddWidget.class).setAction(BalanceWidget.ACTION_TAP).putExtra("what", what);
        return PendingIntent.getBroadcast(c, code + 100, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static RemoteViews build(Context c, boolean small) {
        RemoteViews v = new RemoteViews(c.getPackageName(), small ? R.layout.widget_quick_small : R.layout.widget_quick_add);
        v.setOnClickPendingIntent(R.id.wq_expense, tap(c, "add-expense", 701));
        v.setOnClickPendingIntent(R.id.wq_income, tap(c, "add-income", 702));
        v.setOnClickPendingIntent(R.id.wq_transfer, tap(c, "add-transfer", 703));
        if (!small) v.setOnClickPendingIntent(R.id.wq_head, tap(c, "home", 704));
        return v;
    }

    private static void draw(Context c, AppWidgetManager mgr, int id) {
        // Small: three icon buttons. Wider or taller: a title and the buttons with their names.
        if (android.os.Build.VERSION.SDK_INT >= 31) {
            java.util.Map<android.util.SizeF, RemoteViews> bySize = new java.util.HashMap<>();
            bySize.put(new android.util.SizeF(100f, 40f), build(c, true));
            bySize.put(new android.util.SizeF(240f, 90f), build(c, false));
            mgr.updateAppWidget(id, new RemoteViews(bySize));
        } else {
            android.os.Bundle o = mgr.getAppWidgetOptions(id);
            int w = o == null ? 0 : o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
            int h = o == null ? 0 : o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
            mgr.updateAppWidget(id, build(c, !(w >= 240 && h >= 90)));
        }
    }
}
