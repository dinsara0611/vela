package io.github.dinsara0611.vela;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** The app hands the home-screen widget its figures (already formatted) and asks it to redraw. */
@CapacitorPlugin(name = "BalanceWidget")
public class BalanceWidgetPlugin extends Plugin {
    @PluginMethod
    public void update(PluginCall call) {
        String data = call.getString("data");
        if (data == null || data.length() > 20000) { call.reject("no data"); return; }
        getContext().getSharedPreferences(BalanceWidget.PREFS, android.content.Context.MODE_PRIVATE)
            .edit().putString(BalanceWidget.KEY_DATA, data).apply();
        BalanceWidget.refreshAll(getContext());
        call.resolve();
    }

    /** Signed out or data cleared: the widget forgets the figures. */
    @PluginMethod
    public void clear(PluginCall call) {
        getContext().getSharedPreferences(BalanceWidget.PREFS, android.content.Context.MODE_PRIVATE)
            .edit().remove(BalanceWidget.KEY_DATA).apply();
        BalanceWidget.refreshAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("hidden", BalanceWidget.isHidden(getContext()));
        call.resolve(r);
    }
}
