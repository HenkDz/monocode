import type { ReactNode } from "react";
import { Modal } from "../../../shared/ui/Modal";

export function WorkbenchDrawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal title={title} onClose={onClose} fitViewport className="cc7u-drawer">
      <div className="p-5 text-xs leading-relaxed">{children}</div>
    </Modal>
  );
}
