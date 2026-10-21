import { useId, useState, type ReactNode } from "react";

export function WorkDisclosure({ title, children, initialOpen = false }: { title?: ReactNode; children: ReactNode; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const id = useId();
  return <div className="my-2 min-w-0" data-work-disclosure>
    <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="rounded py-1 text-xs text-content/60 hover:text-content focus-visible:outline-accent">
      {open ? "Hide work" : "Show work"}{title && <> · {title}</>}
    </button>
    <div id={id} hidden={!open} className="min-w-0 [overflow-wrap:anywhere]">{children}</div>
  </div>;
}
