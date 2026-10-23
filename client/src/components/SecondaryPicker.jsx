import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MENU_WIDTH = 208; // px; matches .checklist min-width (13rem)
const narrow = () => window.matchMedia('(max-width: 700px)').matches;

// "Also plays" picker for one member: a button showing their secondary instruments that opens a
// checklist (their primary instrument isn't offered). onSave(ids) saves the new list.
//
// The checklist is rendered into <body>: the Members table scrolls sideways, and a scrolling box
// clips anything inside it, which hid the menu when the table was short (e.g. a one-member band).
// On phones it's a panel pinned to the bottom of the screen (see .checklist in index.css).
export default function SecondaryPicker({ member, instruments, onSave }) {
  const [anchor, setAnchor] = useState(null); // the button's position while open
  const [saving, setSaving] = useState(false);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const open = Boolean(anchor);
  const selected = new Set(member.secondary_instrument_ids || []);
  const choices = instruments.filter((i) => i.id !== member.instrument_id);
  const summary = instruments.filter((i) => selected.has(i.id)).map((i) => i.name).join(', ');

  const close = () => setAnchor(null);
  const toggleOpen = () => setAnchor(open ? null : buttonRef.current.getBoundingClientRect());

  // Close on outside clicks, Escape, resizing, or scrolling the page (the menu wouldn't follow).
  useEffect(() => {
    if (!open) return undefined;
    const inside = (target) => buttonRef.current?.contains(target) || menuRef.current?.contains(target);
    const onClick = (e) => !inside(e.target) && close();
    const onKey = (e) => e.key === 'Escape' && close();
    const onScroll = (e) => !menuRef.current?.contains(e.target) && close();
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  async function toggle(id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSaving(true);
    try {
      await onSave([...next]);
    } finally {
      setSaving(false);
    }
  }

  // Desktop: below the button, or above it when there isn't room; kept inside the window.
  let position;
  if (anchor && !narrow()) {
    const left = Math.min(Math.max(8, anchor.left), window.innerWidth - MENU_WIDTH - 8);
    const roomBelow = window.innerHeight - anchor.bottom;
    position = roomBelow >= choices.length * 34 + 24
      ? { left, top: anchor.bottom + 4 }
      : { left, bottom: window.innerHeight - anchor.top + 4 };
  }

  return (
    <div className="secondary-picker">
      <button
        ref={buttonRef}
        type="button"
        className="ghost small"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Other instruments ${member.name} plays: ${summary || 'none'}`}
        onClick={toggleOpen}
      >
        {summary || <span className="muted">None</span>} ▾
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="menu-list checklist"
          style={position}
          role="group"
          aria-label={`Instruments ${member.name} also plays`}
        >
          {choices.map((i) => (
            <label key={i.id}>
              <input type="checkbox" checked={selected.has(i.id)} disabled={saving} onChange={() => toggle(i.id)} />
              {i.name}
            </label>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
