# Loki CRM for iPhone

The website remains the source of truth. This app displays the complete private CRM at `https://www.lokilyd.no/crmplatform/` in a persistent `WKWebView`, adds a native tasks tab, and includes a WidgetKit extension showing a recent snapshot of open tasks. The app and widget share only a small task snapshot via an App Group; the widget does not store CRM credentials.

## What works now

- The complete website opens inside the app with its existing email-code login. Its persistent cookie is kept in the app's private WebKit store.
- The native tasks tab can read, create, and complete the same tasks used by the website.
- A small, medium, or large home-screen widget shows the most recently synced open tasks. Tapping it opens the native tasks tab. The snapshot is refreshed when the app uses the CRM API and when iOS grants a background notification wakeup; iOS does not guarantee immediate widget refresh while the app is closed.
- A native APNs registration endpoint and delivery path exist in the website backend. They are inactive until Apple signing and APNs credentials are configured.
- Logging out of the CRM revokes registered native push devices for that owner. Opening the app and signing in again registers an opted-in device again.

## Build

Open `LokiCRM.xcodeproj` with Xcode 26. The project is generated from `project.yml` with XcodeGen and uses bundle IDs `no.lokilyd.crm` and `no.lokilyd.crm.widget`, plus App Group `group.no.lokilyd.crm`. The configured Apple team is `M9XU3X5VZ6`. The simulator build can be verified without signing:

```sh
xcodebuild -project LokiCRM.xcodeproj -scheme LokiCRM -configuration Debug -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17 Pro' CODE_SIGNING_ALLOWED=NO build
```

The App Store icon uses the supplied Loki mark on a fully opaque lime background, as required by Apple. The older transparent icon is retained in the asset folder as a source reference, but is not assigned to the app icon set.

## TestFlight

Version 1.0 (build 2) was uploaded to App Store Connect on September 26, 2026 and assigned to the private internal group **Leon**. On Leon's iPhone, install Apple's TestFlight app, open the invitation sent to his Apple account (or sign in to TestFlight with that account), and install **Loki CRM** there. App Store Connect showed the tester as **Invited** when this build was assigned; installation and on-device behavior still require confirmation on the iPhone.

For a future build, increment `CURRENT_PROJECT_VERSION` in `project.yml`, regenerate the Xcode project with `xcodegen generate --spec project.yml`, archive it, and export/upload using `ExportOptions-TestFlight.plist`. App Store Connect API credentials, distribution certificate, and profiles are stored outside this repository on the signing Mac.

## To use on a physical iPhone

1. Install build 2 using the private TestFlight invitation sent to Leon's Apple account.
2. Log in to the CRM in the app once. On the home screen, long-press, select **Add Widget**, and choose **Loki Gjøreliste**.
3. To enable native push, create an APNs authentication key for this app in the Apple Developer account. Store its values as Vercel secrets named `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY` (the contents of the `.p8` key), and `APNS_BUNDLE_ID=no.lokilyd.crm`. Redeploy the website backend, then activate notifications in the app's Settings tab. Never commit the `.p8` file or paste it into the website frontend.

The signed TestFlight build is available, but the APNs key and live-device push delivery still need to be completed. Simulator builds cannot prove physical push delivery.
