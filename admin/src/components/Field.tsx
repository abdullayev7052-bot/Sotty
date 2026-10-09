import { useState } from "react";
import { Pencil } from "lucide-react";
import type { FieldDef, Lang, LText, Options } from "../lib/api.ts";
import { ImageUpload, Toggle } from "./ui.tsx";
import { LatLngPicker } from "./LatLngPicker.tsx";
import { StoresEditor, PriceExceptionsEditor, type StoreDef, type PriceException } from "./StoresEditor.tsx";
import { ProductFieldsEditor, type PField } from "./ProductFieldsEditor.tsx";
import { HomeLayoutEditor, type LayoutRow } from "./HomeLayoutEditor.tsx";
import { FilterFieldsEditor, type FilterRow } from "./FilterFieldsEditor.tsx";
import { ThemePresets } from "./ThemePresets.tsx";

const LANGS: { k: Lang; label: string }[] = [{ k: "uz", label: "🇺🇿 UZ" }, { k: "ru", label: "🇷🇺 RU" }, { k: "en", label: "🇬🇧 EN" }];

export function Field({ def, value, onChange, options, onPatch }: { def: FieldDef; value: unknown; onChange: (v: unknown) => void; options?: Options | null; onPatch?: (values: Record<string, unknown>) => void }) {
  const [open, setOpen] = useState(false);
  const ph = def.placeholders?.length ? <div className="help">O'zgaruvchilar: {def.placeholders.map((p) => <code key={p} className="bg-slate-100 px-1 rounded mr-1">{p}</code>)}</div> : null;
  const help = def.help ? <div className="help">{def.help}</div> : null;

  switch (def.type) {
    case "boolean":
      return <div className="flex items-center justify-between py-1"><span className="text-sm font-medium">{def.label}</span><Toggle value={!!value} onChange={onChange} /></div>;
    case "number":
      return <div><label className="label">{def.label}</label><input type="number" className="input max-w-xs" value={value === undefined || value === null ? "" : String(value)} min={def.min} max={def.max} step={def.step || 1} onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))} />{help}</div>;
    case "color":
      return (
        <div><label className="label">{def.label}</label>
          <div className="flex items-center gap-2"><input type="color" className="w-10 h-10 rounded-lg border border-slate-200 p-0.5 cursor-pointer" value={String(value || "#000000")} onChange={(e) => onChange(e.target.value)} /><input className="input max-w-[140px] font-mono" value={String(value || "")} onChange={(e) => onChange(e.target.value)} /></div>{help}
        </div>
      );
    case "select": {
      const opts = def.source ? options?.[def.source] || [] : def.options || [];
      const missing = def.source && !options?.[def.source];
      return (
        <div><label className="label">{def.label}</label>
          <select className="input max-w-md" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
            <option value="">— tanlanmagan —</option>
            {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            {!!value && !opts.some((o) => o.value === value) && <option value={String(value)}>{String(value)} (joriy)</option>}
          </select>
          {missing && <div className="help text-amber-600">Ro'yxat yuklanmadi.</div>}{help}
        </div>
      );
    }
    case "themePresets":
      return (
        <div>
          <ThemePresets onApply={(vals) => (onPatch ? onPatch(vals) : onChange(vals))} />
          {help}
        </div>
      );

    case "filterFields":
      return (
        <div>
          <label className="label">{def.label}</label>
          <FilterFieldsEditor value={(value as FilterRow[]) || []} onChange={onChange} options={options} />
          {help}
        </div>
      );

    case "homeLayout":
      return (
        <div>
          <label className="label">{def.label}</label>
          <HomeLayoutEditor value={(value as LayoutRow[]) || []} onChange={onChange} />
          {help}
        </div>
      );

    case "productFields":
      return (
        <div>
          <label className="label">{def.label}</label>
          <ProductFieldsEditor value={(value as PField[]) || []} onChange={onChange} options={options} />
          {help}
        </div>
      );

    case "stores":
      return <div><label className="label">{def.label}</label><StoresEditor value={(value as StoreDef[]) || []} onChange={onChange} options={options} />{help}</div>;
    case "priceExceptions":
      return <div><label className="label">{def.label}</label><PriceExceptionsEditor value={(value as PriceException[]) || []} onChange={onChange} options={options} />{help}</div>;
    case "latlng":
      return <div><label className="label">{def.label}</label><LatLngPicker value={(value as { lat: number; lng: number }) || { lat: 41.311, lng: 69.279 }} onChange={onChange} />{help}</div>;
    case "image":
      return <div><label className="label">{def.label}</label><ImageUpload value={String(value || "")} onChange={onChange} hint={def.help} /></div>;
    case "password":
      return <div><label className="label">{def.label}</label><input type="password" className="input max-w-md" value={String(value || "")} onChange={(e) => onChange(e.target.value)} autoComplete="new-password" />{help}</div>;
    case "tags":
      return <div><label className="label">{def.label}</label><input className="input max-w-md" value={Array.isArray(value) ? (value as string[]).join(", ") : String(value || "")} onChange={(e) => onChange(e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} />{help}</div>;
    case "textarea":
      return <div><label className="label">{def.label}</label><textarea className="input" rows={3} value={String(value || "")} onChange={(e) => onChange(e.target.value)} />{help}{ph}</div>;
    case "ltext":
    case "ltextarea": {
      const v = (value && typeof value === "object" ? value : { uz: "", ru: "", en: "" }) as LText;
      const set = (l: Lang, s: string) => onChange({ ...v, [l]: s });
      const preview = v.uz || v.ru || v.en || "";
      return (
        <div>
          {/* Yopiq holatda — nomi + joriy matn + qalamcha; bosilganda 3 tilda ochiladi */}
          <div className="flex items-center gap-2">
            <label className="label !mb-0 shrink-0">{def.label}</label>
            {!open && <span className="text-sm text-slate-500 truncate flex-1 min-w-0 text-right">{preview || "—"}</span>}
            <button type="button" onClick={() => setOpen((o) => !o)} title="Tahrirlash (3 til)"
              className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${open ? "bg-blue-50 text-blue-600" : "text-slate-400 hover:bg-slate-100"}`}><Pencil size={14} /></button>
          </div>
          {open && (
            <div className="space-y-2 mt-2">
              {LANGS.map((l) => (
                <div key={l.k} className="flex items-start gap-2">
                  <span className="text-xs w-12 shrink-0 mt-2.5">{l.label}</span>
                  {def.type === "ltext"
                    ? <input className="input" value={v[l.k] || ""} onChange={(e) => set(l.k, e.target.value)} />
                    : <textarea className="input" rows={3} value={v[l.k] || ""} onChange={(e) => set(l.k, e.target.value)} />}
                </div>
              ))}
              {help}{ph}
            </div>
          )}
        </div>
      );
    }
    default:
      return <div><label className="label">{def.label}</label><input className="input" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />{help}{ph}</div>;
  }
}
