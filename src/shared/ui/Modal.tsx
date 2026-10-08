import { NativePopupHost } from "./NativePopupHost";
import { X } from "./icons";
import { useContext, useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { LAYER } from "../lib/layers";
import { GlassBackdrop } from "../../app/shell/GlassBackdrop";

export type ModalSize = "sm" | "md";

const WIDTH: Record<ModalSize, string> = {
  sm: "w-[min(420px,calc(100vw-24px))]",
  md: "w-[min(560px,calc(100vw-24px))]",
};

const TOP: Record<ModalSize, string> = {
  sm: "top-[22%]",
  md: "top-[10%]",
};

type Props = {
  onClose: () => void;
  title: string;
  description?: string;
  size?: ModalSize;
  /** Keeps the accessible title while letting focused content own the visual hierarchy. */
  minimalHeader?: boolean;
  /** Extra classes on the panel (fixed height, etc). */
  className?: string;
  /** Keep taller dialogs inside the viewport, scrolling their content. */
  fitViewport?: boolean;
  children: ReactNode;
};

export function ModalPanel({
  onClose,
  title,
  description,
  size = "md",
  minimalHeader = false,
  className,
  fitViewport = false,
  children,
}: Props) {
  const popupHost = useContext(NativePopupHost);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const uid = useId();
  const titleId = `${uid}-title`;
  const descriptionId = description ? `${uid}-desc` : undefined;

  useEffect(() => {
    const trigger = triggerRef.current;
    if (!minimalHeader) closeRef.current?.focus();
    return () => {
      if (trigger?.isConnected) trigger.focus();
    };
  }, [minimalHeader]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const panel = panelRef.current;
      const dialogs = document.querySelectorAll(
        '[role="dialog"][aria-modal="true"]',
      );
      if (!panel || dialogs[dialogs.length - 1] !== panel) return;
      if (
        event.target instanceof Element &&
        event.target.closest("[data-dialog-popover]")
      )
        return;
      if (event.key === "Tab" && !event.defaultPrevented) {
        const controls = [
          ...panel.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
          ),
        ].filter(
          (element) =>
            !element.closest('[hidden], [inert], [aria-hidden="true"]'),
        );
        const first = controls[0],
          last = controls[controls.length - 1];
        if (
          !first ||
          (event.shiftKey
            ? document.activeElement === first
            : document.activeElement === last) ||
          !panel.contains(document.activeElement)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
        return;
      }
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing)
        return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      className={
        popupHost
          ? "relative z-[1] w-full"
          : `absolute z-[1] left-1/2 ${fitViewport ? "top-1/2 -translate-y-1/2" : TOP[size]} ${WIDTH[size]} -translate-x-1/2`
      }
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onMouseDown={(event) => event.stopPropagation()}
        className={`relative isolate flex flex-col overflow-hidden rounded-2xl border border-content/7 shadow-2xl ${fitViewport ? "max-h-[calc(100dvh-32px)]" : ""} ${className ?? ""}`}
      >
        <GlassBackdrop className="bg-background-base dark:bg-background-base/55" />
        <div className="modal-panel relative z-[1] flex min-h-0 flex-1 flex-col">
          <header
            className={
              minimalHeader
                ? "absolute top-3 right-3 z-[2]"
                : "flex shrink-0 items-start gap-2 px-4 pt-3"
            }
          >
            <div
              className={minimalHeader ? "sr-only" : "min-w-0 flex-1 pt-0.5"}
            >
              <h2
                id={titleId}
                className="text-md font-semibold leading-tight tracking-tight text-content"
              >
                {title}
              </h2>
              {description ? (
                <p
                  id={descriptionId}
                  className="mt-0.5 truncate text-[12px] leading-snug text-content/50"
                >
                  {description}
                </p>
              ) : null}
            </div>
            <button
              ref={closeRef}
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="grid size-7 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/8 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X className="size-3.5" strokeWidth={1.75} />
            </button>
          </header>
          <div
            ref={lockOverscroll}
            className="min-h-0 flex-1 overflow-y-auto overscroll-none"
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Modal(props: Props) {
  const host = useContext(NativePopupHost);
  if (host) return createPortal(<ModalPanel {...props} />, host);
  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: LAYER.dialog }}>
      <div
        className="modal-backdrop absolute inset-0 z-0 bg-black/40"
        onMouseDown={props.onClose}
      />
      <ModalPanel {...props} />
    </div>,
    document.body,
  );
}
