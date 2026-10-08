import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Bot, Users, Send } from "lucide-react";
import { api } from "../lib/api.ts";
import { Spinner } from "../components/ui.tsx";
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
export function BotPage() {
  return <SettingsForm section="general" part="bot" title="Bot" description="Telegram bot holati va tokeni" before={<BotStatusCard />} />;
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
