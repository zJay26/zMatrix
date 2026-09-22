export const platformIds = [
  "zhihu",
  "juejin",
  "cnblogs",
  "csdn",
  "xiaohongshu",
  "linuxdo",
] as const;
export type PlatformId = (typeof platformIds)[number];
export const channelIds = [
  "zhihu:article",
  "juejin:article",
  "cnblogs:article",
  "csdn:article",
  "xiaohongshu:article",
  "xiaohongshu:note",
  "linuxdo:topic",
] as const;
export type ChannelId = (typeof channelIds)[number];
// Keep the stored "publish" value compatible; it now prepares a manual handoff only.
export type Mode = "draft" | "publish";
export interface Content {
  title: string;
  markdown: string;
  imageIds: string[];
}
export interface Article extends Content {
  id: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
}
export interface Metadata {
  tags: string[];
  category: string;
  summary: string;
  coverId?: string;
}
export interface Variant {
  id: string;
  articleId: string;
  channel: ChannelId;
  baseRevision: number;
  overrides: Partial<Content>;
  metadata: Metadata;
  updatedAt: number;
}
export interface Asset {
  id: string;
  name: string;
  type: string;
  blob: Blob;
  createdAt: number;
}
export interface Snapshot extends Content {
  articleId: string;
  revision: number;
  channel: ChannelId;
  metadata: Metadata;
  createdAt: number;
  fingerprint: string;
}
export interface WireAsset {
  id: string;
  name: string;
  type: string;
  dataUrl: string;
}
export interface PreparedContent {
  markdown: string;
  html: string;
  text: string;
  assets: WireAsset[];
  warnings: string[];
}
export const taskStates = [
  "queued",
  "paused",
  "preparing",
  "submitting",
  "verifying",
  "awaiting_publish",
  "awaiting_review",
  "draft_saved",
  "submitted",
  "reviewing",
  "published",
  "failed",
  "uncertain",
  "cancelled",
] as const;
export type TaskState = (typeof taskStates)[number];
export interface Task {
  id: string;
  batchId: string;
  channel: ChannelId;
  mode: Mode;
  snapshot: Snapshot;
  prepared: PreparedContent;
  state: TaskState;
  step: string;
  createdAt: number;
  updatedAt: number;
  tabId?: number;
  editorUrl?: string;
  remoteUrl?: string;
  remoteId?: string;
  error?: string;
  owner?: string;
  account?: string;
  events: { at: number; message: string }[];
}
export interface RemotePost {
  id: string;
  articleId?: string;
  channel: ChannelId;
  remoteId: string;
  url: string;
  editorUrl?: string;
  title: string;
  status: "draft_saved" | "submitted" | "reviewing" | "published";
  snapshot?: Snapshot;
  registeredAt: number;
  updatedAt: number;
}
export interface Metric {
  key: string;
  label: string;
  value: number;
  raw: string;
}
export interface Metrics {
  postId: string;
  values: Metric[];
  sourceUrl: string;
  collectedAt: number;
  lastAttemptAt: number;
  error?: string;
}
export interface Comment {
  id: string;
  postId: string;
  remoteId: string;
  parentId?: string;
  author: string;
  body: string;
  publishedAt: string;
  url: string;
  collectedAt: number;
  readAt?: number;
}
export interface CommentPage {
  comments: Omit<Comment, "id" | "postId" | "collectedAt">[];
  nextCursor?: string;
  scope: string;
  complete: boolean;
}
export interface CommentSync {
  postId: string;
  sourceUrl: string;
  collectedAt: number;
  lastAttemptAt: number;
  cursor?: string;
  scope: string;
  complete: boolean;
  error?: string;
}
export interface Meta {
  key: string;
  value: unknown;
}
export interface Probe {
  channel: ChannelId;
  checkedAt: number;
  url: string;
  account?: string;
  editorFound: boolean;
  draftControl: boolean;
  publishControl: boolean;
  problems: string[];
}
export const uid = () => crypto.randomUUID();
export const emptyMetadata = (): Metadata => ({
  tags: [],
  category: "",
  summary: "",
});
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function clone<T>(value: T): T {
  return structuredClone(value);
}
