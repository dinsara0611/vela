package io.github.dinsara0611.vela;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import org.json.JSONObject;

/**
 * Sees each incoming SMS (Android delivers it even when Vela is closed or after a restart). Only when bank SMS
 * tracking is on and not paused; only bank transactions are kept, everything else is dropped unread.
 */
public class SmsReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null || !Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
        if (!SmsStore.smsOn(ctx)) return;
        SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (parts == null || parts.length == 0 || parts[0] == null) return;
        String address = parts[0].getOriginatingAddress();
        long date = parts[0].getTimestampMillis();
        StringBuilder body = new StringBuilder();
        for (SmsMessage p : parts) if (p != null) body.append(p.getMessageBody());
        String text = body.toString();
        BankSms.Info info = BankSms.parse(address, text);
        if (info == null) return;
        try {
            JSONObject item = new JSONObject();
            item.put("id", "sms-" + date + "-" + Math.abs(((address == null ? "null" : address) + text).hashCode()));
            item.put("source", "sms");
            item.put("address", address == null ? "" : address);
            item.put("body", text);
            item.put("date", date);
            boolean merged = SmsStore.alreadyNotified(ctx, item, info);
            if (!SmsStore.add(ctx, item)) return;
            if (SmsReaderPlugin.isForeground()) SmsReaderPlugin.emit(item);
            else if (!merged) SmsStore.notify(ctx, item, info);
        } catch (Exception e) {
            // Never crash on an odd message.
        }
    }
}
