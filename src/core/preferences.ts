import { db } from "./db";

export const PREFERENCES_KEY = "preferences";
export const defaultPreferences = {
  fontSize: 16,
  editorFontSize: 17,
  libraryLayout: "grid" as "grid" | "list",
  editorLayout: "split" as "split" | "source" | "preview",
  refreshOnOpen: true,
  autoCheckUpdates: true,
  includePrereleases: true,
};
export type Preferences = typeof defaultPreferences;

export function normalizePreferences(value: unknown): Preferences {
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const size = (
    key: "fontSize" | "editorFontSize",
    min: number,
    max: number,
  ) => {
    const value = source[key];
    return typeof value === "number" && Number.isFinite(value)
      ? Math.min(max, Math.max(min, Math.round(value)))
      : defaultPreferences[key];
  };
  return {
    fontSize: size("fontSize", 14, 22),
    editorFontSize: size("editorFontSize", 14, 26),
    libraryLayout: source.libraryLayout === "list" ? "list" : "grid",
    editorLayout:
      source.editorLayout === "source" || source.editorLayout === "preview"
        ? source.editorLayout
        : "split",
    refreshOnOpen:
      typeof source.refreshOnOpen === "boolean" ? source.refreshOnOpen : true,
    autoCheckUpdates:
      typeof source.autoCheckUpdates === "boolean"
        ? source.autoCheckUpdates
        : true,
    includePrereleases:
      typeof source.includePrereleases === "boolean"
        ? source.includePrereleases
        : true,
  };
}

export async function getPreferences(database = db) {
  return normalizePreferences(
    (await database.meta.get(PREFERENCES_KEY))?.value,
  );
}

export async function savePreferences(
  patch: Partial<Preferences>,
  database = db,
) {
  return database.transaction("rw", database.meta, async () => {
    const value = normalizePreferences({
      ...(await getPreferences(database)),
      ...patch,
    });
    await database.meta.put({ key: PREFERENCES_KEY, value });
    return value;
  });
}
