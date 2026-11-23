package io.github.dinsara0611.vela;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.widget.RemoteViews;

/** Home-screen widget: three buttons that open Vela straight at a new expense, income or transfer. No amounts shown. */
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

    private static RemoteViews build(Context c, boolean small) {
        RemoteViews v = new RemoteViews(c.getPackageName(), small ? R.layout.widget_quick_small : R.layout.widget_quick_add);
        v.setOnClickPendingIntent(R.id.wq_expense, BalanceWidget.openApp(c, "add-expense", 701));
        v.setOnClickPendingIntent(R.id.wq_income, BalanceWidget.openApp(c, "add-income", 702));
        v.setOnClickPendingIntent(R.id.wq_transfer, BalanceWidget.openApp(c, "add-transfer", 703));
        if (!small) v.setOnClickPendingIntent(R.id.wq_head, BalanceWidget.openApp(c, "home", 704));
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
