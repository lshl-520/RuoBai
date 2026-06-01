import { Link } from "react-router-dom";

const highlights = [
  "React is the only active mainline here.",
  "Guangwei stays the default theme, with Classic as the second global theme.",
  "This shell is route-based now, but still intentionally lightweight.",
];

const nextStops = [
  "Home and auth are separated cleanly for future onboarding work.",
  "Backend auth/session calls stay real and same-origin.",
  "Old downstream profile and role setup pages stay explicitly TODO for now.",
];

export function HomePage() {
  return (
    <>
      <section className="rb-card hero-card home-hero">
        <div className="hero-copy">
          <p className="eyebrow">React mainline</p>
          <h1>Clean landing, real routing, no fake destination pages.</h1>
          <p className="lead">
            This React shell keeps the current migration honest: a calmer home
            page, a real auth route, and the same temporary post-auth decision
            logic until profile and role onboarding move over.
          </p>
          <div className="hero-actions">
            <Link className="primary-link" to="/auth">
              Open auth
            </Link>
            <a className="secondary-link" href="/index.html">
              View legacy public home
            </a>
          </div>
        </div>

        <div className="hero-panel">
          <div className="hero-note">
            <span className="hero-note-label">Current direction</span>
            <strong>Route first, then product surfaces.</strong>
            <p>
              We are keeping the migration safe by moving shared concerns into
              React before touching deeper app flows.
            </p>
          </div>
        </div>
      </section>

      <section className="rb-grid">
        <article className="rb-card section-card">
          <h2>What stays true</h2>
          <ul className="rb-list">
            {highlights.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="rb-card section-card">
          <h2>What this chunk unlocks</h2>
          <ul className="rb-list">
            {nextStops.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>
    </>
  );
}
