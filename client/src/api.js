async function request(method, url, body) {
  const res = await fetch(`/api${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  // Session expired or signed out elsewhere: let the app drop back to the sign-in screen.
  if (res.status === 401 && !url.startsWith('/auth/')) window.dispatchEvent(new Event('funklist:signed-out'));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  authConfig: () => request('GET', '/auth/config'),
  me: () => request('GET', '/auth/me'),
  register: (fields) => request('POST', '/auth/register', fields),
  login: (username, password) => request('POST', '/auth/login', { username, password }),
  googleLogin: (credential) => request('POST', '/auth/google', { credential }),
  logout: () => request('POST', '/auth/logout'),
  forgotPassword: (identifier) => request('POST', '/auth/forgot', { identifier }),
  resetPassword: (token, password) => request('POST', '/auth/reset', { token, password }),
  changePassword: (current, next) => request('POST', '/auth/password', { current_password: current, new_password: next }),
  updateAccount: (fields) => request('PUT', '/auth/account', fields),

  // The lineup the create-band form starts from: [{ name, min_count }].
  instrumentDefaults: () => request('GET', '/instruments/defaults'),
  // A band's instruments in order, with quorum minimums: [{ id, name, min_count }].
  bandInstruments: (bandId) => request('GET', `/bands/${bandId}/instruments`),
  saveBandInstruments: (bandId, instruments) => request('PUT', `/bands/${bandId}/instruments`, { instruments }),

  bands: () => request('GET', '/bands'),
  // New bands use the creator's browser time zone (changeable later on the Members tab).
  // instruments: [{ name, min_count }] in order; instrumentName: the creator's (one of those names).
  createBand: (name, instruments, instrumentName) => request('POST', '/bands', {
    name,
    instruments,
    instrument_name: instrumentName || null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }),
  band: (id) => request('GET', `/bands/${id}`),
  updateBand: (id, fields) => request('PUT', `/bands/${id}`, fields),

  // Personal calendar subscription links ({ url, webcal_url }).
  calendarLinks: () => request('GET', '/me/calendar'),
  resetCalendarLinks: () => request('POST', '/me/calendar/reset'),
  newInviteCode: (bandId) => request('POST', `/bands/${bandId}/invite`),
  invite: (code) => request('GET', `/invites/${encodeURIComponent(code)}`),
  joinBand: (code, choice) => request('POST', `/invites/${encodeURIComponent(code)}/join`, choice),

  members: (bandId) => request('GET', `/bands/${bandId}/members`),
  addMember: (bandId, member) => request('POST', `/bands/${bandId}/members`, member),
  updateMember: (id, member) => request('PUT', `/members/${id}`, member),
  removeMember: (id) => request('DELETE', `/members/${id}`),

  events: (bandId, when = 'upcoming') => request('GET', `/bands/${bandId}/events?when=${when}`),
  eventsOverview: (bandId) => request('GET', `/bands/${bandId}/events/overview`),
  event: (id) => request('GET', `/events/${id}`),
  createEvent: (bandId, event) => request('POST', `/bands/${bandId}/events`, event),
  updateEvent: (id, event) => request('PUT', `/events/${id}`, event),
  deleteEvent: (id) => request('DELETE', `/events/${id}`),
  // status: 'confirmed' | 'cancelled'. Emails the band when it changes.
  setEventStatus: (id, status) => request('PUT', `/events/${id}/status`, { status }),
  // RSVPs as the signed-in member, or as memberId (admins only).
  // instrumentId: undefined keeps the current choice; null means the member's primary instrument.
  // iffyReason (Iffy only): undefined keeps the saved reason; '' clears it.
  rsvp: (eventId, status, instrumentId, iffyReason, memberId) =>
    request('PUT', `/events/${eventId}/rsvp`, {
      status, instrument_id: instrumentId, iffy_reason: iffyReason, member_id: memberId,
    }),
  setAdmin: (memberId, isAdmin) => request('PUT', `/members/${memberId}/admin`, { is_admin: isAdmin }),
};

export function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

export function formatTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
