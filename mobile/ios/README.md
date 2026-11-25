# Vela for iPhone

This folder is the iPhone app. It is the same Vela web app as Android (`app.js`, `index.html`, `style.css`,
logos), inside a Capacitor 8 iOS shell, plus iPhone home-screen widgets.

## What works on iPhone, and what can't

| Feature | iPhone | Why |
|---|---|---|
| The whole app (Home, Activity, Plan, Insights, Settings, sync, Google sign-in) | Works | Same web app as Android |
| PIN lock and Face ID / Touch ID | Works | The biometric plugin supports iPhone |
| Bill reminders (notifications) | Works | Local notifications work on iPhone |
| Backup, CSV and PDF export | Works | Saved through the iPhone share sheet (Save to Files, AirDrop, mail) |
| Backup import | Works | Opens the iPhone Files picker |
| Home-screen widgets: balances, budget ring, bills calendar, goal rings, 7-day chart, quick add | Works | Built for iPhone in SwiftUI (WidgetKit), small, medium and large sizes |
| Eye button on widgets hides the amounts | Works | Needs iOS 17 or newer. Amounts start hidden, like on Android |
| Lock-screen widgets (balances, budget, bills) | Works | They follow the home-screen eye button |
| Widgets: one tap shows amounts, double tap opens Vela | Different | iPhone widgets can't tell a single tap from a double tap. On iPhone: tap the eye to show or hide amounts, tap anywhere else to open Vela |
| Small quick-add widget with three buttons | Different | A small iPhone widget is one button. Small opens a new expense; the medium size has Expense, Income and Transfer |
| Hide in screenshots | **Not possible** | iPhone doesn't let apps block screenshots or screen recording. Vela hides itself in the app switcher instead (black screen) |
| Reading bank SMS by itself | **Not possible** | Apple does not let any iPhone app read your text messages |
| Reading bank app (ePassbook) notifications | **Not possible** | Apple does not let an iPhone app read other apps' notifications |
| Adding a bank SMS | Works, by hand | Copy the bank SMS, then Settings > Check a bank SMS in Vela. Or use the Shortcuts action below. Vela always asks before adding |

In Vela's Settings on iPhone, the bank tracking card says this plainly. The SMS and bank-app switches are hidden,
so nothing claims to work when it can't.

### Sending bank SMS to Vela with Shortcuts (optional)

Vela adds a Shortcuts action called **Check a bank SMS in Vela**. This is Apple's own Shortcuts app, and you set it
up yourself, so Vela still never reads your messages on its own.

1. Open the **Shortcuts** app > **Automation** > **+** > **Message**.
2. Set **Sender** to your bank (for example ComBank), or **Message Contains** a word like `debited`.
3. Choose **Run Immediately**, then **Next** > **New Blank Automation**.
4. Add the action **Check a bank SMS in Vela**. For **Message text**, pick **Shortcut Input** (the message).
5. Done. When the bank SMS arrives, Vela gets a copy and shows it for review next time you open Vela.

Apple decides how Shortcuts automations behave. On some iOS versions the automation may ask before it runs.

## How the widgets get their figures

`app.js` builds the figures (`widgetData()`) and calls the `BalanceWidget` plugin, the same as on Android.
On iPhone the plugin (`App/VelaPlugins.swift`) saves that JSON in the App Group
`group.io.github.dinsara0611.vela` and asks the widgets to redraw. The widgets (`VelaWidgets/`) only read that
JSON. They never read Vela's own data.

## Build on a Mac

You need a Mac with Xcode 26 or newer, and Node.js 22.

```sh
cd mobile
npm ci
npm run sync:ios      # copies the web app into ios/App/App/public and updates the iOS plugins
open ios/App/App.xcodeproj
```

In Xcode pick an iPhone simulator and press Run. The simulator does not need an Apple account.

GitHub also builds the app on a Mac for every change in `mobile/ios` (`.github/workflows/ios-build.yml`). It builds
for the simulator and makes an unsigned archive, to prove it compiles. It has no signing and no secrets.

## Put it on your iPhone and TestFlight (needs your Apple Developer account)

Signing needs your own Apple Developer account (99 USD a year). Nothing for signing is stored in this repository,
and it never should be: no certificates, no profiles, no passwords.

1. In the Apple Developer website, under **Identifiers**:
   - Make an **App Group**: `group.io.github.dinsara0611.vela`.
   - Make an **App ID** `io.github.dinsara0611.vela` with the **App Groups** capability, and add that group.
   - Make an **App ID** `io.github.dinsara0611.vela.widgets` with **App Groups**, and add the same group.
2. In Xcode, open the project, click **App** in the left list, then **Signing & Capabilities**:
   - For the **App** target and the **VelaWidgetsExtension** target: tick **Automatically manage signing** and
     choose your **Team**.
   - Check that **App Groups** shows `group.io.github.dinsara0611.vela` ticked on both targets.
3. To run on your own iPhone: plug it in, pick it at the top of Xcode, press Run. On the phone, allow the
   developer in Settings > General > VPN & Device Management the first time.
4. For TestFlight:
   - In **App Store Connect**, make a new app with the bundle ID `io.github.dinsara0611.vela`.
   - In Xcode, pick **Any iOS Device**, then **Product > Archive**.
   - In the Organizer window, **Distribute App > App Store Connect > Upload**.
   - In App Store Connect, open **TestFlight**, and add yourself as a tester.
5. Every new upload needs a higher build number: raise **Build** (CURRENT_PROJECT_VERSION) for both targets. The
   version (MARKETING_VERSION) is 4.65.4, the same as Android.

Google sign-in uses the same return link as Android (`io.github.dinsara0611.vela://auth-callback`), which is
already allowed in Supabase.

## Not checked yet

Nothing here has run on a real iPhone yet (this was made on Windows). After the first install, please check:

- The top and bottom edges on an iPhone with a notch or Dynamic Island, light and dark theme.
- Typing in the add-transaction sheet: the keyboard should not cover the amount or the Save button.
- Each widget in small, medium and large, and the eye button.
- Face ID unlock, a bill reminder, and a backup export and import.
