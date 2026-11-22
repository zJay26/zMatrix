import { db } from "./db";
import { channels } from "../platforms/catalog";
import type { ChannelId } from "./model";

export function normalizePublishSelection(value: unknown) {
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const available = channels.filter((c) => !c.manual).map((c) => c.id);
  return {
    selected: Array.isArray(source.selected)
      ? [
          ...new Set(
            source.selected.filter((id): id is ChannelId =>
              available.includes(id),
            ),
          ),
        ]
      : [],
  };
}
export async function getPublishSelection(database = db) {
  return normalizePublishSelection(
    (await database.meta.get("publishSelection"))?.value,
  );
}
export async function savePublishSelection(
  selected: ChannelId[],
  database = db,
) {
  await database.meta.put({
    key: "publishSelection",
    value: normalizePublishSelection({ selected }),
  });
}
