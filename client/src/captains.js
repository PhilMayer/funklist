// Gig captains (up to two per gig) get 🧑‍✈️ before their name wherever the gig lists them.
export const CAPTAIN = '🧑‍✈️';
export const MAX_CAPTAINS = 2;
export const captainLabel = (name, isCaptain) => (isCaptain ? `${CAPTAIN} ${name}` : name);
