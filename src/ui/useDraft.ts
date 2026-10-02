import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, saveArticle, saveVariant } from "../core/db";
import { SaveQueue } from "../core/autosave";
import { removeVariant } from "../core/cleanup";
import {
  clearOverride,
  newVariant,
  resolveContent,
  setOverride,
} from "../core/variants";
import type {
  Article,
  ChannelId,
  Content,
  SharedMetadata,
  Variant,
} from "../core/model";

export type Draft = ReturnType<typeof useDraft>;
export type DraftTarget = ChannelId | "master";
export const emptyDefaults = (): SharedMetadata => ({ tags: [], summary: "" });

// One open article: the master, its platform versions and their guarded autosave.
// Shared by the editor and by distribution started from the library.
export function useDraft(initial: Article, isNew = false) {
  const [article, setArticle] = useState(initial);
  const articleRef = useRef(article);
  const storedQuery = useLiveQuery(
    () => db.variants.where("articleId").equals(initial.id).toArray(),
    [initial.id],
  );
  const stored = storedQuery ?? [];
  const storedRef = useRef(stored);
  storedRef.current = stored;
  const [localVariants, setLocalVariants] = useState<Record<string, Variant>>(
    {},
  );
  const localRef = useRef(localVariants);
  const [saveStatus, setSaveStatus] = useState({ pending: false, error: "" });
  const [saveQueue] = useState(() => new SaveQueue(setSaveStatus));
  const committedArticle = useRef<Article | undefined>(
    isNew ? undefined : initial,
  );
  const committedVariants = useRef(new Map<string, Variant | undefined>());
  const variants: Record<string, Variant> = {
    ...Object.fromEntries(stored.map((v) => [v.channel, v])),
    ...localVariants,
  };
  const saveMaster = (next: Article) => {
    articleRef.current = next;
    setArticle(next);
    saveQueue.enqueue("master", async () => {
      await saveArticle(next, db, { expected: committedArticle.current });
      committedArticle.current = next;
    });
  };
  const putVariant = (next: Variant) => {
    if (!committedVariants.current.has(next.channel))
      committedVariants.current.set(
        next.channel,
        storedRef.current.find((v) => v.channel === next.channel),
      );
    next = { ...next, updatedAt: Date.now() };
    localRef.current = { ...localRef.current, [next.channel]: next };
    setLocalVariants(localRef.current);
    saveQueue.enqueue(next.id, async () => {
      if (!committedArticle.current) {
        const first = articleRef.current;
        await saveArticle(first, db, { expected: undefined });
        committedArticle.current = first;
      }
      await saveVariant(next, db, {
        expected: committedVariants.current.get(next.channel),
      });
      committedVariants.current.set(next.channel, next);
    });
  };
  const currentVariant = (id: ChannelId) =>
    localRef.current[id] ??
    storedRef.current.find((v) => v.channel === id) ??
    newVariant(articleRef.current, id);
  const contentOf = (target: DraftTarget) =>
    resolveContent(
      articleRef.current,
      target === "master" ? undefined : currentVariant(target),
    );
  const change = <K extends keyof Content>(
    target: DraftTarget,
    key: K,
    value: Content[K],
  ) => {
    if (JSON.stringify(contentOf(target)[key]) === JSON.stringify(value))
      return;
    if (target === "master")
      saveMaster({
        ...articleRef.current,
        [key]: value,
        revision: articleRef.current.revision + 1,
        updatedAt: Date.now(),
      });
    else putVariant(setOverride(currentVariant(target), key, value));
  };
  const reset = (target: DraftTarget, key: keyof Content) => {
    if (target !== "master")
      putVariant(
        clearOverride(currentVariant(target), key, articleRef.current.revision),
      );
  };
  // Shared publishing details are not a content revision: platform versions
  // with their own text should not be told that the master text changed.
  const changeDefaults = (
    update: (previous: SharedMetadata) => SharedMetadata,
  ) => {
    const previous = articleRef.current.defaults ?? emptyDefaults();
    const value = update(previous);
    if (JSON.stringify(value) === JSON.stringify(previous)) return;
    const { defaults: _dropped, ...rest } = articleRef.current;
    const kept = value.tags.length || value.summary || value.coverId;
    saveMaster({
      ...rest,
      ...(kept
        ? {
            defaults: {
              tags: value.tags,
              summary: value.summary,
              ...(value.coverId ? { coverId: value.coverId } : {}),
            },
          }
        : {}),
      updatedAt: Date.now(),
    });
  };
  const changeVariant = (
    channel: ChannelId,
    update: (variant: Variant) => Variant,
  ) => putVariant(update(currentVariant(channel)));
  const dropVariant = async (channel: ChannelId) => {
    if (!(await saveQueue.flush())) throw new Error("请先处理未保存的编辑。");
    const expected =
      committedVariants.current.get(channel) ??
      storedRef.current.find((v) => v.channel === channel);
    if (expected) await removeVariant(expected);
    const next = { ...localRef.current };
    delete next[channel];
    localRef.current = next;
    setLocalVariants(next);
    committedVariants.current.delete(channel);
  };
  return {
    article,
    articleRef,
    localRef,
    variants,
    ready: !!storedQuery,
    saved: !!committedArticle.current,
    saveStatus,
    saveQueue,
    putVariant,
    currentVariant,
    contentOf,
    change,
    reset,
    changeDefaults,
    changeVariant,
    dropVariant,
    flush: () => saveQueue.flush(),
  };
}
