import { useEffect, useState } from "react";
import { pathKey } from "../../../shared/lib/paths";
import { readFlag, writeFlag } from "../../settings/model/storageFlags";

/** Retain sidebar choices when navigation unmounts its project rows. */
export function useProjectExpansion(project: string, section: string, initial: boolean) {
  const key = `monocode:${section}-expanded:${pathKey(project)}`;
  const [expanded, setExpanded] = useState(() => readFlag(key) ?? initial);
  useEffect(() => {
    const saved = readFlag(key);
    setExpanded(saved ?? initial);
    if (saved == null) writeFlag(key, initial);
  }, [key]);
  const saveExpanded = (value: boolean) => {
    setExpanded(value);
    writeFlag(key, value);
  };
  return [expanded, saveExpanded] as const;
}
