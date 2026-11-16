package io.github.dinsara0611.vela;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import org.json.JSONArray;
import org.json.JSONObject;

/** Bank messages that arrived while Vela was closed, kept until the user adds or ignores them. */
final class SmsStore {
    private SmsStore() {}

    static final String CHANNEL = "vela-bank";
    private static final String PREFS = "vela_sms";
    private static final String KEY = "pending";
    private static final int MAX = 50;

    static synchronized JSONArray all(Context ctx) {
        try {
            return new JSONArray(prefs(ctx).getString(KEY, "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    static synchronized void add(Context ctx, JSONObject item) {
        JSONArray list = all(ctx);
        String id = item.optString("id");
        for (int i = 0; i < list.length(); i++) {
            if (id.equals(list.optJSONObject(i).optString("id"))) return;
        }
        JSONArray out = new JSONArray();
        out.put(item);
        for (int i = 0; i < list.length() && out.length() < MAX; i++) out.put(list.opt(i));
        prefs(ctx).edit().putString(KEY, out.toString()).apply();
    }

    static synchronized void remove(Context ctx, java.util.Set<String> ids) {
        JSONArray list = all(ctx);
        JSONArray out = new JSONArray();
        for (int i = 0; i < list.length(); i++) {
            JSONObject o = list.optJSONObject(i);
            if (o != null && !ids.contains(o.optString("id"))) out.put(o);
        }
        prefs(ctx).edit().putString(KEY, out.toString()).apply();
        NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
        for (String id : ids) nm.cancel(notificationId(id));
    }

    static int notificationId(String id) {
        return 700000 + Math.abs(id.hashCode() % 100000);
    }

    /** A notification that stays until the message is added or ignored in Vela. */
    static void notify(Context ctx, JSONObject item, BankSms.Info info) {
        NotificationManager manager = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Bank messages", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Bank SMS that Vela can add for you");
            manager.createNotificationChannel(ch);
        }
        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        open.putExtra("velaSms", item.optString("id"));
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent tap = PendingIntent.getActivity(ctx, notificationId(item.optString("id")), open, flags);
        String money = ("USD".equals(info.currency) ? "$" : "Rs. ") + info.amount;
        String what = "out".equals(info.direction) ? "Expense" : "in".equals(info.direction) ? "Income"
            : "atm".equals(info.direction) ? "ATM withdrawal" : "Reversal";
        String title = "New bank transaction detected";
        String text = info.bank + " \u00b7 " + money + " \u00b7 " + what + ". Tap to review it in Vela; nothing is added until you confirm.";
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_vela)
            .setColor(0xFF9B51E0)
            .setContentTitle(title)
            .setContentText(info.bank + " \u00b7 " + money + " \u00b7 " + what)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(tap);
        try {
            manager.notify(notificationId(item.optString("id")), b.build());
        } catch (SecurityException e) {
            // Notifications not allowed: the message still waits in Vela.
        }
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
