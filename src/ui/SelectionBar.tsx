// Docked bar that replaces the toolbar while a note is selected, so the roll stays visible.
import { useEffect } from 'preact/hooks';
import { editUnit, isFree, stepSeconds } from '../model/riff';
import { dispatch, riff, selection } from '../model/store';
import { midiToNote } from '../music/notation';
import { audition } from './audition';
import './editor.css';

export interface SelectionBarProps {
  /** Bump by semitone skips out-of-key pitches. */
  snapToScale?: boolean;
  /** Open the pin picker for this note. */
  onPin?: (id: string) => void;
}

export function SelectionBar({ snapToScale = false, onPin }: SelectionBarProps) {
  const r = riff.value;
  const id = [...selection.value][0];
  const note = id ? r.notes.find((n) => n.id === id) : undefined;
  const u = editUnit(r);

  const heard = (nid: string) => {
    const n = riff.peek().notes.find((x) => x.id === nid);
    if (n) audition([n.midi], n.velocity);
  };
  const close = () => (selection.value = new Set());
  const del = (nid: string) => {
    dispatch({ type: 'delete', ids: [nid] });
    close();
  };
  const pitch = (nid: string, type: 'bump' | 'octave', dir: -1 | 1) => {
    dispatch(type === 'bump' ? { type, id: nid, dir, snapToScale } : { type, id: nid, dir });
    heard(nid);
  };

  // Desktop keys: Delete removes, arrows nudge/bump, Escape deselects.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const nid = [...selection.peek()][0];
      if (!nid) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'Delete' || e.key === 'Backspace') del(nid);
      else if (e.key === 'ArrowLeft') dispatch({ type: 'nudge', ids: [nid], dir: -1 });
      else if (e.key === 'ArrowRight') dispatch({ type: 'nudge', ids: [nid], dir: 1 });
      else if (e.key === 'ArrowUp') pitch(nid, 'bump', 1);
      else if (e.key === 'ArrowDown') pitch(nid, 'bump', -1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [snapToScale]);

  if (!note || !id) return null;
  const when = isFree(r)
    ? `${(note.step * stepSeconds(r)).toFixed(2)}s · ${Math.round(note.length * stepSeconds(r) * 1000)}ms`
    : `step ${note.step + 1} · len ${note.length}`;
  const btn = (testId: string, label: string, aria: string, onClick: () => void, extra = '') => (
    <button type="button" class={`sheet-btn ${extra}`} data-testid={testId} aria-label={aria} onClick={onClick}>
      {label}
    </button>
  );

  return (
    <div class="selbar" data-testid="selection-bar">
      {btn('sel-close', '✕', 'Deselect', close)}
      <div class="selbar__scroll">
        <div class="selbar__label" data-testid="sel-label">
          <span class="selbar__name">{midiToNote(note.midi)}</span>
          <span>{when}</span>
        </div>
        {btn('sheet-bump-down', '−', 'Down a semitone', () => pitch(id, 'bump', -1))}
        {btn('sheet-bump-up', '+', 'Up a semitone', () => pitch(id, 'bump', 1))}
        {btn('sheet-oct-down', '8▼', 'Down an octave', () => pitch(id, 'octave', -1))}
        {btn('sheet-oct-up', '8▲', 'Up an octave', () => pitch(id, 'octave', 1))}
        {btn('sheet-nudge-left', '◀', 'Nudge earlier', () => dispatch({ type: 'nudge', ids: [id], dir: -1 }))}
        {btn('sheet-nudge-right', '▶', 'Nudge later', () => dispatch({ type: 'nudge', ids: [id], dir: 1 }))}
        {btn('sheet-len-dec', 'len−', 'Shorter', () => dispatch({ type: 'resize', id, length: Math.max(u, note.length - u) }))}
        {btn('sheet-len-inc', 'len+', 'Longer', () => dispatch({ type: 'resize', id, length: note.length + u }))}
        {btn('sheet-split', 'split', 'Split note', () => dispatch({ type: 'split', id }))}
        {btn('sheet-merge', 'merge', 'Merge with next', () => dispatch({ type: 'merge', id }))}
        {btn('sheet-pin', 'pin', 'Choose string and fret', () => onPin?.(id))}
      </div>
      {btn('sheet-delete', 'Del', 'Delete note', () => del(id), 'sheet-btn--danger')}
    </div>
  );
}
