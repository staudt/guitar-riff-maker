import { render } from 'preact';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './ui/tokens.css';
import './ui/base.css';
import { App } from './app/App';

render(<App />, document.getElementById('app')!);

// Offline support (production builds only; dev and test builds skip the service worker).
if (import.meta.env.MODE === 'production' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* e.g. self-signed LAN cert: the app still works online */
    });
  });
}
