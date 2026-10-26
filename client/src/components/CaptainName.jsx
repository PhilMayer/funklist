import { CAPTAIN } from '../captains';

// A member's name, with the captain mark in front when they're captaining this gig.
// Screen readers hear "Captain" rather than the emoji's own name ("pilot").
export default function CaptainName({ name, captain }) {
  if (!captain) return name;
  return (
    <>
      <span className="captain-mark" role="img" aria-label="Captain" title="Captain">{CAPTAIN}</span> {name}
    </>
  );
}
