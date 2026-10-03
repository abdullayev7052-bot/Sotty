/**
 * "Bu haftada X ta sotildi" ko'rsatkichi — ichki buyurtmalardan (bekor qilinganlar hisobga olinmaydi).
 */
import { prisma } from "../db.ts";
import { getSettings } from "../settings/store.ts";
import { errMsg, log } from "../logger.ts";

/** productCode (bitoId) → oxirgi N kunda sotilgan miqdor */
let cache: { at: number; days: number; map: Map<string, number> } | null = null;
let inflight: Promise<Map<string, number>> | null = null;

export function salesCacheAge(): number | null {
  return cache ? Date.now() - cache.at : null;
}

/** Ichki buyurtmalardan: davr ichida sotilgan miqdor (mahsulot kodi bo'yicha) */
async function fetchFromApp(days: number): Promise<Map<string, number>> {
  const since = new Date(Date.now() - days * 86400000);
  const orders = await prisma.order.findMany({
    where: { createdAt: { gte: since }, stateKey: { not: "canceled" } },
    select: { items: true },
    take: 20000,
  });
  const map = new Map<string, number>();
  for (const o of orders) {
    const items = Array.isArray(o.items) ? (o.items as { bitoId?: string; qty?: number }[]) : [];
    for (const it of items) {
      if (!it.bitoId) continue;
      map.set(it.bitoId, (map.get(it.bitoId) || 0) + Number(it.qty || 0));
    }
  }
  return map;
}

export async function weeklySales(): Promise<Map<string, number>> {
  const c = getSettings().catalog;
  if (!c.weeklySalesEnabled) return new Map();
  const days = Math.max(1, Math.min(90, Number(c.weeklySalesDays || 7)));
  const ttl = Math.max(1, Number(c.weeklySalesRefreshMin || 30)) * 60000;
  if (cache && cache.days === days && Date.now() - cache.at < ttl) return cache.map;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const map = await fetchFromApp(days);
      cache = { at: Date.now(), days, map };
      return map;
    } catch (e) {
      log.warn("Haftalik sotuv o'qilmadi:", errMsg(e));
      cache = { at: Date.now(), days, map: new Map() };
      return cache.map;
    } finally { inflight = null; }
  })();
  return inflight;
}

export function invalidateWeeklySales() { cache = null; }

/** Bir nechta mahsulot uchun: productId → sotilgan miqdor (variantlar otasiga yig'iladi) */
export async function weeklySalesFor(products: { id: number; bitoId: string }[], childrenByParent?: Map<string, { bitoId: string }[]>): Promise<Map<number, number>> {
  const map = await weeklySales();
  const out = new Map<number, number>();
  if (!map.size) return out;
  for (const p of products) {
    let q = map.get(p.bitoId) || 0;
    for (const kid of childrenByParent?.get(p.bitoId) || []) q += map.get(kid.bitoId) || 0;
    if (q > 0) out.set(p.id, q);
  }
  return out;
}

/** "X ta insonning savatida" — oxirgi N soat ichida yangilangan savatchalar bo'yicha */
export async function inCartCounts(productIds: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const c = getSettings().catalog;
  if (!c.inCartCountEnabled || !productIds.length) return out;
  const hours = Math.max(1, Math.min(168, Number(c.inCartCountHours || 24)));
  const since = new Date(Date.now() - hours * 3600000);
  const rows = await prisma.cartItem.groupBy({
    by: ["productId"],
    where: { productId: { in: productIds }, updatedAt: { gte: since }, qty: { gt: 0 } },
    _count: { userId: true },
  });
  for (const r of rows) out.set(r.productId, r._count.userId);
  return out;
}
