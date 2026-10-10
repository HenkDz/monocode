import { useEffect, useRef } from "react";

export function EdgePulse({
  path,
  delay,
  reducedMotion,
  x,
  y,
}: {
  path: string;
  delay: number;
  reducedMotion: boolean;
  x: number;
  y: number;
}) {
  const motion = useRef<SVGAnimateMotionElement>(null);
  const visibility = useRef<SVGSetElement>(null);
  useEffect(() => {
    if (reducedMotion) return;
    const frame = requestAnimationFrame(() => {
      motion.current?.beginElementAt(delay);
      visibility.current?.beginElementAt(delay);
    });
    return () => cancelAnimationFrame(frame);
  }, [path, delay, reducedMotion]);
  return (
    <circle
      r="5"
      cx={reducedMotion ? x : 0}
      cy={reducedMotion ? y : 0}
      opacity={reducedMotion ? 1 : 0}
    >
      {!reducedMotion && (
        <animateMotion
          ref={motion}
          dur="1.5s"
          begin="indefinite"
          fill="freeze"
          path={path}
        />
      )}
      {!reducedMotion && (
        <set
          ref={visibility}
          attributeName="opacity"
          to="1"
          begin="indefinite"
          dur="1.5s"
          fill="freeze"
        />
      )}
    </circle>
  );
}
