import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Bot, Globe, Plug, RefreshCw, Link2, Copy, Users } from "lucide-react";
import { api } from "../lib/api.ts";
import { Spinner, useToast } from "../components/ui.tsx";
import { SettingsForm } from "./Settings.tsx";

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

/* ============ 3.2 Bot ============ */
function BotStatusCard() {
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);
  const st = useStatus();
  const [url, setUrl] = useState("");
  if (!st.data) return <Spinner />;
  const d = st.data;
  const copy = (t: string) => { navigator.clipboard.writeText(t).then(() => toast("Nusxalandi")); };
  const setPublic = async () => {
    try { await api.post("/public-url", { url }); toast("Saqlandi"); await qc.invalidateQueries({ queryKey: ["status"] }); } catch (e) { toast((e as Error).message, "err"); }
  };
  return (
    <div className="card p-5 space-y-3 mb-4">
      <div className="font-semibold flex items-center gap-2"><Bot size={18} /> Telegram bot</div>
      {d.bot ? <div className="text-sm">@{d.bot.username} — <span className="text-emerald-600 font-medium">ishlayapti</span></div> : <div className="text-sm text-red-600">Bot ulanmagan — pastda tokenni kiriting (yoki .env → BOT_TOKEN)</div>}
      <div className="text-sm flex items-center gap-2"><Users size={16} /> Ruxsat etilgan guruhlar: <b>{d.counts.groups}</b> <Link className="text-blue-600 ml-1" to="/groups">sozlash →</Link></div>
      <div className="font-semibold flex items-center gap-2 pt-2"><Globe size={18} /> Ommaviy manzil (ngrok)</div>
      {d.publicUrl ? (
        <div className="text-sm space-y-1">
          <div className="flex items-center gap-2 flex-wrap"><code className="bg-slate-100 px-2 py-0.5 rounded break-all">{d.publicUrl}</code><button className="text-slate-400 hover:text-slate-700" onClick={() => copy(d.publicUrl)}><Copy size={14} /></button></div>
          <div className="flex items-center gap-2 flex-wrap">Mini App: <code className="bg-slate-100 px-2 py-0.5 rounded break-all">{d.appUrl}</code> <button className="text-slate-400 hover:text-slate-700" onClick={() => copy(d.appUrl || "")}><Copy size={14} /></button></div>
          <div className="text-emerald-600">✅ Botdagi "Buyurtma berish" tugmasi shu manzilga ulangan</div>
        </div>
      ) : (
        <div className="text-sm text-amber-700 bg-amber-50 rounded-lg p-3">ngrok topilmadi. Terminalda <code>ngrok http {d.port}</code> ni ishga tushiring — manzil avtomatik aniqlanadi. Yoki qo'lda kiriting:</div>
      )}
      <div className="flex gap-2"><input className="input" placeholder="https://xxxx.ngrok-free.app" value={url} onChange={(e) => setUrl(e.target.value)} /><button className="btn btn-ghost" onClick={() => { void setPublic(); }}>Saqlash</button></div>
    </div>
  );
}
export function BotPage() {
  return <SettingsForm section="general" part="bot" title="Bot" description="Telegram bot holati, ommaviy manzil va bot tokeni" before={<BotStatusCard />} />;
}
