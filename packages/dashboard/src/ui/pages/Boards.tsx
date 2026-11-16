import { useEffect, useRef, useState } from 'react';
import { eventNames } from '../../data/queries';
import { blankWidget, isBoard, loadBoards, newId, saveBoards, starterBoard, type Board, type Widget } from '../../lib/boards';
import { go } from '../../lib/router';
import { downloadJson } from '../../lib/storage';
import { WidgetEditor } from '../widgets/WidgetEditor';
import { WidgetView } from '../widgets/WidgetView';

export function Boards({ id, version }: { id?: string; version: number }) {
  const [boards, setBoards] = useState<Board[]>(loadBoards);
  const [editing, setEditing] = useState<Widget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const update = (next: Board[]) => {
    setBoards(next);
    saveBoards(next);
  };

  // First visit with data: build a useful board from the events that exist.
  useEffect(() => {
    if (boards.length) return;
    let alive = true;
    eventNames().then((names) => {
      if (alive && names.length) update([starterBoard(names)]);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const board = boards.find((b) => b.id === id) ?? boards[0];
  if (!board) return <div className="loading">Preparing your first board…</div>;

  const setBoard = (b: Board) => update(boards.map((x) => (x.id === b.id ? b : x)));
  const setWidgets = (widgets: Widget[]) => setBoard({ ...board, widgets });
  const index = (w: Widget) => board.widgets.findIndex((x) => x.id === w.id);

  const move = (w: Widget, dir: -1 | 1) => {
    const i = index(w);
    const j = i + dir;
    if (j < 0 || j >= board.widgets.length) return;
    const next = [...board.widgets];
    [next[i], next[j]] = [next[j], next[i]];
    setWidgets(next);
  };

  const saveWidget = (w: Widget) => {
    setWidgets(index(w) >= 0 ? board.widgets.map((x) => (x.id === w.id ? w : x)) : [...board.widgets, w]);
    setEditing(null);
  };

  const addBoard = async () => {
    const b: Board = { id: newId(), name: `Board ${boards.length + 1}`, widgets: [] };
    update([...boards, b]);
    go({ page: 'boards', id: b.id });
  };

  const importBoards = async (f: File) => {
    try {
      const v: unknown = JSON.parse(await f.text());
      const list = (Array.isArray(v) ? v : [v]).filter(isBoard);
      if (!list.length) throw new Error('No Shipstat board in this file.');
      const ids = new Set(boards.map((b) => b.id));
      const fresh = list.map((b) => (ids.has(b.id) ? { ...b, id: newId() } : b));
      update([...boards, ...fresh]);
      setNotice(`Imported ${fresh.length} board(s).`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };

  if (editing) {
    return (
      <>
        <div className="crumb"><a href="#boards">Boards</a> / {board.name} / {index(editing) >= 0 ? 'Edit chart' : 'New chart'}</div>
        <WidgetEditor value={editing} version={version} onSave={saveWidget} onCancel={() => setEditing(null)} />
      </>
    );
  }

  return (
    <>
      <div className="head">
        <div>
          <input className="title-input" value={board.name} onChange={(e) => setBoard({ ...board, name: e.target.value })} aria-label="Board name" />
          <p>Build your own view: every chart is a query on your events, saved in this browser.</p>
        </div>
        <div className="row-actions">
          <button className="btn" type="button" onClick={() => fileRef.current?.click()}>Import</button>
          <button className="btn" type="button" onClick={() => downloadJson(`shipstat-board-${board.name}.json`, board)}>Export</button>
          <button className="btn primary" type="button" onClick={() => setEditing(blankWidget())}>Add chart</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importBoards(e.target.files[0])} />
        </div>
      </div>

      <div className="tabs">
        {boards.map((b) => (
          <a key={b.id} className={b.id === board.id ? 'tab on' : 'tab'} href={`#boards/${b.id}`}>{b.name}</a>
        ))}
        <button className="tab" type="button" onClick={addBoard}>+ New board</button>
      </div>
      {notice && <div className="card notice">{notice}</div>}

      {board.widgets.length === 0 ? (
        <div className="card empty">
          <h2>This board is empty</h2>
          <p>Add a chart, or start from a ready-made board based on your events.</p>
          <div className="row-actions" style={{ justifyContent: 'center' }}>
            <button className="btn primary" type="button" onClick={() => setEditing(blankWidget())}>Add chart</button>
            <button className="btn" type="button" onClick={async () => setWidgets(starterBoard(await eventNames()).widgets)}>Use the starter board</button>
          </div>
        </div>
      ) : (
        <div className="board-grid">
          {board.widgets.map((w, i) => (
            <section key={w.id} className={`card widget span-${w.size}`}>
              <div className="card-head">
                <div>
                  <h2>{w.title}</h2>
                  <p>{describe(w)}</p>
                </div>
                <div className="widget-tools">
                  <button type="button" title="Move left" disabled={i === 0} onClick={() => move(w, -1)}>←</button>
                  <button type="button" title="Move right" disabled={i === board.widgets.length - 1} onClick={() => move(w, 1)}>→</button>
                  <button type="button" title="Change width" onClick={() => setWidgets(board.widgets.map((x) => (x.id === w.id ? { ...x, size: ((x.size % 3) + 1) as Widget['size'] } : x)))}>⇔</button>
                  <button type="button" title="Duplicate" onClick={() => setWidgets([...board.widgets.slice(0, i + 1), { ...w, id: newId(), title: `${w.title} (copy)` }, ...board.widgets.slice(i + 1)])}>⧉</button>
                  <button type="button" title="Edit" onClick={() => setEditing(w)}>✎</button>
                  <button type="button" title="Delete" onClick={() => setWidgets(board.widgets.filter((x) => x.id !== w.id))}>✕</button>
                </div>
              </div>
              <WidgetView w={w} version={version} />
            </section>
          ))}
        </div>
      )}

      {boards.length > 1 && (
        <p className="faint" style={{ marginTop: 20 }}>
          <button className="link" type="button" onClick={() => { update(boards.filter((b) => b.id !== board.id)); go({ page: 'boards' }); }}>Delete this board</button>
        </p>
      )}
    </>
  );
}

function describe(w: Widget): string {
  if (w.viz === 'feed') return [w.event ?? 'all events', 'newest first'].join(' · ');
  const what = w.viz === 'funnel' ? (w.steps ?? []).filter(Boolean).join(' → ') : w.event ?? 'all events';
  const metric = { events: 'events', users: 'users', per_user: 'events / user' }[w.metric];
  const filters = Object.entries(w.filters).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`);
  return [what, w.viz === 'funnel' ? 'users' : metric, w.split && `by ${w.split}`, w.range, ...filters].filter(Boolean).join(' · ');
}
