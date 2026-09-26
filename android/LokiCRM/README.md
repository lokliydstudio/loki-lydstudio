# Loki CRM for Android

The website remains the source of truth. This Android app opens the private CRM at `https://www.lokilyd.no/crmplatform/` in a persistent WebView, provides a native tasks tab, and includes a home-screen widget. It uses the same approved Leon/Charles login as the website. No CRM password or session token is saved in the widget snapshot.

## Features

- Full CRM in a first-party WebView with persistent login, external links handed to Android, and a system file picker for CRM uploads.
- Native tasks tab: list, create, assign to Leon/Charles/both, complete/reopen, and refresh.
- Resizable home-screen widget with open-task count and up to four task titles. The widget refreshes when the app syncs and periodically when Android allows it. Android limits ordinary widget updates to no more than once every 30 minutes.
- Optional task-change notifications through an Android background job. The job asks the existing CRM API for task changes about every 15 minutes, subject to Android battery and network scheduling. This is **not real-time FCM push** and does not cover every CRM event.
- App data and widget snapshot are private to the Android app; Android backups are disabled. Notification text is hidden on the lock screen.

## Build and test

Open this directory in Android Studio or build with JDK 17+ and an Android SDK with API 36:

```sh
./gradlew assembleDebug
```

The debug APK is written to `app/build/outputs/apk/debug/app-debug.apk`. Install it on an Android test device with `adb install -r app/build/outputs/apk/debug/app-debug.apk`, then log in through the CRM tab using the normal emailed code. Add the **Loki CRM** widget from Android's widget picker. Turn on background task notifications in the app's **Innstillinger** tab if wanted.

The debug APK is for internal testing only. For wider distribution, create an Android release signing key and use Google Play internal testing (or another private enterprise distribution method). Do not commit signing keys, passwords, session cookies, or a Firebase service-account key.

## Limitations

- The app has been built and launched in a Pixel 9 emulator; the real login, uploads, widget refresh, and notifications still need testing on an authenticated Android device.
- Real-time push for all CRM events would require a Firebase project, FCM configuration in the app, and a server-side delivery integration. No Firebase keys or Google Play account have been configured here.
- A link-based email login opened in an external browser may not carry its browser session back into the app. Use the six-digit code in the app's CRM tab for reliable login.
