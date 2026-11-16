# Vela release rules (R8).
# Capacitor and its plugins bring their own keep rules (consumer rules); these cover Vela's own native code.

# Vela's plugin, SMS receiver and helpers are called by Capacitor (reflection) and by Android (manifest).
-keep class io.github.dinsara0611.vela.** { *; }

# Capacitor core and the WebView bridge.
-keep class com.getcapacitor.** { *; }
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod

# Methods called from JavaScript in the WebView.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Readable crash reports without exposing names.
-keepattributes SourceFile, LineNumberTable
-renamesourcefileattribute SourceFile
