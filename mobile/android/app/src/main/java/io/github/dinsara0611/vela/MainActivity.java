package io.github.dinsara0611.vela;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Vela's own plugin: bank SMS and bank-app notification tracking.
        registerPlugin(SmsReaderPlugin.class);
        // Android 15+ draws apps edge to edge; Capacitor's SystemBars passes the bar sizes to the page
        // (env(safe-area-inset-*)), which Vela's layout already uses.
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);
    }
}
