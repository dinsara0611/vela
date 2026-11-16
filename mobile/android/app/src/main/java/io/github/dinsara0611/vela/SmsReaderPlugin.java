package io.github.dinsara0611.vela;

import android.Manifest;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Bank SMS for Vela: reads recent bank messages, hands over the ones that arrived while Vela was closed,
 * and tells the app about new ones while it is open. Messages never leave the phone.
 */
@CapacitorPlugin(
    name = "SmsReader",
    permissions = { @Permission(alias = "sms", strings = { Manifest.permission.READ_SMS, Manifest.permission.RECEIVE_SMS }) }
)
public class SmsReaderPlugin extends Plugin {
    private static SmsReaderPlugin instance;
    private static volatile boolean foreground = false;
    private static final String PREFS = "vela_sms";

    @Override
    public void load() {
        instance = this;
        foreground = true;
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

    static boolean isEnabled(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("enabled", false);
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

    /** Turns tracking on or off (the receiver only acts when on). */
    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("enabled", on).apply();
        call.resolve();
    }

    /** Bank-looking messages in the inbox newer than `since` (ms). */
    @PluginMethod
    public void readInbox(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            call.reject("SMS permission not granted");
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
                if (BankSms.parse(address, body) == null) continue;
                JSObject o = new JSObject();
                o.put("id", "sms-" + date + "-" + Math.abs(((address == null ? "null" : address) + body).hashCode()));
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

    /** Messages that arrived while Vela was closed. */
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
