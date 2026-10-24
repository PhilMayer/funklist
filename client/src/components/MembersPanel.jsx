import { useEffect, useState } from 'react';
import { api } from '../api';
import TimeZoneSetting from './TimeZoneSetting';
import SecondaryPicker from './SecondaryPicker';
import BandInstruments from './BandInstruments';


export default function MembersPanel({
  bandId, members, instruments, setInstruments, isAdmin, onChanged, onLeft, onError,
}) {
  const [name, setName] = useState('');
  const [instrumentId, setInstrumentId] = useState('');
  const [email, setEmail] = useState('');
  const [inviteCode, setInviteCode] = useState(null);
  const [timezone, setTimezone] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.band(bandId)
      .then((b) => {
        setInviteCode(b.invite_code);
        setTimezone(b.timezone);
      })
      .catch((e) => onError(e.message));
  }, [bandId, onError]);

  const inviteLink = inviteCode && `${window.location.origin}/?join=${inviteCode}`;

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onError('Could not copy. Select the link and copy it manually.');
    }
  }

  async function resetInvite() {
    if (!window.confirm('Create a new invite link? The current link will stop working.')) return;
    try {
      setInviteCode((await api.newInviteCode(bandId)).invite_code);
    } catch (err) {
      onError(err.message);
    }
  }

  // Instruments come from the band's list (edited under "Instruments and quorum").
  const resolveInstrument = (value) => (value ? Number(value) : null);

  async function handleAdd(e) {
    e.preventDefault();
    try {
      const instrument_id = await resolveInstrument(instrumentId);
      await api.addMember(bandId, { name, email, instrument_id });
      setName('');
      setEmail('');
      setInstrumentId('');
      onChanged();
    } catch (err) {
      onError(err.message);
    }
  }

  async function changeInstrument(member, value) {
    try {
      const instrument_id = await resolveInstrument(value);
      await api.updateMember(member.id, { name: member.name, email: member.email, instrument_id });
      onChanged();
    } catch (err) {
      onError(err.message);
    }
  }

  async function changeSecondaries(member, ids) {
    try {
      await api.updateMember(member.id, {
        name: member.name, email: member.email, instrument_id: member.instrument_id, secondary_instrument_ids: ids,
      });
    } catch (err) {
      onError(err.message);
    }
    onChanged();
  }

  async function changeEmail(member, value) {
    if (value.trim() === (member.email ?? '')) return;
    try {
      await api.updateMember(member.id, { name: member.name, email: value, instrument_id: member.instrument_id });
    } catch (err) {
      onError(err.message);
    }
    onChanged(); // also resets the field if the save failed
  }

  const meMember = members.find((m) => m.is_me);
  const adminCount = members.filter((m) => m.is_admin).length;

  async function toggleAdmin(member) {
    const makeAdmin = !member.is_admin;
    const question = makeAdmin
      ? `Make ${member.name} an admin? Admins can RSVP for anyone in the band and make other admins.`
      : member.is_me
        ? 'Remove your own admin access? You’ll need another admin to give it back.'
        : `Remove ${member.name}’s admin access?`;
    if (!window.confirm(question)) return;
    try {
      await api.setAdmin(member.id, makeAdmin);
    } catch (err) {
      onError(err.message);
    }
    onChanged();
  }

  async function remove(member) {
    const question = member.is_me
      ? 'Leave this band? Your RSVPs will be removed, and you’ll need an invite link to rejoin.'
      : `Remove ${member.name} from the band? Their RSVPs will be removed too.`;
    if (!window.confirm(question)) return;
    try {
      await api.removeMember(member.id);
      if (member.is_me) onLeft();
      else onChanged();
    } catch (err) {
      onError(err.message);
    }
  }

  const instrumentOptions = (
    <>
      <option value="">No instrument</option>
      {instruments.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
    </>
  );

  return (
    <section className="card">
      <h1>Band members</h1>

      <div className="invite">
        <div>
          <strong>Invite bandmates</strong>
          <p className="muted small-text">
            Anyone with this link can sign in and join. They can claim a profile below that has no account yet.
          </p>
        </div>
        <div className="invite-link">
          <input readOnly value={inviteLink || 'Loading…'} onFocus={(e) => e.target.select()} aria-label="Invite link" />
          <button className="primary" type="button" onClick={copyInvite} disabled={!inviteLink}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button className="ghost" type="button" onClick={resetInvite} title="Replace the link so the old one stops working">
            New link
          </button>
        </div>
      </div>

      <TimeZoneSetting bandId={bandId} timezone={timezone} onSaved={setTimezone} onError={onError} />
      <BandInstruments
        bandId={bandId}
        instruments={instruments}
        isAdmin={isAdmin}
        onSaved={(list) => { setInstruments(list); onChanged(); }}
        onError={onError}
      />

      <p className="muted small-text add-member-hint">
        Add someone who isn’t on Funklist yet (like a sub). They can claim the profile later through the invite link.
      </p>
      <form className="add-member" onSubmit={handleAdd}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required />
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional)" />
        <select value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)}>
          {instrumentOptions}
        </select>
        <button className="primary" type="submit">Add member</button>
      </form>

      {members.length === 0 ? (
        <p className="muted">No members yet. Add yourself first!</p>
      ) : (
        <div className="table-wrap">
        <table className="members">
          <thead>
            <tr><th>Name</th><th>Instrument</th><th>Also plays</th><th>Email <span className="muted">(for event emails)</span></th><th /></tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>
                  {m.name}{' '}
                  {m.is_admin && <span className="pill admin">admin</span>}{' '}
                  {m.is_me ? (
                    <span className="pill">you</span>
                  ) : !m.has_account && (
                    <span className="pill no-account" title="Hasn't signed up yet; they can claim this profile via the invite link">
                      no account
                    </span>
                  )}
                </td>
                <td>
                  <select value={m.instrument_id ?? ''} onChange={(e) => changeInstrument(m, e.target.value)}>
                    {instrumentOptions}
                  </select>
                </td>
                <td>
                  <SecondaryPicker member={m} instruments={instruments} onSave={(ids) => changeSecondaries(m, ids)} />
                </td>
                <td>
                  <input
                    key={`${m.id}:${m.email ?? ''}`}
                    type="email"
                    className="email-input"
                    defaultValue={m.email ?? ''}
                    placeholder="No email"
                    aria-label={`Email for ${m.name}`}
                    onBlur={(e) => changeEmail(m, e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  />
                </td>
                <td className="right nowrap">
                  {meMember?.is_admin && m.has_account && !(m.is_admin && adminCount === 1) && (
                    <button className="ghost small admin-toggle" onClick={() => toggleAdmin(m)}>
                      {m.is_admin ? 'Remove admin' : 'Make admin'}
                    </button>
                  )}
                  <button className="ghost danger small" onClick={() => remove(m)}>
                    {m.is_me ? 'Leave band' : 'Remove'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </section>
  );
}
