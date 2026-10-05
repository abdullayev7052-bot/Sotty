/**
 * Tarif rejalari bo'yicha limitlar va to'lov muddati nazorati (SaaS).
 */
import type { Shop } from "@prisma/client";
import { prisma, currentShopId, DEFAULT_SHOP_ID } from "../db.ts";
import { stopShopBot } from "../bot/manager.ts";
import { activity, errMsg, log } from "../logger.ts";

export interface Limits { products: number; categories: number; banners: number; promotions: number; staff: number; stories: number }

export const TARIFF_LIMITS: Record<string, Limits> = {
  free:  { products: 30,     categories: 15,    banners: 2,  promotions: 2,   staff: 2,   stories: 3 },
  basic: { products: 500,    categories: 100,   banners: 8,  promotions: 15,  staff: 10,  stories: 15 },
  pro:   { products: 100000, categories: 10000, banners: 50, promotions: 200, staff: 100, stories: 50 },
};
export const TARIFF_NAMES: Record<string, string> = { free: "Bepul", basic: "Basic", pro: "Pro" };

export type LimitKey = keyof Limits;

const tariffCache = new Map<number, { at: number; tariff: string }>();

async function shopTariff(shopId: number): Promise<string> {
  const c = tariffCache.get(shopId);
  if (c && Date.now() - c.at < 60000) return c.tariff;
  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { tariff: true } }).catch(() => null);
  const tariff = shop?.tariff && TARIFF_LIMITS[shop.tariff] ? shop.tariff : "free";
  tariffCache.set(shopId, { at: Date.now(), tariff });
  return tariff;
}
export function clearTariffCache(shopId?: number) { if (shopId) tariffCache.delete(shopId); else tariffCache.clear(); }

export function limitsFor(tariff: string): Limits { return TARIFF_LIMITS[tariff] || TARIFF_LIMITS.free; }

/** Joriy do'kon shu modeldan yana qo'sha oladimi — bo'lmasa xato tashlaydi */
export async function enforceLimit(key: LimitKey): Promise<void> {
  const shopId = currentShopId();
  if (shopId === DEFAULT_SHOP_ID) return; // platforma egasining o'z do'koni — limitsiz
  const tariff = await shopTariff(shopId);
  const limit = limitsFor(tariff)[key];
  const used = await currentUsage(key);
  if (used >= limit) {
    throw new Error(`Tarif chegarasi: «${TARIFF_NAMES[tariff] || tariff}» rejada ko'pi bilan ${limit} ta. Tarifni yangilang.`);
  }
}

async function currentUsage(key: LimitKey): Promise<number> {
  switch (key) {
    case "products": return prisma.product.count({ where: { isDeleted: false } });
    case "categories": return prisma.category.count({ where: { isDeleted: false } });
    case "banners": return prisma.banner.count();
    case "promotions": return prisma.promotion.count();
    case "staff": return prisma.staff.count();
    case "stories": return prisma.story.count();
    default: return 0;
  }
}

/** Do'kon foydalanuvi va limitlari (admin panelda ko'rsatish uchun) */
export async function shopUsage() {
  const shopId = currentShopId();
  const tariff = await shopTariff(shopId);
  const limits = limitsFor(tariff);
  const [products, categories, banners, promotions, staff, stories] = await Promise.all([
    currentUsage("products"), currentUsage("categories"), currentUsage("banners"), currentUsage("promotions"), currentUsage("staff"), currentUsage("stories"),
  ]);
  return { tariff, tariffName: TARIFF_NAMES[tariff] || tariff, unlimited: shopId === DEFAULT_SHOP_ID, limits, used: { products, categories, banners, promotions, staff, stories } };
}

/** Do'kon faol emasmi (to'xtatilgan yoki to'lov muddati o'tgan) */
export function isShopInactive(shop: Pick<Shop, "active" | "suspended" | "paidUntil" | "tariff">): boolean {
  if (!shop.active || shop.suspended) return true;
  if (shop.tariff !== "free" && shop.paidUntil && shop.paidUntil.getTime() < Date.now()) return true;
  return false;
}

/** Muddati o'tgan do'konlarni to'xtatish (kuniga) */
export async function expireShops(): Promise<void> {
  try {
    const now = new Date();
    const expired = await prisma.shop.findMany({ where: { id: { not: DEFAULT_SHOP_ID }, active: true, suspended: false, tariff: { not: "free" }, paidUntil: { lt: now } } });
    for (const s of expired) {
      await prisma.shop.update({ where: { id: s.id }, data: { suspended: true, note: (s.note ? s.note + " | " : "") + `Avtomatik to'xtatildi: to'lov muddati tugadi (${now.toISOString().slice(0, 10)})` } });
      await stopShopBot(s.id);
      clearTariffCache(s.id);
      log.info(`⏸ Do'kon ${s.id} (@${s.slug}) to'xtatildi — muddat tugadi`);
      await activity("shop_expired", `Do'kon «${s.name}» to'lov muddati tugaganligi uchun to'xtatildi`).catch(() => {});
    }
  } catch (e) { log.warn("expireShops", errMsg(e)); }
}
