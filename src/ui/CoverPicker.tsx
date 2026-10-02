import { useLiveQuery } from "dexie-react-hooks";
import { Check } from "lucide-react";
import { db } from "../core/db";
import type { Asset } from "../core/model";
import { useBlobUrl } from "./shared";

function Thumb({
  asset,
  index,
  state,
  onClick,
}: {
  asset: Asset;
  index: number;
  state: "own" | "inherited" | "none";
  onClick: () => void;
}) {
  const url = useBlobUrl(asset.blob);
  return (
    <button
      type="button"
      className={`cover-thumb ${state}`}
      aria-pressed={state !== "none"}
      aria-label={`用配图 ${index + 1} 作封面`}
      title={asset.name}
      onClick={onClick}
    >
      <img src={url || undefined} alt="" />
      {state !== "none" && (
        <span>
          <Check size={12} />
          {state === "inherited" ? "通用" : "封面"}
        </span>
      )}
    </button>
  );
}
// Pick one of the version's images as its cover; click again to clear.
export function CoverPicker({
  imageIds,
  value,
  inherited,
  onChange,
}: {
  imageIds: string[];
  value?: string;
  inherited?: string;
  onChange: (coverId: string | undefined) => void;
}) {
  const ids = [...new Set([...imageIds, ...(inherited ? [inherited] : [])])];
  const assets = useLiveQuery(
    () => db.assets.bulkGet(ids),
    [ids.join(",")],
    [],
  );
  const available = assets.flatMap((asset) => (asset ? [asset] : []));
  if (!available.length)
    return <p className="field-help">添加配图后可在这里选择封面。</p>;
  return (
    <div className="cover-picker">
      {available.map((asset, index) => (
        <Thumb
          key={asset.id}
          asset={asset}
          index={index}
          state={
            value === asset.id
              ? "own"
              : !value && inherited === asset.id
                ? "inherited"
                : "none"
          }
          onClick={() => onChange(value === asset.id ? undefined : asset.id)}
        />
      ))}
    </div>
  );
}
