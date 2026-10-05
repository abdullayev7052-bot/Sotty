import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Ticket } from "lucide-react";
import { api } from "../lib/api.ts";
import { PageTitle, Spinner, Modal, Toggle, useToast } from "../components/ui.tsx";

interface Promo { id: number; name: string; type: string; value: number; minTotal: number; promoCode: string | null; active: boolean; startsAt: string | null; endsAt: string | null }
const money = (n: number) => (n || 0).toLocaleString("uz");

export function PromotionsPage() {
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);
  const list = useQuery({ queryKey: ["promotions"], queryFn: () => api.get<Promo[]>("/promotions"), staleTime: 10000 });
  const [edit, setEdit] = useState<Partial<Promo> | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["promotions"] });
  const toggle = async (p: Promo) => { try { await api.put(`/promotions/${p.id}`, { active: !p.active }); refresh(); } catch (e) { toast((e as Error).message, "err"); } };
  const del = async (p: Promo) => { if (!confirm(`"${p.name}" o'chirilsinmi?`)) return; try { await api.del(`/promotions/${p.id}`); refresh(); } catch (e) { toast((e as Error).message, "err"); } };
  const descr = (p: Promo) => {
    const d = p.type === "percent" ? `${p.value}% chegirma` : `${money(p.value)} so'm chegirma`;
    const cond = p.minTotal > 0 ? ` · ${money(p.minTotal)} so'mdan ortiq xaridga` : "";
    const code = p.promoCode ? ` · kod: ${p.promoCode}` : " · avtomatik";
    return d + cond + code;
  };
  return (
    <div>
      <PageTitle title="Aksiyalar" description="Savat darajasidagi chegirmalar. Eng ko'p chegirma beradigan mos aksiya avtomatik qo'llanadi." actions={<button className="btn btn-primary" onClick={() => setEdit({})}><Plus size={16} /> Aksiya qo'shish</button>} />
      {list.isLoading ? <Spinner /> : !list.data?.length ? (
        <div className="card p-10 text-center text-slate-400"><Ticket size={32} className="mx-auto mb-2 opacity-40" />Hali aksiya yo'q. «Aksiya qo'shish» tugmasini bosing.</div>
      ) : (
        <div className="card divide-y divide-slate-100">
          {list.data.map((p) => (
            <div key={p.id} className={`flex items-center gap-3 px-3 py-2.5 ${!p.active ? "opacity-50" : ""}`}>
              <Ticket size={18} className="text-[var(--primary)] shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{p.name}</div>
                <div className="text-xs text-slate-500">{descr(p)}{(p.startsAt || p.endsAt) ? ` · ${p.startsAt ? new Date(p.startsAt).toLocaleDateString("uz") : "…"}—${p.endsAt ? new Date(p.endsAt).toLocaleDateString("uz") : "…"}` : ""}</div>
              </div>
              <Toggle value={p.active} onChange={() => { void toggle(p); }} />
              <button className="w-8 h-8 rounded-lg text-slate-400 hover:bg-slate-100 flex items-center justify-center" onClick={() => setEdit(p)}><Pencil size={16} /></button>
              <button className="w-8 h-8 rounded-lg text-slate-400 hover:bg-slate-100 flex items-center justify-center" onClick={() => { void del(p); }}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      )}
      {edit && <PromoEditor initial={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refresh(); }} />}
    </div>
  );
}

function PromoEditor({ initial, onClose, onSaved }: { initial: Partial<Promo>; onClose: () => void; onSaved: () => void }) {
  const toast = useToast((s) => s.show);
  const ymd = (s: string | null | undefined) => (s ? new Date(s).toISOString().slice(0, 10) : "");
  const [f, setF] = useState({
    name: initial.name || "", type: initial.type || "percent", value: initial.value ?? 10,
    minTotal: initial.minTotal ?? 0, promoCode: initial.promoCode || "", active: initial.active ?? true,
    startsAt: ymd(initial.startsAt), endsAt: ymd(initial.endsAt),
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, v: unknown) => setF((d) => ({ ...d, [k]: v }));
  const save = async () => {
    if (!f.name.trim()) { toast("Nomi kiritilmagan", "err"); return; }
    setSaving(true);
    const body = { name: f.name.trim(), type: f.type, value: Number(f.value) || 0, minTotal: Number(f.minTotal) || 0, promoCode: f.promoCode.trim() || null, active: f.active, startsAt: f.startsAt || null, endsAt: f.endsAt || null };
    try { if (initial.id) await api.put(`/promotions/${initial.id}`, body); else await api.post("/promotions", body); toast("Saqlandi ✅"); onSaved(); }
    catch (e) { toast((e as Error).message, "err"); } finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title={initial.id ? "Aksiyani tahrirlash" : "Yangi aksiya"}>
      <div className="space-y-3">
        <div><label className="label">Nomi *</label><input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Masalan: Hafta oxiri chegirmasi" autoFocus /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Chegirma turi</label><select className="input" value={f.type} onChange={(e) => set("type", e.target.value)}><option value="percent">Foizli (%)</option><option value="fixed">Qat'iy summa</option></select></div>
          <div><label className="label">{f.type === "percent" ? "Foiz (%)" : "Summa (so'm)"}</label><input type="number" className="input" value={f.value} onChange={(e) => set("value", e.target.value)} /></div>
        </div>
        <div><label className="label">Minimal savat summasi (0 = doimo)</label><input type="number" className="input" value={f.minTotal} onChange={(e) => set("minTotal", e.target.value)} /><div className="help">Masalan 100000 — faqat 100 000 so'mdan ortiq xaridga qo'llanadi.</div></div>
        <div><label className="label">Promo-kod (ixtiyoriy)</label><input className="input" value={f.promoCode} onChange={(e) => set("promoCode", e.target.value)} placeholder="Bo'sh = avtomatik qo'llanadi" /><div className="help">Kod kiritilsa, chegirma faqat mijoz savatda shu kodni yozganda qo'llanadi.</div></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Boshlanishi</label><input type="date" className="input" value={f.startsAt} onChange={(e) => set("startsAt", e.target.value)} /></div>
          <div><label className="label">Tugashi</label><input type="date" className="input" value={f.endsAt} onChange={(e) => set("endsAt", e.target.value)} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)} /> Faol</label>
        <div className="flex justify-end gap-2 pt-1"><button className="btn btn-ghost" onClick={onClose}>Bekor</button><button className="btn btn-primary" disabled={saving} onClick={() => { void save(); }}>{saving ? "Saqlanmoqda…" : "Saqlash"}</button></div>
      </div>
    </Modal>
  );
}
