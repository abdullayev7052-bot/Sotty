import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Bot, Users, Send, Pencil } from "lucide-react";
import { api } from "../lib/api.ts";
import { PageTitle, Spinner, useToast } from "../components/ui.tsx";

export interface Status {
  bot: { username: string; name: string } | null; publicUrl: string; port: number; appUrl: string | null;
  shop: { name: { uz?: string; ru?: string; en?: string } };
  sync: { running: boolean; last: { at: string; ok: boolean; message: string } | null };
  webhook: { destination: string; secret: string; at: string; error?: string } | null;
  counts: { users: number; registered: number; products: number; orders: number; ordersToday: number; waitlist: number; groups: number };
}
export function useStatus() {
  return useQuery({ queryKey: ["status"], queryFn: () => api.get<Status>("/status"), refetchInterval: 15000 });
}

/* ============ Telegram → Bot ============ */
function BotStatusCard() {
  const st = useStatus();
  if (!st.data) return <Spinner />;
  const d = st.data;
  return (
    <div className="card p-5 space-y-3 mb-4">
      <div className="font-semibold flex items-center gap-2"><Bot size={18} /> Telegram bot</div>
      {d.bot ? <div className="text-sm">@{d.bot.username} — <span className="text-emerald-600 font-medium">ishlayapti</span></div> : <div className="text-sm text-red-600">Bot ulanmagan — pastda tokenni kiriting</div>}
      <div className="text-sm flex items-center gap-2"><Users size={16} /> Ruxsat etilgan guruhlar: <b>{d.counts.groups}</b> <Link className="text-blue-600 ml-1" to="/groups">sozlash →</Link></div>
    </div>
  );
}
/** Bot tokenini ko'rish (yashirin) va almashtirish */
function BotTokenCard() {
  const toast = useToast((s) => s.show);
  const acc = useQuery({ queryKey: ["admin-account"], queryFn: () => api.get<{ botTokenMasked: string; botUsername: string; hasBot: boolean }>("/account") });
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { const r = await api.post<{ botUsername: string }>("/account/bot-token", { token: token.trim() }); toast(`Bot ulandi: @${r.botUsername} ✅`); setEditing(false); setToken(""); void acc.refetch(); }
    catch (e) { toast((e as Error).message, "err"); } finally { setBusy(false); }
  };
  if (!acc.data) return <Spinner />;
  return (
    <div className="card p-5 space-y-3">
      <div className="font-semibold">Bot tokeni</div>
      {!editing ? (
        <div className="flex items-center gap-3 flex-wrap">
          <code className="text-sm bg-slate-100 rounded-lg px-3 py-2 font-mono">{acc.data.botTokenMasked || "— ulanmagan —"}</code>
          <button className="btn btn-ghost" onClick={() => setEditing(true)}><Pencil size={15} /> Tahrirlash</button>
        </div>
      ) : (
        <div className="space-y-2">
          <input className="input max-w-lg font-mono" placeholder="123456:AA... (BotFather'dan)" value={token} onChange={(e) => setToken(e.target.value)} autoFocus />
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={busy || !token.trim()} onClick={() => { void save(); }}>{busy ? "Tekshirilmoqda…" : "Saqlash"}</button>
            <button className="btn btn-ghost" onClick={() => { setEditing(false); setToken(""); }}>Bekor</button>
          </div>
          <div className="help">BotFather'dan olingan yangi tokenni kiriting. Saqlangach bot darhol yangi tokenda ishga tushadi.</div>
        </div>
      )}
    </div>
  );
}
export function BotPage() {
  return (
    <div className="max-w-4xl">
      <PageTitle title="Bot" description="Telegram bot holati va tokeni" />
      <BotStatusCard />
      <BotTokenCard />
    </div>
  );
}

/* ============ Telegram → Kanal (hozircha bo'sh) ============ */
export function ChannelPage() {
  return (
    <div className="card p-6 text-center text-slate-500">
      <div className="mb-2 flex justify-center text-[var(--primary)]"><Send size={40} /></div>
      <div className="text-lg font-semibold text-slate-700">Kanal</div>
      <div className="text-sm mt-1">Bu bo'lim hozircha tayyorlanmoqda — tez orada qo'shiladi.</div>
    </div>
  );
}
