# Putting Vela on Google Play (internal testing)

Why: Android blocks Notification access and SMS for apps that weren't installed from an app store
("Restricted setting"). An app installed from Google Play doesn't get that block, so bank
notification tracking can be switched on normally. This guide gets Vela onto Play as a private
test app that only you (and people you add) can install.

The upload file is `Vela-<version>-play.aab` (the **play** edition): ComBank **app notifications**
plus share/paste. It does **not** read SMS, because Google Play only allows SMS access after
Google approves a Permissions Declaration (see the end of this guide).

---

## 1. Create the developer account (you, once)

1. Go to <https://play.google.com/console/signup> with your Google account.
2. Choose **Personal** account, pay the one-time **US$25** fee, and verify your identity and
   phone number as asked. Verification can take a few days.
3. New personal accounts must run a **closed test with at least 12 testers for 14 days** before
   the app can go public. Internal testing (step 3) works straight away for you.

## 2. Create the app

1. Play Console › **Create app**
   - App name: **Vela**
   - Default language: English
   - App or game: **App** · Free or paid: **Free**
   - Accept the declarations.

## 3. Internal testing release

1. **Testing › Internal testing › Testers**: create a list and add your Gmail address.
2. **Create new release**:
   - Play App Signing: **Use Google-generated key** (recommended). Your own key in
     `mobile/signing/` stays the **upload key**. Keep it safe; you need it for every update.
   - Upload `Vela-<version>-play.aab`.
   - Release name: the version, e.g. `4.18.0`. Release notes: "First test build".
3. **Save › Review release › Start rollout to Internal testing**.
4. Back on **Testers**, copy the **join link**, open it on your phone, accept, then install Vela
   from the Play Store link. Uninstall the USB version first: with Play App Signing the Play
   version is signed by Google, so it can't install over the USB one. Sign in to Vela afterwards
   to bring your synced data back.

## 4. App content (Policy › App content)

Answer these; the text in quotes can be pasted.

| Section | Answer |
|---|---|
| Privacy policy | `https://dinsara0611.github.io/vela/privacy.html` |
| App access | "All features available without special access. Sign-in is optional (email or Google)." If asked for login details: create a test email account for reviewers. |
| Ads | No ads |
| Content rating | Questionnaire › Category **Utility/Productivity**, answer No to everything → rated Everyone |
| Target audience | 18 and over (finance app) |
| News app | No |
| Government app | No |
| Financial features | **Personal finance / budgeting / expense tracking**. Does not provide loans, banking, payments, crypto or investment services. |
| Health | No |
| Data safety | See below |
| Account deletion | URL: `https://dinsara0611.github.io/vela/privacy.html#delete` · in-app: Settings › profile › **Delete my account and data** |

### Data safety answers

- Does your app collect or share user data? **Yes, collects** (only when the user signs in to sync, or uses Vela AI). **Not shared** with third parties for their own use.
- Is all data encrypted in transit? **Yes**
- Can users request deletion? **Yes** (in-app and via the URL above)
- Data types collected:
  - **Personal info › Email address** (account, sign-in) — required for sync, not optional if you sign in
  - **Personal info › Name** (optional profile name)
  - **Financial info › Purchase history / Other financial info** — the entries you record and sync (optional, only when signed in). Purpose: **App functionality**.
  - **Photos** — receipt photos you attach, if synced (optional). Purpose: App functionality.
  - **App activity › Other user-generated content** — Vela AI questions (optional). Purpose: App functionality. Processed by Google Gemini through Vela's server.
- Bank notifications: processed **on the device only** and not collected (they never leave the phone), so they are not declared as collected.

## 5. Notification access (no form, but Google checks it)

Google Play doesn't have a declaration form for Notification access, but its User Data policy
requires a **prominent disclosure and consent** before asking. Vela does this: turning on
Bank notification tracking shows what is read and why, and only opens Android settings after
"I agree". Mention it in the store description:

> Optional: Vela can read transaction notifications from the Commercial Bank app you choose, on
> your phone, to suggest entries you confirm. Nothing is sent anywhere.

## 6. Building a new upload file

```
cd mobile
npm run sync
cd android
gradlew.bat bundlePlayRelease
```

The file is `mobile/android/app/build/outputs/bundle/playRelease/app-play-release.aab`.
Every new upload needs a higher `versionCode` (in `mobile/android/app/build.gradle`).

## 7. Later: SMS on Google Play

READ_SMS / RECEIVE_SMS are restricted on Play. To add SMS reading to the Play version:
1. Build with SMS (the `full` edition) and, when uploading, fill in **App content ›
   Sensitive permissions › SMS and Call Log** declaration.
2. Choose the exception **"SMS-based money management"** and explain: reads bank transaction
   SMS on the device to suggest expense and income entries the user confirms; nothing is uploaded.
3. Provide a short video showing the feature and the consent screen.
4. Google may approve or reject; approval isn't guaranteed. Until then, ComBank app
   notifications plus share/paste cover the same transactions.

## 8. What must still be tested on the phone (after installing from Play)

- Bank notification tracking: grant Notification access → status shows **Connected**.
- A real small ComBank transaction → "Bank transaction detected" → Confirm & add.
- Same with Vela closed; after a phone restart; access turned off and on again.
