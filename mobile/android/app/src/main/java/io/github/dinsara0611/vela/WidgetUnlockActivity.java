package io.github.dinsara0611.vela;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;

/**
 * A see-through screen that asks for the fingerprint (or the phone's PIN, pattern or password) before a widget shows
 * its amounts. Android's own dialog does the check: Vela never sees the fingerprint or the PIN. Cancelled or failed:
 * the amounts stay hidden. A phone with no screen lock at all has nothing to check with, so the amounts show (anyone
 * holding that phone can open Vela anyway).
 */
public class WidgetUnlockActivity extends AppCompatActivity {
    static final String EXTRA_KIND = "kind";
    private static final int AUTH = BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;

    static PendingIntent intent(Context c, String kind, int code) {
        Intent i = new Intent(c, WidgetUnlockActivity.class).putExtra(EXTRA_KIND, kind)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS);
        return PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private String kind;
    private boolean asked;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        kind = getIntent().getStringExtra(EXTRA_KIND);
        if (kind == null) { finish(); return; }
        if (state != null && state.getBoolean("asked")) return; // turned or recreated: the dialog is still up
        ask();
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle out) {
        super.onSaveInstanceState(out);
        out.putBoolean("asked", asked);
    }

    private void ask() {
        asked = true;
        int can = BiometricManager.from(this).canAuthenticate(AUTH);
        if (can == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED) {
            // No fingerprint, face, PIN, pattern or password on this phone: nothing to check with.
            show();
            return;
        }
        if (can != BiometricManager.BIOMETRIC_SUCCESS) {
            Toast.makeText(this, "Open Vela to see your amounts", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }
        BiometricPrompt prompt = new BiometricPrompt(this, ContextCompat.getMainExecutor(this), new BiometricPrompt.AuthenticationCallback() {
            @Override
            public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                show();
            }

            @Override
            public void onAuthenticationError(int code, @NonNull CharSequence msg) {
                finish(); // cancelled, too many tries, or the screen turned off: stay hidden
            }
        });
        prompt.authenticate(new BiometricPrompt.PromptInfo.Builder()
            .setTitle("Show your amounts")
            .setSubtitle("Vela widget")
            .setAllowedAuthenticators(AUTH)
            .build());
    }

    private void show() {
        getSharedPreferences(BalanceWidget.PREFS, Context.MODE_PRIVATE).edit().putBoolean(BalanceWidget.hiddenKey(kind), false).apply();
        BalanceWidget.refreshAll(this);
        finish();
    }

    @Override
    public void finish() {
        super.finish();
        overridePendingTransition(0, 0);
    }
}
