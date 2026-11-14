# Loki CRM for Android

The website remains the source of truth. This Android app opens the private CRM at `https://www.lokilyd.no/crmplatform/` in a persistent WebView, provides a native tasks tab, and includes a home-screen widget. It uses the same approved Leon/Charles login as the website. No CRM password or session token is saved in the widget snapshot.

## Features

- Full CRM in a first-party WebView with persistent login, external links handed to Android, and document/camera selection for CRM uploads.
- Native tasks tab: list, create, assign to Leon/Charles/both, complete/reopen, and refresh.
- Resizable home-screen widget with open-task count and up to four task titles. The widget refreshes when the app syncs and periodically when Android allows it. Android limits ordinary widget updates to no more than once every 30 minutes.
- Optional task-change notifications through an Android background job. The job asks the existing CRM API for task changes about every 15 minutes, subject to Android battery and network scheduling. This is **not real-time FCM push** and does not cover every CRM event.
- App data and widget snapshot are private to the Android app; Android backups are disabled. Notification text is hidden on the lock screen.

## Build and test

Open this directory in Android Studio or build with JDK 17+ and an Android SDK with API 36:

```sh
./gradlew assembleDebug
```

Generated build files are kept outside synced Documents folders, under Gradle's user home. Find the debug APK with `find "${GRADLE_USER_HOME:-$HOME/.gradle}/loki-crm-build" -path '*/outputs/apk/debug/app-debug.apk' -print`, then install it on an Android test device with `adb install -r /path/to/app-debug.apk`. Log in through the CRM tab using the normal emailed code. Add the **Loki CRM** widget from Android's widget picker. Turn on background task notifications in the app's **Innstillinger** tab if wanted.

Release builds use an upload key supplied only through environment variables:

```sh
export LOKI_ANDROID_KEYSTORE=/secure/path/LokiCRM-Android-Upload.jks
export LOKI_ANDROID_STORE_PASSWORD='...'
export LOKI_ANDROID_KEY_ALIAS=lokicrm-upload
export LOKI_ANDROID_KEY_PASSWORD='...'
./gradlew lintRelease assembleRelease bundleRelease
```

The signed APK can be installed directly for private use. The signed AAB is the package for Google Play internal testing or a later Play Store release. Keep the upload key backed up securely: future Android updates must use the same key. Do not commit signing keys, passwords, session cookies, or Firebase credentials.

Version 1.1 (version code 2) was built, signature-verified, installed and cold-launched on a Pixel 9 emulator. The production CRM login, native tasks screen, private FileProvider and package metadata were checked without fatal Android runtime errors.

## Limitations

- Login and authenticated CRM data still require Leon or Charles to enter their emailed code on the physical Android device; no production login code is stored in the app or build.
- Real-time push for all CRM events would require a Firebase project, FCM configuration in the app, and a server-side delivery integration. No Firebase keys or Google Play account have been configured here.
- A link-based email login opened in an external browser may not carry its browser session back into the app. Use the six-digit code in the app's CRM tab for reliable login.
