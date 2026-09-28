import { useState } from 'react';

// "Why iffy?" box shown to someone whose RSVP is Iffy. Give it key={savedReason} so it resets
// to the saved text whenever that changes. onSave(text) saves; empty text clears the reason.
export default function IffyReasonInput({ savedReason, onSave, autoFocus = false, compact = false }) {
  const [value, setValue] = useState(savedReason ?? '');
  const [saving, setSaving] = useState(false);
  const dirty = value.trim() !== (savedReason ?? '');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!dirty) return;
    setSaving(true);
    try {
      await onSave(value.trim());
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={`iffy-reason ${compact ? 'compact' : ''}`} onSubmit={handleSubmit}>
      <label>
        <span className="iffy-reason-label">Why iffy?</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setValue(savedReason ?? '')}
          maxLength={200}
          placeholder="Optional, e.g. might have to work late"
          autoFocus={autoFocus}
        />
      </label>
      <button type="submit" className="ghost small" disabled={!dirty || saving}>
        {saving ? 'Saving…' : !dirty && savedReason ? 'Saved' : 'Save'}
      </button>
    </form>
  );
}
