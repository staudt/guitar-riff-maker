// The main screen: tab + neck on top, then the editor.
import { useEffect, useState } from 'preact/hooks';
import { riff, dispatch, selection } from '../model/store';
import { fingering } from '../model/fingering';
import { alternatives } from '../music/fretboard';
import type { Pos } from '../music/types';
import { RiffHeader } from '../ui/RiffHeader';
import { TabView } from '../ui/TabView';
import { NeckView } from '../ui/NeckView';
import { NeckControls } from '../ui/NeckControls';
import { EditToolbar } from '../ui/EditToolbar';
import { RollEditor } from '../ui/RollEditor';
import { NoteSheet } from '../ui/NoteSheet';
import { RiffSettingsSheet } from '../ui/RiffSettingsSheet';
import { installPlayhead } from '../ui/playhead';
import { stop } from '../audio/sync';
import { snapScale } from '../app/ui-state';
import '../ui/screens.css';

export function RiffScreen() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [pinId, setPinId] = useState<string | null>(null);

  useEffect(() => installPlayhead(), []);
  useEffect(() => () => stop(), []);
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
    <main class="app riff-screen" data-testid="riff-screen">
      <RiffHeader />
      <section class="riff-screen__views">
        <TabView onSelectNote={setOpenId} />
        <NeckView ghosts={ghosts} onPickGhost={pickGhost} />
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

      <section class="riff-screen__edit">
        <EditToolbar />
        <RollEditor snapScale={snapScale.value} onOpenNote={setOpenId} />
        <NoteSheet
          id={openId}
          snapToScale={snapScale.value}
          onClose={() => setOpenId(null)}
          onPin={(id) => {
            setOpenId(null);
            selection.value = new Set([id]);
            setPinId(id);
          }}
        />
      </section>
      <RiffSettingsSheet />
    </main>
  );
}
