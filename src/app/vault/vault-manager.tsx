"use client";

import {
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  createItem,
  deleteItem,
  getSignedUrl,
  reindexVault,
  updateItem,
} from "./actions";

const kinds = ["guideline", "fact", "term", "asset"] as const;
type VaultKind = (typeof kinds)[number];
type VaultItem = {
  id: string;
  kind: VaultKind;
  title: string;
  body: string | null;
  asset_path: string | null;
  owner: string | null;
  valid_until: string | null;
  is_confidential: boolean;
  tags: string[];
  created_at: string;
};

const kindLabels: Record<VaultKind, string> = {
  guideline: "Guidelines",
  fact: "Facts",
  term: "Terms",
  asset: "Assets",
};

export function VaultManager({
  items,
  initialEditingItemId,
}: {
  items: VaultItem[];
  initialEditingItemId?: string;
}) {
  const router = useRouter();
  const [activeKind, setActiveKind] = useState<VaultKind>("guideline");
  const [search, setSearch] = useState("");
  const [selectedTag, setSelectedTag] = useState("");
  const [editingItem, setEditingItem] = useState<VaultItem | null>(
    () => items.find((item) => item.id === initialEditingItemId) ?? null
  );
  const [isAdding, setIsAdding] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackIsError, setFeedbackIsError] = useState(false);
  const [signedUrls, setSignedUrls] = useState<
    Record<string, { path: string; url: string }>
  >({});
  const [isPending, startTransition] = useTransition();

  const tags = useMemo(
    () => [...new Set(items.flatMap((item) => item.tags))].sort(),
    [items]
  );
  const visibleItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return items.filter((item) => {
      if (item.kind !== activeKind) {
        return false;
      }
      if (selectedTag && !item.tags.includes(selectedTag)) {
        return false;
      }
      return (
        !query ||
        item.title.toLocaleLowerCase().includes(query) ||
        (item.body ?? "").toLocaleLowerCase().includes(query)
      );
    });
  }, [activeKind, items, search, selectedTag]);

  useEffect(() => {
    let active = true;
    const assets = items.filter(
      (item) =>
        item.kind === "asset" &&
        item.asset_path &&
        signedUrls[item.id]?.path !== item.asset_path
    );
    if (assets.length) {
      void Promise.all(
        assets.map(async (item) => {
          const result = await getSignedUrl(item.asset_path, "vault-assets");
          if ("error" in result) {
            setFeedback(`Could not load preview for ${item.title}: ${result.error}`);
            setFeedbackIsError(true);
            return null;
          }
          return [item.id, { path: item.asset_path, url: result.url }] as const;
        })
      ).then((results) => {
        if (!active) {
          return;
        }
        const next = Object.fromEntries(
          results.filter(
            (
              result
            ): result is readonly [
              string,
              { path: string; url: string },
            ] => result !== null
          )
        );
        if (Object.keys(next).length) {
          setSignedUrls((current) => ({ ...current, ...next }));
        }
      });
    }

    return () => {
      active = false;
    };
  }, [items, signedUrls]);

  function showResult(error?: string, success = "Changes saved.") {
    setFeedback(error ?? success);
    setFeedbackIsError(Boolean(error));
    if (!error) {
      setIsAdding(false);
      setEditingItem(null);
      router.refresh();
    }
  }

  function submitItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = editingItem
        ? await updateItem(formData)
        : await createItem(formData);
      if ("error" in result) {
        showResult(result.error);
        return;
      }
      setFeedback(result.warning ?? "Vault item saved.");
      setFeedbackIsError(Boolean(result.warning));
      setIsAdding(false);
      setEditingItem(null);
      router.refresh();
    });
  }

  function handleDelete(item: VaultItem) {
    if (!window.confirm(`Delete "${item.title}" from the vault?`)) {
      return;
    }
    setFeedback("");
    startTransition(async () => {
      const error = await deleteItem(item.id);
      if (error) {
        showResult(error);
      } else {
        showResult(undefined, "Vault item deleted.");
      }
    });
  }

  function handleReindex() {
    setFeedback("");
    startTransition(async () => {
      const result = await reindexVault();
      if ("error" in result) {
        showResult(result.error);
        return;
      }
      setFeedback(
        result.count
          ? `Re-indexed ${result.count} Vault ${result.count === 1 ? "item" : "items"}.`
          : "There are no Vault items to index."
      );
      setFeedbackIsError(false);
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
            Brand Vault
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            Manage the guidelines, facts, terminology, and assets your team can use.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            disabled={isPending}
            onClick={handleReindex}
            type="button"
          >
            Re-index Vault
          </button>
          <button
            className="rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            disabled={isPending}
            onClick={() => {
              setEditingItem(null);
              setIsAdding(true);
            }}
            type="button"
          >
            Add {activeKind === "asset" ? "asset" : activeKind}
          </button>
        </div>
      </div>

      <div className="mt-7 border-b border-zinc-200">
        <nav aria-label="Vault item kinds" className="-mb-px flex gap-6 overflow-x-auto">
          {kinds.map((kind) => (
            <button
              aria-current={activeKind === kind ? "page" : undefined}
              className={`whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium ${
                activeKind === kind
                  ? "border-indigo-600 text-indigo-700"
                  : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700"
              }`}
              key={kind}
              onClick={() => {
                setActiveKind(kind);
                setSelectedTag("");
              }}
              type="button"
            >
              {kindLabels[kind]}
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
        <div>
          <label className="sr-only" htmlFor="vaultSearch">
            Search title and body
          </label>
          <input
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            id="vaultSearch"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search title or body"
            type="search"
            value={search}
          />
        </div>
        <div>
          <label className="sr-only" htmlFor="tagFilter">
            Filter by tag
          </label>
          <select
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-zinc-900"
            id="tagFilter"
            onChange={(event) => setSelectedTag(event.target.value)}
            value={selectedTag}
          >
            <option value="">All tags</option>
            {tags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </div>
      </div>

      {feedback && (
        <p
          className={`mt-4 rounded-lg px-4 py-3 text-sm ${
            feedbackIsError
              ? "bg-amber-50 text-amber-800"
              : "bg-emerald-50 text-emerald-800"
          }`}
          role="status"
        >
          {feedback}
        </p>
      )}

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {visibleItems.map((item) => (
          <article
            className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm"
            key={item.id}
          >
            {item.kind === "asset" && item.asset_path && signedUrls[item.id] && (
              <Image
                alt={item.title}
                className="mb-4 h-44 w-full rounded-lg bg-zinc-100 object-contain"
                height={240}
                unoptimized
                src={signedUrls[item.id].url}
                width={480}
              />
            )}
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="text-lg font-semibold text-zinc-900">{item.title}</h2>
              <div className="flex flex-wrap gap-2">
                {item.is_confidential && (
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
                    Confidential
                  </span>
                )}
                {item.valid_until && <ExpiryBadge value={item.valid_until} />}
              </div>
            </div>

            {item.body && (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-700">
                {item.body}
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-zinc-500">
              {item.owner && <span>Owner: {item.owner}</span>}
              {item.valid_until && (
                <ExpiryDate value={item.valid_until} />
              )}
            </div>
            {item.tags.length > 0 && (
              <ul aria-label="Tags" className="mt-4 flex flex-wrap gap-2">
                {item.tags.map((tag) => (
                  <li
                    className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-700"
                    key={tag}
                  >
                    {tag}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-5 flex gap-3 border-t border-zinc-100 pt-4">
              <button
                className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                onClick={() => {
                  setEditingItem(item);
                  setIsAdding(false);
                }}
                type="button"
              >
                Edit
              </button>
              <button
                className="text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                disabled={isPending}
                onClick={() => handleDelete(item)}
                type="button"
              >
                Delete
              </button>
            </div>
          </article>
        ))}
        {visibleItems.length === 0 && (
          <p className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500 md:col-span-2">
            No {kindLabels[activeKind].toLowerCase()} match those filters.
          </p>
        )}
      </div>

      {(isAdding || editingItem) && (
        <VaultItemForm
          initialItem={editingItem}
          initialKind={activeKind}
          isPending={isPending}
          onClose={() => {
            setIsAdding(false);
            setEditingItem(null);
          }}
          onSubmit={submitItem}
          signedUrl={
            editingItem &&
            signedUrls[editingItem.id]?.path === editingItem.asset_path
              ? signedUrls[editingItem.id].url
              : undefined
          }
        />
      )}
    </div>
  );
}

function ExpiryBadge({ value }: { value: string }) {
  if (!isExpired(value)) {
    return null;
  }
  return (
    <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">
      Expired
    </span>
  );
}

function ExpiryDate({ value }: { value: string }) {
  return <span>Valid until: {formatDate(value)}</span>;
}

function isExpired(value: string): boolean {
  return value < new Date().toISOString().slice(0, 10);
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

function VaultItemForm({
  initialItem,
  initialKind,
  isPending,
  onClose,
  onSubmit,
  signedUrl,
}: {
  initialItem: VaultItem | null;
  initialKind: VaultKind;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  signedUrl?: string;
}) {
  const [kind, setKind] = useState<VaultKind>(
    initialItem?.kind ?? initialKind
  );
  const [tags, setTags] = useState<string[]>(initialItem?.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [confidential, setConfidential] = useState(
    initialItem?.is_confidential ?? false
  );
  const [localPreview, setLocalPreview] = useState<string>();
  const [fileError, setFileError] = useState("");
  const assetPreview = localPreview ?? signedUrl;

  function addTag() {
    const nextTag = tagInput.trim();
    if (!nextTag || tags.includes(nextTag)) {
      setTagInput("");
      return;
    }
    if (tags.length >= 10) {
      setFileError("You can add up to 10 tags.");
      return;
    }
    if (nextTag.length > 80) {
      setFileError("Tags must be 80 characters or fewer.");
      return;
    }
    setFileError("");
    setTags((current) => [...current, nextTag]);
    setTagInput("");
  }

  function onTagKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addTag();
    }
  }

  useEffect(
    () => () => {
      if (localPreview) {
        URL.revokeObjectURL(localPreview);
      }
    },
    [localPreview]
  );

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setFileError("");
    if (file && kind === "asset" && file.type.startsWith("image/")) {
      setLocalPreview(URL.createObjectURL(file));
    } else {
      setLocalPreview(undefined);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-zinc-950/40 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isPending) {
          onClose();
        }
      }}
    >
      <section
        aria-labelledby="vaultFormTitle"
        aria-modal="true"
        className="my-auto max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              className="text-xl font-semibold text-zinc-900"
              id="vaultFormTitle"
            >
              {initialItem ? "Edit vault item" : "Add vault item"}
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Keep trusted brand information up to date.
            </p>
          </div>
          <button
            aria-label="Close"
            className="rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-100"
            disabled={isPending}
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        <form className="mt-6 space-y-5" onSubmit={onSubmit}>
          {initialItem && (
            <input name="id" type="hidden" value={initialItem.id} />
          )}
          <input name="tags" type="hidden" value={JSON.stringify(tags)} />
          <input
            name="confidential"
            type="hidden"
            value={confidential ? "true" : "false"}
          />

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label
                className="mb-1.5 block text-sm font-medium text-zinc-700"
                htmlFor="vaultTitle"
              >
                Title
              </label>
              <input
                autoFocus
                className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                id="vaultTitle"
                maxLength={200}
                name="title"
                required
                type="text"
                defaultValue={initialItem?.title ?? ""}
              />
            </div>

            <div>
              <label
                className="mb-1.5 block text-sm font-medium text-zinc-700"
                htmlFor="vaultKind"
              >
                Kind
              </label>
              <select
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-zinc-900"
                id="vaultKind"
                name="kind"
                onChange={(event) => {
                  const selectedKind = kinds.find(
                    (itemKind) => itemKind === event.target.value
                  );
                  if (selectedKind) {
                    setKind(selectedKind);
                    setLocalPreview(undefined);
                  }
                }}
                value={kind}
              >
                {kinds.map((itemKind) => (
                  <option key={itemKind} value={itemKind}>
                    {kindLabels[itemKind].replace(/s$/, "")}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                className="mb-1.5 block text-sm font-medium text-zinc-700"
                htmlFor="vaultOwner"
              >
                Owner
              </label>
              <input
                className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900"
                id="vaultOwner"
                maxLength={200}
                name="owner"
                type="text"
                defaultValue={initialItem?.owner ?? ""}
              />
            </div>

            <div>
              <label
                className="mb-1.5 block text-sm font-medium text-zinc-700"
                htmlFor="validUntil"
              >
                Valid until
              </label>
              <input
                className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900"
                id="validUntil"
                name="validUntil"
                type="date"
                defaultValue={initialItem?.valid_until ?? ""}
              />
            </div>

            <div className="flex items-center gap-3 self-end pb-2">
              <input
                checked={confidential}
                className="size-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                id="confidential"
                onChange={(event) => setConfidential(event.target.checked)}
                type="checkbox"
              />
              <label
                className="text-sm font-medium text-zinc-700"
                htmlFor="confidential"
              >
                Confidential
              </label>
            </div>
          </div>

          <div>
            <label
              className="mb-1.5 block text-sm font-medium text-zinc-700"
              htmlFor="vaultBody"
            >
              {kind === "asset" ? "Usage notes" : "Body"}
            </label>
            {kind === "term" && (
              <p className="mb-2 text-xs text-zinc-500">
                Preferred term | Avoid | Notes
              </p>
            )}
            <textarea
              className="min-h-32 w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              id="vaultBody"
              maxLength={100000}
              name="body"
              placeholder={
                kind === "asset"
                  ? "For example: use on dark backgrounds only"
                  : "Enter trusted brand information"
              }
              defaultValue={initialItem?.body ?? ""}
            />
          </div>

          <div>
            <label
              className="mb-1.5 block text-sm font-medium text-zinc-700"
              htmlFor="tagInput"
            >
              Tags <span className="font-normal text-zinc-500">(up to 10)</span>
            </label>
            <div className="flex flex-wrap gap-2 rounded-lg border border-zinc-300 p-2 focus-within:border-indigo-500">
              {tags.map((tag) => (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-sm text-zinc-700"
                  key={tag}
                >
                  {tag}
                  <button
                    aria-label={`Remove ${tag} tag`}
                    className="text-zinc-500 hover:text-zinc-900"
                    onClick={() =>
                      setTags((current) => current.filter((entry) => entry !== tag))
                    }
                    type="button"
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                className="min-w-32 flex-1 border-0 px-2 py-1 text-sm outline-none"
                id="tagInput"
                onChange={(event) => setTagInput(event.target.value)}
                onKeyDown={onTagKeyDown}
                placeholder="Type a tag and press Enter"
                type="text"
                value={tagInput}
              />
              <button
                className="rounded-md px-2 py-1 text-sm font-medium text-indigo-600 hover:bg-indigo-50"
                onClick={addTag}
                type="button"
              >
                Add tag
              </button>
            </div>
          </div>

          <div>
            <label
              className="mb-1.5 block text-sm font-medium text-zinc-700"
              htmlFor="vaultFile"
            >
              {kind === "asset" ? "Image upload" : "Document upload"}
              {initialItem?.asset_path && (
                <span className="ml-2 font-normal text-zinc-500">
                  (upload a replacement or leave unchanged)
                </span>
              )}
            </label>
            <input
              accept={
                kind === "asset"
                  ? "image/png,image/jpeg,image/webp,image/svg+xml"
                  : ".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              }
              className="block w-full text-sm text-zinc-700 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:font-medium file:text-zinc-700 hover:file:bg-zinc-200"
              id="vaultFile"
              name="file"
              onChange={onFileChange}
              type="file"
            />
            <p className="mt-1.5 text-xs text-zinc-500">
              {kind === "asset"
                ? "PNG, JPEG, WEBP, or SVG. Maximum 5 MB."
                : "PDF, DOCX, or TXT. Maximum 10 MB. Text is extracted into the body."}
            </p>
            {kind === "asset" && assetPreview && (
              <Image
                alt="Asset preview"
                className="mt-3 max-h-48 rounded-lg border border-zinc-200 bg-zinc-50 object-contain"
                height={192}
                unoptimized
                src={assetPreview}
                width={384}
              />
            )}
          </div>

          {fileError && (
            <p className="text-sm text-red-700" role="alert">
              {fileError}
            </p>
          )}

          <div className="flex justify-end gap-3 border-t border-zinc-100 pt-5">
            <button
              className="rounded-lg border border-zinc-300 px-4 py-2.5 font-medium text-zinc-700 hover:bg-zinc-50"
              disabled={isPending}
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isPending}
              type="submit"
            >
              {isPending ? "Saving..." : initialItem ? "Save changes" : "Add item"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
