// Edits a band's instrument list in order: name and the quorum minimum (Yes RSVPs needed; 0 = not
// required). `value` is [{ key, name, min_count }]; onChange gets the new array.
import { newRow } from './instrumentRows';

export default function InstrumentsEditor({ value, onChange, disabled = false }) {
  const update = (index, fields) => onChange(value.map((row, i) => (i === index ? { ...row, ...fields } : row)));
  const move = (index, by) => {
    const next = [...value];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    onChange(next);
  };

  return (
    <div className="instruments-editor">
      <div className="instruments-editor-head" aria-hidden="true">
        <span>Instrument</span>
        <span title="Yes RSVPs needed from this section for an event to have quorum">Min. for quorum</span>
      </div>
      <ol>
        {value.map((row, i) => (
          <li key={row.key}>
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
              aria-label={`Minimum ${row.name || `instrument ${i + 1}`} for quorum`}
            />
            <div className="instruments-editor-actions">
              <button type="button" className="ghost small" onClick={() => move(i, -1)} disabled={disabled || i === 0}
                aria-label={`Move ${row.name || 'instrument'} up`}>↑</button>
              <button type="button" className="ghost small" onClick={() => move(i, 1)} disabled={disabled || i === value.length - 1}
                aria-label={`Move ${row.name || 'instrument'} down`}>↓</button>
              <button type="button" className="ghost small danger" onClick={() => onChange(value.filter((_, j) => j !== i))}
                disabled={disabled || value.length === 1} aria-label={`Remove ${row.name || 'instrument'}`}>✕</button>
            </div>
          </li>
        ))}
      </ol>
      <button type="button" className="ghost small" disabled={disabled}
        onClick={() => onChange([...value, newRow()])}>
        + Add instrument
      </button>
    </div>
  );
}

