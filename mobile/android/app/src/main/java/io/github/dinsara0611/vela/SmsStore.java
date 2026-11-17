package io.github.dinsara0611.vela;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.HashSet;
import java.util.Set;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Bank SMS detections waiting for the user to add or ignore them in Vela.
 * Kept encrypted with a key in the Android Keystore, only until handled, at most 50, and deleted on Disconnect.
 */
final class SmsStore {
    private SmsStore() {}

    static final String CHANNEL = "vela-bank-review";
    static final String PREFS = "vela_sms";
    private static final String KEY = "pending_enc";
    private static final String HANDLED = "handled";
    private static final String KEY_ALIAS = "vela_bank_store";
    private static final int MAX = 50;

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ---- settings shared by the receiver, the listener and the plugin ----
    static boolean smsOn(Context ctx) { return prefs(ctx).getBoolean("enabled", false) && !paused(ctx); }
    static boolean paused(Context ctx) { return prefs(ctx).getBoolean("paused", false); }

    // ---- encrypted storage ----
    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(KEY_ALIAS, null)).getSecretKey();
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        kg.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build());
        return kg.generateKey();
    }

    private static String seal(String plain) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return null; // no Keystore AES before Android 6
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key());
            byte[] iv = c.getIV();
            byte[] ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            return Base64.encodeToString(iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP);
        } catch (Exception e) {
            return null;
        }
    }

    private static String open(String sealed) {
        if (sealed == null || !sealed.contains(":")) return null;
        try {
            String[] p = sealed.split(":", 2);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(p[0], Base64.NO_WRAP)));
            return new String(c.doFinal(Base64.decode(p[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }

    static synchronized JSONArray all(Context ctx) {
        SharedPreferences p = prefs(ctx);
        // Vela 4.15 kept waiting messages unencrypted: move them into the encrypted store once.
        String old = p.getString("pending", null);
        if (old != null) {
            p.edit().remove("pending").apply();
            try {
                JSONArray list = new JSONArray(old);
                if (list.length() > 0 && p.getString(KEY, null) == null) save(ctx, list);
            } catch (Exception e) {
                // unreadable: drop it
            }
        }
        try {
            String stored = p.getString(KEY, null);
            String plain = stored == null ? null : stored.startsWith(PLAIN) ? stored.substring(PLAIN.length()) : open(stored);
            return new JSONArray(plain == null ? "[]" : plain);
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    /** Marks the rare phone whose Keystore can't encrypt: still kept, in Vela's private app storage. */
    private static final String PLAIN = "plain:";

    private static void save(Context ctx, JSONArray list) {
        if (list.length() == 0) { prefs(ctx).edit().remove(KEY).apply(); return; }
        String sealed = seal(list.toString());
        // If this phone's Keystore fails, keep the detection rather than silently losing it (private storage only).
        prefs(ctx).edit().putString(KEY, sealed != null ? sealed : PLAIN + list.toString()).apply();
    }

    /** Added or ignored already (also from the notification), so the inbox scan doesn't offer it again. */
    static boolean isHandled(Context ctx, String id) {
        return handled(ctx).contains(id);
    }

    private static Set<String> handled(Context ctx) {
        return new HashSet<>(prefs(ctx).getStringSet(HANDLED, new HashSet<>()));
    }

    /**
     * Keeps a detection. Returns false when it's already kept or was already added/ignored (a notification update or
     * a resent SMS), so no second Vela notification is shown.
     */
    static synchronized boolean add(Context ctx, JSONObject item) {
        String id = item.optString("id");
        if (handled(ctx).contains(id)) return false;
        JSONArray list = all(ctx);
        for (int i = 0; i < list.length(); i++) {
            JSONObject o = list.optJSONObject(i);
            if (o != null && id.equals(o.optString("id"))) return false;
        }
        JSONArray out = new JSONArray();
        out.put(item);
        for (int i = 0; i < list.length() && out.length() < MAX; i++) out.put(list.opt(i));
        save(ctx, out);
        prefs(ctx).edit().putLong("lastDetected", System.currentTimeMillis()).apply();
        return true;
    }

    /** Added or ignored in Vela: forget them, remember they're done, remove their notifications. */
    static synchronized void remove(Context ctx, Set<String> ids) {
        JSONArray list = all(ctx);
        JSONArray out = new JSONArray();
        for (int i = 0; i < list.length(); i++) {
            JSONObject o = list.optJSONObject(i);
            if (o != null && !ids.contains(o.optString("id"))) out.put(o);
        }
        save(ctx, out);
        Set<String> done = handled(ctx);
        done.addAll(ids);
        if (done.size() > 400) done.clear(); // ids carry timestamps; old ones never come back
        done.addAll(ids);
        prefs(ctx).edit().putStringSet(HANDLED, done).apply();
        NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
        for (String id : ids) nm.cancel(notificationId(id));
    }

    /** Disconnect / delete: every kept detection and its notification. */
    static synchronized void clear(Context ctx) {
        JSONArray list = all(ctx);
        NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
        for (int i = 0; i < list.length(); i++) {
            JSONObject o = list.optJSONObject(i);
            if (o != null) nm.cancel(notificationId(o.optString("id")));
        }
        prefs(ctx).edit().remove(KEY).remove("pending").remove(HANDLED).remove("lastDetected").apply();
    }

    static int notificationId(String id) {
        return 700000 + Math.abs(id.hashCode() % 100000);
    }

    /**
     * "Bank transaction detected" notification. Respects the user's notification settings, shows no amounts on the
     * lock screen, opens the review screen when tapped, and can be swiped away (the detection stays in Vela).
     */
    static void notify(Context ctx, JSONObject item, BankSms.Info info) {
        if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return;
        NotificationManager manager = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Bank transactions to review", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("When Vela detects a bank transaction it asks you to review it");
            ch.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            manager.createNotificationChannel(ch);
        }
        String id = item.optString("id");
        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        open.putExtra("velaReview", id);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent tap = PendingIntent.getActivity(ctx, notificationId(id), open, flags);
        String money = ("USD".equals(info.currency) ? "$" : "LKR".equals(info.currency) ? "Rs. " : info.currency + " ") + info.amount;
        String text = "out".equals(info.direction) ? money + " spent from " + info.bank + "."
            : "in".equals(info.direction) ? money + " received in " + info.bank + "."
            : "atm".equals(info.direction) ? money + " ATM withdrawal from " + info.bank + "."
            : "cardpay".equals(info.direction) ? money + " paid to your " + info.bank + " card."
            : money + " reversal at " + info.bank + ".";
        Notification publicVersion = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_vela)
            .setColor(0xFF9B51E0)
            .setContentTitle("Vela")
            .setContentText("Bank transaction detected. Unlock to review.")
            .build();
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_vela)
            .setColor(0xFF9B51E0)
            .setContentTitle("Bank transaction detected")
            .setContentText(text + " Add it, ignore it, or tap to review.")
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text + " Tap Add to add it to Vela, Ignore to skip it, or tap here to check the details first."))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .setContentIntent(tap);
        // Buttons: "Add" opens Vela and adds it (a clear payment, money in or an ATM withdrawal); "Ignore" forgets it
        // without opening Vela. Payments to your own card and reversals need the review screen, so they get Ignore only.
        // On Android 12+ both need the phone unlocked first.
        boolean addable = "out".equals(info.direction) || "in".equals(info.direction) || "atm".equals(info.direction);
        if (addable) {
            Intent add = new Intent(ctx, MainActivity.class);
            add.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            add.putExtra("velaReview", id);
            add.putExtra("velaAdd", true);
            PendingIntent addTap = PendingIntent.getActivity(ctx, notificationId(id) + 1, add, flags);
            b.addAction(new NotificationCompat.Action.Builder(0, "Add", addTap).setAuthenticationRequired(true).build());
        }
        Intent ignore = new Intent(ctx, NotificationActionReceiver.class);
        ignore.setAction(NotificationActionReceiver.IGNORE);
        ignore.putExtra("id", id);
        PendingIntent ignoreTap = PendingIntent.getBroadcast(ctx, notificationId(id) + 2, ignore, flags);
        b.addAction(new NotificationCompat.Action.Builder(0, "Ignore", ignoreTap).setAuthenticationRequired(true).build());
        try {
            manager.notify(notificationId(id), b.build());
        } catch (SecurityException e) {
            // Notifications not allowed: the detection still waits in Vela.
        }
    }
}
