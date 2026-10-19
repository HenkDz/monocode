import { slash } from "../../../shared/lib/paths";

export function monoDisplayPath(path: string): string {
  const display = slash(path.replace(/^[/\\]{2}\?[/\\](UNC[/\\])?/i, (_prefix, unc) => unc ? "//" : ""));
  return display.length > 64 ? `${display.slice(0, 28)}…${display.slice(-32)}` : display;
}
