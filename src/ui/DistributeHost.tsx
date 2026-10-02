import { useEffect, useState } from "react";
import { db } from "../core/db";
import { messageOf, type Article, type ChannelId } from "../core/model";
import { DistributeDialog } from "./DistributeDialog";
import { Alert, Modal } from "./shared";
import { useDraft } from "./useDraft";

function Session({
  initial,
  onClose,
  onQueue,
  onEdit,
}: {
  initial: Article;
  onClose: () => void;
  onQueue: () => void;
  onEdit: (article: Article, channel: ChannelId) => void;
}) {
  const draft = useDraft(initial);
  return (
    <DistributeDialog
      draft={draft}
      onClose={onClose}
      onCreated={onQueue}
      onEditPlatform={(channel) => onEdit(draft.articleRef.current, channel)}
    />
  );
}
// Distribute an article straight from a list, without opening the editor.
export function DistributeHost({
  articleId,
  ...props
}: {
  articleId: string;
  onClose: () => void;
  onQueue: () => void;
  onEdit: (article: Article, channel: ChannelId) => void;
}) {
  const [article, setArticle] = useState<Article>();
  const [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    void db.articles
      .get(articleId)
      .then((found) => {
        if (!mounted) return;
        if (!found || found.trashedAt)
          setError("稿件已删除或在回收站，请返回内容库。");
        else setArticle(found);
      })
      .catch((e) => mounted && setError(messageOf(e)));
    return () => {
      mounted = false;
    };
  }, [articleId]);
  if (error)
    return (
      <Modal title="无法分发" onClose={props.onClose}>
        <Alert tone="danger">{error}</Alert>
      </Modal>
    );
  return article ? <Session initial={article} {...props} /> : null;
}
