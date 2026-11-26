// The main screen: tab + neck on top (always visible), then either the editor or the lesson panel.
import { useEffect, useRef, useState } from 'preact/hooks';
import { riff, dispatch, selection } from '../model/store';
import { fingering } from '../model/fingering';
import { alternatives } from '../music/fretboard';
import type { Pos } from '../music/types';
import { riffMode } from '../app/nav';
import { RiffHeader } from '../ui/RiffHeader';
import { TabView } from '../ui/TabView';
import { NeckView } from '../ui/NeckView';
import { NeckControls } from '../ui/NeckControls';
import { EditToolbar } from '../ui/EditToolbar';
import { RollEditor } from '../ui/RollEditor';
import { NoteSheet } from '../ui/NoteSheet';
import { RiffSettingsSheet } from '../ui/RiffSettingsSheet';
import { LessonPanel } from '../ui/LessonPanel';
import { CountInOverlay } from '../ui/CountInOverlay';
import { installPlayhead } from '../ui/playhead';
import { stop } from '../audio/sync';
import '../ui/screens.css';

export function RiffScreen() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [pinId, setPinId] = useState<string | null>(null);
  const [snapScale, setSnapScale] = useState(false);
  const mode = riffMode.value;

  useEffect(() => installPlayhead(), []);
  useEffect(() => () => stop(), []);
  // Switching Edit <-> Learn stops playback (each mode has its own play control). Not on first mount:
  // a fresh capture lands here and starts playing right away.
  const firstMode = useRef(true);
  useEffect(() => {
    if (firstMode.current) firstMode.current = false;
    else stop();
    setOpenId(null);
    setPinId(null);
  }, [mode]);

  const r = riff.value;
  const pinIndex = pinId ? r.notes.findIndex((n) => n.id === pinId) : -1;
  const pinNote = pinIndex >= 0 ? r.notes[pinIndex]! : null;
  const ghosts: Pos[] = pinNote ? alternatives(pinNote.midi, r.tuning, r.maxFret, fingering.value.pos[pinIndex]?.[0]) : [];

  const pickGhost = (pos: Pos) => {
    if (!pinId) return;
    dispatch({ type: 'pin', id: pinId, pos });
    setPinId(null);
  };

  return (
    <main class="app riff-screen" data-testid="riff-screen" data-mode={mode}>
      <RiffHeader />
      <section class="riff-screen__views">
        <TabView mode={mode} onSelectNote={(id) => mode === 'edit' && setOpenId(id)} />
        <NeckView mode={mode} ghosts={ghosts} onPickGhost={pickGhost} />
        {pinNote ? (
          <div class="pin-banner" data-testid="pin-banner">
            <span>Tap a dashed dot to play this note there</span>
            {pinNote.pin && (
              <button
                onClick={() => {
                  dispatch({ type: 'unpin', id: pinNote.id });
                  setPinId(null);
                }}
              >
                Auto
              </button>
            )}
            <button onClick={() => setPinId(null)}>Cancel</button>
          </div>
        ) : (
          <NeckControls />
        )}
      </section>

      {mode === 'edit' ? (
        <section class="riff-screen__edit">
          <EditToolbar snapScale={snapScale} onSnapScale={setSnapScale} />
          <RollEditor snapScale={snapScale} onOpenNote={setOpenId} />
          <NoteSheet
            id={openId}
            snapToScale={snapScale}
            onClose={() => setOpenId(null)}
            onPin={(id) => {
              setOpenId(null);
              selection.value = new Set([id]);
              setPinId(id);
            }}
          />
        </section>
      ) : (
        <section class="riff-screen__lesson">
          <LessonPanel />
        </section>
      )}
      <RiffSettingsSheet />
      <CountInOverlay />
    </main>
  );
}
