import "./env.ts";
import { PrismaClient } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Ko'p-ijara (multitenancy) konteksti.
 * Har bir so'rov/bot update o'z do'koniga (shopId) bog'lanadi. Prisma kengaytmasi
 * tenant jadvallariga shopId'ni AVTOMATIK qo'shadi — shuning uchun so'rovlarda
 * qo'lda filtr yozish shart emas (unutib qoldirish xavfi yo'q).
 */
export const DEFAULT_SHOP_ID = 1;

const als = new AsyncLocalStorage<{ shopId: number }>();

export function currentShopId(): number {
  return als.getStore()?.shopId ?? DEFAULT_SHOP_ID;
}

/** Berilgan do'kon konteksti ichida kodni ishga tushirish */
export function runWithShop<T>(shopId: number, fn: () => T): T {
  return als.run({ shopId }, fn);
}

/** shopId ustuniga ega (tenant) jadvallar — avtomatik ajratiladi */
const TENANT_MODELS = new Set([
  "User", "Product", "Category", "Order", "Supplier", "StockMovement", "CashTransaction",
  "Promotion", "Waitlist", "Story", "Banner", "Setting", "AdminGroup", "Staff",
  "ActivityLog", "AppEvent", "Favorite", "CartItem", "HomeBlock",
]);

const base = new PrismaClient({ log: ["error"] });

export const prisma = base.$extends({
  query: {
    $allModels: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async $allOperations({ model, operation, args, query }: { model?: string; operation: string; args: any; query: (a: any) => Promise<unknown> }) {
        if (!model || !TENANT_MODELS.has(model)) return query(args);
        const shopId = currentShopId();
        const a = (args || {}) as Record<string, unknown>;
        switch (operation) {
          case "findMany": case "findFirst": case "findFirstOrThrow":
          case "count": case "aggregate": case "groupBy":
          case "updateMany": case "deleteMany": {
            a.where = a.where ? { AND: [a.where, { shopId }] } : { shopId };
            return query(a);
          }
          case "create": {
            a.data = { ...(a.data as object), shopId: (a.data as { shopId?: number })?.shopId ?? shopId };
            return query(a);
          }
          case "createMany": {
            const d = a.data as unknown;
            a.data = Array.isArray(d)
              ? d.map((x) => ({ ...(x as object), shopId: (x as { shopId?: number })?.shopId ?? shopId }))
              : { ...(d as object), shopId: (d as { shopId?: number })?.shopId ?? shopId };
            return query(a);
          }
          case "upsert": {
            a.create = { ...(a.create as object), shopId: (a.create as { shopId?: number })?.shopId ?? shopId };
            return query(a);
          }
          // findUnique / findUniqueOrThrow / update / delete — unique/id bo'yicha,
          // chaqiruvchi kerakli joyda shopId bilan kompozit kalit yuboradi
          default:
            return query(a);
        }
      },
    },
  },
});

export type Prisma = typeof prisma;
