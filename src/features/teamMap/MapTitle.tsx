import { useLayoutEffect, useRef, useState } from "react";
import { Popover } from "../../shared/ui/Popover";

/** Measure at layout size, independently of the map's animated camera. */
export function MapTitle({ title }: { title: string }) {
  const element = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(title), [tooltip, setTooltip] = useState(false);
  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    const measure = () => {
      const probe = node.cloneNode() as HTMLSpanElement;
      probe.removeAttribute("id");
      Object.assign(probe.style, { position: "absolute", visibility: "hidden", display: "block", width: `${node.clientWidth}px`, maxHeight: "none", WebkitLineClamp: "unset" });
      node.parentElement!.append(probe);
      const words = title.split(/\s+/), height = parseFloat(getComputedStyle(node).lineHeight) * 2;
      probe.textContent = title;
      let result = title;
      if (node.clientWidth && Number.isFinite(height) && probe.scrollHeight > height + 1) {
        let low = 0, high = words.length;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          probe.textContent = `${words.slice(0, middle).join(" ")}…`;
          if (probe.scrollHeight <= height + 1) low = middle; else high = middle - 1;
        }
        result = low ? `${words.slice(0, low).join(" ")}…` : "…";
      }
      probe.remove(); setShown(result);
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(node);
    const target = node.closest("button") ?? node;
    const focus = () => setTooltip(true), blur = () => setTooltip(false);
    target.addEventListener("focus", focus); target.addEventListener("blur", blur);
    return () => { observer.disconnect(); target.removeEventListener("focus", focus); target.removeEventListener("blur", blur); };
  }, [title]);
  return <span className="zoom-map-title-anchor" onMouseEnter={() => setTooltip(true)} onMouseLeave={() => setTooltip(false)}>
    <span className="zoom-map-title" ref={element} title={title} aria-label={title}>{shown}</span>
    {tooltip && <Popover anchor={element} role="tooltip" autoFocus={false} className="zoom-map-title-tooltip" style={{ pointerEvents: "none", maxWidth: 360 }}>{title}</Popover>}
  </span>;
}
