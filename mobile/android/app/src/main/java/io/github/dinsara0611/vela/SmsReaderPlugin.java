package io.github.dinsara0611.vela;

import android.Manifest;
import android.content.ComponentName;
import android.content.pm.ResolveInfo;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONObject;

/**
 * Bank tracking for Vela: bank SMS and bank / Passbook app notifications (two separate switches), their real
 * status from Android, and the detections kept while Vela was closed. Messages and notifications never leave the phone.
 */
@CapacitorPlugin(
    name = "SmsReader",
    permissions = { @Permission(alias = "sms", strings = { Manifest.permission.READ_SMS, Manifest.permission.RECEIVE_SMS }) }
)
public class SmsReaderPlugin extends Plugin {
    private static SmsReaderPlugin instance;
    private static volatile boolean foreground = false;

    @Override
    public void load() {
        instance = this;
        foreground = true;
        if (getActivity() != null) handleIntent(getActivity().getIntent());
        if (SmsStore.notifOn(getContext())) BankNotificationListener.start(getContext());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String review = intent.getStringExtra("velaReview");
        if (review != null) {
            boolean add = intent.getBooleanExtra("velaAdd", false);
            intent.removeExtra("velaReview");
            intent.removeExtra("velaAdd");
            JSObject o = new JSObject();
            o.put("id", review);
            o.put("add", add);
            notifyListeners("reviewRequested", o, true);
        }
        takeShared(intent);
    }

    /** A bank SMS shared to Vela from another app: kept like a received one and shown for review. */
    private void takeShared(Intent intent) {
        if (!Intent.ACTION_SEND.equals(intent.getAction())) return;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        intent.setAction(null); // handle it once
        if (text == null || text.trim().isEmpty()) return;
        try {
            JSONObject item = new JSONObject();
            item.put("id", "shared-" + Math.abs(text.trim().hashCode()));
            item.put("source", "shared");
            item.put("address", "Shared");
            item.put("body", text.trim());
            item.put("date", System.currentTimeMillis());
            item.put("shared", true);
            SmsStore.add(getContext(), item);
            emit(item);
        } catch (Exception e) {
            // ignore
        }
    }

    @Override
    protected void handleOnResume() {
        foreground = true;
    }

    @Override
    protected void handleOnPause() {
        foreground = false;
    }

    static boolean isForeground() {
        return instance != null && foreground;
    }

    static void emit(JSONObject item) {
        SmsReaderPlugin p = instance;
        if (p == null) return;
        try {
            p.notifyListeners("smsReceived", new JSObject(item.toString()), true);
        } catch (Exception e) {
            // ignore
        }
    }

    /**
     * Android's "Restricted setting" state for Vela (Android 13+). For apps not installed by an app store, Android
     * blocks the SMS permission until the user picks App info > ⋮ > Allow restricted settings.
     * Vela only reads this; it can't and doesn't change it.
     * Returns "allowed", "restricted" or "unknown".
     */
    private String restrictedSettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return "allowed";
        try {
            android.app.AppOpsManager ops = (android.app.AppOpsManager) getContext().getSystemService(Context.APP_OPS_SERVICE);
            int mode = ops.unsafeCheckOpNoThrow("android:access_restricted_settings", android.os.Process.myUid(), getContext().getPackageName());
            if (mode == android.app.AppOpsManager.MODE_ALLOWED) return "allowed";
            if (mode == android.app.AppOpsManager.MODE_IGNORED || mode == android.app.AppOpsManager.MODE_ERRORED) return "restricted";
            // MODE_DEFAULT: decided by how Vela was installed.
            String src = installSource();
            return "store".equals(src) ? "allowed" : "restricted";
        } catch (Exception e) {
            // Some Android versions don't let an app read this op: judge by how Vela was installed.
            String src = installSource();
            return "store".equals(src) ? "allowed" : "unknown".equals(src) ? "unknown" : "restricted";
        }
    }

    /** How Vela was installed: "store", "file" (APK from a browser, chat app or file manager), "other" (e.g. a computer) or "unknown". */
    private String installSource() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return "unknown";
        try {
            int s = getContext().getPackageManager().getInstallSourceInfo(getContext().getPackageName()).getPackageSource();
            if (s == android.content.pm.PackageInstaller.PACKAGE_SOURCE_STORE) return "store";
            if (s == android.content.pm.PackageInstaller.PACKAGE_SOURCE_LOCAL_FILE || s == android.content.pm.PackageInstaller.PACKAGE_SOURCE_DOWNLOADED_FILE) return "file";
            return "other";
        } catch (Exception e) {
            return "unknown";
        }
    }

    private boolean declaresSms() {
        try {
            String[] req = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), PackageManager.GET_PERMISSIONS).requestedPermissions;
            if (req != null) for (String r : req) if (Manifest.permission.READ_SMS.equals(r)) return true;
        } catch (Exception e) {
            // fall through
        }
        return false;
    }

    /** Notification access (NotificationListenerService), granted by the user in Android. Not POST_NOTIFICATIONS. */
    private boolean notificationAccessGranted() {
        Context ctx = getContext();
        ComponentName me = BankNotificationListener.component(ctx);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            try {
                android.app.NotificationManager nm = (android.app.NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) return nm.isNotificationListenerAccessGranted(me);
            } catch (Exception e) {
                // fall back below
            }
        }
        String flat = Settings.Secure.getString(ctx.getContentResolver(), "enabled_notification_listeners");
        if (flat == null) return false;
        for (String part : flat.split(":")) if (me.flattenToString().equals(part)) return true;
        return false;
    }

    /** Whether this edition includes the listener (the standard edition leaves it out for Play Protect). */
    private boolean hasListener() {
        try {
            getContext().getPackageManager().getServiceInfo(BankNotificationListener.component(getContext()), 0);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** Bank and Passbook apps installed on this phone (found by package name), with the ones the user picked. */
    private JSArray bankApps() {
        JSArray out = new JSArray();
        Set<String> chosen = SmsStore.bankApps(getContext());
        Set<String> seen = new HashSet<>();
        try {
            PackageManager pm = getContext().getPackageManager();
            Intent launcher = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
            List<ResolveInfo> list = pm.queryIntentActivities(launcher, 0);
            for (ResolveInfo r : list) {
                String pkg = r.activityInfo == null ? null : r.activityInfo.packageName;
                String bank = BankSms.bankForApp(pkg);
                if (bank == null || !seen.add(pkg)) continue;
                JSObject o = new JSObject();
                o.put("pkg", pkg);
                o.put("name", String.valueOf(r.loadLabel(pm)));
                o.put("bank", bank);
                o.put("selected", chosen.contains(pkg));
                out.put(o);
            }
        } catch (Exception e) {
            // none found
        }
        return out;
    }

    /** Everything the Bank connections screen shows, read from Android itself. */
    @PluginMethod
    public void status(PluginCall call) {
        Context ctx = getContext();
        android.content.SharedPreferences p = SmsStore.prefs(ctx);
        JSObject ret = new JSObject();
        ret.put("sdk", Build.VERSION.SDK_INT);
        // What this edition of Vela includes (the standard edition leaves SMS out so Play Protect allows it).
        ret.put("smsAvailable", declaresSms());
        boolean listener = hasListener();
        ret.put("notifAvailable", listener);
        String smsPerm = "unavailable";
        if (declaresSms()) {
            try { smsPerm = getPermissionState("sms").toString().toLowerCase(); } catch (Exception e) { smsPerm = "denied"; }
        }
        ret.put("smsPermission", smsPerm);
        ret.put("smsEnabled", p.getBoolean("enabled", false));
        ret.put("paused", SmsStore.paused(ctx));
        String restricted = restrictedSettings();
        ret.put("restrictedSettings", restricted);
        boolean access = listener && notificationAccessGranted();
        boolean connected = access && BankNotificationListener.isConnected();
        // Access granted but Android hasn't bound the listener yet (e.g. right after granting): ask it to.
        if (access && !connected && p.getBoolean("notifEnabled", false)) BankNotificationListener.start(ctx);
        boolean requested = p.getLong("notifRequestedAt", 0) > 0;
        ret.put("notifEnabled", p.getBoolean("notifEnabled", false));
        ret.put("notifAccess", access);
        ret.put("listenerConnected", connected);
        ret.put("notifState", !listener ? "unavailable" : connected ? "connected" : access ? "disconnected"
            : "restricted".equals(restricted) ? "restricted" : requested ? "not_granted" : "not_requested");
        ret.put("notifRequestedAt", p.getLong("notifRequestedAt", 0));
        ret.put("hiddenAt", p.getLong("hiddenAt", 0));
        ret.put("apps", listener ? bankApps() : new JSArray());
        ret.put("installSource", installSource());
        ret.put("postNotifications", NotificationManagerCompat.from(ctx).areNotificationsEnabled());
        ret.put("lastDetected", p.getLong("lastDetected", 0));
        ret.put("pending", SmsStore.all(ctx).length());
        call.resolve(ret);
    }

    /** SMS tracking on or off (the receiver only acts when on). */
    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        SmsStore.prefs(getContext()).edit().putBoolean("enabled", on).apply();
        call.resolve();
    }

    /** Bank-app notification tracking on or off, and which bank apps to read. Separate from SMS tracking. */
    @PluginMethod
    public void setNotifTracking(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        Set<String> apps = new HashSet<>();
        try {
            JSArray arr = call.getArray("apps", new JSArray());
            for (int i = 0; i < arr.length(); i++) if (BankSms.bankForApp(arr.getString(i)) != null) apps.add(arr.getString(i));
        } catch (Exception e) {
            // keep empty
        }
        SmsStore.prefs(getContext()).edit().putBoolean("notifEnabled", on).putStringSet("bankApps", apps).apply();
        if (on) BankNotificationListener.start(getContext());
        call.resolve();
    }

    /** Android's Notification access screen for Vela (the user grants or removes access there). */
    @PluginMethod
    public void openNotificationAccess(PluginCall call) {
        SmsStore.prefs(getContext()).edit().putLong("notifRequestedAt", System.currentTimeMillis()).apply();
        Intent i;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS);
            i.putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, BankNotificationListener.component(getContext()).flattenToString());
        } else {
            i = new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS");
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
        } catch (Exception e) {
            Intent all = new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS");
            all.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try { getContext().startActivity(all); } catch (Exception e2) { call.reject("Couldn't open Notification access"); return; }
        }
        call.resolve();
    }

    @PluginMethod
    public void setPaused(PluginCall call) {
        SmsStore.prefs(getContext()).edit().putBoolean("paused", Boolean.TRUE.equals(call.getBoolean("paused", false))).apply();
        call.resolve();
    }

    /** Disconnect: stops both kinds of tracking and deletes every kept detection. */
    @PluginMethod
    public void disconnect(PluginCall call) {
        SmsStore.prefs(getContext()).edit().putBoolean("enabled", false).putBoolean("notifEnabled", false)
            .putBoolean("paused", false).putStringSet("bankApps", new HashSet<>()).apply();
        BankNotificationListener.stop();
        SmsStore.clear(getContext());
        call.resolve();
    }

    /** Deletes kept detections only (tracking stays as it is). */
    @PluginMethod
    public void deleteDetections(PluginCall call) {
        SmsStore.clear(getContext());
        call.resolve();
    }

    /**
     * The real status bar, navigation bar and display cutout sizes, in CSS pixels. Some WebView versions report
     * env(safe-area-inset-top) too large on Android 15+ (edge to edge), so the page uses these instead.
     */
    @PluginMethod
    public void insets(PluginCall call) {
        if (getActivity() == null) { call.reject("No activity"); return; }
        getActivity().runOnUiThread(() -> {
            JSObject ret = new JSObject();
            try {
                android.view.View decor = getActivity().getWindow().getDecorView();
                androidx.core.view.WindowInsetsCompat wi = androidx.core.view.ViewCompat.getRootWindowInsets(decor);
                float d = getContext().getResources().getDisplayMetrics().density;
                if (wi == null) { call.reject("Insets not ready"); return; }
                androidx.core.graphics.Insets i = wi.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars()
                    | androidx.core.view.WindowInsetsCompat.Type.displayCutout());
                ret.put("top", i.top / d);
                ret.put("bottom", i.bottom / d);
                ret.put("left", i.left / d);
                ret.put("right", i.right / d);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Couldn't read insets");
            }
        });
    }

    /** Vela's App info screen (permissions, and "Allow restricted settings" on Android 13+). */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't open App info");
        }
    }

    /** Android's notification settings for Vela (to turn on "Bank transaction detected" alerts). */
    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
        i.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            openAppSettings(call);
        }
    }

    /** Bank-looking messages in the inbox newer than `since` (ms). */
    @PluginMethod
    public void readInbox(PluginCall call) {
        if (!declaresSms() || getPermissionState("sms") != PermissionState.GRANTED) {
            call.reject("SMS permission not granted");
            return;
        }
        if (SmsStore.paused(getContext())) {
            JSObject ret = new JSObject();
            ret.put("messages", new JSArray());
            call.resolve(ret);
            return;
        }
        long since = call.getLong("since", 0L);
        int limit = call.getInt("limit", 200);
        JSArray out = new JSArray();
        Cursor c = null;
        try {
            c = getContext().getContentResolver().query(
                Uri.parse("content://sms/inbox"),
                new String[] { "_id", "address", "body", "date" },
                "date > ?",
                new String[] { String.valueOf(since) },
                "date DESC"
            );
            int n = 0;
            while (c != null && c.moveToNext() && n < limit) {
                String address = c.getString(1);
                String body = c.getString(2);
                long date = c.getLong(3);
                if (BankSms.parse(address, body) == null) continue; // only bank transactions leave this method
                String id = "sms-" + date + "-" + Math.abs(((address == null ? "null" : address) + body).hashCode());
                if (SmsStore.isHandled(getContext(), id)) continue; // added or ignored from the notification
                // The live SMS listener keeps the same message under the network's send time, not this inbox time:
                // match it by sender + text, so a message already waiting, added or ignored never comes a second time.
                JSONObject probe = new JSONObject();
                probe.put("address", address == null ? "" : address);
                probe.put("body", body == null ? "" : body);
                String sameText = SmsStore.textKey(probe);
                if (SmsStore.isHandled(getContext(), sameText) || SmsStore.hasText(getContext(), sameText)) continue;
                JSObject o = new JSObject();
                o.put("id", id);
                o.put("source", "sms");
                o.put("address", address == null ? "" : address);
                o.put("body", body);
                o.put("date", date);
                out.put(o);
                n++;
            }
        } catch (Exception e) {
            call.reject("Couldn't read messages: " + e.getMessage());
            return;
        } finally {
            if (c != null) c.close();
        }
        JSObject ret = new JSObject();
        ret.put("messages", out);
        call.resolve(ret);
    }

    /** Detections kept while Vela was closed. */
    @PluginMethod
    public void getPending(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            ret.put("messages", new JSArray(SmsStore.all(getContext()).toString()));
        } catch (Exception e) {
            ret.put("messages", new JSArray());
        }
        call.resolve(ret);
    }

    /** Added or ignored in Vela: forget them and remove their notifications. */
    @PluginMethod
    public void clearHandled(PluginCall call) {
        Set<String> ids = new HashSet<>();
        try {
            JSArray arr = call.getArray("ids", new JSArray());
            for (int i = 0; i < arr.length(); i++) ids.add(arr.getString(i));
        } catch (Exception e) {
            // nothing
        }
        SmsStore.remove(getContext(), ids);
        call.resolve();
    }
}
