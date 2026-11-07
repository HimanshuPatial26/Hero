import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

export function BrandMark(props: P) {
  const rays = Array.from({ length: 12 }, (_, i) => i * 30);
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <g fill="currentColor">
        {rays.map((deg) => (
          <rect key={deg} x="11.1" y="2.6" width="1.8" height="5.6" rx="0.9" transform={`rotate(${deg} 12 12)`} />
        ))}
      </g>
      <circle cx="12" cy="12" r="2.3" fill="#0b0f0b" />
    </svg>
  );
}

export function ArrowRight(props: P) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
      <path d="M3 8h9.5M8.5 4l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BarsIcon(props: P) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
      <rect x="2.5" y="10" width="2.2" height="4" rx="0.6" />
      <rect x="6.9" y="6.5" width="2.2" height="7.5" rx="0.6" />
      <rect x="11.3" y="2.5" width="2.2" height="11.5" rx="0.6" />
    </svg>
  );
}

export function PenIcon(props: P) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
      <path
        d="M10.4 3.1l2.5 2.5-7.1 7.1-3.1.6.6-3.1 7.1-7.1zM9.2 4.3l2.5 2.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ---- "Trusted by" marks (original, generic geometric logos) ---- */

export function LogoHex(props: P) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" {...props}>
      <g stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round">
        <path d="M9.2 4.5h13.6L29.6 16l-6.8 11.5H9.2L2.4 16z" />
        <path d="M11 7.6h10l5 8.4-5 8.4H11L6 16z" />
        <path d="M12.8 10.6h6.4L22.4 16l-3.2 5.4h-6.4L9.6 16z" />
        <path d="M9.2 4.5L11 7.6l1.8 3M22.8 4.5L21 7.6l-1.8 3M29.6 16H26h-3.6M22.8 27.5L21 24.4l-1.8-3M9.2 27.5l1.8-3.1 1.8-3M2.4 16H6h3.6" />
      </g>
    </svg>
  );
}

export function LogoN(props: P) {
  return (
    <svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true" {...props}>
      {/* left stem + stepped diagonal + right stem, with a detached top-right block */}
      <path d="M4 4h6.4L22 18.2V13h6v15h-6.4L10 13.8V28H4z" />
      <rect x="22" y="4" width="6" height="6.2" />
    </svg>
  );
}

export function LogoChain(props: P) {
  return (
    <svg viewBox="0 0 52 24" fill="none" aria-hidden="true" {...props}>
      <g stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        {[11, 25, 39].map((cx) => (
          <rect key={cx} x={cx - 8.5} y="7.2" width="17" height="9.6" rx="4.8" transform={`rotate(-38 ${cx} 12)`} />
        ))}
      </g>
    </svg>
  );
}
