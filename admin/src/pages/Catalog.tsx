import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Star, ArrowUp, ArrowDown, Search, ArrowDownAZ, Copy, ChevronsUp, ChevronsDown, Percent, Image as ImageIcon, Plus, Pencil, Trash2, Info, X, LayoutGrid } from "lucide-react";
import { api, type Options } from "../lib/api.ts";
import { Modal, PageTitle, Spinner, Toggle, useToast } from "../components/ui.tsx";
import { HomeBlocksTab } from "./HomeBlocks.tsx";

interface CF { id: string; name: string; value: string }
interface P { id: number; bitoId: string; name: string; image: string | null; images?: (string | null)[]; price: number; oldPrice?: number | null; stock: number; trackStock?: boolean; categoryId: string | null; categoryName: string | null; hidden: boolean; featured: boolean; sortOrder: number; boxItem: number; sku: string | null; barcode?: string | null; note?: string | null; measure?: string | null; customFields?: CF[]; finalPrice?: number; discountPercent?: number; roundStep?: number; roundMode?: string }
interface C { id: number; bitoId: string; name: string; parentId: string | null; image: string | null; hidden: boolean; sortOrder: number; itemCount: number }
interface BannerRow { id: number; image: string; link: string | null; active: boolean; productIds?: number[] }
interface Data { products: P[]; categories: C[]; uzs?: boolean; sync: { running: boolean; last: { at: string; ok: boolean; message: string } | null } }

/** Tartibni serverga yuborishni 600 ms kechiktirib, bir nechta bosishni bittaga jamlash */
function useDebouncedReorder(url: string) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<number[] | null>(null);
  const toast = useToast((s) => s.show);
  return (ids: number[]) => {
    pending.current = ids;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const list = pending.current; pending.current = null;
      if (list) api.post(url, { ids: list }).catch((e) => toast("Tartib saqlanmadi: " + (e as Error).message, "err"));
    }, 600);
  };
}

export function CatalogPage() {
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);
  const q = useQuery({ queryKey: ["catalog"], queryFn: () => api.get<Data>("/catalog"), staleTime: 30000 });
  const options = useQuery({ queryKey: ["erp-options"], queryFn: () => api.get<Options>("/erp/options"), staleTime: 60000 });
  const [tab, setTab] = useState<"products" | "categories" | "blocks">("products");
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [disc, setDisc] = useState<{ percent: number; round: boolean; step: number; mode: string } | null>(null);
  const [bannerPick, setBannerPick] = useState(false);
  const banners = useQuery({ queryKey: ["banners"], queryFn: () => api.get<BannerRow[]>("/banners"), enabled: bannerPick });
  const [blockPick, setBlockPick] = useState(false);
  const blocksQ = useQuery({ queryKey: ["home-blocks"], queryFn: () => api.get<{ id: number; kind: string; title?: Record<string, string> }[]>("/home-blocks"), enabled: blockPick });
  /** Tanlangan mahsulotlarni mavjud blokka qo'shish */
  const attachToBlock = async (blockId: number) => {
    const ids = [...sel];
    try {
      const r = await api.post<{ added: number }>(`/home-blocks/${blockId}/add-products`, { ids });
      toast(`${r.added} ta mahsulot blokka qo'shildi`);
      setBlockPick(false); setSel(new Set());
    } catch (e) { toast((e as Error).message, "err"); }
  };
  /** Tanlangan mahsulotlarni bannerga biriktirish — mijoz bannerni bosganda shular chiqadi */
  const attachToBanner = async (b: BannerRow) => {
    const ids = [...sel];
    try {
      await api.put(`/banners/${b.id}`, { productIds: ids });
      toast(`${ids.length} ta mahsulot bannerga biriktirildi`);
      setBannerPick(false);
      setSel(new Set());
    } catch (e) { toast((e as Error).message, "err"); }
  };
  const reorderP = useDebouncedReorder("/catalog/products/reorder");
  const reorderC = useDebouncedReorder("/catalog/categories/reorder");

  // Lokal (optimistik) nusxa — har bosishda serverni kutmaymiz
  const [products, setProducts] = useState<P[]>([]);
  const [cats, setCats] = useState<C[]>([]);
  useEffect(() => { if (q.data) { setProducts(q.data.products); setCats(q.data.categories); } }, [q.data]);

  const visible = useMemo(() => {
    let list = products;
    if (cat) list = list.filter((p) => p.categoryId === cat);
    if (search.trim()) { const s = search.toLowerCase(); list = list.filter((p) => p.name.toLowerCase().includes(s) || (p.sku || "").includes(s) || String(p.id) === s); }
    return list;
  }, [products, cat, search]);

  const patch = (id: number, body: Partial<P>) => {
    setProducts((l) => l.map((p) => (p.id === id ? { ...p, ...body } : p)));
    api.put(`/catalog/products/${id}`, body).catch((e) => { toast((e as Error).message, "err"); void qc.invalidateQueries({ queryKey: ["catalog"] }); });
  };
  const patchCat = (id: number, body: Partial<C>) => {
    setCats((l) => l.map((c) => (c.id === id ? { ...c, ...body } : c)));
    api.put(`/catalog/categories/${id}`, body).catch((e) => { toast((e as Error).message, "err"); void qc.invalidateQueries({ queryKey: ["catalog"] }); });
  };
  /** Mahsulotni ko'rinadigan ro'yxat ichida siljitish (butun ro'yxat tartibini saqlab) */
  const moveP = (id: number, to: "up" | "down" | "top" | "bottom") => {
    setProducts((all) => {
      const list = [...all];
      const idx = list.findIndex((p) => p.id === id);
      if (idx < 0) return all;
      const visIds = visible.map((p) => p.id);
      const vi = visIds.indexOf(id);
      let targetVisIdx = to === "up" ? vi - 1 : to === "down" ? vi + 1 : to === "top" ? 0 : visIds.length - 1;
      if (targetVisIdx < 0 || targetVisIdx >= visIds.length || targetVisIdx === vi) return all;
      const targetId = visIds[targetVisIdx];
      const tIdx = list.findIndex((p) => p.id === targetId);
      const [item] = list.splice(idx, 1);
      list.splice(tIdx, 0, item);
      const withOrder = list.map((p, i) => ({ ...p, sortOrder: i + 1 }));
      reorderP(withOrder.map((p) => p.id));
      return withOrder;
    });
  };
  const moveC = (i: number, dir: -1 | 1) => {
    setCats((all) => {
      const list = [...all]; const j = i + dir; if (j < 0 || j >= list.length) return all;
      [list[i], list[j]] = [list[j], list[i]];
      reorderC(list.map((c) => c.id));
      return list;
    });
  };
  const bulk = async (body: { hidden?: boolean; featured?: boolean }) => {
    const ids = [...sel];
    setProducts((l) => l.map((p) => (sel.has(p.id) ? { ...p, ...body } : p)));
    setSel(new Set());
    try { await api.post("/catalog/products/bulk", { ids, ...body }); toast(`${ids.length} ta mahsulot yangilandi`); } catch (e) { toast((e as Error).message, "err"); void qc.invalidateQueries({ queryKey: ["catalog"] }); }
  };
  const applyDiscount = async () => {
    if (!disc) return;
    const ids = [...sel];
    const body = { ids, percent: disc.percent, roundStep: disc.round && q.data?.uzs ? disc.step : 0, roundMode: disc.mode };
    setDisc(null); setSel(new Set());
    try { await api.post("/catalog/products/discount", body); toast(body.percent > 0 ? `${ids.length} ta mahsulotga ${body.percent}% chegirma` : "Chegirma olib tashlandi"); await qc.invalidateQueries({ queryKey: ["catalog"] }); } catch (e) { toast((e as Error).message, "err"); }
  };
  const sortAZ = () => {
    setProducts((all) => { const l = [...all].sort((a, b) => a.name.localeCompare(b.name, "uz")).map((p, i) => ({ ...p, sortOrder: i + 1 })); reorderP(l.map((p) => p.id)); return l; });
    toast("A–Z tartiblandi");
  };
  const [editP, setEditP] = useState<Partial<P> | null>(null); // mahsulot tahrirlagich (yangi uchun {})
  const [editC, setEditC] = useState<Partial<C> | null>(null); // kategoriya tahrirlagich
  const delProduct = async (p: P) => {
    if (!confirm(`"${p.name}" mahsuloti o'chirilsinmi?`)) return;
    setProducts((l) => l.filter((x) => x.id !== p.id));
    try { await api.del(`/catalog/products/${p.id}`); toast("O'chirildi"); } catch (e) { toast((e as Error).message, "err"); void qc.invalidateQueries({ queryKey: ["catalog"] }); }
  };
  const delCategory = async (c: C) => {
    if (!confirm(`"${c.name}" kategoriyasi o'chirilsinmi?`)) return;
    setCats((l) => l.filter((x) => x.id !== c.id));
    try { await api.del(`/catalog/categories/${c.id}`); toast("O'chirildi"); } catch (e) { toast((e as Error).message, "err"); void qc.invalidateQueries({ queryKey: ["catalog"] }); }
  };
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast(`Nusxalandi: ${t}`));
  const IconBtn = ({ onClick, title, children, active }: { onClick: () => void; title: string; children: React.ReactNode; active?: boolean }) => (
    <button title={title} onClick={onClick} className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${active ? "bg-amber-100 text-amber-600" : "text-slate-400 hover:bg-slate-100"}`}>{children}</button>
  );

  if (q.isLoading || !q.data) return <Spinner />;

  return (
    <div>
      <PageTitle title="Katalog" actions={
        tab === "categories"
          ? <button className="btn btn-primary" onClick={() => setEditC({})}><Plus size={16} /> Kategoriya qo'shish</button>
          : tab === "products"
            ? <button className="btn btn-primary" onClick={() => setEditP({})}><Plus size={16} /> Mahsulot qo'shish</button>
            : undefined
      } />
      <div className="flex gap-2 mb-4">
        <button className={`btn ${tab === "products" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("products")}>Mahsulotlar ({products.length})</button>
        <button className={`btn ${tab === "categories" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("categories")}>Kategoriyalar ({cats.length})</button>
        <button className={`btn ${tab === "blocks" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("blocks")}>Bosh sahifa bloklari</button>
      </div>

      {tab === "blocks" ? <HomeBlocksTab products={products} options={options.data || null} /> : null}

      {tab === "products" ? (
        <div className="card">
          <div className="p-3 flex flex-wrap gap-2 items-center border-b border-slate-100">
            <div className="relative flex-1 min-w-[180px]"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="input pl-9" placeholder="Nomi, SKU yoki ID..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <select className="input w-auto max-w-[220px]" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Barcha kategoriyalar</option>{cats.map((c) => <option key={c.bitoId} value={c.bitoId}>{c.name}</option>)}</select>
            <button className="btn btn-ghost" onClick={sortAZ}><ArrowDownAZ size={16} /> A–Z</button>
            {sel.size > 0 && (
              <div className="flex flex-wrap gap-1.5 items-center bg-blue-50 rounded-lg px-2 py-1 w-full sm:w-auto">
                <span className="text-xs font-semibold text-blue-700">{sel.size} tanlandi:</span>
                <button className="btn btn-ghost !py-1 !px-2 text-xs" onClick={() => { void bulk({ hidden: true }); }}>Yashirish</button>
                <button className="btn btn-ghost !py-1 !px-2 text-xs" onClick={() => { void bulk({ hidden: false }); }}>Ko'rsatish</button>
                <button className="btn btn-ghost !py-1 !px-2 text-xs" onClick={() => setBannerPick(true)}><ImageIcon size={13} /> Banner</button>
                <button className="btn btn-ghost !py-1 !px-2 text-xs" onClick={() => setBlockPick(true)}><LayoutGrid size={13} /> Bloklar</button>
                <button className="btn btn-ghost !py-1 !px-2 text-xs text-rose-600" onClick={() => setDisc({ percent: 10, round: true, step: 1000, mode: "nearest" })}><Percent size={12} /> Chegirma</button>
              </div>
            )}
          </div>
          <div className="divide-y divide-slate-100">
            {visible.map((p) => (
              <div key={p.id} className={`flex items-center gap-2 px-2 sm:px-3 py-2 ${p.hidden ? "opacity-50" : ""}`}>
                <input type="checkbox" className="shrink-0" checked={sel.has(p.id)} onChange={(e) => { const s = new Set(sel); if (e.target.checked) s.add(p.id); else s.delete(p.id); setSel(s); }} />
                {p.image ? <img src={p.image} className="w-10 h-10 rounded-lg object-cover bg-slate-100 shrink-0" loading="lazy" /> : <div className="w-10 h-10 rounded-lg bg-slate-100 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  <div className="text-xs text-slate-500 truncate">{p.categoryName || "—"} · {p.discountPercent ? <><s className="text-slate-400">{p.price.toLocaleString()}</s> <b className="text-rose-600">{(p.finalPrice ?? p.price).toLocaleString()}</b> <span className="badge bg-rose-50 text-rose-600">-{p.discountPercent}%</span></> : p.price.toLocaleString()} · qoldiq {p.stock}{p.boxItem ? ` · quti ${p.boxItem}` : ""}</div>
                  <button onClick={() => { void copy(`product:${p.id}`); }} className="text-[11px] text-blue-600 inline-flex items-center gap-1 mt-0.5"><Copy size={11} /> ID {p.id}</button>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <IconBtn title="Tavsiya etilgan" active={p.featured} onClick={() => patch(p.id, { featured: !p.featured })}><Star size={16} fill={p.featured ? "currentColor" : "none"} /></IconBtn>
                  <IconBtn title={p.hidden ? "Ko'rsatish" : "Yashirish"} onClick={() => patch(p.id, { hidden: !p.hidden })}>{p.hidden ? <EyeOff size={16} /> : <Eye size={16} />}</IconBtn>
                  <div className="hidden sm:flex">
                    <IconBtn title="Eng yuqoriga" onClick={() => moveP(p.id, "top")}><ChevronsUp size={16} /></IconBtn>
                    <IconBtn title="Yuqoriga" onClick={() => moveP(p.id, "up")}><ArrowUp size={16} /></IconBtn>
                    <IconBtn title="Pastga" onClick={() => moveP(p.id, "down")}><ArrowDown size={16} /></IconBtn>
                    <IconBtn title="Eng pastga" onClick={() => moveP(p.id, "bottom")}><ChevronsDown size={16} /></IconBtn>
                  </div>
                  <div className="flex sm:hidden flex-col">
                    <IconBtn title="Yuqoriga" onClick={() => moveP(p.id, "up")}><ArrowUp size={14} /></IconBtn>
                    <IconBtn title="Pastga" onClick={() => moveP(p.id, "down")}><ArrowDown size={14} /></IconBtn>
                  </div>
                  <IconBtn title="Tahrirlash" onClick={() => setEditP(p)}><Pencil size={16} /></IconBtn>
                  <IconBtn title="O'chirish" onClick={() => { void delProduct(p); }}><Trash2 size={16} /></IconBtn>
                </div>
              </div>
            ))}
            {!visible.length && <div className="p-8 text-center text-slate-400">Mahsulot topilmadi</div>}
          </div>
        </div>
      ) : (
        <div className="card divide-y divide-slate-100">
          {cats.map((c, i) => (
            <div key={c.id} className={`flex items-center gap-2 px-2 sm:px-3 py-2 ${c.hidden ? "opacity-50" : ""}`}>
              {c.image ? <img src={c.image} className="w-10 h-10 rounded-lg object-cover bg-slate-100 shrink-0" loading="lazy" /> : <div className="w-10 h-10 rounded-lg bg-slate-100 shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{c.parentId ? "↳ " : ""}{c.name}</div>
                <div className="text-xs text-slate-500 truncate">{c.itemCount} ta mahsulot{c.parentId ? ` · ${cats.find((x) => x.bitoId === c.parentId)?.name || ""}` : ""}</div>
                <button onClick={() => { void copy(`category:${c.bitoId}`); }} className="text-[11px] text-blue-600 inline-flex items-center gap-1 mt-0.5"><Copy size={11} /> ID nusxalash</button>
              </div>
              <Toggle value={!c.hidden} onChange={(v) => patchCat(c.id, { hidden: !v })} />
              <IconBtn title="Yuqoriga" onClick={() => moveC(i, -1)}><ArrowUp size={16} /></IconBtn>
              <IconBtn title="Pastga" onClick={() => moveC(i, 1)}><ArrowDown size={16} /></IconBtn>
              <IconBtn title="Tahrirlash" onClick={() => setEditC(c)}><Pencil size={16} /></IconBtn>
              <IconBtn title="O'chirish" onClick={() => { void delCategory(c); }}><Trash2 size={16} /></IconBtn>
            </div>
          ))}
        </div>
      )}

      <Modal open={bannerPick} onClose={() => setBannerPick(false)} title={`Bannerga biriktirish (${sel.size} ta mahsulot)`}>
        <div className="space-y-2">
          {banners.isLoading ? <Spinner /> : !banners.data?.length ? (
            <div className="text-sm text-slate-500 py-4 text-center">Hali banner yo'q. <b>Kontent → Banner</b> bo'limida qo'shing.</div>
          ) : banners.data.map((b) => (
            <button key={b.id} onClick={() => { void attachToBanner(b); }} className="w-full flex items-center gap-3 p-2 rounded-xl border border-slate-200 hover:border-[var(--primary)] text-left">
              <img src={b.image} className="w-24 h-14 rounded-lg object-cover bg-slate-100 shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium">Banner #{b.id}{!b.active && <span className="text-slate-400 font-normal"> · o'chirilgan</span>}</span>
                <span className="block text-xs text-slate-500 truncate">
                  {b.productIds?.length ? `hozir ${b.productIds.length} ta mahsulot biriktirilgan` : b.link ? `havola: ${b.link}` : "havolasiz"}
                </span>
              </span>
              <span className="text-xs text-[var(--primary)] font-semibold shrink-0">Biriktirish →</span>
            </button>
          ))}
          <div className="help">Biriktirilgandan keyin mijoz shu bannerni bosganda katalogda aynan shu mahsulotlar ko'rinadi.</div>
        </div>
      </Modal>

      <Modal open={blockPick} onClose={() => setBlockPick(false)} title={`Blokka qo'shish (${sel.size} ta mahsulot)`}>
        <div className="space-y-2">
          {blocksQ.isLoading ? <Spinner /> : !(blocksQ.data || []).filter((b) => b.kind === "products").length ? (
            <div className="text-sm text-slate-500 py-4 text-center">«Mahsulotlar bloki» yo'q. <b>Katalog → Bosh sahifa bloklari</b> da yarating.</div>
          ) : (blocksQ.data || []).filter((b) => b.kind === "products").map((b) => (
            <button key={b.id} onClick={() => { void attachToBlock(b.id); }} className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-[var(--primary)] text-left">
              <LayoutGrid size={18} className="text-[var(--primary)] shrink-0" />
              <span className="flex-1 text-sm font-medium">{b.title?.uz || `Blok #${b.id}`}</span>
              <span className="text-xs text-[var(--primary)] font-semibold shrink-0">Qo'shish →</span>
            </button>
          ))}
          <div className="help">Tanlangan mahsulotlar shu blokka qo'shiladi (dublikatlar qo'shilmaydi). Bosh sahifada blok sekin aylanib turadi.</div>
        </div>
      </Modal>

      <Modal open={!!disc} onClose={() => setDisc(null)} title={`Chegirma belgilash (${sel.size} ta mahsulot)`}>
        {disc && (
          <div className="space-y-4">
            <div><label className="label">Chegirma foizi (%)</label><input type="number" className="input max-w-xs" min={0} max={99} value={disc.percent} onChange={(e) => setDisc({ ...disc, percent: Math.max(0, Math.min(99, Number(e.target.value) || 0)) })} />
              <div className="help">0 — chegirmani olib tashlaydi. Chegirma narxi Mini App'da chizilgan eski narx bilan ko'rsatiladi, buyurtma ham Bito'ga shu narxda tushadi.</div></div>
            {q.data?.uzs ? (
              <>
                <div className="flex items-center justify-between"><span className="text-sm font-medium">Narxni yaxlitlash</span><Toggle value={disc.round} onChange={(v) => setDisc({ ...disc, round: v })} /></div>
                {disc.round && (
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div><label className="label">Yaxlitlash qadami</label>
                      <select className="input" value={disc.step} onChange={(e) => setDisc({ ...disc, step: Number(e.target.value) })}>{[100, 500, 1000, 5000, 10000].map((s) => <option key={s} value={s}>{s.toLocaleString()} so'm</option>)}</select></div>
                    <div><label className="label">Yaxlitlash turi</label>
                      <select className="input" value={disc.mode} onChange={(e) => setDisc({ ...disc, mode: e.target.value })}><option value="nearest">Eng yaqiniga</option><option value="up">Yuqoriga</option><option value="down">Pastga</option></select></div>
                  </div>
                )}
              </>
            ) : <div className="help">Yaxlitlash faqat so'm valyutasida ishlaydi.</div>}
            <div className="flex justify-end gap-2"><button className="btn btn-ghost" onClick={() => setDisc(null)}>Bekor</button><button className="btn btn-primary" onClick={() => { void applyDiscount(); }}>{disc.percent > 0 ? "Qo'llash" : "Chegirmani olib tashlash"}</button></div>
          </div>
        )}
      </Modal>

      {editP && <ProductEditor initial={editP} cats={cats} onClose={() => setEditP(null)} onSaved={() => { setEditP(null); void qc.invalidateQueries({ queryKey: ["catalog"] }); }} />}
      {editC && <CategoryEditor initial={editC} cats={cats} onClose={() => setEditC(null)} onSaved={() => { setEditC(null); void qc.invalidateQueries({ queryKey: ["catalog"] }); }} />}
    </div>
  );
}

function newFieldId(): string { return "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

interface FieldDef { id: string; name: string; options: string[] }
interface VariantDef { id: string; name: string; values: string[] }
interface CFRow { id: string; name: string; value: string }
interface Dim { name: string; values: string[] }
interface Combo { label: string; attrs: { name: string; value: string }[] }
interface VariantItem { label: string; attrs: { name: string; value: string }[]; price?: number; stock?: number; image?: string | null }

/** Variant o'lchamlaridan barcha kombinatsiyalarni hosil qilish (dekart ko'paytma) */
function cartesian(dims: Dim[]): Combo[] {
  const ds = dims.filter((d) => d.name.trim() && d.values.length);
  if (!ds.length) return [];
  let acc: { name: string; value: string }[][] = [[]];
  for (const d of ds) acc = acc.flatMap((c) => d.values.map((v) => [...c, { name: d.name.trim(), value: v }]));
  return acc.map((attrs) => ({ attrs, label: attrs.map((a) => a.value).join(" / ") }));
}

/** Mavjud variantlardan o'lchamlarni tiklash */
function dimsFromVariants(list: VariantItem[]): Dim[] {
  const names: string[] = [];
  const map = new Map<string, string[]>();
  for (const v of list) for (const a of v.attrs) {
    if (!map.has(a.name)) { map.set(a.name, []); names.push(a.name); }
    const arr = map.get(a.name)!;
    if (!arr.includes(a.value)) arr.push(a.value);
  }
  return names.map((n) => ({ name: n, values: map.get(n)! }));
}

/** Mahsulot qo'shish/tahrirlash */
function ProductEditor({ initial, cats, onClose, onSaved }: { initial: Partial<P>; cats: C[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast((s) => s.show);
  const initImages = (((initial.images || []).filter(Boolean) as string[]).length ? (initial.images!.filter(Boolean) as string[]) : (initial.image ? [initial.image] : []));
  const [f, setF] = useState({
    name: initial.name || "",
    price: String(initial.price ?? ""),
    oldPrice: initial.oldPrice != null ? String(initial.oldPrice) : "",
    categoryCode: initial.categoryId || "",
    note: initial.note || "",
    images: initImages as string[],
    trackStock: initial.trackStock ?? false,
    stock: String(initial.stock ?? ""),
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [localCats, setLocalCats] = useState<C[]>(cats);
  const [addingCat, setAddingCat] = useState(false);
  const [newCat, setNewCat] = useState("");
  const set = (k: keyof typeof f, v: unknown) => setF((d) => ({ ...d, [k]: v }));

  // ----- Variantlar -----
  const [hasVariants, setHasVariants] = useState(false);
  const [dims, setDims] = useState<Dim[]>([]);
  const [diffPrice, setDiffPrice] = useState(false);
  const [vData, setVData] = useState<Record<string, { price: string; stock: string; image: string }>>({});
  const combos = useMemo(() => cartesian(dims), [dims]);
  useEffect(() => {
    if (!initial.id) return;
    api.get<VariantItem[]>(`/catalog/products/${initial.id}/variants`).then((list) => {
      if (!list.length) return;
      setHasVariants(true);
      setDims(dimsFromVariants(list));
      setDiffPrice(new Set(list.map((v) => v.price)).size > 1);
      const d: Record<string, { price: string; stock: string; image: string }> = {};
      for (const v of list) d[v.label] = { price: String(v.price ?? ""), stock: String(v.stock ?? ""), image: v.image || "" };
      setVData(d);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const addDim = () => setDims((d) => [...d, { name: "", values: [] }]);
  const setDimName = (i: number, name: string) => setDims((d) => d.map((x, j) => j === i ? { ...x, name } : x));
  const removeDim = (i: number) => setDims((d) => d.filter((_, j) => j !== i));
  const addDimValue = (i: number, val: string) => { const v = val.trim(); if (!v) return; setDims((d) => d.map((x, j) => j === i ? (x.values.includes(v) ? x : { ...x, values: [...x.values, v] }) : x)); };
  const removeDimValue = (i: number, vi: number) => setDims((d) => d.map((x, j) => j === i ? { ...x, values: x.values.filter((_, k) => k !== vi) } : x));

  // ----- Variant xotirasi (do'kon bo'yicha eslab qolingan turlar/qiymatlar) -----
  const [vdefs, setVdefs] = useState<VariantDef[]>([]);
  useEffect(() => { api.get<VariantDef[]>("/catalog/variant-defs").then(setVdefs).catch(() => {}); }, []);
  const saveVdefs = (next: VariantDef[]) => { setVdefs(next); api.put("/catalog/variant-defs", next).catch(() => {}); };
  /** Eslab qolingan variant turini mahsulotga qo'shish (yoki e'tiborni unga qaratish) */
  const addRememberedDim = (def: VariantDef) => setDims((d) => d.some((x) => x.name.trim().toLowerCase() === def.name.trim().toLowerCase()) ? d : [...d, { name: def.name, values: [] }]);
  /** Eslab qolingan qiymatni mos variantga qo'shish */
  const defValuesFor = (name: string): string[] => vdefs.find((v) => v.name.trim().toLowerCase() === name.trim().toLowerCase())?.values || [];
  /** Xotiradan variant turini butunlay o'chirish */
  const forgetDim = (id: string) => saveVdefs(vdefs.filter((v) => v.id !== id));
  /** Xotiradan bitta qiymatni o'chirish */
  const forgetValue = (id: string, val: string) => saveVdefs(vdefs.map((v) => v.id === id ? { ...v, values: v.values.filter((x) => x !== val) } : v));
  const setVField = (label: string, k: "price" | "stock" | "image", val: string) => setVData((d) => { const cur = d[label] || { price: "", stock: "", image: "" }; return { ...d, [label]: { ...cur, [k]: val } }; });

  const pickImages = async (files: FileList) => {
    setUploading(true);
    try {
      const paths: string[] = [];
      for (const file of Array.from(files)) { const p = await api.upload(file); paths.push(p); }
      setF((d) => ({ ...d, images: [...d.images, ...paths] }));
    } catch (e) { toast((e as Error).message, "err"); } finally { setUploading(false); }
  };
  const makePrimary = (i: number) => setF((d) => { const imgs = [...d.images]; const [x] = imgs.splice(i, 1); return { ...d, images: [x, ...imgs] }; });
  const removeImage = (i: number) => setF((d) => ({ ...d, images: d.images.filter((_, j) => j !== i) }));

  const addCategory = async () => {
    const name = newCat.trim();
    if (!name) return;
    try {
      const r = await api.post<{ code: string }>("/catalog/categories/create", { name });
      const added: C = { id: Date.now(), bitoId: r.code, name, parentId: null, image: null, hidden: false, sortOrder: 0, itemCount: 0 };
      setLocalCats((c) => [...c, added]);
      set("categoryCode", r.code);
      setNewCat(""); setAddingCat(false);
    } catch (e) { toast((e as Error).message, "err"); }
  };

  // ----- Qo'shimcha maydonlar (do'kon bo'yicha umumiy) -----
  // Har bir maydon do'konning BARCHA mahsulotlariga tegishli; har mahsulot o'z qiymatini kiritadi.
  // Bitta mahsulotga qo'shilgan maydon — keyingi mahsulotlarda ham avtomatik ochiladi.
  const [defs, setDefs] = useState<FieldDef[]>([]);
  const [cfs, setCfs] = useState<CFRow[]>([]);
  useEffect(() => {
    api.get<FieldDef[]>("/catalog/field-defs").then((list) => {
      setDefs(list);
      const own = (initial.customFields || []);
      const valOf = (def: FieldDef) => own.find((c) => c.id === def.id || c.name.trim().toLowerCase() === def.name.trim().toLowerCase())?.value || "";
      // Do'kondagi barcha maydonlar + mahsulotning o'z qiymatlari
      const rows: CFRow[] = list.map((d) => ({ id: d.id, name: d.name, value: valOf(d) }));
      // Ta'rifda yo'q, lekin mahsulotda bor eski maydonlar — ularni ham ko'rsatamiz
      for (const c of own) if (!list.some((d) => d.id === c.id || d.name.trim().toLowerCase() === c.name.trim().toLowerCase())) rows.push({ id: c.id, name: c.name, value: c.value });
      setCfs(rows);
    }).catch(() => {});
  }, []);
  const addField = () => setCfs((d) => [...d, { id: newFieldId(), name: "", value: "" }]);
  const setField = (i: number, k: "name" | "value", v: string) => setCfs((d) => d.map((c, j) => j === i ? { ...c, [k]: v } : c));
  const removeField = async (i: number) => {
    const row = cfs[i];
    setCfs((d) => d.filter((_, j) => j !== i));
    // Agar bu maydon do'kon ta'rifida bo'lsa — uni butun do'kondan (barcha mahsulotlardan) o'chiramiz
    if (defs.some((d) => d.id === row.id)) {
      try { await api.del(`/catalog/field-defs/${row.id}`); setDefs((d) => d.filter((x) => x.id !== row.id)); } catch { /* ignore */ }
    }
  };
  const defByName = (name: string) => defs.find((d) => d.name.toLowerCase() === name.trim().toLowerCase());

  const save = async () => {
    if (!f.name.trim()) { toast("Nomi kiritilmagan", "err"); return; }
    if (!(Number(f.price) > 0)) { toast("Narxi kiritilmagan", "err"); return; }
    if (!f.images.length) { toast("Kamida bitta rasm qo'shing", "err"); return; }
    const oldP = f.oldPrice.trim() ? Number(f.oldPrice) : null;
    if (oldP != null && !(oldP > Number(f.price))) { toast("Eski narx yangi narxdan katta bo'lishi kerak", "err"); return; }
    setSaving(true);
    const variantsOn = hasVariants && combos.length > 0;
    // Ishlatilgan variant turlari/qiymatlarini do'kon xotirasiga qo'shamiz (keyingi mahsulotlarda tezkor tanlash uchun)
    if (variantsOn) {
      const nextV: VariantDef[] = vdefs.map((v) => ({ ...v, values: [...v.values] }));
      let vChanged = false;
      for (const d of dims) {
        const nm = d.name.trim(); if (!nm || !d.values.length) continue;
        const idx = nextV.findIndex((v) => v.name.trim().toLowerCase() === nm.toLowerCase());
        if (idx < 0) { nextV.push({ id: newFieldId(), name: nm, values: [...d.values] }); vChanged = true; }
        else for (const val of d.values) if (!nextV[idx].values.includes(val)) { nextV[idx].values.push(val); vChanged = true; }
      }
      if (vChanged) { setVdefs(nextV); api.put("/catalog/variant-defs", nextV).catch(() => {}); }
    }
    // Do'kon bo'yicha maydon ta'riflari: yangi maydon / yangi qiymat avtomatik saqlanadi (barcha mahsulotlar uchun)
    const newDefs: FieldDef[] = defs.map((d) => ({ ...d, options: [...d.options] }));
    let defsChanged = false;
    for (const c of cfs) {
      if (!c.name.trim()) continue;
      const nm = c.name.trim(), val = c.value.trim();
      const idx = newDefs.findIndex((d) => d.id === c.id || d.name.toLowerCase() === nm.toLowerCase());
      if (idx < 0) { newDefs.push({ id: c.id, name: nm, options: val ? [val] : [] }); defsChanged = true; }
      else {
        if (newDefs[idx].name !== nm) { newDefs[idx].name = nm; defsChanged = true; }
        if (val && !newDefs[idx].options.includes(val)) { newDefs[idx].options.push(val); defsChanged = true; }
      }
    }
    // Faqat qiymati bor maydonlar mahsulotga yoziladi — bo'sh qiymat Mini App'da ko'rinmaydi
    const cfOut = cfs.filter((c) => c.name.trim() && c.value.trim()).map((c) => { const def = newDefs.find((d) => d.id === c.id || d.name.toLowerCase() === c.name.trim().toLowerCase()); return { id: def?.id || c.id, name: c.name.trim(), value: c.value.trim() }; });
    const body = {
      name: f.name.trim(), price: Number(f.price) || 0, oldPrice: oldP,
      categoryCode: f.categoryCode || null, note: f.note || null,
      image: f.images[0] || null, images: f.images,
      trackStock: f.trackStock, stock: f.trackStock ? (Number(f.stock) || 0) : 0,
      customFields: cfOut,
      hasVariants: variantsOn,
      variants: variantsOn ? combos.map((c): VariantItem => ({
        label: c.label, attrs: c.attrs,
        price: diffPrice ? (Number(vData[c.label]?.price) || Number(f.price) || 0) : undefined,
        stock: Number(vData[c.label]?.stock) || 0,
        image: vData[c.label]?.image || null,
      })) : [],
    };
    try {
      if (defsChanged) { await api.put("/catalog/field-defs", newDefs); setDefs(newDefs); }
      if (initial.id) await api.put(`/catalog/products/${initial.id}/full`, body);
      else await api.post("/catalog/products/create", body);
      toast("Saqlandi ✅");
      onSaved();
    } catch (e) { toast((e as Error).message, "err"); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={initial.id ? "Mahsulotni tahrirlash" : "Yangi mahsulot"}>
      <div className="space-y-3">
        <div><label className="label">Nomi *</label><input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Narxi *</label><input type="number" className="input" value={f.price} onChange={(e) => set("price", e.target.value)} /></div>
          <div>
            <label className="label flex items-center gap-1">Eski narxi
              <span className="text-slate-400 cursor-help" title="Kiritilsa, mahsulot kartochkasida eski narx ustidan chizilgan holda — yangi narx chegirma sifatida ko'rinadi."><Info size={13} /></span>
            </label>
            <input type="number" className="input" value={f.oldPrice} onChange={(e) => set("oldPrice", e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Kategoriya</label>
          {addingCat ? (
            <div className="flex gap-2">
              <input className="input" placeholder="Yangi kategoriya nomi" value={newCat} autoFocus onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void addCategory(); }} />
              <button className="btn btn-primary" onClick={() => { void addCategory(); }}>Qo'shish</button>
              <button className="btn btn-ghost" onClick={() => { setAddingCat(false); setNewCat(""); }}><X size={16} /></button>
            </div>
          ) : (
            <div className="flex gap-2">
              <select className="input flex-1" value={f.categoryCode} onChange={(e) => set("categoryCode", e.target.value)}>
                <option value="">— yo'q —</option>{localCats.map((c) => <option key={c.bitoId} value={c.bitoId}>{c.name}</option>)}
              </select>
              <button className="btn btn-ghost" title="Yangi kategoriya" onClick={() => setAddingCat(true)}><Plus size={16} /></button>
            </div>
          )}
        </div>
        <div><label className="label">Mahsulot haqida</label><textarea className="input" rows={2} value={f.note} onChange={(e) => set("note", e.target.value)} /></div>

        <div>
          <label className="label">Rasm *</label>
          <div className="flex flex-wrap items-center gap-2">
            {f.images.map((img, i) => (
              <div key={img + i} className="relative w-16 h-16 group">
                <img src={img} className={`w-16 h-16 rounded-lg object-cover bg-slate-100 ${i === 0 ? "ring-2 ring-[var(--primary)]" : ""}`} />
                {i === 0 && <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 text-[9px] bg-[var(--primary)] text-white px-1 rounded">Asosiy</span>}
                <button className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-500 text-white flex items-center justify-center" onClick={() => removeImage(i)}><X size={11} /></button>
                {i !== 0 && <button className="absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[9px] bg-black/60 text-white px-1 rounded opacity-0 group-hover:opacity-100" onClick={() => makePrimary(i)}>Asosiy</button>}
              </div>
            ))}
            <label className="w-16 h-16 rounded-lg border-2 border-dashed border-slate-300 flex items-center justify-center cursor-pointer text-slate-400 hover:border-[var(--primary)]">
              {uploading ? "…" : <Plus size={20} />}
              <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { const fs = e.target.files; if (fs?.length) void pickImages(fs); }} />
            </label>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <label className="label mb-0 flex items-center gap-1">Qo'shimcha maydon
              <span className="text-slate-400 cursor-help" title="Qo'shilgan maydon do'konning barcha mahsulotlariga qo'shiladi. Har mahsulotda o'z qiymatini kiritasiz; bo'sh qoldirilsa Mini App'da ko'rinmaydi."><Info size={13} /></span>
            </label>
            <button className="btn btn-ghost !py-1 !px-2 text-xs" onClick={addField}><Plus size={14} /> Qo'shish</button>
          </div>
          <datalist id="cf-names">{defs.map((d) => <option key={d.id} value={d.name} />)}</datalist>
          {cfs.map((cf, i) => {
            const opts = defByName(cf.name)?.options || [];
            return (
              <div key={cf.id} className="flex gap-2 mt-2 items-center">
                <input className="input flex-1" placeholder="Nomi (masalan: Brend)" value={cf.name} list="cf-names" onChange={(e) => setField(i, "name", e.target.value)} />
                <input className="input flex-1" placeholder="Qiymati (masalan: Nike)" value={cf.value} list={`cf-opts-${i}`} onChange={(e) => setField(i, "value", e.target.value)} />
                <datalist id={`cf-opts-${i}`}>{opts.map((o) => <option key={o} value={o} />)}</datalist>
                <button className="w-9 rounded-lg flex items-center justify-center text-rose-500 hover:bg-rose-50 shrink-0" title="Butun do'kondan o'chirish" onClick={() => { void removeField(i); }}><Trash2 size={15} /></button>
              </div>
            );
          })}
          {!cfs.length && <div className="help mt-1">Masalan: Brend, Material, Kafolat… Bir marta qo'shilsa — barcha mahsulotlarda chiqadi.</div>}
        </div>

        <div className="rounded-xl bg-slate-50 p-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <Toggle value={f.trackStock} onChange={(v) => set("trackStock", v)} /> Qoldiq
            <span className="text-slate-400 cursor-help" title="Yoqilsa: buyurtmalarda qoldiq ayriladi, tugasa Mini App'da «sotuvda yo'q» bo'ladi. O'chiq bo'lsa — cheksiz."><Info size={13} /></span>
          </label>
          {f.trackStock && (
            <div className="mt-2"><input type="number" className="input max-w-[160px]" placeholder="Qoldiq miqdori" value={f.stock} onChange={(e) => set("stock", e.target.value)} /></div>
          )}
        </div>

        <div className="rounded-xl bg-slate-50 p-3">
          <label className="flex items-center gap-2 text-sm font-medium"><Toggle value={hasVariants} onChange={setHasVariants} /> Variant mahsulot</label>
          {hasVariants && (
            <div className="mt-3 space-y-3">
              {vdefs.length > 0 && (
                <div className="rounded-lg bg-white border border-slate-200 p-2.5">
                  <div className="text-xs font-semibold text-slate-500 mb-1.5">Eslab qolingan variant turlari (tezkor qo'shish):</div>
                  <div className="flex flex-wrap gap-1.5">
                    {vdefs.map((vd) => {
                      const used = dims.some((x) => x.name.trim().toLowerCase() === vd.name.trim().toLowerCase());
                      return (
                        <span key={vd.id} className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg ${used ? "bg-slate-100 text-slate-400" : "bg-blue-50 text-blue-700"}`}>
                          <button disabled={used} onClick={() => addRememberedDim(vd)}>{vd.name}</button>
                          <button className="text-slate-300 hover:text-rose-500" title="Xotiradan o'chirish" onClick={() => forgetDim(vd.id)}><X size={11} /></button>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
              {dims.map((d, i) => {
                const remembered = defValuesFor(d.name).filter((v) => !d.values.includes(v));
                const rdef = vdefs.find((v) => v.name.trim().toLowerCase() === d.name.trim().toLowerCase());
                return (
                <div key={i} className="rounded-lg border border-slate-200 bg-white p-2.5">
                  <div className="flex gap-2 items-center">
                    <input className="input flex-1" placeholder="Variant nomi (masalan: Rangi, O'lchami)" value={d.name} list="vdef-names" onChange={(e) => setDimName(i, e.target.value)} />
                    <button className="w-8 h-8 rounded-lg text-rose-500 hover:bg-rose-50 flex items-center justify-center shrink-0" onClick={() => removeDim(i)}><Trash2 size={15} /></button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2 items-center">
                    {d.values.map((v, vi) => (
                      <span key={vi} className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded-lg">{v}<button className="text-slate-400 hover:text-rose-500" onClick={() => removeDimValue(i, vi)}><X size={12} /></button></span>
                    ))}
                    <input className="input !w-32 !py-1 text-sm" placeholder="+ qiymat, Enter" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const el = e.target as HTMLInputElement; addDimValue(i, el.value); el.value = ""; } }} />
                  </div>
                  {remembered.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5 items-center">
                      <span className="text-[11px] text-slate-400">Eslab qolingan:</span>
                      {remembered.map((v) => (
                        <span key={v} className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-lg">
                          <button onClick={() => addDimValue(i, v)}>+ {v}</button>
                          {rdef && <button className="text-blue-300 hover:text-rose-500" title="Xotiradan o'chirish" onClick={() => forgetValue(rdef.id, v)}><X size={10} /></button>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                );
              })}
              <datalist id="vdef-names">{vdefs.map((vd) => <option key={vd.id} value={vd.name} />)}</datalist>
              <button className="btn btn-ghost !py-1.5 text-sm" onClick={addDim}><Plus size={14} /> Variant qo'shish</button>
              <label className="flex items-center gap-2 text-sm font-medium"><Toggle value={diffPrice} onChange={setDiffPrice} /> Har xil narx</label>
              {combos.length > 0 && (
                <div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
                  {combos.map((c) => (
                    <div key={c.label} className="flex items-center gap-2 p-2 text-sm">
                      <span className="flex-1 font-medium">{c.label}</span>
                      {diffPrice && <input type="number" className="input !w-28 !py-1" placeholder="narx" value={vData[c.label]?.price ?? ""} onChange={(e) => setVField(c.label, "price", e.target.value)} />}
                      {f.trackStock && <input type="number" className="input !w-20 !py-1" placeholder="qoldiq" value={vData[c.label]?.stock ?? ""} onChange={(e) => setVField(c.label, "stock", e.target.value)} />}
                    </div>
                  ))}
                </div>
              )}
              <div className="help">Har kombinatsiya alohida variant bo'ladi. Mini App'da mijoz mahsulot ichida variantni tanlab savatga qo'shadi.</div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1"><button className="btn btn-ghost" onClick={onClose}>Bekor</button><button className="btn btn-primary" disabled={saving} onClick={() => { void save(); }}>{saving ? "Saqlanmoqda…" : "Saqlash"}</button></div>
      </div>
    </Modal>
  );
}

/** Kategoriya qo'shish/tahrirlash */
function CategoryEditor({ initial, cats, onClose, onSaved }: { initial: Partial<C>; cats: C[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast((s) => s.show);
  const [f, setF] = useState({ name: initial.name || "", parentCode: initial.parentId || "", image: initial.image || "" });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const set = (k: keyof typeof f, v: unknown) => setF((d) => ({ ...d, [k]: v }));
  const pickImage = async (file: File) => {
    setUploading(true);
    try { const path = await api.upload(file); set("image", path); } catch (e) { toast((e as Error).message, "err"); } finally { setUploading(false); }
  };
  const save = async () => {
    if (!f.name.trim()) { toast("Nomi kiritilmagan", "err"); return; }
    setSaving(true);
    const body = { name: f.name.trim(), parentCode: f.parentCode || null, image: f.image || null };
    try {
      if (initial.id) await api.put(`/catalog/categories/${initial.id}/full`, body);
      else await api.post("/catalog/categories/create", body);
      toast("Saqlandi ✅");
      onSaved();
    } catch (e) { toast((e as Error).message, "err"); } finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title={initial.id ? "Kategoriyani tahrirlash" : "Yangi kategoriya"}>
      <div className="space-y-3">
        <div><label className="label">Nomi *</label><input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus /></div>
        <div><label className="label">Ota kategoriya</label>
          <select className="input" value={f.parentCode} onChange={(e) => set("parentCode", e.target.value)}>
            <option value="">— yo'q (asosiy) —</option>{cats.filter((c) => c.id !== initial.id).map((c) => <option key={c.bitoId} value={c.bitoId}>{c.name}</option>)}
          </select></div>
        <div>
          <label className="label">Rasm</label>
          <div className="flex items-center gap-3">
            {f.image ? <img src={f.image} className="w-16 h-16 rounded-lg object-cover bg-slate-100" /> : <div className="w-16 h-16 rounded-lg bg-slate-100 flex items-center justify-center"><ImageIcon size={20} className="text-slate-300" /></div>}
            <label className="btn btn-ghost cursor-pointer">{uploading ? "Yuklanmoqda…" : "Rasm tanlash"}<input type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void pickImage(file); }} /></label>
            {f.image && <button className="btn btn-ghost text-rose-600" onClick={() => set("image", "")}>Olib tashlash</button>}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1"><button className="btn btn-ghost" onClick={onClose}>Bekor</button><button className="btn btn-primary" disabled={saving} onClick={() => { void save(); }}>{saving ? "Saqlanmoqda…" : "Saqlash"}</button></div>
      </div>
    </Modal>
  );
}
