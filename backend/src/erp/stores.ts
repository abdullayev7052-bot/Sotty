import type { Product, User } from "@prisma/client";
import { getSettings, lt } from "../settings/store.ts";
import type { Lang } from "../settings/schema.ts";

/**
 * Ichki do'kon konteksti. Hozircha bitta do'kon (ko'p do'kon kelgusi bosqichda).
 */
export interface StoreContext {
  id: string;
  name: (lang: Lang) => string;
  currencyId: string;
  stockSource: "warehouse" | "organization";
  pickupAddress: (lang: Lang) => string;
  pickupLocation: { lat: number; lng: number } | null;
}

/** Yoqilgan do'konlar ro'yxati (hozircha faqat asosiy do'kon) */
export function listStores(): StoreContext[] {
  const s = getSettings();
  const shop = s.shop;
  const c = s.checkout as Record<string, unknown>;
  const main: StoreContext = {
    id: "main",
    name: (lang) => lt(shop.mainStoreName, lang) || "Do'kon",
    currencyId: "",
    stockSource: "organization",
    pickupAddress: (lang) => lt(c.pickupAddress as never, lang),
    pickupLocation: (c.pickupLocation as { lat: number; lng: number }) || null,
  };
  return [main];
}

export function isMultiStore(): boolean {
  return false;
}

export function getStore(_id?: string | null): StoreContext {
  return listStores()[0];
}

export function userStore(_user: { storeId?: string | null }): StoreContext {
  return listStores()[0];
}

/** Mijoz uchun istisno narx turi (ichki ERP'da hozircha yo'q) */
export function exceptionPriceId(_user: { bitoCustomerId?: string | null }): string | null {
  return null;
}

/** Yaxlitlash: step (100/500/1000/...), mode nearest|up|down */
export function roundPrice(v: number, step: number, mode: string): number {
  if (!step || step <= 0) return Math.round(v);
  const q = v / step;
  const n = mode === "up" ? Math.ceil(q - 1e-9) : mode === "down" ? Math.floor(q + 1e-9) : Math.round(q);
  return n * step;
}

export interface Priced { price: number; basePrice: number; discountPercent: number; stock: number; available: boolean }

/** Mahsulotning mijoz uchun yakuniy narxi va qoldig'i (chegirma, yaxlitlash) */
export function priceFor(p: Product, _user: Pick<User, "storeId" | "bitoCustomerId">): Priced {
  const stores = (p.stores as Record<string, { price?: number; stock?: number; available?: boolean }>) || {};
  const st = stores.main || { price: p.price, stock: p.stock, available: p.isAvailableForSale };
  let base = Number(st?.price ?? p.price ?? 0);
  base = Number.isFinite(base) ? base : 0;
  let price = base;
  const d = Number(p.discountPercent || 0);
  if (d > 0) {
    price = base * (1 - d / 100);
    price = p.roundStep > 0 ? roundPrice(price, p.roundStep, p.roundMode) : Math.round(price * 100) / 100;
  }
  return { price, basePrice: base, discountPercent: d, stock: Number(st?.stock ?? p.stock ?? 0), available: st ? st.available !== false : true };
}

/** Do'kon valyutasi so'mmi (yaxlitlash faqat so'mda ma'noli — hozircha doim ha) */
export function storeIsUzs(_storeId?: string | null): boolean {
  return true;
}
