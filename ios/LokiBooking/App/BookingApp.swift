import SwiftUI
import WebKit

@main
struct LokiBookingApp: App {
    @StateObject private var model = BookingWebModel()

    var body: some Scene {
        WindowGroup {
            BookingView(model: model)
        }
    }
}

@MainActor
final class BookingWebModel: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
    static let bookingURL = URL(string: "https://www.lokilyd.no/booking/")!

    let webView: WKWebView
    @Published private(set) var loading = true
    @Published private(set) var loadFailed = false

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        openCalendar()
    }

    func openCalendar() {
        loadFailed = false
        loading = true
        webView.load(URLRequest(url: Self.bookingURL, cachePolicy: .reloadIgnoringLocalCacheData))
    }

    func refresh() {
        loadFailed = false
        loading = true
        webView.reload()
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        loading = true
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loading = false
        loadFailed = false
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handleFailure(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handleFailure(error)
    }

    private func handleFailure(_ error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        loading = false
        loadFailed = true
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }

        if url.scheme == "about" {
            decisionHandler(.allow)
            return
        }

        if ["mailto", "tel"].contains(url.scheme?.lowercased() ?? "") {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }

        let host = url.host?.lowercased() ?? ""
        let isBookingPage = ["www.lokilyd.no", "lokilyd.no"].contains(host)
            && (url.path == "/booking" || url.path.hasPrefix("/booking/"))
            && url.scheme == "https"
        if isBookingPage {
            decisionHandler(.allow)
        } else {
            // Keep the tenant app in the booking portal. Other pages open outside the app.
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }
        let host = url.host?.lowercased() ?? ""
        if ["www.lokilyd.no", "lokilyd.no"].contains(host)
            && (url.path == "/booking" || url.path.hasPrefix("/booking/")) {
            webView.load(URLRequest(url: url))
        } else {
            UIApplication.shared.open(url)
        }
        return nil
    }
}

struct BookingView: View {
    @ObservedObject var model: BookingWebModel

    var body: some View {
        ZStack {
            Color(red: 0.09, green: 0.09, blue: 0.08).ignoresSafeArea()
            BookingWebView(webView: model.webView)
                .ignoresSafeArea(edges: .bottom)

            if model.loadFailed {
                VStack(spacing: 16) {
                    Image(systemName: "wifi.exclamationmark")
                        .font(.system(size: 40))
                    Text("Kunne ikke åpne bookingkalenderen")
                        .font(.headline)
                    Text("Sjekk internettilkoblingen og prøv igjen.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Button("Prøv igjen") { model.openCalendar() }
                        .buttonStyle(.borderedProminent)
                        .tint(Color(red: 0.85, green: 1, blue: 0.32))
                }
                .multilineTextAlignment(.center)
                .padding(28)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(uiColor: .systemBackground))
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            HStack(spacing: 12) {
                Text("LOKI BOOKING")
                    .font(.system(size: 12, weight: .black, design: .rounded))
                    .tracking(2)
                Spacer()
                if model.loading { ProgressView().tint(.white).accessibilityLabel("Laster kalender") }
                Button { model.refresh() } label: {
                    Image(systemName: "arrow.clockwise")
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Oppdater kalender")
            }
            .foregroundStyle(.white)
            .padding(.leading, 18)
            .padding(.trailing, 4)
            .frame(height: 48)
            .background(Color(red: 0.09, green: 0.09, blue: 0.08))
        }
    }
}

struct BookingWebView: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
