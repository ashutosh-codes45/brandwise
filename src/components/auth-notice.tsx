import type { NoticeType } from "@/lib/auth/notices";

export function AuthNoticeBanner({
  message,
  type = "error",
}: {
  message?: string | null;
  type?: NoticeType | null;
}) {
  if (!message) {
    return null;
  }

  const isSuccess = type === "success";

  return (
    <div
      className={`rounded-lg border px-4 py-3 text-sm font-medium ${
        isSuccess
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-red-200 bg-red-50 text-red-700"
      }`}
      role={isSuccess ? "status" : "alert"}
    >
      {message}
    </div>
  );
}
