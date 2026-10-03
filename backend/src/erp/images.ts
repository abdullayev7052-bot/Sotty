/**
 * Rasm manzilini qaytaradi. Ichki ERP'da rasmlar admin panel orqali yuklanadi
 * va `/uploads/...` ko'rinishida saqlanadi — shuning uchun qiymat o'zgarishsiz qaytariladi.
 */
export function fileUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const s = String(path).trim();
  return s || null;
}
