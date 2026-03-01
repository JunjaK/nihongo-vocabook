import { AppWebView } from '../components/webview/app-webview';

/**
 * Home screen — loads the web app in a WebView.
 * Mobile app enforces auth-only: no guest mode.
 * The web app handles its own auth flow (redirects to login if unauthenticated).
 */
export default function HomeScreen() {
  return <AppWebView />;
}
