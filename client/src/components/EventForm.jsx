import { useState } from 'react';
import { api, formatDate } from '../api';

const EMPTY = {
  type: 'rehearsal',
  title: '',
  event_date: '',
  venue: '',
  call_time: '',
  hit_time: '',
  set_list: '',
  description: '',
};

// initial: the event being edited. template: an event being duplicated; its details are copied
// into a new event, except the date (the copy needs its own) and anything RSVP-related.
export default function EventForm({ bandId, initial, template, onCancel, onSaved }) {
  const [form, setForm] = useState(() => {
    const source = initial || template;
    if (!source) return EMPTY;
    const copy = Object.fromEntries(Object.keys(EMPTY).map((k) => [k, source[k] ?? '']));
    return template ? { ...copy, event_date: '' } : copy;
  });
  const [notify, setNotify] = useState(true); // new events only
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const saved = initial
        ? await api.updateEvent(initial.id, form)
        : await api.createEvent(bandId, { ...form, notify });
      onSaved(saved);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form className="card form" onSubmit={handleSubmit}>
      <h1>{initial ? 'Edit event' : template ? 'Duplicate event' : 'New event'}</h1>
      {template && (
        <p className="muted">
          Copied from “{template.title}” on {formatDate(template.event_date)}. Pick a date for the new event.
          RSVPs and the confirmed/cancelled status aren’t copied.
        </p>
      )}

      <div className="field">
        <span className="label">Type</span>
        <div className="segmented">
          {['rehearsal', 'gig'].map((t) => (
            <button
              type="button"
              key={t}
              className={form.type === t ? 'active' : ''}
              onClick={() => setForm((f) => ({ ...f, type: t }))}
            >
              {t === 'gig' ? 'Gig' : 'Rehearsal'}
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <span className="label">Title *</span>
        <input value={form.title} onChange={set('title')} required placeholder="e.g. Friday at The Blue Room" />
      </label>

      <div className="row">
        <label className="field">
          <span className="label">Date *</span>
          <input type="date" value={form.event_date} onChange={set('event_date')} required autoFocus={Boolean(template)} />
        </label>
        <label className="field">
          <span className="label">Call time</span>
          <input type="time" value={form.call_time} onChange={set('call_time')} />
        </label>
        <label className="field">
          <span className="label">Hit time</span>
          <input type="time" value={form.hit_time} onChange={set('hit_time')} />
        </label>
      </div>

      <label className="field">
        <span className="label">Venue</span>
        <input value={form.venue} onChange={set('venue')} placeholder="Name and address" />
      </label>

      <label className="field">
        <span className="label">Set list <span className="muted">(one song per line)</span></span>
        <textarea rows={8} value={form.set_list} onChange={set('set_list')} />
      </label>

      <label className="field">
        <span className="label">Description</span>
        <textarea rows={4} value={form.description} onChange={set('description')} placeholder="Dress code, parking, load-in notes…" />
      </label>

      {!initial && (
        <label className="checkbox">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          <span>Email the band about this event, with a link to RSVP</span>
        </label>
      )}

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary" disabled={saving}>
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Create event'}
        </button>
      </div>
    </form>
  );
}
