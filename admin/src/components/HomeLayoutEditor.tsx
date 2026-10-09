import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, Pencil, Check } from "lucide-react";
import { api, type Lang, type LText } from "../lib/api.ts";
import type { HomeBlock } from "../pages/HomeBlocks.tsx";

export interface LayoutRow { key: string; show?: boolean; title?: Partial<LText> }

const LANGS: { k: Lang; label: string }[] = [{ k: "uz", label: "🇺🇿 UZ" }, { k: "ru", label: "🇷🇺 RU" }, { k: "en", label: "🇬🇧 EN" }];
const L = (uz: string, ru: string, en: string): LText => ({ uz, ru, en });

/** O'rnatilgan bloklar: nomi, standart ko'rinishi, va (agar sarlavhali bo'lsa) standart sarlavhasi */
interface Builtin { key: string; label: string; defShow: boolean; title?: LText }
const BUILTIN: Builtin[] = [
  { key: "stories", label: "Storis (doiralar)", defShow: true },
  { key: "banners", label: "Bannerlar", defShow: true },
  { key: "hero", label: "Asosiy vidjet", defShow: true },
  { key: "featured", label: "Tavsiya etamiz", defShow: true, title: L("Tavsiya etamiz", "Рекомендуем", "Recommended") },
  { key: "categories", label: "Kategoriyalar", defShow: true, title: L("Kategoriyalar", "Категории", "Categories") },
  { key: "new", label: "Yangi kelganlar", defShow: false, title: L("Yangi kelganlar", "Новинки", "New arrivals") },
];

/** Bosh sahifa bloklari: ko'rinishi (ko'z), tartibi (strelka), nomi (qalamcha) */
export function HomeLayoutEditor({ value, onChange }: { value: LayoutRow[]; onChange: (v: LayoutRow[]) => void }) {
  const blocks = useQuery({ queryKey: ["home-blocks"], queryFn: () => api.get<HomeBlock[]>("/home-blocks"), staleTime: 30000 });
  const [editing, setEditing] = useState<string | null>(null);
  const custom = useMemo<Builtin[]>(() => (blocks.data || []).map((b) => ({ key: `block:${b.id}`, label: `${b.title.uz || "(nomsiz)"} — ${b.kind === "chips" ? "mini bloklar" : "mahsulotlar"}`, defShow: true })), [blocks.data]);
  const all = useMemo(() => [...BUILTIN, ...custom], [custom]);
  const meta = (key: string) => all.find((a) => a.key === key);

  const rows = useMemo(() => {
    const list: LayoutRow[] = Array.isArray(value) ? value.filter((r) => all.some((a) => a.key === r.key)) : [];
    const have = new Set(list.map((r) => r.key));
    for (const a of all) if (!have.has(a.key)) list.push({ key: a.key, show: a.defShow });
    return list;
  }, [value, all]);

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const setRow = (key: string, patch: Partial<LayoutRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const visible = (r: LayoutRow) => r.show !== false;

  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => {
        const m = meta(r.key);
        const titled = !!m?.title; // faqat sarlavhali o'rnatilgan bloklarni qayta nomlash mumkin
        const on = visible(r);
        const curTitle = { ...(m?.title || {}), ...(r.title || {}) } as Partial<LText>;
        return (
          <div key={r.key} className="rounded-xl border border-slate-200">
            <div className="flex items-center gap-2 px-3 py-2">
              <GripVertical size={15} className="text-slate-300 shrink-0" />
              <button type="button" onClick={() => setRow(r.key, { show: !on })} title={on ? "Yashirish" : "Ko'rsatish"}
                className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${on ? "text-emerald-600 hover:bg-emerald-50" : "text-slate-300 hover:bg-slate-100"}`}>
                {on ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
              <span className={`flex-1 min-w-0 text-sm truncate ${on ? "" : "text-slate-400"}`}>{(r.title?.uz || m?.title?.uz) || m?.label || r.key}</span>
              {titled && (
                <button type="button" onClick={() => setEditing(editing === r.key ? null : r.key)} className="w-8 h-8 rounded-lg text-slate-400 hover:bg-slate-100 flex items-center justify-center shrink-0" title="Nomini o'zgartirish"><Pencil size={14} /></button>
              )}
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="w-8 h-8 rounded-lg text-slate-400 hover:bg-slate-100 disabled:opacity-30 flex items-center justify-center"><ArrowUp size={15} /></button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="w-8 h-8 rounded-lg text-slate-400 hover:bg-slate-100 disabled:opacity-30 flex items-center justify-center"><ArrowDown size={15} /></button>
            </div>
            {titled && editing === r.key && (
              <div className="px-3 pb-3 pt-1 border-t border-slate-100 space-y-2">
                {LANGS.map((l) => (
                  <div key={l.k} className="flex items-center gap-2">
                    <span className="text-xs w-12 shrink-0">{l.label}</span>
                    <input className="input !py-1.5" value={curTitle[l.k] || ""} placeholder={m?.title?.[l.k] || ""}
                      onChange={(e) => setRow(r.key, { title: { ...(r.title || {}), [l.k]: e.target.value } })} />
                  </div>
                ))}
                <button type="button" className="btn btn-ghost !py-1 !px-2 text-xs" onClick={() => setEditing(null)}><Check size={14} /> Tayyor</button>
              </div>
            )}
          </div>
        );
      })}
      <div className="help">Ko'z — blokni ko'rsatish/yashirish, strelkalar — tartib, qalamcha — nomini o'zgartirish. Yangi bloklar <b>Nazorat → Katalog → Bosh sahifa bloklari</b> da yaratiladi.</div>
    </div>
  );
}
