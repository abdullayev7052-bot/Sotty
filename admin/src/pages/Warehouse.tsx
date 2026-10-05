import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PackagePlus, PackageMinus, Scale, History, Truck, Plus, Trash2, Pencil, Search } from "lucide-react";
import { api } from "../lib/api.ts";
import { PageTitle, Spinner, Modal, useToast } from "../components/ui.tsx";

interface WProduct { id: number; name: string; sku: string | null; stock: number; price: number; costPrice: number; measure: string | null }
interface Supplier { id: number; name: string; phone: string | null; note: string | null }
interface Summary { products: number; totalUnits: number; costValue: number; retailValue: number; lowCount: number; outCount: number }
interface Movement { id: number; productId: number; product: string; measure: string | null; type: string; reason: string; qty: number; unitPrice: number; total: number; balance: number; supplier: string | null; orderId: number | null; note: string | null; createdBy: string | null; createdAt: string }

const money = (n: number) => (n || 0).toLocaleString("uz");

/** Qidiruvli mahsulot tanlagich */
function ProductPick({ products, value, onChange, placeholder = "Mahsulot qidiring..." }: { products: WProduct[]; value: number | null; onChange: (id: number, p: WProduct) => void; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const sel = products.find((p) => p.id === value);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (s ? products.filter((p) => p.name.toLowerCase().includes(s) || (p.sku || "").toLowerCase().includes(s)) : products).slice(0, 30);
  }, [q, products]);
  return (
    <div className="relative">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="input pl-9" placeholder={placeholder} value={open ? q : sel ? `${sel.name} (qoldiq ${sel.stock})` : q}
          onFocus={() => { setOpen(true); setQ(""); }} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)} />
      </div>
      {open && list.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-auto card p-1 shadow-lg">
          {list.map((p) => (
            <button key={p.id} type="button" className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-100 text-sm" onMouseDown={() => { onChange(p.id, p); setOpen(false); }}>
              <span className="font-medium">{p.name}</span>
              <span className="text-xs text-slate-500"> · qoldiq {p.stock}{p.sku ? ` · ${p.sku}` : ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function WarehousePage() {
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);
  const [tab, setTab] = useState<"purchase" | "movement" | "history" | "suppliers">("purchase");
  const summary = useQuery({ queryKey: ["wh-summary"], queryFn: () => api.get<Summary>("/warehouse/summary"), staleTime: 10000 });
  const products = useQuery({ queryKey: ["wh-products"], queryFn: () => api.get<WProduct[]>("/warehouse/products"), staleTime: 15000 });
  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: () => api.get<Supplier[]>("/suppliers"), staleTime: 30000 });

  const refreshAll = () => { void qc.invalidateQueries({ queryKey: ["wh-summary"] }); void qc.invalidateQueries({ queryKey: ["wh-products"] }); void qc.invalidateQueries({ queryKey: ["wh-movements"] }); void qc.invalidateQueries({ queryKey: ["catalog"] }); };

  const s = summary.data;
  const stat = (label: string, value: string, cls = "") => (
    <div className="card p-4"><div className="text-xs text-slate-500">{label}</div><div className={`text-lg font-bold ${cls}`}>{value}</div></div>
  );

  return (
    <div>
      <PageTitle title="Ombor" description="Kirim (xarid), chiqim (sotuv) va qoldiqlar. Buyurtma «Bajarildi» bo'lganda qoldiq avtomatik kamayadi." />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {s ? <>
          {stat("Jami qoldiq (dona)", money(s.totalUnits))}
          {stat("Tan narxda qiymati", money(s.costValue) + " so'm")}
          {stat("Sotuv narxida", money(s.retailValue) + " so'm")}
          {stat("Kam / tugagan", `${s.lowCount} / ${s.outCount}`, s.outCount ? "text-rose-600" : "")}
        </> : <div className="col-span-4"><Spinner /></div>}
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        <button className={`btn ${tab === "purchase" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("purchase")}><PackagePlus size={16} /> Kirim</button>
        <button className={`btn ${tab === "movement" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("movement")}><PackageMinus size={16} /> Chiqim / Tuzatish</button>
        <button className={`btn ${tab === "history" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("history")}><History size={16} /> Tarix</button>
        <button className={`btn ${tab === "suppliers" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("suppliers")}><Truck size={16} /> Yetkazib beruvchilar</button>
      </div>

      {products.isLoading ? <Spinner /> : (
        <>
          {tab === "purchase" && <PurchaseForm products={products.data || []} suppliers={suppliers.data || []} onDone={() => { refreshAll(); toast("Kirim saqlandi ✅"); }} />}
          {tab === "movement" && <MovementForm products={products.data || []} onDone={() => { refreshAll(); toast("Saqlandi ✅"); }} />}
          {tab === "history" && <HistoryTab />}
          {tab === "suppliers" && <SuppliersTab suppliers={suppliers.data || []} onChange={() => qc.invalidateQueries({ queryKey: ["suppliers"] })} />}
        </>
      )}
    </div>
  );
}

/** Kirim (ko'p qatorli xarid) */
function PurchaseForm({ products, suppliers, onDone }: { products: WProduct[]; suppliers: Supplier[]; onDone: () => void }) {
  const toast = useToast((s) => s.show);
  const [supplierId, setSupplierId] = useState<number | "">("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<{ productId: number | null; qty: number; unitPrice: number }[]>([{ productId: null, qty: 1, unitPrice: 0 }]);
  const [saving, setSaving] = useState(false);
  const setRow = (i: number, patch: Partial<{ productId: number | null; qty: number; unitPrice: number }>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const total = rows.reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.unitPrice) || 0), 0);
  const save = async () => {
    const valid = rows.filter((r) => r.productId && Number(r.qty) > 0);
    if (!valid.length) { toast("Kamida bitta mahsulot va miqdor kiriting", "err"); return; }
    setSaving(true);
    try {
      await api.post("/warehouse/purchase", { supplierId: supplierId || null, note: note || null, rows: valid.map((r) => ({ productId: r.productId, qty: Number(r.qty), unitPrice: Number(r.unitPrice) || 0 })) });
      setRows([{ productId: null, qty: 1, unitPrice: 0 }]); setNote("");
      onDone();
    } catch (e) { toast((e as Error).message, "err"); } finally { setSaving(false); }
  };
  return (
    <div className="card p-5 space-y-4 max-w-3xl">
      <div className="grid sm:grid-cols-2 gap-3">
        <div><label className="label">Yetkazib beruvchi</label>
          <select className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">— tanlanmagan —</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></div>
        <div><label className="label">Izoh</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Masalan: faktura №..." /></div>
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => {
          const sel = products.find((p) => p.id === r.productId);
          return (
            <div key={i} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-12 sm:col-span-6"><label className="label sm:hidden">Mahsulot</label><ProductPick products={products} value={r.productId} onChange={(id, p) => setRow(i, { productId: id, unitPrice: r.unitPrice || p.costPrice })} /></div>
              <div className="col-span-5 sm:col-span-2"><label className="label">Miqdor{sel?.measure ? ` (${sel.measure})` : ""}</label><input type="number" className="input" value={r.qty} onChange={(e) => setRow(i, { qty: Number(e.target.value) })} /></div>
              <div className="col-span-5 sm:col-span-3"><label className="label">Tan narx</label><input type="number" className="input" value={r.unitPrice} onChange={(e) => setRow(i, { unitPrice: Number(e.target.value) })} /></div>
              <div className="col-span-2 sm:col-span-1 flex justify-end"><button className="w-9 h-9 rounded-lg text-slate-400 hover:bg-slate-100 flex items-center justify-center" onClick={() => setRows((rw) => rw.length > 1 ? rw.filter((_, j) => j !== i) : rw)}><Trash2 size={16} /></button></div>
            </div>
          );
        })}
        <button className="btn btn-ghost" onClick={() => setRows((r) => [...r, { productId: null, qty: 1, unitPrice: 0 }])}><Plus size={16} /> Qator qo'shish</button>
      </div>
      <div className="flex items-center justify-between border-t border-slate-100 pt-3">
        <div className="text-sm">Jami summa: <b>{money(total)} so'm</b></div>
        <button className="btn btn-primary" disabled={saving} onClick={() => { void save(); }}>{saving ? "Saqlanmoqda…" : "Kirim qilish"}</button>
      </div>
    </div>
  );
}

/** Chiqim yoki tuzatish */
function MovementForm({ products, onDone }: { products: WProduct[]; onDone: () => void }) {
  const toast = useToast((s) => s.show);
  const [productId, setProductId] = useState<number | null>(null);
  const [mode, setMode] = useState<"out" | "adjust">("out");
  const [qty, setQty] = useState(1);
  const [unitPrice, setUnitPrice] = useState(0);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const sel = products.find((p) => p.id === productId);
  const save = async () => {
    if (!productId) { toast("Mahsulot tanlang", "err"); return; }
    setSaving(true);
    try {
      await api.post("/warehouse/movement", { productId, type: mode, qty: Number(qty), unitPrice: mode === "out" ? Number(unitPrice) || 0 : 0, reason: mode === "out" ? "sale" : "manual", note: note || null });
      setProductId(null); setQty(1); setUnitPrice(0); setNote("");
      onDone();
    } catch (e) { toast((e as Error).message, "err"); } finally { setSaving(false); }
  };
  return (
    <div className="card p-5 space-y-4 max-w-xl">
      <div className="flex gap-2">
        <button className={`btn ${mode === "out" ? "btn-primary" : "btn-ghost"}`} onClick={() => setMode("out")}><PackageMinus size={16} /> Chiqim (sotuv)</button>
        <button className={`btn ${mode === "adjust" ? "btn-primary" : "btn-ghost"}`} onClick={() => setMode("adjust")}><Scale size={16} /> Tuzatish</button>
      </div>
      <div><label className="label">Mahsulot</label><ProductPick products={products} value={productId} onChange={(id) => setProductId(id)} /></div>
      {sel && <div className="text-xs text-slate-500">Hozirgi qoldiq: <b>{sel.stock}</b>{sel.measure ? ` ${sel.measure}` : ""}</div>}
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">{mode === "adjust" ? "Yangi qoldiq" : "Miqdor"}</label><input type="number" className="input" value={qty} onChange={(e) => setQty(Number(e.target.value))} /></div>
        {mode === "out" && <div><label className="label">Sotuv narxi (ixtiyoriy)</label><input type="number" className="input" value={unitPrice} onChange={(e) => setUnitPrice(Number(e.target.value))} /></div>}
      </div>
      <div><label className="label">Izoh</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === "adjust" ? "Masalan: inventarizatsiya" : "Masalan: do'kondan sotildi"} /></div>
      <div className="flex justify-end"><button className="btn btn-primary" disabled={saving} onClick={() => { void save(); }}>{saving ? "Saqlanmoqda…" : "Saqlash"}</button></div>
    </div>
  );
}

const TYPE_LABEL: Record<string, { t: string; cls: string }> = {
  in: { t: "Kirim", cls: "text-emerald-600" }, out: { t: "Chiqim", cls: "text-rose-600" }, adjust: { t: "Tuzatish", cls: "text-amber-600" },
};
const REASON_LABEL: Record<string, string> = { manual: "qo'lda", purchase: "xarid", sale: "sotuv", order: "buyurtma" };

function HistoryTab() {
  const [reason, setReason] = useState("");
  const movements = useQuery({ queryKey: ["wh-movements", reason], queryFn: () => api.get<Movement[]>(`/warehouse/movements?limit=200${reason ? `&reason=${reason}` : ""}`), staleTime: 5000 });
  return (
    <div className="card">
      <div className="p-3 border-b border-slate-100 flex gap-2 items-center">
        <select className="input w-auto" value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="">Barcha harakatlar</option><option value="purchase">Xaridlar</option><option value="sale">Sotuvlar</option><option value="order">Buyurtmalar</option><option value="manual">Qo'lda</option>
        </select>
      </div>
      {movements.isLoading ? <Spinner /> : !movements.data?.length ? <div className="p-8 text-center text-slate-400">Harakatlar yo'q</div> : (
        <div className="divide-y divide-slate-100">
          {movements.data.map((m) => {
            const tl = TYPE_LABEL[m.type] || { t: m.type, cls: "" };
            return (
              <div key={m.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{m.product}</div>
                  <div className="text-xs text-slate-500">{new Date(m.createdAt).toLocaleString("uz")} · {REASON_LABEL[m.reason] || m.reason}{m.supplier ? ` · ${m.supplier}` : ""}{m.orderId ? ` · buyurtma #${m.orderId}` : ""}{m.note ? ` · ${m.note}` : ""}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className={`font-semibold ${tl.cls}`}>{tl.t} {m.qty > 0 ? "+" : ""}{m.qty}{m.measure ? ` ${m.measure}` : ""}</div>
                  <div className="text-xs text-slate-500">qoldiq: {m.balance}{m.total ? ` · ${money(m.total)} so'm` : ""}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SuppliersTab({ suppliers, onChange }: { suppliers: Supplier[]; onChange: () => void }) {
  const toast = useToast((s) => s.show);
  const [edit, setEdit] = useState<Partial<Supplier> | null>(null);
  const del = async (s: Supplier) => { if (!confirm(`"${s.name}" o'chirilsinmi?`)) return; try { await api.del(`/suppliers/${s.id}`); onChange(); } catch (e) { toast((e as Error).message, "err"); } };
  return (
    <div className="card">
      <div className="p-3 border-b border-slate-100 flex justify-end"><button className="btn btn-primary" onClick={() => setEdit({})}><Plus size={16} /> Yetkazib beruvchi</button></div>
      {!suppliers.length ? <div className="p-8 text-center text-slate-400">Hali yetkazib beruvchi yo'q</div> : (
        <div className="divide-y divide-slate-100">
          {suppliers.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-3 py-2">
              <div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{s.name}</div><div className="text-xs text-slate-500">{s.phone || "—"}{s.note ? ` · ${s.note}` : ""}</div></div>
              <button className="w-8 h-8 rounded-lg text-slate-400 hover:bg-slate-100 flex items-center justify-center" onClick={() => setEdit(s)}><Pencil size={16} /></button>
              <button className="w-8 h-8 rounded-lg text-slate-400 hover:bg-slate-100 flex items-center justify-center" onClick={() => { void del(s); }}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      )}
      {edit && <SupplierEditor initial={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onChange(); }} />}
    </div>
  );
}

function SupplierEditor({ initial, onClose, onSaved }: { initial: Partial<Supplier>; onClose: () => void; onSaved: () => void }) {
  const toast = useToast((s) => s.show);
  const [f, setF] = useState({ name: initial.name || "", phone: initial.phone || "", note: initial.note || "" });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!f.name.trim()) { toast("Nomi kiritilmagan", "err"); return; }
    setSaving(true);
    const body = { name: f.name.trim(), phone: f.phone || null, note: f.note || null };
    try { if (initial.id) await api.put(`/suppliers/${initial.id}`, body); else await api.post("/suppliers", body); onSaved(); } catch (e) { toast((e as Error).message, "err"); } finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title={initial.id ? "Tahrirlash" : "Yangi yetkazib beruvchi"}>
      <div className="space-y-3">
        <div><label className="label">Nomi *</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></div>
        <div><label className="label">Telefon</label><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
        <div><label className="label">Izoh</label><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
        <div className="flex justify-end gap-2"><button className="btn btn-ghost" onClick={onClose}>Bekor</button><button className="btn btn-primary" disabled={saving} onClick={() => { void save(); }}>Saqlash</button></div>
      </div>
    </Modal>
  );
}
