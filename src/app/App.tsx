import { useEffect } from 'preact/hooks';
import { screen } from './nav';
import { RiffScreen } from '../screens/Riff';
import { loadRiff, riff } from '../model/store';
import { demoRiff } from '../model/demo';
import '../audio/sync';

let booted = false;

export function App() {
  useEffect(() => {
    if (booted) return;
    booted = true;
    if (!riff.value.notes.length) loadRiff(demoRiff());
  }, []);

  switch (screen.value) {
    case 'riff':
    default:
      return <RiffScreen />;
  }
}
