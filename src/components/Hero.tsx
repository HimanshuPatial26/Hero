import { useCallback, useEffect, useRef, useState } from 'react';
import HeroCanvas from './HeroCanvas';
import RevealHeadline from './RevealHeadline';
import {
  ArrowRight,
  BarsIcon,
  BrandMark,
  LogoChain,
  LogoHex,
  LogoN,
  PenIcon,
} from './icons';

const NAV_LINKS = ['Solutions', 'Products', 'Download', 'Resources'];

// Intro timeline (seconds after the WebGL scene paints its first frame)
const T = {
  line: 0.45,
  badge: 0.6,
  title: 0.62,
  nav: 0.66,
  sub: 0.6,
  cta: 0.86,
  trusted: 1.12,
  card: 1.1,
};
const CHAR_STAGGER = 0.05;

export default function Hero() {
  const heroRef = useRef<HTMLElement>(null);
  const [ready, setReady] = useState(false);

  const onReady = useCallback(() => setReady(true), []);

  // Safety net: never leave the copy hidden if WebGL is slow to start.
  useEffect(() => {
    const id = window.setTimeout(() => setReady(true), 2500);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <section
      ref={heroRef}
      className={`hero${ready ? ' is-ready' : ''}`}
      style={
        {
          '--t-line': `${T.line}s`,
          '--t-badge': `${T.badge}s`,
          '--t-nav': `${T.nav}s`,
          '--t-sub': `${T.sub}s`,
          '--t-cta': `${T.cta}s`,
          '--t-trusted': `${T.trusted}s`,
          '--t-card': `${T.card}s`,
        } as React.CSSProperties
      }
    >
      <HeroCanvas eventTarget={heroRef} onReady={onReady} />

      <header className="nav">
        <div className="nav__inner">
          <a href="#" className="brand anim anim--down" aria-label="web3.ia home">
            <span className="brand__mark">
              <BrandMark />
            </span>
            <span className="brand__name">web3.ia</span>
          </a>

          <nav className="nav__links anim anim--down" aria-label="Primary">
            {NAV_LINKS.map((l) => (
              <a key={l} href="#" className="nav__link">
                {l}
              </a>
            ))}
          </nav>

          <div className="nav__actions anim anim--down">
            <a href="#" className="nav__signup">
              Sign up
            </a>
            <a href="#" className="nav__signin">
              Sign in
            </a>
          </div>
        </div>
        <div className="nav__rule" aria-hidden="true" />
      </header>

      <div className="hero__body">
        <div className="hero__copy">
          <a href="#" className="badge anim anim--up">
            <span className="badge__dot" />
            <span>Web3.ai V2 is out</span>
            <ArrowRight className="badge__arrow" />
          </a>

          <RevealHeadline lines={['The Core DNA of', 'Web3 Infrastructure']} delay={T.title} stagger={CHAR_STAGGER} />

          <p className="hero__sub anim anim--up-lg">
            Transform fragmented, high-volume data into structured insights that drive confident decisions.
          </p>

          <a href="#" className="cta anim anim--up-lg">
            <span>See it in action</span>
            <ArrowRight className="cta__arrow" />
          </a>
        </div>

        <div className="hero__footer">
          <div className="trusted anim anim--up">
            <p className="trusted__label">Trusted by teams across finance, product, and operations.</p>
            <ul className="trusted__logos" aria-label="Customer logos">
              <li>
                <LogoHex className="trusted__logo trusted__logo--hex" />
              </li>
              <li>
                <LogoN className="trusted__logo trusted__logo--n" />
              </li>
              <li>
                <LogoChain className="trusted__logo trusted__logo--chain" />
              </li>
            </ul>
          </div>

          <article className="entity-card">
            <div className="entity-card__thumb">
              <img src="/media/entity-graph.webp" alt="" width={108} height={110} decoding="async" />
            </div>
            <div className="entity-card__body">
              <h3 className="entity-card__title">
                <BarsIcon className="entity-card__icon" />
                Entity Graph
              </h3>
              <p className="entity-card__text">
                Map wallets, contracts, and protocols into a unified graph. Reveal hidden connections and track
                activities with confidence.
              </p>
            </div>
          </article>
        </div>
      </div>

      <button type="button" className="fab" aria-label="Edit">
        <PenIcon />
      </button>
    </section>
  );
}
