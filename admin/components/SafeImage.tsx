'use client';

import { useEffect, useRef, useState } from 'react';

type Props = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string | null | undefined;
  /** Shown instead of the image when it is missing or fails twice. Defaults to nothing, so the container's own background shows. */
  fallback?: React.ReactNode;
};

/**
 * An image that never shows the browser's broken-image icon. It fades in once
 * loaded, retries once on failure (serverless cold starts can drop a request),
 * then gives way to the fallback.
 */
export function SafeImage({ src, fallback = null, className, style, onLoad, ...rest }: Props) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  // Reset when the source changes. This must run before the cache check below: React reuses
  // the same <img> when a list re-renders with new films, and a cached image never fires onLoad again.
  useEffect(() => {
    setAttempt(0);
    setLoaded(false);
    setFailed(false);
  }, [src]);

  // An image already in the browser cache can finish before React attaches onLoad;
  // check it once mounted so it never stays invisible.
  const ref = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth > 0) setLoaded(true);
  });

  if (!src || failed) return <>{fallback}</>;

  const url = attempt === 0 ? src : `${src}${src.includes('?') ? '&' : '?'}retry=${attempt}`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...rest}
      ref={ref}
      key={url}
      src={url}
      className={className}
      style={{ ...style, opacity: loaded ? 1 : 0, transition: 'opacity 0.2s ease' }}
      onLoad={(e) => {
        setLoaded(true);
        onLoad?.(e);
      }}
      onError={() => {
        if (attempt === 0) setTimeout(() => setAttempt(1), 800);
        else setFailed(true);
      }}
    />
  );
}
