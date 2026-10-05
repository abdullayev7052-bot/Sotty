import { useState } from "react";

/** Xalqaro telefon kiritish: davlat kodi tanlash + raqamni guruhlab ko'rsatish.
 *  value — to'liq raqam ("+998901234567"); onChange ham shu ko'rinishda qaytaradi. */
const COUNTRIES = [
  { code: "998", flag: "🇺🇿", name: "O'zbekiston" },
  { code: "7", flag: "🇷🇺", name: "Rossiya / Qozogʻiston" },
  { code: "996", flag: "🇰🇬", name: "Qirgʻiziston" },
  { code: "992", flag: "🇹🇯", name: "Tojikiston" },
  { code: "993", flag: "🇹🇲", name: "Turkmaniston" },
  { code: "90", flag: "🇹🇷", name: "Turkiya" },
  { code: "971", flag: "🇦🇪", name: "BAA" },
  { code: "966", flag: "🇸🇦", name: "Saudiya Arabistoni" },
  { code: "44", flag: "🇬🇧", name: "Buyuk Britaniya" },
  { code: "1", flag: "🇺🇸", name: "AQSH / Kanada" },
];

function groupDigits(cc: string, digits: string): string {
  if (cc === "998") {
    const m = digits.slice(0, 9).match(/^(\d{0,2})(\d{0,3})(\d{0,2})(\d{0,2})$/);
    if (m) return [m[1], m[2], m[3], m[4]].filter(Boolean).join(" ");
  }
  return digits.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
}

function parse(full: string): { cc: string; num: string } {
  const d = (full || "").replace(/[^\d]/g, "");
  const c = [...COUNTRIES].sort((a, b) => b.code.length - a.code.length).find((x) => d.startsWith(x.code));
  if (c) return { cc: c.code, num: d.slice(c.code.length) };
  return { cc: "998", num: d };
}

export function PhoneInput({ value, onChange, autoFocus }: { value: string; onChange: (full: string) => void; autoFocus?: boolean }) {
  const init = parse(value);
  const [cc, setCc] = useState(init.cc);
  const [num, setNum] = useState(init.num);
  const emit = (c: string, n: string) => onChange(n ? "+" + c + n : "");
  const maxLen = cc === "998" ? 9 : 14;
  return (
    <div className="flex gap-2">
      <select className="input !w-auto" value={cc} onChange={(e) => { setCc(e.target.value); emit(e.target.value, num); }} aria-label="Davlat kodi">
        {COUNTRIES.map((c) => <option key={c.code} value={c.code} title={c.name}>{c.flag} +{c.code}</option>)}
      </select>
      <input
        className="input flex-1"
        inputMode="numeric"
        autoFocus={autoFocus}
        value={groupDigits(cc, num)}
        onChange={(e) => { const n = e.target.value.replace(/[^\d]/g, "").slice(0, maxLen); setNum(n); emit(cc, n); }}
        placeholder={cc === "998" ? "90 123 45 67" : "raqam"}
      />
    </div>
  );
}
