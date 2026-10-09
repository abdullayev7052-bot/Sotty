export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

const BASE = "/api/admin";

/** Do'kon slug'i (ko'p-do'kon): ?shop=... URL'da bo'lsa shu do'kon admini.
 *  sessionStorage ishlatamiz (localStorage emas): u HAR TAB uchun alohida, shuning uchun
 *  bitta brauzerda turli tablarda turli do'konlarga bir vaqtda kirish mumkin va
 *  bir do'kon boshqasining kontekstiga aralashmaydi. ?shop yo'q bo'lsa — asosiy do'kon. */
function shopHeaders(): Record<string, string> {
  try {
    const u = new URLSearchParams(location.search).get("shop");
    if (u) { sessionStorage.setItem("sotty_admin_shop", u); return { "X-Shop": u }; }
    const saved = sessionStorage.getItem("sotty_admin_shop");
    return saved ? { "X-Shop": saved } : {};
  } catch { return {}; }
}

async function request<T>(method: string, path: string, body?: unknown, raw?: FormData): Promise<T> {
  const r = await fetch(BASE + path, {
    method,
    credentials: "include",
    headers: { ...(raw ? {} : { "Content-Type": "application/json" }), ...shopHeaders() },
    body: raw ? raw : body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (r.status === 401 && !path.startsWith("/login")) {
    window.dispatchEvent(new CustomEvent("admin-unauthorized"));
  }
  if (!r.ok) throw new ApiError(((json || {}) as { error?: string }).error || `Xatolik (${r.status})`, r.status);
  return json as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
  upload: async (file: File): Promise<string> => {
    const fd = new FormData();
    fd.append("file", file);
    const r = await request<{ path: string }>("POST", "/upload", undefined, fd);
    return r.path;
  },
};

export type Lang = "uz" | "ru" | "en";
export type LText = Record<Lang, string>;
export interface FieldDef { key: string; label: string; type: string; help?: string; showIf?: string; default: unknown; options?: { value: string; label: string }[]; source?: string; min?: number; max?: number; step?: number; placeholders?: string[] }
export interface GroupDef { title: string; description?: string; part?: string; showIf?: string; fields: FieldDef[] }
export interface SectionDef { key: string; title: string; icon: string; description?: string; groups: GroupDef[] }
export type Settings = Record<string, Record<string, unknown>>;
export type Options = Record<string, { value: string; label: string }[]> & { ok?: boolean; error?: string };
