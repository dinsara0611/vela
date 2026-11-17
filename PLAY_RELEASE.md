# Putting Vela on Google Play

Why: on your phone, Android treats SMS access for an app installed from a file or a computer as a
"Restricted setting". Apps from Google Play don't get that block. But Google Play itself only lets an
app read SMS after Google approves a **Permissions Declaration** for it. So there are two steps:

1. **Now:** publish the **play** edition (`Vela-<version>-play.aab`). It has no SMS permission, so it can
   be uploaded straight away. Bank SMS are added by sharing or pasting them into Vela.
2. **Then:** ask Google for SMS access (section 7). If Google approves, upload the **full** edition
   (automatic bank SMS detection) as the next release.

---

## 1. Create the developer account (you, once)

1. Go to <https://play.google.com/console/signup> with your Google account.
2. Choose **Personal** account, pay the one-time **US$25** fee, and verify your identity and phone
   number as asked. Verification can take a few days.
3. New personal accounts must run a **closed test with at least 12 testers for 14 days** before the app
   can go public. Internal testing (step 3) works straight away for you.

## 2. Create the app

Play Console › **Create app** › name **Vela**, English, **App**, **Free**, accept the declarations.

## 3. Internal testing release

1. **Testing › Internal testing › Testers**: create a list and add your Gmail address.
2. **Create new release**:
   - Play App Signing: **Use Google-generated key** (recommended). Your key in `mobile/signing/` stays
     the **upload key**. Keep it and its password safe; every update needs it.
   - Upload `Vela-<version>-play.aab`. Release name: the version, e.g. `4.19.0`.
3. **Save › Review release › Start rollout to Internal testing**.
4. On **Testers**, copy the **join link**, open it on your phone, accept, and install Vela from Play.
   Uninstall the USB/WhatsApp version first (Play signs with Google's key, so it can't install over it).
   Sign in to Vela afterwards to bring back your synced data.

## 4. App content (Policy › App content)

| Section | Answer |
|---|---|
| Privacy policy | `https://dinsara0611.github.io/vela/privacy.html` |
| App access | All features available without special access. Sign-in is optional (email or Google). |
| Ads | No ads |
| Content rating | Category **Utility/Productivity**, answer No to everything |
| Target audience | 18 and over |
| News / Government / Health app | No |
| Financial features | **Personal finance / budgeting / expense tracking**. No loans, banking, payments, crypto or investments. |
| Data safety | See below |
| Account deletion | URL `https://dinsara0611.github.io/vela/privacy.html#delete` · in-app: Settings › profile › **Delete my account and data** |

### Data safety answers

- Collects data? **Yes** (only when the user signs in to sync, or uses Vela AI). Shared with third parties? **No**.
- Encrypted in transit? **Yes**. Users can request deletion? **Yes**.
- Data types:
  - **Personal info › Email address** (sign-in), **Name** (optional profile name)
  - **Financial info › Other financial info**: entries the user records and syncs. Purpose: App functionality.
  - **Photos**: receipt photos, if synced. Purpose: App functionality.
  - **App activity › Other user-generated content**: Vela AI questions. Purpose: App functionality.
- Bank SMS (shared/pasted, or read in the full edition): processed **on the device only**, never uploaded,
  so not "collected". The play edition has no SMS permission.

## 5. Before every upload: deploy the account-deletion function

```
npx supabase functions deploy delete-account --project-ref qtgkbpfqrcczrdmhglhq
```

## 6. Building a new upload file

Needs Java 21 (Capacitor 8, Android 16 / API 36 target, as Play requires since 31 Aug 2026).

```
set JAVA_HOME=C:\Program Files\Microsoft\jdk-21.0.13.21-hotspot
cd mobile
npm run sync
cd android
gradlew.bat bundlePlayRelease
```

The file is `mobile/android/app/build/outputs/bundle/playRelease/app-play-release.aab`.
Every upload needs a higher `versionCode` (in `mobile/android/app/build.gradle`).

## 7. Asking Google for SMS access (automatic bank SMS on Play)

1. Build the full edition as a bundle: `gradlew.bat bundleFullRelease`
   (`app/build/outputs/bundle/fullRelease/app-full-release.aab`).
2. Upload it to **Internal testing** (a new release). Play Console then asks for the
   **Permissions Declaration Form** for SMS (Policy › App content › Sensitive app permissions).
3. Core functionality: choose **SMS-based money management** ("apps that track and manage budget").
4. Explain: *Vela reads bank transaction SMS (debit and credit alerts) on the device to suggest expense and income
   entries, which the user confirms. OTPs and personal messages are ignored. Nothing is uploaded.*
5. Attach a short screen recording: turning on SMS tracking, the explanation, the permission dialog,
   and a detected transaction being confirmed.
6. Google approves or rejects; approval isn't guaranteed and can take a few days. If rejected, keep the
   play edition (share/paste).

## 8. What to test on the phone after installing from Play

- Share a bank SMS (any bank) from Messages to Vela → review → Confirm & add.
- Paste one in Settings › Bank connections › Check a bank SMS.
- If the full edition is approved: turn on SMS tracking, allow SMS, receive a real bank SMS with Vela
  open and with Vela closed; check the "Bank transaction detected" notification opens the review.
