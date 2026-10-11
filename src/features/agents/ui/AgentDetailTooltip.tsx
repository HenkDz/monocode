import {
  cloneElement,
  useId,
  useState,
  type ComponentPropsWithoutRef,
  type ReactElement,
} from "react";
import { Popover } from "../../../shared/ui/Popover";

/** Reuses the row's button so details do not add another tab stop. */
export function AgentDetailTooltip({ detail, children }: {
  detail?: string;
  children: ReactElement<ComponentPropsWithoutRef<"button">>;
}) {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  if (!detail) return children;
  return (
    <>
      {cloneElement(children, {
        "aria-describedby": [children.props["aria-describedby"], id].filter(Boolean).join(" "),
        onFocus: event => {
          setAnchor(event.currentTarget);
          setFocused(true);
          children.props.onFocus?.(event);
        },
        onBlur: event => { setFocused(false); children.props.onBlur?.(event); },
        onMouseEnter: event => {
          setAnchor(event.currentTarget);
          setHovered(true);
          children.props.onMouseEnter?.(event);
        },
        onMouseLeave: event => { setHovered(false); children.props.onMouseLeave?.(event); },
      })}
      {(focused || hovered) && anchor ? (
        <Popover
          anchor={anchor}
          side="top"
          align="start"
          width={300}
          role="tooltip"
          id={id}
          onDismiss={() => { setFocused(false); setHovered(false); }}
          className="pointer-events-none px-2.5 py-2 text-xs leading-relaxed"
        >
          {detail}
        </Popover>
      ) : <span id={id} hidden>{detail}</span>}
    </>
  );
}
