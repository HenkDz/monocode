import { useId, useRef, useState, type ReactNode } from "react";
import { Popover } from "../../../shared/ui/Popover";

export function AttentionDetails({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };
  return <div className="aq-details" data-attention-details={open || undefined}>
    <button ref={trigger} type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(value => !value)}>Evidence</button>
    {open && <Popover anchor={trigger} width={440} role="dialog" aria-label={title} id={id} tabIndex={-1} autoFocus
      data-attention-details data-dialog-popover className="aq-detail-popover" onDismiss={reason => close(reason === "escape")}>
      <header><h3>{title}</h3><button type="button" aria-label="Close evidence" onClick={() => close(true)}>Close</button></header>
      {children}
    </Popover>}
  </div>;
}
