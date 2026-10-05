import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Wallet, Users, BarChart3, Search, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { api } from "../lib/api.ts";
import { PageTitle, Spinner, Modal, useToast } from "../components/ui.tsx";

const money = (n: number) => (n || 0).toLocaleString("uz");
const METHODS = [["cash", "Naqd"], ["card", "Karta"], ["transfer", "O'tkazma"], ["other", "Boshqa"]] as const;
const CAT_LABEL: Record<string, string> = { sale: "Sotuv", debt_payment: "Qarz to'lovi", purchase: "Xarid", salary: "Oylik", rent: "Ijara", refund: "Qaytarish", other: "Boshqa" };

interface Tx { id: number; kind: string; amount: number; method: string; category: string; note: string | null; orderId: number | null; customer: string | null; balanceAfter: number; createdBy: string | null; createdAt: string }
interface Customer { id: number; name: string; phone: string | null; balance: number; telegramId: string }
interface Report { from: string; to: string; income: number; expense: number; net: number; byCategory: Record<string, { income: number; expense: number }>; salesCount: number; salesRevenue: number; cogs: number; grossProfit: number; cashBalance: number; customersDebt: number; customersCredit: number }

export function FinancePage() {
  const [tab, setTab] = useState<"cash" | "customers" | "report">("cash");
  const bal = useQuery({ queryKey: ["cash-summary"], queryFn: () => api.get<{ balance: number }>("/cash/summary"), staleTime: 5000 });
  return (
    <div>
      <PageTitle title="Moliya" description="Kassa (pul kirim/chiqim), mijozlar balansi va moliyaviy hisobot" />
      <div className="card p-4 mb-4 inline-block min-w-[220px]"><div className="text-xs text-slate-500">Kassa qoldig'i</div><div className={`text-2xl font-bold ${(bal.data?.balance || 0) < 0 ? "text-rose-600" : "text-emerald-600"}`}>{bal.data ? money(bal.data.balance) + " so'm" : "…"}</div></div>
      <div className="flex gap-2 mb-4 flex-wrap">
        <button className={`btn ${tab === "cash" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("cash")}><Wallet size={16} /> Kassa</button>
        <button className={`btn ${tab === "customers" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("customers")}><Users size={16} /> Mijozlar balansi</button>
        <button className={`btn ${tab === "report" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("report")}><BarChart3 size={16} /> Hisobot</button>
      </div>
      {tab === "cash" && <CashTab />}
      {tab === "customers" && <CustomersTab />}
      {tab === "report" && <ReportTab />}
    </div>
  );
}

function CashTab() {
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);
  const [kind, setKind] = useState<"income" | "expense">("income");
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState("cash");
  const [category, setCategory] = useState("other");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const txs = useQuery({ queryKey: ["cash-tx"], queryFn: () => api.get<Tx[]>("/cash/transactions?limit=200"), staleTime: 5000 });
  const save = async () => {
    if (!(amount > 0)) { toast("Summa kiriting", "err"); return; }
    setSaving(true);
    try {
      await api.post("/cash", { kind, amount: Number(amount), method, category, note: note || null });
      setAmount(0); setNote("");
      await qc.invalidateQueries({ queryKey: ["cash-tx"] }); await qc.invalidateQueries({ queryKey: ["cash-summary"] });
      toast("Saqlandi ✅");
    } catch (e) { toast((e as Error).message, "err"); } finally { setSaving(false); }
  };
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="card p-5 space-y-3 h-fit">
        <div className="flex gap-2">
          <button className={`btn flex-1 justify-center ${kind === "income" ? "btn-primary" : "btn-ghost"}`} onClick={() => { setKind("income"); setCategory("other"); }}><ArrowDownCircle size={16} /> Kirim</button>
          <button className={`btn flex-1 justify-center ${kind === "expense" ? "btn-primary" : "btn-ghost"}`} onClick={() => { setKind("expense"); setCategory("other"); }}><ArrowUpCircle size={16} /> Chiqim</button>
        </div>
        <div><label className="label">Summa</label><input type="number" className="input" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">To'lov turi</label><select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div><label className="label">Turkum</label><select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {(kind === "income" ? ["sale", "debt_payment", "other"] : ["purchase", "salary", "rent", "refund", "other"]).map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
          </select></div>
        </div>
        <div><label className="label">Izoh</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <div className="flex justify-end"><button className="btn btn-primary" disabled={saving} onClick={() => { void save(); }}>{saving ? "Saqlanmoqda…" : "Saqlash"}</button></div>
      </div>
      <div className="card">
        <div className="p-3 border-b border-slate-100 text-sm font-semibold">Oxirgi harakatlar</div>
        {txs.isLoading ? <Spinner /> : !txs.data?.length ? <div className="p-8 text-center text-slate-400">Harakatlar yo'q</div> : (
          <div className="divide-y divide-slate-100 max-h-[480px] overflow-auto">
            {txs.data.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{CAT_LABEL[t.category] || t.category}{t.customer ? ` · ${t.customer}` : ""}{t.orderId ? ` · #${t.orderId}` : ""}</div>
                  <div className="text-xs text-slate-500">{new Date(t.createdAt).toLocaleString("uz")} · {METHODS.find((m) => m[0] === t.method)?.[1]}{t.note ? ` · ${t.note}` : ""}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className={`font-semibold ${t.kind === "income" ? "text-emerald-600" : "text-rose-600"}`}>{t.kind === "income" ? "+" : "−"}{money(t.amount)}</div>
                  <div className="text-xs text-slate-500">qoldiq: {money(t.balanceAfter)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CustomersTab() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [onlyDebt, setOnlyDebt] = useState(true);
  const [pay, setPay] = useState<Customer | null>(null);
  const [adj, setAdj] = useState<Customer | null>(null);
  const list = useQuery({ queryKey: ["customers", q, onlyDebt], queryFn: () => api.get<Customer[]>(`/customers?${onlyDebt ? "onlyDebt=1&" : ""}q=${encodeURIComponent(q)}`), staleTime: 3000 });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["customers"] }); void qc.invalidateQueries({ queryKey: ["cash-summary"] }); void qc.invalidateQueries({ queryKey: ["cash-tx"] }); };
  return (
    <div className="card">
      <div className="p-3 border-b border-slate-100 flex gap-2 items-center flex-wrap">
        <div className="relative flex-1 min-w-[180px]"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="input pl-9" placeholder="Ism yoki telefon..." value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyDebt} onChange={(e) => setOnlyDebt(e.target.checked)} /> Faqat balansi borlar</label>
      </div>
      {list.isLoading ? <Spinner /> : !list.data?.length ? <div className="p-8 text-center text-slate-400">Mijoz topilmadi</div> : (
        <div className="divide-y divide-slate-100">
          {list.data.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-3 py-2">
              <div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{c.name}</div><div className="text-xs text-slate-500">{c.phone || "—"}</div></div>
              <div className={`text-sm font-semibold shrink-0 ${c.balance < 0 ? "text-rose-600" : c.balance > 0 ? "text-emerald-600" : "text-slate-400"}`}>
                {c.balance < 0 ? `qarz ${money(-c.balance)}` : c.balance > 0 ? `haqdor ${money(c.balance)}` : "0"}
              </div>
              <button className="btn btn-ghost !py-1 !px-2 text-xs" onClick={() => setPay(c)}>To'lov</button>
              <button className="btn btn-ghost !py-1 !px-2 text-xs" onClick={() => setAdj(c)}>Tuzatish</button>
            </div>
          ))}
        </div>
      )}
      {pay && <PaymentModal customer={pay} onClose={() => setPay(null)} onDone={() => { setPay(null); refresh(); }} />}
      {adj && <AdjustModal customer={adj} onClose={() => setAdj(null)} onDone={() => { setAdj(null); refresh(); }} />}
    </div>
  );
}

function PaymentModal({ customer, onClose, onDone }: { customer: Customer; onClose: () => void; onDone: () => void }) {
  const toast = useToast((s) => s.show);
  const [amount, setAmount] = useState(customer.balance < 0 ? -customer.balance : 0);
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!(amount > 0)) { toast("Summa kiriting", "err"); return; }
    setSaving(true);
    try { await api.post(`/customers/${customer.id}/payment`, { amount: Number(amount), method, note: note || null }); toast("To'lov qabul qilindi ✅"); onDone(); }
    catch (e) { toast((e as Error).message, "err"); } finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title={`To'lov — ${customer.name}`}>
      <div className="space-y-3">
        <div className="text-sm text-slate-500">Joriy balans: <b className={customer.balance < 0 ? "text-rose-600" : "text-emerald-600"}>{customer.balance < 0 ? `qarz ${money(-customer.balance)}` : money(customer.balance)}</b></div>
        <div><label className="label">Summa</label><input type="number" className="input" value={amount} onChange={(e) => setAmount(Number(e.target.value))} autoFocus /></div>
        <div><label className="label">To'lov turi</label><select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div><label className="label">Izoh</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <div className="help">To'lov kassaga kirim bo'lib yoziladi va mijoz qarzi kamayadi.</div>
        <div className="flex justify-end gap-2"><button className="btn btn-ghost" onClick={onClose}>Bekor</button><button className="btn btn-primary" disabled={saving} onClick={() => { void save(); }}>Qabul qilish</button></div>
      </div>
    </Modal>
  );
}

function AdjustModal({ customer, onClose, onDone }: { customer: Customer; onClose: () => void; onDone: () => void }) {
  const toast = useToast((s) => s.show);
  const [dir, setDir] = useState<"debt" | "credit">("debt");
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!(amount > 0)) { toast("Summa kiriting", "err"); return; }
    const delta = dir === "debt" ? -Math.abs(amount) : Math.abs(amount);
    setSaving(true);
    try { await api.post(`/customers/${customer.id}/adjust`, { delta, note: note || null }); toast("Balans yangilandi ✅"); onDone(); }
    catch (e) { toast((e as Error).message, "err"); } finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Balansni tuzatish — ${customer.name}`}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <button className={`btn flex-1 justify-center ${dir === "debt" ? "btn-primary" : "btn-ghost"}`} onClick={() => setDir("debt")}>Qarz yozish</button>
          <button className={`btn flex-1 justify-center ${dir === "credit" ? "btn-primary" : "btn-ghost"}`} onClick={() => setDir("credit")}>Haqdor qilish</button>
        </div>
        <div><label className="label">Summa</label><input type="number" className="input" value={amount} onChange={(e) => setAmount(Number(e.target.value))} autoFocus /></div>
        <div><label className="label">Izoh</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <div className="help">Bu amal naqd pulga ta'sir qilmaydi — faqat mijoz balansini o'zgartiradi.</div>
        <div className="flex justify-end gap-2"><button className="btn btn-ghost" onClick={onClose}>Bekor</button><button className="btn btn-primary" disabled={saving} onClick={() => { void save(); }}>Saqlash</button></div>
      </div>
    </Modal>
  );
}

const QUICK = [["Bugun", 0], ["7 kun", 6], ["30 kun", 29]] as const;
function ReportTab() {
  const today = new Date().toISOString().slice(0, 10);
  const ago = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(ago(6));
  const [to, setTo] = useState(today);
  const r = useQuery({ queryKey: ["finance-report", from, to], queryFn: () => api.get<Report>(`/finance/report?from=${from}&to=${to}`), staleTime: 3000 });
  const stat = (label: string, value: string, cls = "") => <div className="card p-4"><div className="text-xs text-slate-500">{label}</div><div className={`text-lg font-bold ${cls}`}>{value}</div></div>;
  return (
    <div className="space-y-4">
      <div className="card p-3 flex gap-2 items-center flex-wrap">
        <input type="date" className="input w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-slate-400">—</span>
        <input type="date" className="input w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
        <div className="flex gap-1">{QUICK.map(([l, d]) => <button key={l} className="btn btn-ghost !py-1 !px-2 text-xs" onClick={() => { setFrom(ago(d)); setTo(today); }}>{l}</button>)}</div>
      </div>
      {r.isLoading || !r.data ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {stat("Tushum", money(r.data.income) + " so'm", "text-emerald-600")}
            {stat("Xarajat", money(r.data.expense) + " so'm", "text-rose-600")}
            {stat("Sof (kassa oqimi)", money(r.data.net) + " so'm", r.data.net < 0 ? "text-rose-600" : "")}
            {stat("Kassa qoldig'i", money(r.data.cashBalance) + " so'm")}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {stat("Sotuvlar soni", String(r.data.salesCount))}
            {stat("Sotuv tushumi", money(r.data.salesRevenue) + " so'm")}
            {stat("Tan narx (COGS)", money(r.data.cogs) + " so'm")}
            {stat("Yalpi foyda", money(r.data.grossProfit) + " so'm", r.data.grossProfit < 0 ? "text-rose-600" : "text-emerald-600")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {stat("Mijozlar qarzi", money(r.data.customersDebt) + " so'm", "text-rose-600")}
            {stat("Mijozlar haqdorligi", money(r.data.customersCredit) + " so'm", "text-emerald-600")}
          </div>
          <div className="card p-4">
            <div className="font-semibold mb-2 text-sm">Turkumlar bo'yicha</div>
            {Object.keys(r.data.byCategory).length === 0 ? <div className="text-sm text-slate-400">Ma'lumot yo'q</div> : (
              <div className="divide-y divide-slate-100">
                {Object.entries(r.data.byCategory).map(([cat, v]) => (
                  <div key={cat} className="flex justify-between py-1.5 text-sm">
                    <span>{CAT_LABEL[cat] || cat}</span>
                    <span>{v.income ? <span className="text-emerald-600">+{money(v.income)}</span> : null}{v.income && v.expense ? " · " : ""}{v.expense ? <span className="text-rose-600">−{money(v.expense)}</span> : null}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
