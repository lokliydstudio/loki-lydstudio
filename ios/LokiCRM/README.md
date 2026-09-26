# Loki CRM for iPhone

The website remains the source of truth. This app displays the complete private CRM at `https://www.lokilyd.no/crmplatform/` in a persistent `WKWebView`, adds a native tasks tab, and includes a WidgetKit extension showing a recent snapshot of open tasks. The app and widget share only a small task snapshot via an App Group; the widget does not store CRM credentials.

## What works now

- The complete website opens inside the app with its existing email-code login. Its persistent cookie is kept in the app's private WebKit store.
- The native tasks tab can read, create, and complete the same tasks used by the website.
- A small, medium, or large home-screen widget shows the most recently synced open tasks. Tapping it opens the native tasks tab. The snapshot is refreshed when the app uses the CRM API and when iOS grants a background notification wakeup; iOS does not guarantee immediate widget refresh while the app is closed.
- A native APNs registration endpoint and delivery path exist in the website backend. They are inactive until Apple signing and APNs credentials are configured.
- Logging out of the CRM revokes registered native push devices for that owner. Opening the app and signing in again registers an opted-in device again.

## Build

Open `LokiCRM.xcodeproj` with Xcode 26. The project is generated from `project.yml` with XcodeGen and uses bundle IDs `no.lokilyd.crm` and `no.lokilyd.crm.widget`, plus App Group `group.no.lokilyd.crm`. Confirm these identifiers and the Apple development team before distributing. The simulator build can be verified without signing:

```sh
xcodebuild -project LokiCRM.xcodeproj -scheme LokiCRM -configuration Debug -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17 Pro' CODE_SIGNING_ALLOWED=NO build
```

The icon is the existing Loki logo enlarged mechanically from the website asset; the mark itself has not been redesigned.

## To use on a physical iPhone

1. Sign in with the Loki Apple Developer team in Xcode and enable **App Groups** for both app and widget using `group.no.lokilyd.crm`.
2. Enable **Push Notifications** and **Background Modes → Remote notifications** for the app. Confirm that the app ID and provisioning profiles match the bundle IDs above.
3. Connect the iPhone to this Mac and install the development build from Xcode, or prepare a TestFlight distribution. The iPhone was offline when this project was built, so it has not been installed on the device yet.
4. Log in to the CRM in the app once. On the home screen, long-press, select **Add Widget**, and choose **Loki Gjøreliste**.
5. To enable native push, create an APNs authentication key for this app in the Apple Developer account. Store its values as Vercel secrets named `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY` (the contents of the `.p8` key), and `APNS_BUNDLE_ID=no.lokilyd.crm`. Redeploy the website backend, then activate notifications in the app's Settings tab. Never commit the `.p8` file or paste it into the website frontend.

The APNs key, signed physical-device build, and live-device delivery still need to be completed. Simulator builds cannot prove physical push delivery.
