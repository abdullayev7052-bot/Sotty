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
        {groups.map((g) => (
          <div key={g.title} id={`group-${g.title}`} className="card p-5 rounded-2xl">
            <div className="font-semibold mb-1">{g.title}</div>
            {g.description && <div className="text-sm text-slate-500 mb-3">{g.description}</div>}
            <div className="space-y-4 mt-3">
              {g.fields.map((f) => <div key={f.key} id={`field-${f.key}`} className="rounded-xl -mx-2 px-2 py-1"><Field def={f} value={draft[f.key]} onChange={(v) => set(f.key, v)} options={options.data || null} onPatch={patchMany} /></div>)}
            </div>
          </div>
        ))}
        {!groups.length && <div className="text-slate-400 text-sm">Bu sahifada sozlamalar yo'q</div>}
      </div>
      {dirty && (
        <div className="sticky bottom-4 mt-4 flex justify-end">
          <button className="btn btn-primary shadow-lg" disabled={saving} onClick={() => { void save(); }}><Save size={16} /> {saving ? "Saqlanmoqda…" : "O'zgarishlarni saqlash"}</button>
        </div>
      )}
    </div>
  );
}
