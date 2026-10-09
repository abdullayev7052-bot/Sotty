import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { api, type Options, type SectionDef, type Settings } from "../lib/api.ts";
import { Field } from "../components/Field.tsx";
import { PageTitle, Spinner, useToast } from "../components/ui.tsx";

export function useSchema() {
  return useQuery({ queryKey: ["schema"], queryFn: () => api.get<SectionDef[]>("/schema"), staleTime: Infinity });
}
export function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/settings"), staleTime: 10000 });
}

/** Marshrut orqali: /settings/:section va /settings/:section/:part */
const PART_TITLES: Record<string, { title: string; description: string }> = {
  "checkout/cart": { title: "Savatcha", description: "Mini App savatchasi: matnlar va xatti-harakati" },
  "checkout/order": { title: "Buyurtma", description: "Yetkazib berish, olib ketish, xarita va rasmiylashtirish sozlamalari" },
};
export function SettingsPage() {
  const { section = "general", part } = useParams();
  const pt = part ? PART_TITLES[`${section}/${part}`] : undefined;
  return <SettingsForm section={section} part={part} title={pt?.title} description={pt?.description} />;
}

interface Props {
  section: string;
  /** Guruhlarning qaysi qismi ko'rsatiladi: berilsa — faqat shu part; berilmasa — part'siz guruhlar */
  part?: string;
  title?: string;
  description?: string;
  /** Forma ustida ko'rsatiladigan blok (masalan, holat kartasi) */
  before?: ReactNode;
}

export function SettingsForm({ section, part, title, description, before }: Props) {
  const schema = useSchema();
  const settings = useSettings();
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);
  const [params] = useSearchParams();
  const focus = params.get("focus");
  const def = useMemo(() => schema.data?.find((s) => s.key === section), [schema.data, section]);
  const groups = useMemo(() => (def?.groups || []).filter((g) => (part ? g.part === part : !g.part)), [def, part]);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  /** showIf: boshqa (boolean) maydon yoqilganda ko'rsatish */
  const shown = (f: { showIf?: string }) => !f.showIf || !!draft[f.showIf];
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const needsOptions = useMemo(() => !!groups.some((g) => g.fields.some((f) => f.source)), [groups]);
  const options = useQuery({ queryKey: ["erp-options"], queryFn: () => api.get<Options>("/erp/options"), enabled: needsOptions, staleTime: 60000 });

  useEffect(() => {
    if (settings.data?.[section]) { setDraft({ ...settings.data[section] }); setDirty(false); }
  }, [settings.data, section]);

  // Qidiruvdan kelganda kerakli maydonga o'tib, ajratib ko'rsatish
  useEffect(() => {
    if (!focus || settings.isLoading || schema.isLoading) return;
    const id = focus.startsWith("group:") ? `group-${focus.slice(6)}` : `field-${focus}`;
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("focus-flash");
    const t = setTimeout(() => el.classList.remove("focus-flash"), 2500);
    return () => clearTimeout(t);
  }, [focus, settings.isLoading, schema.isLoading, section, part]);

  const set = (k: string, v: unknown) => { setDraft((d) => ({ ...d, [k]: v })); setDirty(true); };
  /** Bir nechta sozlamani birdaniga to'ldirish (uslub shablonlari) */
  const patchMany = (vals: Record<string, unknown>) => { setDraft((d) => ({ ...d, ...vals })); setDirty(true); };

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put<{ ok: boolean; settings: Settings }>(`/settings/${section}`, draft);
      qc.setQueryData(["settings"], r.settings);
      setDirty(false);
      toast("Saqlandi ✅");
      if (section === "shop" || section === "general") await qc.invalidateQueries({ queryKey: ["status"] });
      if (section === "adminPanel") await qc.invalidateQueries({ queryKey: ["branding"] });
    } catch (e) { toast((e as Error).message, "err"); } finally { setSaving(false); }
  };

  if (schema.isLoading || settings.isLoading) return <Spinner />;
  if (!def) return <div className="text-slate-500">Bo'lim topilmadi</div>;

  const saveBtn = <button className="btn btn-primary" disabled={!dirty || saving} onClick={() => { void save(); }}><Save size={16} /> {saving ? "Saqlanmoqda…" : "Saqlash"}</button>;
  return (
    <div className="max-w-4xl">
      <PageTitle title={title || def.title} description={description ?? def.description} actions={saveBtn} />
      {before}
      <div className="space-y-4">
        {groups.filter(shown).map((g) => (
          <div key={g.title} id={`group-${g.title}`} className="card p-5 rounded-2xl">
            <div className="font-semibold mb-1">{g.title}</div>
            {g.description && <div className="text-sm text-slate-500 mb-3">{g.description}</div>}
            <div className="space-y-4 mt-3">
              {g.fields.filter(shown).map((f) => <div key={f.key} id={`field-${f.key}`} className="rounded-xl -mx-2 px-2 py-1"><Field def={f} value={draft[f.key]} onChange={(v) => set(f.key, v)} options={options.data || null} onPatch={patchMany} /></div>)}
            </div>
          </div>
        ))}
        {section === "general" && !part && <AdminAccountCard />}
        {!groups.length && section !== "general" && <div className="text-slate-400 text-sm">Bu sahifada sozlamalar yo'q</div>}
      </div>
      {dirty && (
        <div className="sticky bottom-4 mt-4 flex justify-end">
          <button className="btn btn-primary shadow-lg" disabled={saving} onClick={() => { void save(); }}><Save size={16} /> {saving ? "Saqlanmoqda…" : "O'zgarishlarni saqlash"}</button>
        </div>
      )}
    </div>
  );
}

/** Admin akkaunt: login telefoni va parolni (eski+yangi) o'zgartirish */
function AdminAccountCard() {
  const toast = useToast((s) => s.show);
  const acc = useQuery({ queryKey: ["admin-account"], queryFn: () => api.get<{ phone: string; phoneRaw: string }>("/account") });
  const [phone, setPhone] = useState("");
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [busyP, setBusyP] = useState(false);
  const [busyPw, setBusyPw] = useState(false);
  useEffect(() => { if (acc.data) setPhone(acc.data.phoneRaw || ""); }, [acc.data]);

  const savePhone = async () => {
    setBusyP(true);
    try { const r = await api.post<{ phone: string }>("/account/phone", { phone }); toast("Telefon o'zgartirildi ✅"); void acc.refetch(); setPhone(r.phone ? phone : phone); }
    catch (e) { toast((e as Error).message, "err"); } finally { setBusyP(false); }
  };
  const savePassword = async () => {
    if (newPw.length < 6) { toast("Yangi parol kamida 6 ta belgidan iborat bo'lishi kerak", "err"); return; }
    if (newPw !== newPw2) { toast("Yangi parollar mos kelmadi", "err"); return; }
    setBusyPw(true);
    try { await api.post("/account/password", { oldPassword: oldPw, newPassword: newPw }); toast("Parol o'zgartirildi ✅"); setOldPw(""); setNewPw(""); setNewPw2(""); }
    catch (e) { toast((e as Error).message, "err"); } finally { setBusyPw(false); }
  };

  return (
    <div className="card p-5 rounded-2xl space-y-5">
      <div className="font-semibold">Admin panel</div>
      <div>
        <label className="label">Admin telefon raqami (kirish uchun)</label>
        <div className="flex gap-2 max-w-md">
          <input className="input" placeholder="+998 90 123 45 67" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <button className="btn btn-primary shrink-0" disabled={busyP} onClick={() => { void savePhone(); }}>{busyP ? "…" : "Saqlash"}</button>
        </div>
        <div className="help">Shu raqam orqali admin panelga kirasiz. Parolni unutganda ham shu raqam tekshiriladi.</div>
      </div>
      <div className="border-t border-slate-100 pt-4">
        <label className="label">Parolni o'zgartirish</label>
        <div className="grid sm:grid-cols-3 gap-2 max-w-2xl">
          <input type="password" className="input" placeholder="Joriy parol" value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoComplete="current-password" />
          <input type="password" className="input" placeholder="Yangi parol" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
          <input type="password" className="input" placeholder="Yangi parolni takrorlang" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} autoComplete="new-password" />
        </div>
        <button className="btn btn-primary mt-2" disabled={busyPw || !oldPw || !newPw} onClick={() => { void savePassword(); }}>{busyPw ? "Saqlanmoqda…" : "Parolni o'zgartirish"}</button>
      </div>
    </div>
  );
}
