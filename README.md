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
- **Activity:** every entry by month, with search and category filters.
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
