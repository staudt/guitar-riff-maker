import { useEffect, useState } from 'preact/hooks';
import { screen } from './nav';
import { RiffScreen } from '../screens/Riff';
import { CaptureScreen } from '../screens/Capture';
import { LibraryScreen } from '../screens/Library';
import { bootLibrary, startAutosave } from '../model/library';
import '../audio/sync';

let bootPromise: Promise<void> | null = null;

export function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    bootPromise ??= bootLibrary()
      .catch(() => {})
      .then(() => {
        startAutosave();
      });
    void bootPromise.then(() => setReady(true));
  }, []);

  if (!ready) return <div class="app-loading" data-testid="app-loading" aria-busy="true" />;

  switch (screen.value) {
    case 'capture':
      return <CaptureScreen />;
    case 'library':
      return <LibraryScreen />;
    case 'riff':
    default:
      return <RiffScreen />;
  }
}
