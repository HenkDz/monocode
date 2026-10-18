import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { IconButton } from "../../../app/shell/TitleBar";
import { useDragResize } from "../../../shared/hooks/useDragResize";
import { PanelRightToggle } from "../../../shared/ui/icons";

const MIN_WIDTH = 340;
const DEFAULT_WIDTH = 400;
let rememberedWidth = DEFAULT_WIDTH;
let rememberedArtifactWidth = 560;

/** The shared frame for a Mono's details and turn sidebars. */
export function MonoSidebar({
  open,
  kind,
  label,
  color,
  returnFocus,
  onInteract,
  windowControls,
  children,
}: {
  open: boolean;
  kind: "details" | "activity" | "prs" | "sessions" | "artifact" | "changes";
  label: string;
  color: string;
  returnFocus?: HTMLElement | null;
  onInteract?: () => void;
  windowControls?: ReactNode;
  children: ReactNode;
}) {
  // Readers (documents, diffs) need room; the turn sidebars stay narrow.
  const reader = kind === "artifact" || kind === "changes";
  const pane = useRef<HTMLElement | null>(null);
  const [keyboardWidth, setKeyboardWidth] = useState<number | null>(null);
  const maxWidth = () =>
    Math.min(
      window.innerWidth - 24,
      reader
        ? Math.min(840, Math.max(360, Math.round(window.innerWidth * 0.58)))
        : Math.min(440, Math.max(MIN_WIDTH, Math.round(window.innerWidth * 0.4))),
    );
  const minWidth = Math.min(reader ? 360 : MIN_WIDTH, maxWidth());
  const resize = useDragResize({
    min: minWidth,
    max: maxWidth,
    defaultWidth: keyboardWidth ?? (reader ? 560 : MIN_WIDTH),
    initial: reader ? rememberedArtifactWidth : rememberedWidth,
    direction: "left",
    onCommit: (width) => {
      rememberedWidth = width;
    },
  });
  useLayoutEffect(() => {
    if (keyboardWidth === null) return;
    // Keyboard sizing uses the same clamped commit as pointer resizing.
    resize.onDoubleClick();
    setKeyboardWidth(null);
  }, [keyboardWidth, resize.onDoubleClick]);
  useLayoutEffect(() => {
    if (!open) return;
    const panel = pane.current;
    const opener = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    return () => {
      if (opener?.isConnected && panel?.contains(document.activeElement))
        opener.focus({ preventScroll: true });
    };
  }, [open, returnFocus]);
  return (
    <aside
      ref={(element) => { pane.current = element; resize.setPaneRef(element); }}
      aria-label={label}
      aria-hidden={!open || undefined}
      inert={!open || undefined}
      data-mono-details={kind === "details" ? "" : undefined}
      data-mono-activity={kind === "activity" ? "" : undefined}
      data-mono-prs={kind === "prs" ? "" : undefined}
      data-mono-sessions={kind === "sessions" ? "" : undefined}
      data-open={open}
      onFocusCapture={onInteract}
      onPointerDownCapture={onInteract}
      style={
        {
          "--mono-color": color,
          "--mono-window-controls-width": windowControls
            ? "calc(7.5rem + 1px)"
            : "0px",
        } as CSSProperties
      }
      className="mono-details-panel relative flex h-full min-h-0 shrink-0 flex-col border-l border-stroke font-sans"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize Mono ${kind}`}
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth()}
        aria-valuenow={resize.width}
        tabIndex={open ? 0 : -1}
        className={`absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize touch-none focus-visible:bg-accent/30 focus-visible:outline-2 focus-visible:outline-accent ${resize.dragging ? "bg-content/15" : "hover:bg-content/10"}`}
        onPointerDown={resize.onPointerDown}
        onDoubleClick={resize.onDoubleClick}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(event.key)) return;
          event.preventDefault();
          const step = event.shiftKey ? 40 : 10;
          setKeyboardWidth(event.key === "Home" ? minWidth
            : event.key === "End" ? maxWidth()
              : event.key === "Enter" ? reader ? 560 : MIN_WIDTH
                : resize.width + (event.key === "ArrowLeft" ? step : -step));
        }}
      />
      {windowControls ? (
        <div className="absolute right-0 top-0 z-30 h-10">{windowControls}</div>
      ) : null}
      {children}
    </aside>
  );
}

export function MonoSidebarHeader({
  title,
  heading,
  onClose,
  children,
  actions,
}: {
  title: string;
  /** Richer content in place of the plain title text. */
  heading?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header
      className="flex h-10 shrink-0 items-stretch border-b border-stroke"
      style={{ paddingRight: "var(--mono-window-controls-width)" }}
      data-tauri-drag-region="deep"
    >
      {children ?? (
        <h3 className="flex min-w-0 flex-1 items-center pl-4 text-[13px] font-medium text-content">
          {heading ?? title}
        </h3>
      )}
      <div className="flex shrink-0 items-center gap-0.5 px-3">
        {actions}
        <IconButton
          label={`Hide ${title.toLowerCase()}`}
          active
          onClick={onClose}
        >
          <PanelRightToggle className="size-3.5" strokeWidth={1.75} />
        </IconButton>
      </div>
    </header>
  );
}
