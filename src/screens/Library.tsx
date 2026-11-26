// Saved riffs: open, create, record, import, rename, duplicate, delete, export.
import { useEffect, useRef, useState } from 'preact/hooks';
import { screen } from '../app/nav';
import type { RiffSummary } from '../model/db';
import { exportJson } from '../model/export';
import {
  duplicate,
  importFromFile,
  newBlankRiff,
  openRiff,
  refreshLibrary,
  removeRiff,
  renameRiff,
  storageError,
  summaries,
} from '../model/library';
import { getRiff } from '../model/db';
import { riff } from '../model/store';
import { pcName } from '../music/theory';
import { Sheet } from '../ui/primitives';
import '../ui/library.css';

function relTime(t: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return new Date(t).toLocaleDateString();
}

function detail(s: RiffSummary): string {
  return `${pcName(s.key.tonic, false)} ${s.key.scale} · ${Math.round(s.bpm)} bpm · ${s.bars} ${s.bars === 1 ? 'bar' : 'bars'} · ${s.noteCount} ${s.noteCount === 1 ? 'note' : 'notes'}`;
}

async function downloadJson(id: string): Promise<void> {
  const r = riff.peek().id === id ? riff.peek() : await getRiff(id);
  if (!r) return;
  const url = URL.createObjectURL(new Blob([exportJson(r)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${r.name.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'riff'}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function LibraryScreen() {
  const [menu, setMenu] = useState<RiffSummary | null>(null);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void refreshLibrary();
  }, []);

  const list = summaries.value;
  const currentId = riff.value.id;
  const err = storageError.value;

  const act = (f: () => Promise<void> | void) => async () => {
    setMenu(null);
    setMsg('');
    try {
      await f();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div class="library" data-testid="library-screen">
      <header class="library__bar">
        <button class="library__btn library__back" aria-label="Back to riff" data-testid="library-back" onClick={() => (screen.value = 'riff')}>
          ◀
        </button>
        <h1 class="library__title">Riffs</h1>
        <button class="library__btn" data-testid="library-new" onClick={act(newBlankRiff)}>
          New
        </button>
        <button class="library__btn library__btn--rec" data-testid="library-record" onClick={() => (screen.value = 'capture')}>
          Record
        </button>
        <button class="library__btn" data-testid="library-import" onClick={() => fileRef.current?.click()}>
          Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          data-testid="library-import-input"
          onChange={(e) => {
            const input = e.currentTarget;
            const file = input.files?.[0];
            input.value = '';
            if (file) void act(() => importFromFile(file))();
          }}
        />
      </header>
      {err ? <p class="library__note" role="status">Saving is unavailable ({err}). Your riff stays in memory until you close the app.</p> : null}
      {msg ? <p class="library__note library__note--error" role="alert">{msg}</p> : null}
      <ul class="library__list">
        {list.length === 0 ? (
          <li class="library__empty" data-testid="library-empty">No riffs yet. Tap New to start one, or Record to whistle one in.</li>
        ) : (
          list.map((s) => (
            <li key={s.id} class="library__row" data-testid="library-row" data-riff-id={s.id} data-current={s.id === currentId}>
              <button class="library__open" onClick={act(() => void openRiff(s.id))}>
                <span class="library__name">{s.name}</span>
                <span class="library__meta">{detail(s)}</span>
                <span class="library__time">{relTime(s.updatedAt)}</span>
              </button>
              <button class="library__more" aria-label={`Actions for ${s.name}`} data-testid="library-more" onClick={() => setMenu(s)}>
                ⋯
              </button>
            </li>
          ))
        )}
      </ul>
      <Sheet open={menu !== null} onClose={() => setMenu(null)} title={menu?.name} testId="library-sheet">
        {menu ? (
          <div class="library__actions">
            <button
              class="library__action"
              data-testid="library-rename"
              onClick={act(async () => {
                const name = window.prompt('Rename riff', menu.name);
                if (name) await renameRiff(menu.id, name);
              })}
            >
              Rename
            </button>
            <button class="library__action" data-testid="library-duplicate" onClick={act(() => duplicate(menu.id))}>
              Duplicate
            </button>
            <button class="library__action" data-testid="library-export" onClick={act(() => downloadJson(menu.id))}>
              Export JSON
            </button>
            <button
              class="library__action library__action--danger"
              data-testid="library-delete"
              onClick={act(async () => {
                if (window.confirm(`Delete "${menu.name}"?`)) await removeRiff(menu.id);
              })}
            >
              Delete
            </button>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
