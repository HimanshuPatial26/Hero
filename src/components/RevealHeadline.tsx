import { Fragment, type CSSProperties } from 'react';

interface Props {
  lines: string[];
  /** seconds before the first character appears */
  delay: number;
  /** seconds between characters */
  stagger: number;
}

/**
 * Headline that reveals one character at a time (typewriter style with a soft
 * fade/blur per glyph). Words are kept together so wrapping stays natural.
 */
export default function RevealHeadline({ lines, delay, stagger }: Props) {
  let index = 0;
  const label = lines.join(' ');

  return (
    <h1 className="hero-title" aria-label={label}>
      {lines.map((line, li) => (
        <Fragment key={li}>
          <span className="hero-title__line" aria-hidden="true">
            {line.split(' ').map((word, wi, words) => (
              <Fragment key={wi}>
                <span className="hero-title__word">
                  {Array.from(word).map((ch, ci) => {
                    const style = { '--d': `${(delay + index++ * stagger).toFixed(3)}s` } as CSSProperties;
                    return (
                      <span className="hero-title__char" style={style} key={ci}>
                        {ch}
                      </span>
                    );
                  })}
                </span>
                {wi < words.length - 1 && (
                  <span
                    className="hero-title__char hero-title__space"
                    style={{ '--d': `${(delay + index++ * stagger).toFixed(3)}s` } as CSSProperties}
                  >
                    {' '}
                  </span>
                )}
              </Fragment>
            ))}
          </span>
          {li < lines.length - 1 && <br className="hero-title__br" />}
        </Fragment>
      ))}
    </h1>
  );
}
