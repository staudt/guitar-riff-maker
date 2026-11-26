import { riff, dispatch } from '../model/store';
import { pcName } from '../music/theory';
import { riffMode, screen } from '../app/nav';
import { moreOpen } from '../app/ui-state';
import { stop } from '../audio/sync';
import { Segmented } from './primitives';
import './screens.css';

const SCALE_LABEL: Record<string, string> = {
  minor: 'minor',
  major: 'major',
  dorian: 'dorian',
  mixolydian: 'mixolydian',
  pentatonic: 'minor pent.',
};

export function RiffHeader() {
  const r = riff.value;
  const rename = () => {
    const name = window.prompt('Riff name', r.name);
    if (name && name.trim()) dispatch({ type: 'rename', name: name.trim() });
  };
  return (
    <header class="riff-header">
      <button class="riff-header__back" aria-label="Library" data-testid="nav-library" onClick={() => (screen.value = 'library')}>
        ☰
      </button>
      <button class="riff-header__title" data-testid="riff-name" onClick={rename}>
        <span class="riff-header__name">{r.name}</span>
        <span class="riff-header__meta" data-testid="riff-meta">
          {pcName(r.key.tonic, false)} {SCALE_LABEL[r.key.scale] ?? r.key.scale} · ♩={r.bpm}
        </span>
      </button>
      <Segmented
        testId="riff-mode"
        options={[
          { value: 'edit', label: 'Edit' },
          { value: 'lesson', label: 'Learn' },
        ]}
        value={riffMode.value}
        onChange={(v) => (riffMode.value = v)}
      />
      <button class="riff-header__more" aria-label="Riff settings" data-testid="riff-more" onClick={() => (moreOpen.value = true)}>
        ⋯
      </button>
      <button
        class="riff-header__rec"
        aria-label="Record a new riff"
        data-testid="nav-capture"
        onClick={() => {
          stop();
          screen.value = 'capture';
        }}
      >
        <span aria-hidden="true" />
      </button>
    </header>
  );
}
