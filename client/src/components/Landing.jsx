import { useEffect, useRef } from 'react';
import '@fontsource/permanent-marker/latin-400.css';
import '../landing.css';

const YEAR = new Date().getFullYear();

// The public home page, shown to signed-out visitors. Its buttons are real links (/?signup, /?signin)
// so they work in a new tab; a plain click calls onStart('register' | 'signin') instead.
// The product shots are drawn with HTML so they stay sharp and match the real screens.
export default function Landing({ onStart }) {
  const root = useRef(null);
  useReveal(root);

  return (
    <div className="lp" ref={root}>
      <nav className="lp-nav" aria-label="Funklist">
        <div className="lp-nav-inner">
          <a className="lp-logo" href="/" aria-label="Funklist home">
            <Mark /> Funklist
          </a>
          <StartLink mode="signin" className="lp-nav-signin" onStart={onStart}>Sign in</StartLink>
        </div>
      </nav>

      <main>
        <Hero onStart={onStart} />
        <Marquee />
        <LineupFeature />
        <DoublingFeature />
        <CalendarFeature />
        <AlsoList />
        <FinalCta onStart={onStart} />
      </main>

      <footer className="lp-footer">
        <div className="lp-checker" aria-hidden="true" />
        <div className="lp-wrap lp-footer-inner">
          <div className="lp-footer-brand">
            <a className="lp-logo" href="/"><Mark /> Funklist</a>
            <p>Rehearsal and gig attendance for bands.</p>
          </div>
          <div className="lp-footer-links">
            <StartLink mode="register" onStart={onStart}>Make a band</StartLink>
            <StartLink mode="signin" onStart={onStart}>Sign in</StartLink>
          </div>
        </div>
        <p className="lp-wrap lp-fineprint">
          © {YEAR} Funklist. Turn it up. Show up on time.
        </p>
      </footer>
    </div>
  );
}

function StartLink({ mode, onStart, className, children }) {
  function handleClick(e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; // new tab or window
    e.preventDefault();
    onStart(mode);
  }
  return (
    <a href={mode === 'register' ? '/?signup' : '/?signin'} className={className} onClick={handleClick}>
      {children}
    </a>
  );
}

// Fades sections in as they scroll into view. Uses a data attribute, not className, so React
// re-renders can't undo it.
function useReveal(root) {
  useEffect(() => {
    const items = root.current.querySelectorAll('.lp-reveal');
    if (!('IntersectionObserver' in window)) {
      items.forEach((el) => { el.dataset.in = ''; });
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.dataset.in = '';
        observer.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    items.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [root]);
}

/* ---------- Hero ---------- */

const GIG_SECTIONS = [
  { name: 'Vocals', people: [['Dee', 'yes']] },
  { name: 'Percussion', people: [['Marco', 'yes'], ['Priya', 'yes'], ['Jules', 'iffy']] },
  { name: 'Trumpets', people: [['Ana', 'yes'], ['Ray', 'yes'], ['Kit', 'pending']] },
  { name: 'Midhorns', people: [['Lou', 'yes'], ['Sam', 'yes']] },
  { name: 'Saxophones', people: [['Tess', 'yes'], ['Omar', 'yes'], ['Sam', 'yes', true]] },
  { name: 'Tubas', people: [['Bo', 'no']] },
];

function Hero({ onStart }) {
  return (
    <section className="lp-hero">
      <div className="lp-wrap">
        <h1 className="lp-h1">
          <span className="lp-h1-line">
            For bands who{' '}
            <span className="lp-scribble">
              maybe
              <svg viewBox="0 0 300 24" preserveAspectRatio="none" aria-hidden="true">
                <path d="M4 15 C 40 5, 70 21, 110 12 S 180 4, 220 13 S 280 18, 296 8" />
              </svg>
            </span>{' '}
            have rehearsal this weekend.
          </span>
          <span className="lp-h1-line lp-grad">The Funklist abides.</span>
        </h1>
        <p className="lp-lede lp-hero-lede">
          Funklist keeps track of who’s coming to rehearsals and gigs, section by section, so you know
          whether you’ve got enough trumpets <b>before anyone loads the van.</b> It’s free.
        </p>
        <div className="lp-ctas">
          <StartLink mode="register" className="lp-btn lp-btn-primary" onStart={onStart}>
            Make a band
          </StartLink>
          <StartLink mode="signin" className="lp-btn lp-btn-ghost" onStart={onStart}>Sign in</StartLink>
        </div>

        <div className="lp-stage lp-reveal">
          <SafetyPin className="lp-pin" />
          <div
            className="lp-window"
            role="img"
            aria-label="Funklist’s event list: the Halloween Stomp gig still needs one tuba, and Tuesday’s rehearsal has quorum."
          >
            <div className="lp-window-bar" aria-hidden="true">
              <i /><i /><i />
              <span>funklist.fly.dev</span>
            </div>
            <div className="lp-app" aria-hidden="true">
              <div className="lp-app-top">
                <span className="lp-app-brand"><Mark /> Funklist</span>
                <span className="lp-select">The Funklist</span>
              </div>
              <div className="lp-app-toolbar">
                <span className="lp-segmented"><b>Upcoming</b><span>Past</span></span>
                <span className="lp-app-actions">
                  <span className="lp-fake-btn">Calendar sync</span>
                  <span className="lp-fake-btn primary">+ New event</span>
                </span>
              </div>
              <EventCard
                type="gig"
                title="Halloween Stomp"
                meta="Sat, Oct 31 · Call 7:00 PM · Hit 8:30 PM"
                venue="The Crypt, Eastside"
                quorum={{ needed: 1, detail: '1 tuba' }}
                sections={GIG_SECTIONS}
                rsvp="yes"
              />
              <EventCard
                type="rehearsal"
                title="Tuesday rehearsal"
                meta="Tue, Nov 3 · Call 7:00 PM"
                venue="Practice space, room B"
                quorum={{ met: true }}
                confirmed
              />
            </div>
          </div>
          <p className="lp-note lp-note-tuba" aria-hidden="true">
            uh oh. find a tuba.
            <Arrow />
          </p>
          <p className="lp-sticker lp-sticker-pink lp-sticker-iffy" aria-hidden="true">iffy is a valid answer</p>
        </div>
      </div>
    </section>
  );
}

function EventCard({ type, title, meta, venue, quorum, sections, rsvp, confirmed }) {
  return (
    <div className="lp-event">
      <div className="lp-event-head">
        <span className={`lp-badge ${type}`}>{type}</span>
        <span className="lp-event-main">
          <strong>
            {title}
            {confirmed && <span className="lp-tag">Confirmed</span>}
          </strong>
          <span>{meta}</span>
          {venue && <span>{venue}</span>}
        </span>
        <Quorum {...quorum} />
      </div>
      {sections && <Sections sections={sections} />}
      {rsvp && (
        <div className="lp-quick-rsvp">
          <span>Your RSVP</span>
          <Rsvp selected={rsvp} />
        </div>
      )}
    </div>
  );
}

function Quorum({ met, needed, detail }) {
  if (met) return <span className="lp-q met"><span className="lp-q-badge">✓ Quorum</span></span>;
  return (
    <span className="lp-q short">
      <span className="lp-q-badge">{needed} more needed</span>
      <small>{detail}</small>
    </span>
  );
}

function Sections({ sections }) {
  return (
    <div className="lp-sections">
      {sections.map((s) => (
        <div key={s.name} className="lp-col">
          <h4>{s.name}</h4>
          <ul>
            {s.people.map(([name, status, secondary]) => (
              <li key={name} className={`${status}${secondary ? ' secondary' : ''}`}>
                {secondary ? `(${name})` : name}
                {status === 'iffy' && ' ?'}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Rsvp({ selected }) {
  return (
    <span className="lp-rsvp">
      {['Yes', 'Iffy', 'No'].map((label) => (
        <span key={label} className={selected === label.toLowerCase() ? `on ${selected}` : ''}>{label}</span>
      ))}
    </span>
  );
}

/* ---------- Marquee ---------- */

const CHANTS = [
  'Who’s in',
  'Who’s iffy',
  'Who’s bailing',
  'Do we have enough trumpets?',
  'Call time is not a suggestion',
  'Doublers count once',
  'Synced to your calendar',
];

function Marquee() {
  return (
    <div className="lp-marquee" aria-hidden="true">
      <div className="lp-tape lp-tape-plaid" />
      <div className="lp-tape lp-tape-pink">
        <div className="lp-tape-track">
          {[...CHANTS, ...CHANTS].map((c, i) => (
            <span key={i}>{c}<Star /></span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Feature: lineup ---------- */

const LINEUP = [
  ['Vocals', 1],
  ['Percussion', 2],
  ['Trumpets', 2],
  ['Midhorns', 2],
  ['Saxophones', 2],
  ['Tubas', 1],
];

function LineupFeature() {
  return (
    <section className="lp-feature" id="lineup">
      <div className="lp-wrap lp-feature-grid">
        <div className="lp-feature-copy lp-reveal">
          <p className="lp-eyebrow"><Star /> Shaped like your band</p>
          <h2 className="lp-h2">Quorum? <span className="lp-grad">Quorum!</span></h2>
          <p className="lp-lede">
            Your band gets <b>its own instruments, in its own order, with its own minimums.</b> Need two
            trumpets and a tuba before it counts as a rehearsal? Every event shows “✓&nbsp;Quorum” or exactly
            who’s missing.
          </p>
        </div>

        <div className="lp-visual lp-reveal">
          <div className="lp-panel lp-lineup" role="img" aria-label="A band’s instrument list with a minimum for each: Vocals 1, Percussion 2, Trumpets 2, Midhorns 2, Saxophones 2, Tubas 1.">
            <div className="lp-panel-head" aria-hidden="true">
              <b>Instruments</b>
              <span>The Funklist</span>
            </div>
            <div className="lp-lineup-cols" aria-hidden="true"><span /><span>Instrument</span><span>Minimum</span></div>
            <ol aria-hidden="true">
              {LINEUP.map(([name, min]) => (
                <li key={name} className={name === 'Midhorns' ? 'lifted' : undefined}>
                  <Grip />
                  <span className="lp-field">{name}</span>
                  <span className="lp-stepper"><i>−</i><b>{min}</b><i>+</i></span>
                </li>
              ))}
            </ol>
            <span className="lp-add" aria-hidden="true">+ Add instrument</span>
          </div>
          <div className="lp-float lp-float-met" aria-hidden="true">
            <span className="lp-q met"><span className="lp-q-badge">✓ Quorum</span></span>
            <small>Tuesday rehearsal</small>
          </div>
          <div className="lp-float lp-float-short" aria-hidden="true">
            <span className="lp-q short"><span className="lp-q-badge">2 more needed</span></span>
            <small>1 trumpet, 1 tuba</small>
          </div>
          <p className="lp-note lp-note-lineup" aria-hidden="true">brass band? big band? mariachi? sure.</p>
        </div>
      </div>
    </section>
  );
}

/* ---------- Feature: doubling ---------- */

function DoublingFeature() {
  return (
    <section className="lp-feature lp-feature-flip" id="doublers">
      <div className="lp-wrap lp-feature-grid">
        <div className="lp-feature-copy lp-reveal">
          <p className="lp-eyebrow"><Star /> Doublers welcome</p>
          <h2 className="lp-h2">Plays tenor. And bari. <span className="lp-grad">And flute, as a last resort.</span></h2>
          <p className="lp-lede">
            Members list <b>everything they play.</b> At each event they pick what they’re playing that night,
            and they count <b>once, toward that section.</b> Your sax player covering the midhorn chair fills
            the gap without getting counted twice.
          </p>
         
        </div>

        <div className="lp-visual lp-doubling lp-reveal" role="img" aria-label="Sam usually plays saxophone and also plays midhorn. Sam RSVPs Yes, playing midhorn, so Sam counts toward Midhorns and shows in parentheses under Saxophones.">
          <div className="lp-panel lp-member" aria-hidden="true">
            <span className="lp-avatar">S</span>
            <span className="lp-member-name">
              <b>Sam</b>
              <span>Saxophones</span>
            </span>
            <span className="lp-also">
              <small>Also plays</small>
              <span className="lp-chip">Midhorns</span>
              <span className="lp-chip">Flute</span>
            </span>
          </div>

          <div className="lp-panel lp-rsvp-box" aria-hidden="true">
            <span className="lp-rsvp-title">
              <small>Halloween Stomp</small>
              <b>Can you make it?</b>
            </span>
            <Rsvp selected="yes" />
            <span className="lp-playing">
              <span>Playing</span>
              <span className="lp-select">Midhorns</span>
            </span>
          </div>

          <div className="lp-panel lp-split" aria-hidden="true">
            <div className="lp-col">
              <h4>Midhorns</h4>
              <ul>
                <li className="yes">Lou</li>
                <li className="yes">
                  <span className="lp-circled">Sam</span>
                  <span className="lp-covering">Usually plays Saxophones</span>
                </li>
              </ul>
            </div>
            <div className="lp-col">
              <h4>Saxophones</h4>
              <ul>
                <li className="yes">Tess</li>
                <li className="yes">Omar</li>
                <li className="yes secondary"><span className="lp-circled">(Sam)</span></li>
              </ul>
            </div>
            <p className="lp-split-foot"><span className="lp-q met"><span className="lp-q-badge">✓ Quorum</span></span> Sam counts toward Midhorns only.</p>
          </div>

          <p className="lp-note lp-note-sam" aria-hidden="true">
            same Sam. counts once.
            <Arrow />
          </p>
        </div>
      </div>
    </section>
  );
}

/* ---------- Feature: calendar ---------- */

const DAYS = [
  ['Mon', 26], ['Tue', 27], ['Wed', 28], ['Thu', 29], ['Fri', 30], ['Sat', 31], ['Sun', 1],
];
// start/length are hours after 4 PM.
const CAL_EVENTS = [
  { day: 1, start: 3, length: 2.5, title: 'Rehearsal', time: '7–9:30 PM' },
  { day: 3, start: 2, length: 2, title: 'Brass Menagerie rehearsal', time: '6–8 PM' },
  { day: 4, start: 4, length: 2, title: 'Open mic', time: 'Cancelled', kind: 'gone' },
  { day: 5, start: 3, length: 4.5, title: 'Halloween Stomp', time: '7–11:30 PM' },
  { day: 6, start: 0, length: 2, title: 'Porch gig', time: 'Tentative', kind: 'tentative' },
];

function CalendarFeature() {
  return (
    <section className="lp-feature" id="calendar">
      <div className="lp-wrap">
        <div className="lp-feature-copy lp-center lp-reveal">
          <p className="lp-eyebrow"><Star /> Calendar sync</p>
          <h2 className="lp-h2">Every gig in your calendar. <span className="lp-grad">Kept up to date.</span></h2>
          <p className="lp-lede">
            Subscribe once in <b>Google Calendar or Apple Calendar</b> (Outlook works too) and every rehearsal
            and gig from all your bands shows up there. Not confirmed yet? It’s marked tentative. Cancelled? It
            drops off.
          </p>
        </div>

        <div className="lp-cal-stage lp-reveal">
          <span className="lp-tape-bit lp-tape-bit-a" aria-hidden="true" />
          <span className="lp-tape-bit lp-tape-bit-b" aria-hidden="true" />
          <div className="lp-panel lp-cal" role="img" aria-label="A calendar week with Funklist events: a rehearsal Tuesday, another band’s rehearsal Thursday, a cancelled open mic Friday, the Halloween Stomp gig Saturday, and a tentative porch gig Sunday.">
            <div className="lp-cal-head" aria-hidden="true">
              <b>Oct 26 – Nov 1</b>
              <span className="lp-cal-apps">
                <span><CalIcon /> Apple Calendar</span>
                <span><CalIcon /> Google Calendar</span>
              </span>
            </div>
            <div className="lp-cal-grid" aria-hidden="true">
              <div className="lp-cal-gutter">
                <span />
                {['4 PM', '6 PM', '8 PM', '10 PM'].map((h) => <small key={h}>{h}</small>)}
              </div>
              {DAYS.map(([name, date], i) => (
                <div key={name} className={`lp-cal-day${i < 3 ? ' lp-cal-early' : ''}`}>
                  <div className={`lp-cal-date${date === 31 ? ' hot' : ''}`}>
                    <small>{name}</small>
                    <b>{date}</b>
                  </div>
                  <div className="lp-cal-body">
                    {CAL_EVENTS.filter((e) => e.day === i).map((e) => (
                      <div
                        key={e.title}
                        className={`lp-cal-ev ${e.kind || ''}`}
                        style={{ '--start': e.start, '--length': e.length }}
                      >
                        <b>{e.title}</b>
                        <span>{e.time}</span>
                      </div>
                    ))}
                    {CAL_EVENTS.some((e) => e.day === i && e.kind === 'gone') && (
                      <span className="lp-poof">poof.</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <ul className="lp-trio lp-reveal">
          <li>
            <b>Apple Calendar</b>
            <span>One tap to subscribe on iPhone, iPad or Mac.</span>
          </li>
          <li>
            <b>Google Calendar</b>
            <span>We copy your link. You paste it into Google’s “From URL.” Done.</span>
          </li>
          <li>
            <b>Always current</b>
            <span>Changes sync on their own. Google checks about once a day.</span>
          </li>
        </ul>
      </div>
    </section>
  );
}

/* ---------- Everything else ---------- */

const ALSO = [
  ['Yes, no or iffy', 'Iffy comes with a reason, like “babysitter TBD.”'],
  ['Call time, hit time, set list', 'Plus the venue and notes, all on the event page.'],
  ['Emails when something changes', 'New events, confirmations and cancellations go to the band.'],
  ['Confirm or cancel', 'Admins call it once they see who’s coming.'],
  ['Invite link', 'Bandmates join with a link, using a password or Google.'],
  ['More than one band', 'Switch from the top bar. One calendar link covers all of them.'],
];

function AlsoList() {
  return (
    <section className="lp-feature lp-also-section">
      <div className="lp-wrap">
        <div className="lp-feature-copy lp-center lp-reveal">
          <p className="lp-eyebrow"><Star /> Also in there</p>
        </div>
        <ul className="lp-also-list lp-reveal">
          {ALSO.map(([title, text]) => (
            <li key={title}><b>{title}</b><span>{text}</span></li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ---------- Final call to action ---------- */

function FinalCta({ onStart }) {
  return (
    <section className="lp-final">
      <div className="lp-wrap">
        <div className="lp-final-card lp-reveal">
          <div className="lp-studs" aria-hidden="true" />
          <h2 className="lp-h2">It’s <span className="lp-grad">free.</span></h2>
          <p className="lp-lede">
            Make a band, set up your instruments, and send everyone the invite link.
          </p>
          <div className="lp-ctas">
            <StartLink mode="register" className="lp-btn lp-btn-primary" onStart={onStart}>
              Make a band
            </StartLink>
            <StartLink mode="signin" className="lp-btn lp-btn-ghost" onStart={onStart}>Sign in</StartLink>
          </div>
          <div className="lp-studs" aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}

/* ---------- Little drawings ---------- */

// Beamed eighth notes on a pink-to-violet tile (the same drawing as client/public/favicon.svg).
function Mark() {
  return (
    <span className="lp-mark" aria-hidden="true">
      <svg viewBox="0 0 64 64">
        <path d="M24 17.5 L47 12 V19 L24 24.5 Z" />
        <rect x="24" y="17.5" width="4.2" height="27" />
        <rect x="42.8" y="13" width="4.2" height="26" />
        <ellipse cx="21.5" cy="45" rx="7" ry="5.2" transform="rotate(-22 21.5 45)" />
        <ellipse cx="40.3" cy="39.5" rx="7" ry="5.2" transform="rotate(-22 40.3 39.5)" />
      </svg>
    </span>
  );
}

function SafetyPin({ className }) {
  return (
    <svg className={className} viewBox="0 0 140 44" aria-hidden="true">
      <defs>
        <linearGradient id="lp-steel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f5f5f7" />
          <stop offset="0.5" stopColor="#8e8e93" />
          <stop offset="1" stopColor="#d1d1d6" />
        </linearGradient>
      </defs>
      <g fill="none" stroke="url(#lp-steel)" strokeWidth="3" strokeLinecap="round">
        <path d="M112 14 H24 a8 8 0 1 0 0 16 H116" />
        <circle cx="22" cy="22" r="4.5" />
      </g>
      <path d="M104 8 h18 a8 8 0 0 1 8 8 v12 a8 8 0 0 1 -8 8 h-18 z" fill="url(#lp-steel)" />
      <path d="M108 13 h12" stroke="#fff" strokeOpacity="0.7" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Arrow() {
  return (
    <svg className="lp-arrow" viewBox="0 0 80 56" aria-hidden="true">
      <path d="M6 6 C 26 4, 54 12, 64 42" />
      <path d="M53 35 L65 45 L71 31" />
    </svg>
  );
}

function Star() {
  return (
    <svg className="lp-star" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 1 L14.2 9.8 L23 12 L14.2 14.2 L12 23 L9.8 14.2 L1 12 L9.8 9.8 Z" />
    </svg>
  );
}

function Grip() {
  return (
    <svg className="lp-grip" viewBox="0 0 10 16" aria-hidden="true">
      {[3, 8, 13].map((y) => [2.5, 7.5].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.4" />))}
    </svg>
  );
}

function CalIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M1.5 6.5h13M5 1v3M11 1v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

