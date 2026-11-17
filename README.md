# Vela

A phone-first expense and savings tracker that works in USD and LKR. It is a static Progressive Web App (plain HTML, CSS and JavaScript), hosted on GitHub Pages:

**https://dinsara0611.github.io/vela/**

- **Income & balance:** log expenses and income, see what's left this month.
- **Accounts:** cash, bank, card and mobile wallets with live balances, and transfers between them (even across currencies).
- **Any currency:** 17 currencies with live rates; show everything in the one you choose.
- **Receipt photos** on any expense, kept on the phone and backed up when signed in.
- **Fixed and variable expenses**: mark any expense Fixed (rent, internet, subscriptions) or Variable. Repeating fixed expenses live in Plan > Fixed. Each month Vela shows your income, your fixed expenses (paid and still due) and what's left, counting each fixed expense once per due date; also on Home, after saving income, for Vela AI and in the PDF report.
- **Amounts with commas everywhere**, including while typing (100000 shows as 100,000); small cards shrink the text before shortening a number.
- **Quick picks** with typical local prices (Sri Lanka, India, US, and scaled for other currencies), your own usual items learnt from history, ordered for the time of day (breakfast, lunch, tea, dinner), and auto-picked categories as you type.
- **Vela AI**: a real AI money assistant (Google Gemini, free tier) behind the `vela-ai` Supabase Edge Function, so the key stays on the server. Tell it “kottu 1200 and bus 100” and it prepares entries to add; ask anything about spending, budgets and saving, in English or Sinhala. Needs sign-in. Setup: `supabase_setup_guide.md`.
- **Price check**: a gentle warning when an amount is far above or below what you usually pay.
- **Calendar view** of a month's spending, day by day.
- **Payment status**: every payment you still owe (or money you're waiting for) is Upcoming, Due today, Overdue or Paid. "Mark as paid" first asks *Have you completed this payment?* (**Yes, mark as paid** / **Not yet**), then records the day you actually paid. Home shows a Payments card, and Vela pops up the overdue ones when it opens.
- **Reminders that stay** (Android): a notice the day before, an ongoing one on the due day and another once it's late. Opening the notice or the app doesn't clear them; only paying does.
- **Bank SMS tracking** (Settings › Bank connections, Android): debit and credit SMS from every bank and wallet on Vela's list (Commercial Bank, Sampath, HNB, BOC, People's Bank, NSB, Nations Trust, NDB, Seylan, DFCC, Pan Asia, Union Bank, Amana, Cargills Bank, HSBC, Standard Chartered, MCB, SDB, RDB, HDFC, LOLC, FriMi, eZ Cash, mCash) and, always with a review, from other named senders whose text is clearly about an account or card. A bank Vela hasn't read on this phone before is reviewed until 3 of its messages were confirmed unchanged; only then can it be added automatically. Payments to your own credit card are offered as a transfer, never as income. It only says *Connected* when Android has really allowed SMS access.
  - The app and the Android filter read the same sample messages in their tests (`tests/sms-corpus.tsv`); run the app tests with `node tests/run-headless.mjs` while the app is served on port 5510.
- **Your own logos**: for a shop Vela doesn't know, *Add a logo for this shop* (under the name in the entry form) takes a photo or screenshot, crops it to a square and shows it for that shop everywhere. Kept only on the phone and in backups.
- **Real logos**: shops, services and banks show their official app icon (bundled in `logos/`, fetched once by `scripts/fetch-logos.mjs` and checked by eye), so nothing is downloaded while you use Vela. Logos belong to their owners and only identify where money went.
  - Reads incoming bank SMS (and the last 3 days once, when turned on): amount (never the balance), debit or credit, date, time, reference, shop, card/account last 4 and currency. Works out card and online payments, ATM withdrawals (moved to Cash), transfers (or *between my own accounts*, recorded as a transfer), bank charges, refunds (lower the original purchase) and reversals (remove it). Ignores OTPs, failed or declined payments, login and security alerts, announcements, promotions, balance messages and reminders.
  - The *Bank transaction detected* notification has **Add** and **Ignore** buttons (the phone must be unlocked); a possible repeat, a card payment or a reversal opens the review instead. Messages from a plain phone number are read only when they clearly talk about an account, always for review, never added automatically.
  - The review pop-up shows *Confirm & add*, *Edit details* or *Ignore*. Nothing changes your balances until you confirm (unless you turn on *Add confident ones automatically*).
  - No duplicates: the same SMS read twice (live and from the inbox), a resent SMS, the same reference, or a shared/pasted copy is kept once. Two real purchases with the same amount are never merged.
  - While Vela is closed Android still delivers SMS to Vela, which keeps them encrypted (Android Keystore) and shows *Bank transaction detected* (no amounts on the lock screen). Tapping it opens the review. Kept detections survive restarts and are excluded from backups.
  - Pause, Disconnect (stops tracking and deletes waiting detections) and Delete detection records. Nothing is sent to Vela AI or any server; Vela never asks for bank passwords, PINs or codes.
  - Without SMS access you can share a bank SMS to Vela from your Messages app, or paste it (*Check a bank SMS*).
  - **Android editions** (same app id and data):
    - **Vela** (`Vela-<version>.apk`, standard): installs from WhatsApp, a browser or a file manager. Google Play Protect's *enhanced fraud protection* blocks apps installed that way when they request SMS access, so this edition leaves SMS out: share or paste bank SMS.
    - **Vela Full** (`Vela-<version>-full.apk`): automatic bank SMS detection. Install it from a computer over USB (`adb install -r Vela-<version>-full.apk`). Android then treats SMS as a *restricted setting*: App info › ⋮ › *Allow restricted settings*, then Permissions › SMS › Allow (Vela shows these steps).
    - **Play** (`Vela-<version>-play.aab`): for Google Play. SMS reading on Play needs Google to approve an *SMS-based money management* declaration first (see `PLAY_RELEASE.md`); until then it works like the standard edition.
  - Build (Java 21): `cd mobile && npm run sync && cd android && gradlew assembleRelease bundlePlayRelease` (R8 shrinking is on for release builds).
- **Activity:** every entry by month, with search, category filters and status filters (Paid, Unpaid, Upcoming, Overdue, From bank).
- **Plan:** budgets per category, bills and subscriptions that log themselves (with reminders on Android), savings goals with target dates, and money you lent or borrowed.
- **Insights:** income vs spending, savings rate, daily average, where money went and came from.
- **Reports:** monthly PDF report and CSV export of every entry; JSON backup and restore.
- **Your own categories** with icons and colours.
- **App lock:** 4-digit PIN, plus fingerprint on Android.
- Live exchange rates (open.er-api.com), or set your own per currency.
- Works offline and installs to the home screen.
- Optional sign-in and cloud sync with Supabase (see `supabase_setup_guide.md`).

The design system (tokens, components, rules) is documented in [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md).

## Files

| File | Purpose |
|---|---|
| `index.html` | App markup, icon sprite, sheets and onboarding |
| `style.css` | Design tokens and all component styles |
| `app.js` | State, rendering, charts, Supabase sync |
| `sw.js` | Service worker (offline cache) |
| `manifest.json` | PWA manifest |

## Run locally

```bash
python -m http.server 5510
```

Then open http://localhost:5510.

## Deploying updates (GitHub Pages)

GitHub Pages serves the `main` branch from the repository root. Merging changes into `main` publishes them within a minute or two.

When you change `style.css` or `app.js`, bump the `?v=` number in `index.html` and the matching entries plus `VERSION` in `sw.js`, so installed copies pick up the new files.

## Installing on a phone

- **iPhone (Safari):** Share → *Add to Home Screen*.
- **Android (Chrome):** ⋮ menu → *Install app*.

## Android app (APK)

`mobile/` wraps the same web app in a native Android shell with [Capacitor 6](https://capacitorjs.com). Fonts, Chart.js and supabase-js are bundled, so the app works offline. Native extras: splash screen, adaptive icon, status bar that follows the theme, haptics, share-sheet backups, and Google sign-in through a Chrome tab with a deep link back to the app (`io.github.dinsara0611.vela://auth-callback`).

Requirements: Node 18+, JDK 17, Android SDK (platform 34). Then:

```bash
cd mobile
npm install
npm run apk
```

The signed APK is written to `mobile/android/app/build/outputs/apk/release/app-release.apk`.

- `npm run sync` copies the latest `index.html`, `style.css` and `app.js` into the app (run it after every web change).
- `npm run icons` regenerates the launcher icon and splash from `scripts/make-icons.mjs`.
- Signing: release builds use `mobile/signing/vela-release.jks` with passwords in `mobile/signing/keystore.properties`. Both are git-ignored. **Back them up somewhere safe**: Android only installs updates signed with the same key.
- Before each new release, raise `versionCode` in `mobile/android/app/build.gradle`.

## Publishing to Google Play

Build an app bundle with `cd mobile/android && gradlew.bat bundleRelease` and upload `app/build/outputs/bundle/release/app-release.aab` in the Google Play Console. Google Play currently requires a newer target SDK than this Capacitor 6 build uses (34), so upgrade to Capacitor 7+ (needs JDK 21) before publishing there.
