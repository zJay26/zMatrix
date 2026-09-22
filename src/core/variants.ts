import {
  clone,
  emptyMetadata,
  uid,
  type Article,
  type ChannelId,
  type Content,
  type Snapshot,
  type Variant,
} from "./model";

export function newArticle(title = "", markdown = ""): Article {
  const now = Date.now();
  return {
    id: uid(),
    title,
    markdown,
    imageIds: [],
    revision: 1,
    createdAt: now,
    updatedAt: now,
    archived: false,
  };
}
export function newVariant(article: Article, channel: ChannelId): Variant {
  return {
    id: `${article.id}/${channel}`,
    articleId: article.id,
    channel,
    baseRevision: article.revision,
    overrides: {},
    metadata: emptyMetadata(),
    updatedAt: Date.now(),
  };
}
export function resolveContent(article: Article, variant?: Variant): Content {
  return {
    title: variant?.overrides.title ?? article.title,
    markdown: variant?.overrides.markdown ?? article.markdown,
    imageIds: [...(variant?.overrides.imageIds ?? article.imageIds)],
  };
}
export function setOverride<K extends keyof Content>(
  variant: Variant,
  key: K,
  value: Content[K],
): Variant {
  return {
    ...variant,
    overrides: { ...variant.overrides, [key]: clone(value) },
    updatedAt: Date.now(),
  };
}
export function clearOverride(
  variant: Variant,
  key: keyof Content,
  revision: number,
): Variant {
  const overrides = { ...variant.overrides };
  delete overrides[key];
  return {
    ...variant,
    overrides,
    baseRevision: revision,
    updatedAt: Date.now(),
  };
}
export function isVariantBehind(article: Article, variant?: Variant) {
  return (
    !!variant &&
    Object.keys(variant.overrides).length > 0 &&
    variant.baseRevision < article.revision
  );
}
export async function sha256(data: string | ArrayBuffer): Promise<string> {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
}
export async function freezeSnapshot(
  article: Article,
  variant: Variant,
): Promise<Snapshot> {
  const content = resolveContent(article, variant);
  const metadata = clone(variant.metadata);
  metadata.tags = metadata.tags.map((t) => t.trim()).filter(Boolean);
  return {
    ...content,
    articleId: article.id,
    revision: article.revision,
    channel: variant.channel,
    metadata,
    createdAt: Date.now(),
    fingerprint: await sha256(JSON.stringify({ content, metadata })),
  };
}
export function snapshotDiffers(
  snapshot: Snapshot,
  article: Article,
  variant?: Variant,
) {
  const current = resolveContent(article, variant);
  return (
    snapshot.title !== current.title ||
    snapshot.markdown !== current.markdown ||
    JSON.stringify(snapshot.imageIds) !== JSON.stringify(current.imageIds) ||
    JSON.stringify(snapshot.metadata) !==
      JSON.stringify(variant?.metadata ?? emptyMetadata())
  );
}
