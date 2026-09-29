import { useMemo, useState } from 'react';
import { api } from '../api';

// UTC offset right now, e.g. "GMT-4" (accounts for daylight saving).
const offsetOf = (tz) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
    .formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? '';

const nowIn = (tz) => new Date().toLocaleTimeString([], { timeZone: tz, hour: 'numeric', minute: '2-digit' });

// Band time zone: decides when an event moves from Upcoming to Past (midnight there).
export default function TimeZoneSetting({ bandId, timezone, onSaved, onError }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const zones = useMemo(() => {
    const all = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
    const list = timezone && !all.includes(timezone) ? [timezone, ...all] : all;
    return list.map((tz) => ({ tz, label: `${tz.replaceAll('_', ' ')} (${offsetOf(tz)})` }));
  }, [timezone]);

  async function change(tz) {
    setSaving(true);
    setSaved(false);
    try {
      onSaved((await api.updateBand(bandId, { timezone: tz })).timezone);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!timezone) return null;
  return (
    <div className="band-setting">
      <label>
        <strong>Band time zone</strong>
        <select value={timezone} disabled={saving} onChange={(e) => change(e.target.value)}>
          {zones.map(({ tz, label }) => <option key={tz} value={tz}>{label}</option>)}
        </select>
        {saved && <span className="saved-note">Saved</span>}
      </label>
      <p className="muted small-text">
        Events move from Upcoming to Past at midnight in this time zone. It’s {nowIn(timezone)} there now.
      </p>
    </div>
  );
}
