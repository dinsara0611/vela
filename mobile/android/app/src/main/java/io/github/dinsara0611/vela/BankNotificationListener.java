package io.github.dinsara0611.vela;

import android.app.Notification;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import org.json.JSONObject;

/**
 * Bank and Passbook app notification tracking (Commercial Bank ePassbook, ComBank Digital, BOC Smart Passbook,
 * Sampath Vishwa...), a second way to detect transactions alongside bank SMS. Android runs this only after the
 * user grants Notification access in Android Settings, and restarts it after a reboot by itself.
 * Only notifications from the bank apps the user picked in Vela are looked at; every other app's notifications
 * are dropped without being read. OTPs, login and security alerts, hidden content and anything without an
 * amount are never kept. What is kept goes through the same store, review and duplicate checks as bank SMS.
 */
public class BankNotificationListener extends NotificationListenerService {
    private static volatile BankNotificationListener instance;

    static boolean isConnected() {
        return instance != null;
    }

    static ComponentName component(Context ctx) {
        return new ComponentName(ctx, BankNotificationListener.class);
    }

    /** Turned off in Vela: stop listening until the user turns it on again. */
    static void stop() {
        BankNotificationListener l = instance;
        if (l != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try { l.requestUnbind(); } catch (Exception e) { /* ignore */ }
        }
    }

    /** Turned on in Vela while access is granted: ask Android to (re)start the listener. */
    static void start(Context ctx) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && instance == null) {
            try { requestRebind(component(ctx)); } catch (Exception e) { /* not granted */ }
        }
    }

    @Override
    public void onListenerConnected() {
        instance = this;
        SmsStore.prefs(this).edit().putLong("listenerConnectedAt", System.currentTimeMillis()).apply();
        if (!SmsStore.notifOn(this)) return;
        // Bank notifications posted while the listener was down (e.g. after a restart) that are still showing.
        try {
            StatusBarNotification[] active = getActiveNotifications();
            if (active != null) for (StatusBarNotification sbn : active) handle(sbn);
        } catch (Exception e) {
            // ignore
        }
    }

    @Override
    public void onListenerDisconnected() {
        instance = null;
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        handle(sbn);
    }

    private void handle(StatusBarNotification sbn) {
        if (sbn == null || !SmsStore.notifOn(this)) return;
        String pkg = sbn.getPackageName();
        // Only the bank apps the user picked; everything else is ignored before reading anything.
        String bank = BankSms.bankForApp(pkg);
        if (bank == null || !SmsStore.bankApps(this).contains(pkg)) return;
        Notification n = sbn.getNotification();
        if (n == null || (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
        Bundle x = n.extras;
        String title = x == null ? "" : str(x.getCharSequence(Notification.EXTRA_TITLE));
        String big = x == null ? "" : str(x.getCharSequence(Notification.EXTRA_BIG_TEXT));
        String text = big.isEmpty() ? (x == null ? "" : str(x.getCharSequence(Notification.EXTRA_TEXT))) : big;
        CharSequence[] lines = x == null ? null : x.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
        // Identity of this notification: its key plus when it was first created. An update of the same notification
        // keeps both (so it isn't kept twice); a new alert in the same slot, or a second identical alert, has a new time.
        String slot = sbn.getKey() + "|" + n.when;
        if (lines != null && lines.length > 0) {
            for (CharSequence line : lines) take(pkg, bank, slot, title, str(line), sbn.getPostTime());
            return;
        }
        take(pkg, bank, slot, title, text, sbn.getPostTime());
    }

    private void take(String pkg, String bank, String slot, String title, String text, long postTime) {
        if (BankSms.looksHidden(text)) {
            // The bank app or Android hid the content: note it so Vela can explain, keep nothing else.
            SmsStore.prefs(this).edit().putLong("hiddenAt", System.currentTimeMillis()).putString("hiddenApp", pkg).apply();
            return;
        }
        String body = (title.isEmpty() || text.startsWith(title) ? "" : title + ". ") + text;
        BankSms.Info info = BankSms.parse(null, body, bank);
        if (info == null) return; // not a transaction (or an OTP, alert, promotion...): never stored
        try {
            JSONObject item = new JSONObject();
            // Same notification and same text = kept once (updates and re-reads after a restart don't duplicate).
            item.put("id", "ntf-" + Math.abs((pkg + "|" + slot + "|" + body.replaceAll("\\s+", " ").trim()).hashCode()));
            item.put("source", "notification");
            item.put("address", pkg);
            item.put("bank", bank);
            item.put("body", body);
            item.put("date", postTime > 0 ? postTime : System.currentTimeMillis());
            boolean merged = SmsStore.alreadyNotified(this, item, info);
            if (!SmsStore.add(this, item)) return;
            if (SmsReaderPlugin.isForeground()) SmsReaderPlugin.emit(item);
            else if (!merged) SmsStore.notify(this, item, info);
        } catch (Exception e) {
            // Never crash on an odd notification.
        }
    }

    private static String str(CharSequence s) {
        return s == null ? "" : s.toString().trim();
    }
}
