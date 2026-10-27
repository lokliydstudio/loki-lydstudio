# Loki Booking for iPhone

The app shows the existing Studio C/D booking portal at `https://www.lokilyd.no/booking/` in a persistent private `WKWebView`. Approved tenants see only their assigned studio. Leon and Charles can switch between both studios through the portal's studio selector. The app does not provide access to CRM content.

Accounts are created and approved through the existing booking portal. After signing in once, the portal's device session stays in the app's persistent WebKit store until the user logs out, the session is revoked, or server-side policy changes. The app has a native refresh control and a retry screen for connection errors.

Generate the Xcode project with `xcodegen generate --spec project.yml`. Build without signing for the simulator with `xcodebuild -project LokiBooking.xcodeproj -scheme LokiBooking -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build`.

The production bundle ID is `no.lokilyd.booking`. Distribution credentials and profiles must remain outside the repository.

Version 1.0, build 2, was uploaded to App Store Connect on October 27, 2026. The internal TestFlight group is `Loki internt`; the external group for tenants is `Studio C og D`. External installation requires Apple's first beta review and a TestFlight invitation or public link. Testers still need a studio booking account approved by Leon or Charles; installing the app does not grant booking or CRM access.
