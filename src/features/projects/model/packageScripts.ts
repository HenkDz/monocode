import { readTextFile } from "../../../platform/tauri/fs";

export type PackageScript = { name: string; command: string; run: string };

/** Read existing project config only; script values remain npm's responsibility. */
export async function packageScripts(project: string): Promise<PackageScript[]> {
  const value: unknown = JSON.parse(await readTextFile(`${project.replace(/[\\/]+$/, "")}/package.json`));
  if (!value || typeof value !== "object" || !("scripts" in value)) return [];
  const scripts = value.scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) return [];
  return Object.entries(scripts).filter(([name, command]) => /^[a-zA-Z0-9][a-zA-Z0-9:._-]*$/.test(name) && typeof command === "string" && !!command.trim())
    .map(([name, command]) => ({ name, command: command as string, run: `npm run ${name}` }));
}
