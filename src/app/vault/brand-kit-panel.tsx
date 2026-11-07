"use client";

import { useState, useTransition } from "react";
import { saveBrandKit } from "./actions";
import type { BrandKit } from "@/lib/context/brand-kit";

const emptyKit: BrandKit = {
  colours: [],
  paletteTolerance: 25,
  allowNeutrals: true,
  fonts: [],
  logo: {
    minWidthPx: 200,
    allowedFormats: ["png", "jpg", "webp"],
    forbiddenUses: [],
  },
};

export function BrandKitPanel({
  initialKit,
  renderedRules,
  canManage,
}: {
  initialKit: BrandKit | null;
  renderedRules: string;
  canManage: boolean;
}) {
  const [json, setJson] = useState(() =>
    JSON.stringify(initialKit ?? emptyKit, null, 2)
  );
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [isError, setIsError] = useState(false);
  const [isPending, startTransition] = useTransition();

  function save() {
    let value: unknown;
    try {
      value = JSON.parse(json);
    } catch {
      setFeedback("Enter valid JSON for the Brand kit.");
      setIsError(true);
      return;
    }

    startTransition(async () => {
      const result = await saveBrandKit(value);
      if ("error" in result) {
        setFeedback(result.error);
        setIsError(true);
        return;
      }
      setEditing(false);
      setFeedback("Brand kit saved.");
      setIsError(false);
      window.location.reload();
    });
  }

  return (
    <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900">Brand kit</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Shared brand rules used for deterministic visual checks.
          </p>
        </div>
        {canManage && !editing && (
          <button
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            onClick={() => setEditing(true)}
            type="button"
          >
            {initialKit ? "Edit Brand kit" : "Set up Brand kit"}
          </button>
        )}
      </div>

      {editing ? (
        <div className="mt-5">
          <label
            className="mb-1.5 block text-sm font-medium text-zinc-700"
            htmlFor="brand-kit-json"
          >
            Structured brand rules (JSON)
          </label>
          <textarea
            className="min-h-80 w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-sm text-zinc-800"
            id="brand-kit-json"
            onChange={(event) => setJson(event.target.value)}
            spellCheck={false}
            value={json}
          />
          <div className="mt-3 flex justify-end gap-3">
            <button
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              disabled={isPending}
              onClick={() => setEditing(false)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              disabled={isPending}
              onClick={save}
              type="button"
            >
              {isPending ? "Saving..." : "Save Brand kit"}
            </button>
          </div>
        </div>
      ) : (
        <>
          {!initialKit ? (
            <p className="mt-5 rounded-lg bg-zinc-50 p-4 text-sm text-zinc-600">
              No Brand kit has been set up yet.
            </p>
          ) : (
            <div className="mt-5 space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-zinc-800">
                  Brand colours
                </h3>
                {initialKit?.colours.length ? (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {(initialKit?.colours ?? []).map((colour) => (
                      <li
                        className="inline-flex items-center gap-2 rounded-full border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700"
                        key={`${colour.hex}-${colour.name}`}
                      >
                        <span
                          aria-hidden="true"
                          className="size-4 rounded-full border border-zinc-300"
                          style={{ backgroundColor: colour.hex }}
                        />
                        {colour.name} · {colour.role} · {colour.hex}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-zinc-500">
                    No brand colours defined.
                  </p>
                )}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-zinc-800">
                  Logo rules
                </h3>
                <p className="mt-1 text-sm text-zinc-600">
                  Minimum width {initialKit?.logo.minWidthPx}px · Allowed formats:{" "}
                  {initialKit?.logo.allowedFormats.join(", ")}
                </p>
              </div>
              {renderedRules && (
                <div>
                  <h3 className="text-sm font-semibold text-zinc-800">
                    Rules and citations
                  </h3>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-zinc-600">
                    {renderedRules.split("\n").map((rule, index) => (
                      <li key={`${index}-${rule}`}>{rule}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {feedback && (
        <p
          className={`mt-4 rounded-lg px-3 py-2 text-sm ${
            isError ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"
          }`}
          role="status"
        >
          {feedback}
        </p>
      )}
    </section>
  );
}
