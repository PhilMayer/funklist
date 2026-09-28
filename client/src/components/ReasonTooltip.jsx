import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Wraps a name and shows `reason` in a tooltip on hover, keyboard focus, or tap (touch screens).
// The tooltip is rendered into <body> with fixed positioning so containers that clip their
// contents (like the instrument grid on event cards) can't cut it off.
export default function ReasonTooltip({ reason, children }) {
  const ref = useRef(null);
  const tipRef = useRef(null);
  const [anchor, setAnchor] = useState(null); // the name's position while the tooltip is open
  const [shiftX, setShiftX] = useState(0);
  const id = useId();

  const show = () => {
    setShiftX(0);
    setAnchor(ref.current.getBoundingClientRect());
  };
  const hide = () => setAnchor(null);

  // Nudge the tooltip back inside the viewport if it would overflow on either side.
  useLayoutEffect(() => {
    if (!anchor || !tipRef.current) return;
    const { left, right } = tipRef.current.getBoundingClientRect();
    const margin = 8;
    if (left < margin) setShiftX(margin - left);
    else if (right > window.innerWidth - margin) setShiftX(window.innerWidth - margin - right);
  }, [anchor]);

  // A fixed-position tooltip would drift away from the name on scroll, so close it instead.
  useEffect(() => {
    if (!anchor) return undefined;
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, [anchor]);

  const below = anchor && anchor.top < 90; // not enough room above: open underneath
  return (
    <>
      <span
        ref={ref}
        className="has-reason"
        tabIndex={0}
        aria-describedby={anchor ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={show}
      >
        {children}
      </span>
      {anchor && createPortal(
        <span
          ref={tipRef}
          id={id}
          role="tooltip"
          className={`reason-tip ${below ? 'below' : ''}`}
          style={{ left: anchor.left + anchor.width / 2 + shiftX, top: below ? anchor.bottom + 8 : anchor.top - 8 }}
        >
          {reason}
        </span>,
        document.body
      )}
    </>
  );
}
