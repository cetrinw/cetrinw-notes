import { useCallback, useEffect, useState } from "react";
import { list, command } from "./db";
import type { Entry, Kind } from "../types";
export function useEntries(kind: Kind | "", query = "", limit = 200) {
  const [rows, setRows] = useState<Entry[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      setRows(await list(kind, query, limit));
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [kind, query, limit]);
  useEffect(() => {
    let active = true;
    const load = () => {
      if (active) void refresh();
    };
    const onChange = (e: Event) => {
      const k = (e as CustomEvent).detail;
      if (!k || !kind || k === kind) load();
    };
    load();
    window.addEventListener("cetrinw-change", onChange);
    return () => {
      active = false;
      window.removeEventListener("cetrinw-change", onChange);
    };
  }, [refresh, kind]);
  return { rows, error, loading, refresh };
}
export function useDebounce<T>(value: T, delay = 180) {
  const [d, set] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => set(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return d;
}
/** Records that link to `to` (record id, or `asset:<sha256>`), via the derived
 * links index — exact matches instead of full-text searching for UUIDs. */
export function useLinks(to: string, rel = "") {
  const [rows, setRows] = useState<Entry[]>([]);
  useEffect(() => {
    let active = true;
    const load = () =>
      void command<Entry[]>({ op: "links", to, rel })
        .then((r) => {
          if (active) setRows(r);
        })
        .catch(() => {});
    load();
    window.addEventListener("cetrinw-change", load);
    return () => {
      active = false;
      window.removeEventListener("cetrinw-change", load);
    };
  }, [to, rel]);
  return rows;
}
export const dateLabel = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleDateString("zh-CN", {
        month: "short",
        day: "numeric",
      })
    : "未记录";
