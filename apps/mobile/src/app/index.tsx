import { useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppWebView } from '../components/webview/app-webview';

/**
 * Home screen — loads the web app in a WebView.
 * Mobile app enforces auth-only: no guest mode.
 *
 * SafeAreaView edges=['top'] pushes WebView below the notch/status bar.
 * Bottom is NOT included — the web app handles home indicator area.
 */
export default function HomeScreen() {
  const colorScheme = useColorScheme();
  const bg = colorScheme === 'dark' ? '#1a1a2e' : '#f5f5f5';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={['top']}>
      <AppWebView />
    </SafeAreaView>
  );
}
