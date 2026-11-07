import { useEffect, useRef } from 'react';
import { HeroScene, type VideoSource } from '../webgl/HeroScene';

interface Props {
  eventTarget: React.RefObject<HTMLElement>;
  onReady: () => void;
}

/** Aspect ratio of the Blender render (1440×900). */
const VIDEO_ASPECT = 1.6;

function supportsWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Pick the Blender loop encode that fits the screen (smaller file on phones). */
function videoSources(): VideoSource[] {
  const px = Math.max(window.innerWidth, window.innerHeight * VIDEO_ASPECT) * Math.min(window.devicePixelRatio || 1, 2);
  const size = px <= 1100 ? 960 : 1440;
  return [
    { src: `/media/dna-loop-${size}.webm`, type: 'video/webm; codecs="vp9"' },
    { src: `/media/dna-loop-${size}.mp4`, type: 'video/mp4; codecs="avc1.640028"' },
  ];
}

export default function HeroCanvas({ eventTarget, onReady }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!supportsWebGL()) {
      el.classList.add('hero-canvas--fallback');
      readyRef.current();
      return;
    }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scene = new HeroScene(el, {
      eventTarget: eventTarget.current ?? el,
      reducedMotion,
      video: { sources: videoSources(), aspect: VIDEO_ASPECT },
      onReady: () => readyRef.current(),
    });
    return () => scene.dispose();
  }, [eventTarget]);

  return <div ref={ref} className="hero-canvas" />;
}
