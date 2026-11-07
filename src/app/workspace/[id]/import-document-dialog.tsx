"use client";

import { useState, useTransition } from "react";
import { parseDocumentAction } from "./import-actions";

type ImportedSection = {
  html: string;
  preview: string;
  charCount: number;
};
type ImportResult = {
  sections: ImportedSection[];
  stats: {
    fileName: string;
    totalChars: number;
    sectionCount: number;
    truncatedChars: number;
  };
  warnings: string[];
};

export function ImportDocumentDialog({
  contentId,
  onAdd,
}: {
  contentId: string;
  onAdd: (sections: ImportedSection[], fileName: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ImportResult | null>(null);
  const [selected, setSelected] = useState<boolean[]>([]);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const selectedCount = selected.filter(Boolean).length;

  function openDialog() {
    setFile(null);
    setParsed(null);
    setSelected([]);
    setError("");
    setIsOpen(true);
  }

  function uploadFile() {
    if (!file) {
      setError("Choose a PDF, DOCX, or TXT document first.");
      return;
    }

    setError("");
    setParsed(null);
    const formData = new FormData();
    formData.set("contentId", contentId);
    formData.set("file", file);
    startTransition(async () => {
      const result = await parseDocumentAction(formData);
      if ("error" in result) {
        setError(result.error ?? "Could not read the selected document.");
        return;
      }
      setParsed(result);
      setSelected(result.sections.map(() => true));
    });
  }

  function addSelectedSections() {
    if (!parsed || selectedCount === 0) {
      return;
    }
    onAdd(
      parsed.sections.filter((_, index) => selected[index]),
      parsed.stats.fileName
    );
    setIsOpen(false);
  }

  return (
    <>
      <button
        className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        onClick={openDialog}
        type="button"
      >
        Import document
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 p-4">
          <section
            aria-labelledby="import-document-title"
            aria-modal="true"
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  className="text-lg font-semibold text-zinc-900"
                  id="import-document-title"
                >
                  Import document
                </h2>
                <p className="mt-1 text-sm text-zinc-600">
                  Review the extracted sections before adding them. Nothing is
                  saved until you press Save.
                </p>
              </div>
              <button
                aria-label="Close import dialog"
                className="rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-100"
                disabled={isPending}
                onClick={() => setIsOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="mt-5 flex flex-wrap items-end gap-3">
              <div className="min-w-0 flex-1">
                <label
                  className="mb-1.5 block text-sm font-medium text-zinc-700"
                  htmlFor="document-import-file"
                >
                  PDF, DOCX, or TXT (maximum 10 MB)
                </label>
                <input
                  accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  className="block w-full text-sm text-zinc-700 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:font-medium file:text-zinc-700 hover:file:bg-zinc-200"
                  disabled={isPending}
                  id="document-import-file"
                  onChange={(event) => {
                    setFile(event.currentTarget.files?.[0] ?? null);
                    setParsed(null);
                    setSelected([]);
                    setError("");
                  }}
                  type="file"
                />
              </div>
              <button
                className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!file || isPending}
                onClick={uploadFile}
                type="button"
              >
                {isPending ? "Reading document..." : "Upload"}
              </button>
            </div>

            {error && (
              <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
                {error}
              </p>
            )}

            {isPending && (
              <p className="mt-4 text-sm text-zinc-600" role="status">
                Extracting text and preparing a preview...
              </p>
            )}

            {parsed && (
              <div className="mt-5 space-y-4">
                <div className="rounded-lg bg-zinc-50 p-4 text-sm text-zinc-700">
                  <p>
                    <span className="font-medium">File:</span>{" "}
                    {parsed.stats.fileName}
                  </p>
                  <p className="mt-1">
                    <span className="font-medium">Sections found:</span>{" "}
                    {parsed.stats.sectionCount}{" "}
                    <span className="text-zinc-500">
                      ({parsed.stats.totalChars.toLocaleString()} characters)
                    </span>
                  </p>
                  <p
                    className={`mt-1 ${
                      parsed.stats.truncatedChars > 0
                        ? "text-amber-800"
                        : "text-zinc-500"
                    }`}
                  >
                    Characters cut:{" "}
                    {parsed.stats.truncatedChars.toLocaleString()}
                    {parsed.stats.truncatedChars > 0
                      ? " at the 50,000-character limit."
                      : ""}
                  </p>
                  {parsed.warnings.map((warning) => (
                    <p className="mt-1 text-amber-800" key={warning}>
                      {warning}
                    </p>
                  ))}
                </div>

                <ul className="max-h-80 space-y-3 overflow-y-auto pr-1">
                  {parsed.sections.map((section, index) => (
                    <li
                      className="rounded-lg border border-zinc-200 p-4"
                      key={index}
                    >
                      <label className="flex cursor-pointer items-start gap-3">
                        <input
                          checked={selected[index] ?? false}
                          className="mt-1 size-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                          onChange={(event) =>
                            setSelected((current) =>
                              current.map((isSelected, sectionIndex) =>
                                sectionIndex === index
                                  ? event.target.checked
                                  : isSelected
                              )
                            )
                          }
                          type="checkbox"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-zinc-800">
                            Section {index + 1}{" "}
                            <span className="font-normal text-zinc-500">
                              · {section.charCount.toLocaleString()} characters
                            </span>
                          </span>
                          <span className="mt-1 block whitespace-pre-wrap text-sm text-zinc-600">
                            {section.preview}
                            {section.charCount > section.preview.length
                              ? "…"
                              : ""}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>

                <div className="flex flex-wrap justify-end gap-3 border-t border-zinc-200 pt-4">
                  <button
                    className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                    onClick={() => setIsOpen(false)}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={selectedCount === 0}
                    onClick={addSelectedSections}
                    type="button"
                  >
                    Add {selectedCount} selected sections
                  </button>
                </div>
              </div>
            )}

            {!parsed && (
              <div className="mt-5 flex justify-end border-t border-zinc-200 pt-4">
                <button
                  className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                  disabled={isPending}
                  onClick={() => setIsOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
