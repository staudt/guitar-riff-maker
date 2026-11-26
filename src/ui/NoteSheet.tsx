import { gridUnit } from '../model/edit';
import { dispatch, riff, selection } from '../model/store';
import { midiToNote } from '../music/notation';
import { Sheet } from './primitives';
import { audition } from './audition';
import './editor.css';

export interface NoteSheetProps {
  /** Note being edited; the sheet is closed when null or the note no longer exists. */
  id: string | null;
  onClose: () => void;
  /** Bump by semitone skips out-of-key pitches. */
  snapToScale?: boolean;
  /** Open the pin picker for this note. */
  onPin?: (id: string) => void;
}

export function NoteSheet(props: NoteSheetProps) {
  const { id, onClose, snapToScale = false, onPin } = props;
  const r = riff.value;
  const note = id ? r.notes.find((n) => n.id === id) : undefined;
  const open = !!note;
  const u = gridUnit(r.grid);

  const heard = () => {
    const n = id ? riff.peek().notes.find((x) => x.id === id) : undefined;
    if (n) audition([n.midi], n.velocity);
  };
  const pitch = (type: 'bump' | 'octave', dir: -1 | 1) => {
    if (!id) return;
    dispatch(type === 'bump' ? { type, id, dir, snapToScale } : { type, id, dir });
    heard();
  };
  const btn = (testId: string, label: string, onClick: () => void, extra = '') => (
    <button type="button" class={`sheet-btn ${extra}`} data-testid={testId} onClick={onClick}>
      {label}
    </button>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={note ? `${midiToNote(note.midi)}  ·  step ${note.step + 1} · len ${note.length}` : undefined}
      testId="note-sheet"
    >
      {note && id ? (
        <div class="sheet-grid">
          {btn('sheet-bump-down', '− semi', () => pitch('bump', -1))}
          {btn('sheet-bump-up', '+ semi', () => pitch('bump', 1))}
          {btn('sheet-oct-down', 'oct ▼', () => pitch('octave', -1))}
          {btn('sheet-oct-up', 'oct ▲', () => pitch('octave', 1))}
          {btn('sheet-nudge-left', '◀ nudge', () => dispatch({ type: 'nudge', ids: [id], dir: -1 }))}
          {btn('sheet-nudge-right', 'nudge ▶', () => dispatch({ type: 'nudge', ids: [id], dir: 1 }))}
          {btn('sheet-len-dec', 'len −', () => dispatch({ type: 'resize', id, length: Math.max(u, note.length - u) }))}
          {btn('sheet-len-inc', 'len +', () => dispatch({ type: 'resize', id, length: note.length + u }))}
          {btn('sheet-split', 'split', () => dispatch({ type: 'split', id }))}
          {btn('sheet-merge', 'merge →', () => dispatch({ type: 'merge', id }))}
          {btn('sheet-pin', 'pin…', () => onPin?.(id))}
          {btn(
            'sheet-delete',
            'delete',
            () => {
              dispatch({ type: 'delete', ids: [id] });
              selection.value = new Set();
              onClose();
            },
            'sheet-btn--danger',
          )}
        </div>
      ) : null}
    </Sheet>
  );
}
