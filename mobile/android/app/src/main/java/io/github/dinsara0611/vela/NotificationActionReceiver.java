package io.github.dinsara0611.vela;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import java.util.Collections;

/**
 * "Ignore" on a "Bank transaction detected" notification: forgets that detection and removes the notification,
 * without opening Vela. Only Vela's own notifications can send this (the receiver isn't exported).
 */
public class NotificationActionReceiver extends BroadcastReceiver {
    static final String IGNORE = "io.github.dinsara0611.vela.IGNORE_DETECTION";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null || !IGNORE.equals(intent.getAction())) return;
        String id = intent.getStringExtra("id");
        if (id == null || id.isEmpty()) return;
        SmsStore.remove(ctx, Collections.singleton(id));
    }
}
