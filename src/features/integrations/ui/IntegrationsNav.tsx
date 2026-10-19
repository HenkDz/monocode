import { FileScript } from "../../../shared/ui/icons";

export function IntegrationsNav({ onOpen, compact = false }: { onOpen(): void; compact?: boolean }) {
  return <button type="button" onClick={onOpen} title="Integrations" aria-label="Integrations"
    className={`flex shrink-0 items-center gap-2 rounded-md text-[13px] text-content/65 hover:bg-content/8 hover:text-content focus-visible:outline-accent ${compact ? "mx-auto size-8 justify-center" : "mx-2 my-1 h-8 px-2"}`}>
    <FileScript className="size-4" aria-hidden="true" />{!compact && "Integrations"}
  </button>;
}
