package io.github.dinsara0611.vela;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Leave the launch (splash) theme for Vela's normal theme: no title bar, plain dark background.
        // Without this the launch theme stayed, which added Android's grey "Vela" title bar over the page.
        setTheme(R.style.AppTheme_NoActionBar);
        // Vela's own plugin: bank SMS tracking.
        registerPlugin(SmsReaderPlugin.class);
        // Android 15+ draws apps edge to edge; Vela's layout pads for the status and navigation bars.
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);
        // The page scrolls by touch like any app screen: no scrollbar drawn down the side.
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView web = getBridge().getWebView();
            web.setVerticalScrollBarEnabled(false);
            web.setHorizontalScrollBarEnabled(false);
        }
    }
}
