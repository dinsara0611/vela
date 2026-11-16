package io.github.dinsara0611.vela;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import org.json.JSONObject;

/** Sees each incoming SMS; bank transactions are kept for Vela and shown as a notification or pop-up. */
public class SmsReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null || !Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
        if (!SmsReaderPlugin.isEnabled(ctx)) return;
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
            item.put("id", "sms-" + date + "-" + Math.abs((address + text).hashCode()));
            item.put("address", address == null ? "" : address);
            item.put("body", text);
            item.put("date", date);
            SmsStore.add(ctx, item);
            if (SmsReaderPlugin.isForeground()) SmsReaderPlugin.emit(item);
            else SmsStore.notify(ctx, item, info);
        } catch (Exception e) {
            // Never crash on an odd message.
        }
    }
}
