// Edits a band's instrument list in order: name and the quorum minimum (Yes RSVPs needed; 0 = not
// required). `value` is [{ key, name, min_count }]; onChange gets the new array.
//
// Rows are reordered by dragging the ⠿ handle (pointer events, so it works with a mouse or a finger)
// or, with the handle focused, the ↑/↓ keys.
import { useEffect, useRef, useState } from 'react';
import { newRow } from './instrumentRows';

const moveItem = (list, from, to) => {
  const next = [...list];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
};

export default function InstrumentsEditor({ value, onChange, disabled = false }) {
  const rowRefs = useRef(new Map()); // key -> <li>
  const handleRefs = useRef(new Map()); // key -> handle <button>
  const [dragKey, setDragKey] = useState(null); // for styling the dragged row
  const refocusKey = useRef(null); // handle to refocus after a keyboard move
  const [announcement, setAnnouncement] = useState('');

  const update = (index, fields) => onChange(value.map((row, i) => (i === index ? { ...row, ...fields } : row)));
  const label = (row, i) => row.name || `instrument ${i + 1}`;

  function moveTo(from, to) {
    if (to < 0 || to >= value.length || to === from) return;
    onChange(moveItem(value, from, to));
    setAnnouncement(`${label(value[from], from)} moved to position ${to + 1} of ${value.length}`);
  }

  // Moving a row re-inserts its DOM node, which drops focus; put it back on the moved handle.
  useEffect(() => {
    if (!refocusKey.current) return;
    handleRefs.current.get(refocusKey.current)?.focus();
    refocusKey.current = null;
  }, [value]);

  // Dragging listens on window rather than the handle: moving the dragged row re-inserts its DOM
  // node, which drops pointer capture and would end the drag after one step.
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange };
  });
  const stopDragging = useRef(null);
  useEffect(() => () => stopDragging.current?.(), []);

  function onPointerDown(e, row) {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    setDragKey(row.key);

    const onMove = (ev) => {
      const { value: rows, onChange: change } = latest.current;
      const from = rows.findIndex((r) => r.key === row.key);
      // The dragged row's new index is the number of other rows whose middle is above the pointer.
      const to = rows.filter((r) => {
        if (r.key === row.key) return false;
        const rect = rowRefs.current.get(r.key)?.getBoundingClientRect();
        return rect && rect.top + rect.height / 2 < ev.clientY;
      }).length;
      if (to !== from) {
        const next = moveItem(rows, from, to);
        latest.current = { value: next, onChange: change }; // further moves before the re-render build on it
        change(next);
      }
    };
    const onEnd = () => {
      stopDragging.current();
      setDragKey(null);
      const rows = latest.current.value;
      const i = rows.findIndex((r) => r.key === row.key);
      if (i >= 0) setAnnouncement(`${label(rows[i], i)} is now at position ${i + 1} of ${rows.length}`);
    };
    stopDragging.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      stopDragging.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  }

  function onHandleKeyDown(e, i, row) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    refocusKey.current = row.key;
    moveTo(i, e.key === 'ArrowUp' ? i - 1 : i + 1);
  }

  return (
    <div className="instruments-editor">
      <div className="instruments-editor-head" aria-hidden="true">
        <span />
        <span>Instrument</span>
        <span title="Yes RSVPs needed from this section for an event to have quorum">Min. for quorum</span>
        <span />
      </div>
      <ol>
        {value.map((row, i) => (
          <li
            key={row.key}
            ref={(el) => (el ? rowRefs.current.set(row.key, el) : rowRefs.current.delete(row.key))}
            className={dragKey === row.key ? 'dragging' : ''}
          >
            <button
              type="button"
              ref={(el) => (el ? handleRefs.current.set(row.key, el) : handleRefs.current.delete(row.key))}
              className="drag-handle"
              disabled={disabled || value.length === 1}
              aria-label={`Reorder ${label(row, i)}, position ${i + 1} of ${value.length}. Drag, or use the up and down arrow keys.`}
              title="Drag to reorder"
              onPointerDown={(e) => onPointerDown(e, row)}
              onKeyDown={(e) => onHandleKeyDown(e, i, row)}
            >
              ⠿
            </button>
            <input
              value={row.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="e.g. Trombones"
              maxLength={40}
              required
              disabled={disabled}
              aria-label={`Instrument ${i + 1} name`}
            />
            <input
              type="number"
              min={0}
              max={50}
              step={1}
              value={row.min_count}
              onChange={(e) => update(i, { min_count: e.target.value === '' ? '' : Number(e.target.value) })}
              required
              disabled={disabled}
              aria-label={`Minimum ${label(row, i)} for quorum`}
            />
            <button type="button" className="ghost small danger" onClick={() => onChange(value.filter((_, j) => j !== i))}
              disabled={disabled || value.length === 1} aria-label={`Remove ${label(row, i)}`}>✕</button>
          </li>
        ))}
      </ol>
      <p className="sr-only" aria-live="polite">{announcement}</p>
      <button type="button" className="ghost small" disabled={disabled} onClick={() => onChange([...value, newRow()])}>
        + Add instrument
      </button>
    </div>
  );
}
