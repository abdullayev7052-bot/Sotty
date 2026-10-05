/**
 * Aksiya/chegirma qoidalari (savat darajasida). Eng ko'p chegirma beradigan
 * mos aksiya tanlanadi. Promo-kodli aksiyalar faqat kod kiritilganda qo'llanadi.
 */
import { prisma } from "../db.ts";
import type { Promotion } from "@prisma/client";

export interface QuoteResult {
  subtotal: number;
  discount: number;
  total: number;
  promo: { id: number; name: string } | null;
  /** Yetishmayotgan eng yaqin avtomatik aksiya (rag'batlantirish uchun) */
  nextPromo: { name: string; remaining: number } | null;
}

const round = (n: number) => Math.round(n);

export async function activePromotions(): Promise<Promotion[]> {
  const now = new Date();
  const list = await prisma.promotion.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  return list.filter((p) => (!p.startsAt || p.startsAt <= now) && (!p.endsAt || p.endsAt >= now));
}

function discountOf(p: Promotion, subtotal: number): number {
  if (subtotal <= 0) return 0;
  const d = p.type === "fixed" ? Math.min(p.value, subtotal) : (subtotal * p.value) / 100;
  return Math.max(0, Math.min(round(d), subtotal));
}

/** Savat summasi bo'yicha chegirma hisobi */
export async function quote(subtotal: number, opts?: { code?: string | null }): Promise<QuoteResult> {
  const promos = await activePromotions();
  const code = (opts?.code || "").trim().toLowerCase();
  let best: Promotion | null = null;
  let bestDisc = 0;
  for (const p of promos) {
    if (subtotal < p.minTotal) continue;
    if (p.promoCode && p.promoCode.trim().toLowerCase() !== code) continue;
    const d = discountOf(p, subtotal);
    if (d > bestDisc) { bestDisc = d; best = p; }
  }
  // Keyingi aksiya: promo-kodsiz, summasi yetmagan eng yaqini
  const unmet = promos
    .filter((p) => !p.promoCode && subtotal < p.minTotal)
    .sort((a, b) => a.minTotal - b.minTotal)[0];
  const nextPromo = unmet ? { name: unmet.name, remaining: round(unmet.minTotal - subtotal) } : null;
  return { subtotal, discount: bestDisc, total: subtotal - bestDisc, promo: best ? { id: best.id, name: best.name } : null, nextPromo };
}
