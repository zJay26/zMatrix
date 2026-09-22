import type {
  ChannelId,
  CommentPage,
  Metric,
  Mode,
  PreparedContent,
  Probe,
  RemotePost,
  Snapshot,
} from "../core/model";
export interface Context {
  tabId: number;
  channel: ChannelId;
  taskId: string;
}
export interface Receipt {
  status:
    | "draft_saved"
    | "submitted"
    | "reviewing"
    | "published"
    | "uncertain"
    | "awaiting_publish"
    | "awaiting_review";
  url?: string;
  editorUrl?: string;
  remoteId?: string;
  detail: string;
}
export interface PlatformAdapter {
  channel: ChannelId;
  capabilities: {
    format: "html" | "markdown" | "images";
    math: boolean;
    mermaid: boolean;
    tables: boolean;
    publishing: "manual" | "unverified" | "verified";
    metrics: "unverified" | "verified" | "unsupported";
    comments: "unverified" | "verified" | "unsupported";
  };
  checkSession(): Promise<Probe>;
  prepare(
    snapshot: Snapshot,
    content: PreparedContent,
    taskId: string,
    onTab: (id: number) => Promise<void>,
  ): Promise<Context>;
  saveDraft(
    context: Context,
    snapshot: Snapshot,
    content: PreparedContent,
  ): Promise<Receipt>;
  preparePublish(
    context: Context,
    snapshot: Snapshot,
    content: PreparedContent,
  ): Promise<Receipt>;
  verify(
    context: Context,
    snapshot: Snapshot,
    content: PreparedContent,
    mode?: Mode,
  ): Promise<Receipt>;
  fetchMetrics(
    post: RemotePost,
  ): Promise<{ values: Metric[]; sourceUrl: string }>;
  fetchComments(post: RemotePost, cursor?: string): Promise<CommentPage>;
}
