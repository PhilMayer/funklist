import { useEffect, useRef, useState } from 'react';

// "Also plays" picker for one member: a button showing their secondary instruments that opens a
// checklist (their primary instrument isn't offered). onSave(ids) saves the new list.
export default function SecondaryPicker({ member, instruments, onSave }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef(null);
  const selected = new Set(member.secondary_instrument_ids || []);
  const choices = instruments.filter((i) => i.id !== member.instrument_id);
  const summary = instruments.filter((i) => selected.has(i.id)).map((i) => i.name).join(', ');

  // Close when clicking elsewhere or pressing Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
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

  return (
    <div className="menu secondary-picker" ref={ref}>
      <button
        type="button"
        className="ghost small"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Other instruments ${member.name} plays: ${summary || 'none'}`}
        onClick={() => setOpen((o) => !o)}
      >
        {summary || <span className="muted">None</span>} ▾
      </button>
      {open && (
        <div className="menu-list checklist" role="group" aria-label={`Instruments ${member.name} also plays`}>
          {choices.map((i) => (
            <label key={i.id}>
              <input type="checkbox" checked={selected.has(i.id)} disabled={saving} onChange={() => toggle(i.id)} />
              {i.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
