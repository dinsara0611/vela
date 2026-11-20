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

    private static void draw(Context c, AppWidgetManager mgr, int id) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_quick_add);
        v.setOnClickPendingIntent(R.id.wq_expense, BalanceWidget.openApp(c, "add-expense", 701));
        v.setOnClickPendingIntent(R.id.wq_income, BalanceWidget.openApp(c, "add-income", 702));
        v.setOnClickPendingIntent(R.id.wq_transfer, BalanceWidget.openApp(c, "add-transfer", 703));
        v.setOnClickPendingIntent(R.id.wq_head, BalanceWidget.openApp(c, "home", 704));
        mgr.updateAppWidget(id, v);
    }
}
