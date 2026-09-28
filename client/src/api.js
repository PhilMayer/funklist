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

  instruments: () => request('GET', '/instruments'),
  addInstrument: (name) => request('POST', '/instruments', { name }),

  bands: () => request('GET', '/bands'),
  createBand: (name, instrumentId) => request('POST', '/bands', { name, instrument_id: instrumentId || null }),
  band: (id) => request('GET', `/bands/${id}`),
  newInviteCode: (bandId) => request('POST', `/bands/${bandId}/invite`),
  invite: (code) => request('GET', `/invites/${encodeURIComponent(code)}`),
  joinBand: (code, choice) => request('POST', `/invites/${encodeURIComponent(code)}/join`, choice),

  members: (bandId) => request('GET', `/bands/${bandId}/members`),
  addMember: (bandId, member) => request('POST', `/bands/${bandId}/members`, member),
  updateMember: (id, member) => request('PUT', `/members/${id}`, member),
  removeMember: (id) => request('DELETE', `/members/${id}`),

  events: (bandId, when = 'upcoming') => request('GET', `/bands/${bandId}/events?when=${when}`),
  event: (id) => request('GET', `/events/${id}`),
  createEvent: (bandId, event) => request('POST', `/bands/${bandId}/events`, event),
  updateEvent: (id, event) => request('PUT', `/events/${id}`, event),
  deleteEvent: (id) => request('DELETE', `/events/${id}`),
  // status: 'confirmed' | 'cancelled'. Emails the band when it changes.
  setEventStatus: (id, status) => request('PUT', `/events/${id}/status`, { status }),
  // Always RSVPs as the signed-in member.
  // instrumentId: undefined keeps the current choice; null means the member's primary instrument.
  rsvp: (eventId, status, instrumentId) =>
    request('PUT', `/events/${eventId}/rsvp`, { status, instrument_id: instrumentId }),
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
