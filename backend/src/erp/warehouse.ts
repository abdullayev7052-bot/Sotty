/**
 * Ombor (kirim/chiqim). Qoldiq to'liq StockMovement jurnali orqali boshqariladi.
 * Har bir harakat Product.stock va stores.main.stock ni bir xil saqlaydi.
 */
import { prisma } from "../db.ts";
import type { Order, Prisma } from "@prisma/client";
import { activity, errMsg, log } from "../logger.ts";
import { invalidateWeeklySales } from "./sales.ts";
import { notifyStockArrived } from "./sync.ts";
import type { OrderItemSnapshot } from "./orders.ts";

export type MovementType = "in" | "out" | "adjust";
export type MovementReason = "manual" | "purchase" | "sale" | "order";

export interface MovementInput {
  productId: number;
  type: MovementType;
  qty: number;
  unitPrice?: number;
  reason?: MovementReason;
  note?: string | null;
  supplierId?: number | null;
  orderId?: number | null;
  createdBy?: string | null;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Bitta ombor harakati: qoldiqni o'zgartiradi va jurnalingga yozadi */
export async function recordMovement(input: MovementInput) {
  const qty = Number(input.qty);
  if (!Number.isFinite(qty)) throw new Error("Miqdor noto'g'ri");
  const unitPrice = Math.max(0, Number(input.unitPrice || 0));
  const reason = input.reason || "manual";

  const res = await prisma.$transaction(async (tx) => {
    const p = await tx.product.findUnique({ where: { id: input.productId } });
    if (!p) throw new Error("Mahsulot topilmadi");
    const cur = Number(p.stock || 0);

    let delta: number;
    let moveQty: number;
    if (input.type === "in") { delta = Math.abs(qty); moveQty = Math.abs(qty); }
    else if (input.type === "out") { delta = -Math.abs(qty); moveQty = Math.abs(qty); }
    else { delta = round3(qty - cur); moveQty = delta; } // adjust: qty = yangi qoldiq

    if (moveQty === 0) throw new Error("Qoldiq o'zgarmadi");
    const newStock = round3(cur + delta);

    const mv = await tx.stockMovement.create({
      data: {
        productId: p.id, type: input.type, reason,
        qty: moveQty, unitPrice, total: round2(Math.abs(moveQty) * unitPrice),
        balance: newStock, supplierId: input.supplierId ?? null, orderId: input.orderId ?? null,
        note: input.note || null, createdBy: input.createdBy || null,
      },
    });

    const stores = ((p.stores as Record<string, { price?: number; stock?: number; available?: boolean }>) || {});
    const main = stores.main || { price: p.price, stock: cur, available: p.isAvailableForSale };
    stores.main = { ...main, stock: newStock };
    const data: Prisma.ProductUpdateInput = { stock: newStock, stores: stores as object };
    // Xaridda tan narxni yangilaymiz (oxirgi xarid narxi)
    if (input.type === "in" && reason === "purchase" && unitPrice > 0) data.costPrice = unitPrice;
    await tx.product.update({ where: { id: p.id }, data });

    return { mv, wasOut: cur <= 0, newStock };
  });

  invalidateWeeklySales();
  if (res.wasOut && res.newStock > 0) void notifyStockArrived([input.productId]);
  return res.mv;
}

/** Ko'p qatorli xarid (bitta yetkazib beruvchidan bir nechta mahsulot) */
export async function recordPurchase(rows: { productId: number; qty: number; unitPrice: number }[], opts: { supplierId?: number | null; note?: string | null; createdBy?: string | null }) {
  const created = [];
  for (const r of rows) {
    if (!r.productId || !(Number(r.qty) > 0)) continue;
    created.push(await recordMovement({ productId: r.productId, type: "in", qty: r.qty, unitPrice: r.unitPrice, reason: "purchase", supplierId: opts.supplierId ?? null, note: opts.note ?? null, createdBy: opts.createdBy ?? null }));
  }
  await activity("purchase", `Kirim: ${created.length} ta mahsulot`);
  return created;
}

/** Buyurtma bajarilganda ombordan avtomatik chiqim (bir marta) */
export async function applyOrderStock(order: Order): Promise<void> {
  if (order.stockApplied) return;
  const items = (order.items as unknown as OrderItemSnapshot[]) || [];
  try {
    for (const it of items) {
      if (!it.productId || !(Number(it.qty) > 0)) continue;
      const exists = await prisma.product.findUnique({ where: { id: it.productId }, select: { id: true, trackStock: true } });
      if (!exists) continue;
      // Qoldiq hisobini yuritmaydigan (cheksiz) mahsulotdan ayirmaymiz
      if (!exists.trackStock) continue;
      await recordMovement({ productId: it.productId, type: "out", qty: Number(it.qty), unitPrice: Number(it.price || 0), reason: "order", orderId: order.id, note: `Buyurtma #${order.number || order.id}`, createdBy: "tizim" });
    }
    await prisma.order.update({ where: { id: order.id }, data: { stockApplied: true } });
  } catch (e) {
    log.warn("applyOrderStock #" + order.id, errMsg(e));
  }
}

/** Ombor xulosasi: qoldiq qiymati, kam qolgan mahsulotlar soni */
export async function warehouseSummary(lowThreshold = 5) {
  const products = await prisma.product.findMany({ where: { isDeleted: false }, select: { stock: true, price: true, costPrice: true } });
  let costValue = 0, retailValue = 0, lowCount = 0, outCount = 0, totalUnits = 0;
  for (const p of products) {
    const s = Number(p.stock || 0);
    totalUnits += s;
    costValue += s * Number(p.costPrice || 0);
    retailValue += s * Number(p.price || 0);
    if (s <= 0) outCount++;
    else if (s <= lowThreshold) lowCount++;
  }
  return { products: products.length, totalUnits: round3(totalUnits), costValue: round2(costValue), retailValue: round2(retailValue), lowCount, outCount };
}
