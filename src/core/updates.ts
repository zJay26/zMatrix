import { z } from "zod";
import { version as currentVersion } from "../../package.json";
import { db, getMeta } from "./db";
import { getPreferences } from "./preferences";

export const RELEASES_URL = "https://github.com/zJay26/zMatrix/releases";
export const UPDATE_API =
  "https://api.github.com/repos/zJay26/zMatrix/releases?per_page=100";
export const UPDATE_KEY = "softwareUpdate";
export const UPDATE_INTERVAL = 6 * 60 * 60 * 1000;
export const UPDATE_ALARM = "zmatrix-check-updates";
export interface ReleaseInfo {
  version: string;
  name: string;
  notes: string;
  url: string;
  publishedAt: string;
  prerelease: boolean;
  downloadUrl?: string;
  size?: number;
  assetId?: number;
  sha256?: string;
}
export interface UpdateState {
  checkedAt?: number;
  attemptedAt?: number;
  includePrereleases?: boolean;
  release?: ReleaseInfo;
  error?: string;
  dismissedVersion?: string;
}

function parseVersion(value: string) {
  const match =
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z.-]+)?$/.exec(
      value,
    );
  if (!match) return null;
  return { numbers: match.slice(1, 4).map(Number), pre: match[4]?.split(".") };
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left),
    b = parseVersion(right);
  if (!a || !b) throw new Error("版本号格式无效");
  for (let i = 0; i < 3; i++) {
    if (a.numbers[i] !== b.numbers[i])
      return Math.sign(a.numbers[i]! - b.numbers[i]!);
  }
  if (!a.pre && !b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i],
      y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x),
      yn = /^\d+$/.test(y);
    if (xn && yn) return Math.sign(Number(x) - Number(y));
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

const releaseSchema = z.object({
  tag_name: z.string(),
  name: z.string().nullable(),
  body: z.string().nullable().optional(),
  html_url: z.string(),
  published_at: z.string().nullable(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  assets: z.array(
    z.object({
      name: z.string(),
      browser_download_url: z.string(),
      size: z.number().nonnegative(),
      id: z.number().int().positive().optional(),
      digest: z.string().nullable().optional(),
    }),
  ),
});

function isReleaseUrl(value: string, path: string) {
  try {
    const url = new URL(value);
    return (
      url.origin === "https://github.com" &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith(`/zJay26/zMatrix/releases/${path}/`)
    );
  } catch {
    return false;
  }
}

export function latestRelease(
  data: unknown,
  includePrereleases: boolean,
): ReleaseInfo | undefined {
  if (!Array.isArray(data)) throw new Error("版本服务返回了无法识别的数据");
  const releases = data.flatMap((value) => {
    const parsed = releaseSchema.safeParse(value);
    if (!parsed.success) throw new Error("版本信息不完整，请稍后重试");
    const r = parsed.data;
    const semver = parseVersion(r.tag_name);
    if (
      r.draft ||
      !r.published_at ||
      !semver ||
      (!includePrereleases && (r.prerelease || semver.pre)) ||
      !isReleaseUrl(r.html_url, "tag")
    )
      return [];
    const version = r.tag_name.replace(/^v/, "");
    const asset = r.assets.find(
      (asset) =>
        asset.name === `zMatrix-edge-${version}.zip` &&
        asset.size > 0 &&
        isReleaseUrl(asset.browser_download_url, "download") &&
        new URL(asset.browser_download_url).pathname ===
          `/zJay26/zMatrix/releases/download/${r.tag_name}/${asset.name}`,
    );
    return [
      {
        version,
        name: r.name || r.tag_name,
        notes: (r.body ?? "").slice(0, 16000),
        url: r.html_url,
        publishedAt: r.published_at,
        prerelease: r.prerelease || !!semver.pre,
        downloadUrl: asset?.browser_download_url,
        size: asset?.size,
        assetId: asset?.id,
        sha256: asset?.digest?.match(/^sha256:([a-f0-9]{64})$/)?.[1],
      },
    ];
  });
  return releases.sort((a, b) => compareVersions(b.version, a.version))[0];
}

export const hasUpdate = (state?: UpdateState, version = currentVersion) =>
  !!state?.release && compareVersions(state.release.version, version) > 0;

export async function getUpdateState(database = db) {
  return getMeta<UpdateState>(UPDATE_KEY, {}, database);
}

// Only fetch release metadata. Downloading and reloading are separate user actions.
export async function checkForUpdates({
  manual = false,
  database = db,
  fetcher = fetch,
  now = Date.now(),
}: {
  manual?: boolean;
  database?: typeof db;
  fetcher?: typeof fetch;
  now?: number;
} = {}): Promise<UpdateState> {
  const preferences = await getPreferences(database);
  const previous = await getUpdateState(database);
  if (
    !manual &&
    (!preferences.autoCheckUpdates ||
      (previous.includePrereleases === preferences.includePrereleases &&
        previous.attemptedAt !== undefined &&
        now >= previous.attemptedAt &&
        now - previous.attemptedAt < UPDATE_INTERVAL))
  )
    return previous;

  // A persisted lease also guards multiple preview tabs and service-worker wakeups.
  const owner = crypto.randomUUID();
  const acquired = await database.transaction("rw", database.meta, async () => {
    const lease = await getMeta<{ owner: string; at: number } | null>(
      "updateCheckLease",
      null,
      database,
    );
    if (lease && now >= lease.at && now - lease.at < 30_000) return false;
    await database.meta.put({
      key: "updateCheckLease",
      value: { owner, at: now },
    });
    return true;
  });
  if (!acquired) return getUpdateState(database);
  try {
    let next: UpdateState;
    try {
      const response = await fetcher(UPDATE_API, {
        headers: { Accept: "application/vnd.github+json" },
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok)
        throw new Error(
          response.status === 403 || response.status === 429
            ? "版本检查暂时受限，请稍后重试"
            : `无法获取版本信息（${response.status}），请稍后重试`,
        );
      next = {
        ...previous,
        attemptedAt: now,
        checkedAt: now,
        includePrereleases: preferences.includePrereleases,
        release: latestRelease(
          await response.json(),
          preferences.includePrereleases,
        ),
        error: undefined,
      };
    } catch (error) {
      next = {
        ...previous,
        attemptedAt: now,
        includePrereleases: preferences.includePrereleases,
        release:
          previous.includePrereleases === preferences.includePrereleases
            ? previous.release
            : undefined,
        checkedAt:
          previous.includePrereleases === preferences.includePrereleases
            ? previous.checkedAt
            : undefined,
        error:
          error instanceof Error && error.message.includes("版本")
            ? error.message
            : "检查失败，请检查网络后重试",
      };
    }
    await database.transaction("rw", database.meta, async () => {
      // Retain a dismissal made while a request was in flight.
      const latest = await getUpdateState(database);
      next.dismissedVersion = latest.dismissedVersion;
      await database.meta.put({ key: UPDATE_KEY, value: next });
    });
    return next;
  } finally {
    await database.transaction("rw", database.meta, async () => {
      const lease = await getMeta<{ owner: string } | null>(
        "updateCheckLease",
        null,
        database,
      );
      if (lease?.owner === owner)
        await database.meta.delete("updateCheckLease");
    });
  }
}

export async function dismissUpdate(version: string, database = db) {
  await database.transaction("rw", database.meta, async () => {
    const state = await getUpdateState(database);
    await database.meta.put({
      key: UPDATE_KEY,
      value: { ...state, dismissedVersion: version },
    });
  });
}

export async function syncUpdateAlarm(database = db, alarms = chrome.alarms) {
  const preferences = await getPreferences(database);
  if (!preferences.autoCheckUpdates) {
    await alarms.clear(UPDATE_ALARM);
    return;
  }
  if (!(await alarms.get(UPDATE_ALARM))) {
    await alarms.create(UPDATE_ALARM, {
      periodInMinutes: UPDATE_INTERVAL / 60_000,
    });
  }
}
