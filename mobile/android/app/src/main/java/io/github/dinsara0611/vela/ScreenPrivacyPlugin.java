package io.github.dinsara0611.vela;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Screen privacy, like banking apps: with it on, Android shows Vela as a black screen in screenshots,
 * screen recordings, the recent-apps view and Circle to Search (FLAG_SECURE). On by default; the choice is
 * kept so it applies from the first frame, before the page has loaded.
 */
@CapacitorPlugin(name = "ScreenPrivacy")
public class ScreenPrivacyPlugin extends Plugin {
    private static final String PREFS = "vela_privacy";
    private static final String KEY = "secure_screen";

    static boolean isOn(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY, true);
    }

    static void apply(Activity activity, boolean on) {
        if (activity == null) return;
        if (on) activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        else activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
    }

    @PluginMethod
    public void get(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("on", isOn(getContext()));
        call.resolve(ret);
    }

    @PluginMethod
    public void set(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", true));
        SharedPreferences.Editor editor = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        editor.putBoolean(KEY, on).apply();
        Activity activity = getActivity();
        if (activity != null) activity.runOnUiThread(() -> apply(activity, on));
        JSObject ret = new JSObject();
        ret.put("on", on);
        call.resolve(ret);
    }
}
