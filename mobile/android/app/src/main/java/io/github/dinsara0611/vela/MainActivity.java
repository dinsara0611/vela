package io.github.dinsara0611.vela;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Vela's own plugin: bank SMS tracking.
        registerPlugin(SmsReaderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
