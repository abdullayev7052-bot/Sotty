import { prisma } from "../db.ts";
import type { Order, User } from "@prisma/client";
import { fill, getSettings, lt } from "../settings/store.ts";
import type { Lang } from "../settings/schema.ts";
import { events, type StageActor } from "../events.ts";
import { activity, errMsg, log } from "../logger.ts";
import { money, normalizePhone, qty } from "../utils/format.ts";
import { priceFor, userStore } from "./stores.ts";
import { quote } from "./promotions.ts";

export type Stage = "new" | "accepted" | "ready" | "delivering" | "done" | "canceled" | "other";
export const TERMINAL: Stage[] = ["done", "canceled"];

export interface OrderItemSnapshot {
  productId: number;
  bitoId: string;
  name: string;
  price: number;
  basePrice?: number;
  qty: number;
  boxCount?: number;
  boxItem?: number;
  measure?: string | null;
  image?: string | null;
}

export interface HistoryEntry {
  at: string;
  stage: Stage;
  stateName?: string;
  by: StageActor;
  kind?: "stage" | "products" | "traded";
}

/** Holat kalitini aniqlash (ichki — stateId ishlatilmaydi) */
export function stageOf(stateId: string | null | undefined, dynamic?: { default_key?: string; name?: string } | null): Stage {
  const k = dynamic?.default_key || stateId;
  if (k === "new") return "new";
  if (k === "accepted" || k === "in_progress") return "accepted";
  if (k === "ready") return "ready";
  if (k === "delivering") return "delivering";
  if (k === "done") return "done";
  if (k === "canceled") return "canceled";
  return "other";
}

export function stageName(stage: Stage, lang: Lang, fallback?: string | null): string {
  const st = getSettings().statuses;
  const map: Record<Stage, string> = {
    new: lt(st.nameNew, lang), accepted: lt(st.nameAccepted, lang), ready: lt(st.nameReady, lang), delivering: lt(st.nameDelivering, lang),
    done: lt(st.nameDone, lang), canceled: lt(st.nameCanceled, lang), other: fallback || "",
  };
  return map[stage] || fallback || stage;
}

export function stageMessage(stage: Stage, lang: Lang, vars: Record<string, string | number>): string {
  const st = getSettings().statuses;
  const tpl: Record<Stage, string> = {
    new: "", accepted: lt(st.msgAccepted, lang), ready: lt(st.msgReady, lang), delivering: lt(st.msgDelivering, lang),
    done: lt(st.msgDone, lang), canceled: lt(st.msgCanceled, lang), other: lt(st.msgOther, lang),
  };
  return fill(tpl[stage] || "", vars).trim();
}

/** Keyingi bosqich tugmalari (guruh uchun) */
export function nextStages(stage: Stage, type: string): Stage[] {
  if (stage === "new") return ["accepted", "canceled"];
  if (stage === "accepted") return ["ready", "canceled"];
  if (stage === "ready") return type === "pickup" ? ["done", "canceled"] : ["delivering", "canceled"];
  if (stage === "delivering") return ["done", "canceled"];
  if (stage === "other") return ["accepted", "ready", "done", "canceled"];
  return [];
}

export interface CreateOrderInput {
  items: { productId: number; qty: number; boxCount?: number }[];
  type: "delivery" | "pickup";
  phone: string;
  name?: string;
  address?: string;
  lat?: number | null;
  lng?: number | null;
  comment?: string;
  promoCode?: string;
}

export class OrderValidationError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

/** Mini App savatchasidan ichki buyurtma yaratish */
export async function createOrder(user: User, input: CreateOrderInput, lang: Lang): Promise<Order> {
  const s = getSettings();
  const store = userStore(user);
  const c = s.checkout;
  if (!input.items.length) throw new OrderValidationError("Savatcha bo'sh", "empty");
  if (input.type === "delivery" && !c.deliveryEnabled) throw new OrderValidationError("Yetkazib berish o'chirilgan", "type");

  const ids = input.items.map((i) => i.productId);
  const products = await prisma.product.findMany({ where: { id: { in: ids }, isDeleted: false, hidden: false } });
  const snapshot: OrderItemSnapshot[] = [];
  let total = 0;
  let count = 0;
  for (const it of input.items) {
    const p = products.find((x) => x.id === it.productId);
    if (!p) throw new OrderValidationError("Mahsulot topilmadi", "product");
    const q = Number(it.qty);
    if (!Number.isFinite(q) || q <= 0) throw new OrderValidationError("Miqdor noto'g'ri", "qty");
    if (q > 1000) throw new OrderValidationError("Miqdor juda katta", "qty");
    const pr = priceFor(p, user);
    if (p.trackStock && s.catalog.checkStockOnCheckout && !s.catalog.allowOrderOutOfStock && q > pr.stock) {
      throw new OrderValidationError(fill(lt(c.errorStock as never, lang), { product: p.name, stock: qty(pr.stock) }), "stock");
    }
    snapshot.push({ productId: p.id, bitoId: p.bitoId, name: p.name, price: pr.price, basePrice: pr.basePrice, qty: q, boxCount: it.boxCount || 0, boxItem: p.boxItem, measure: p.measure, image: p.image });
    total += pr.price * q;
    count += q;
  }
  if (c.minOrderTotal > 0 && total < c.minOrderTotal) {
    throw new OrderValidationError(fill(lt(c.errorMin as never, lang), { min: money(c.minOrderTotal, lang) }), "min");
  }
  // Aksiya/chegirma (savat darajasida)
  const promo = await quote(total, { code: input.promoCode });
  const discount = promo.discount;
  const netTotal = total - discount;
  const phone = normalizePhone(input.phone || user.phone || "");
  if (!phone) throw new OrderValidationError("Telefon raqam kiritilmagan", "phone");
  const isDelivery = input.type === "delivery";
  if (isDelivery && !(input.address || "").trim() && !(input.lat && input.lng)) throw new OrderValidationError("Manzil kiritilmagan", "address");
  if (isDelivery && c.requireLocation && !(input.lat && input.lng)) throw new OrderValidationError("Xaritadan joylashuvni belgilang", "location");

  // Mijoz ma'lumotlarini yangilash (manzil, telefon, ism)
  const userPatch: Record<string, unknown> = { phone };
  if (input.name && input.name.trim()) userPatch.name = input.name.trim();
  if (isDelivery) { if (input.address) userPatch.address = input.address; if (input.lat && input.lng) { userPatch.lat = input.lat; userPatch.lng = input.lng; } }
  const updatedUser = await prisma.user.update({ where: { id: user.id }, data: userPatch });

  const history: HistoryEntry[] = [{ at: new Date().toISOString(), stage: "new", by: { type: "customer" } }];
  const order = await prisma.order.create({
    data: {
      number: null, userId: user.id, type: input.type, storeId: store.id,
      stateKey: "new", stateName: null,
      items: snapshot as unknown as object, total: netTotal, discount, promoTitle: promo.promo?.name || null, itemsCount: count, phone, customerName: updatedUser.name || input.name || null,
      address: isDelivery ? input.address || null : null, lat: isDelivery ? input.lat || null : null, lng: isDelivery ? input.lng || null : null,
      comment: input.comment || null, history: history as unknown as object,
    },
  });
  // Buyurtma raqami: ichki ketma-ket (id asosida)
  const withNumber = await prisma.order.update({ where: { id: order.id }, data: { number: String(order.id) } });
  await activity("order_created", `Buyurtma #${withNumber.number} yaratildi (${updatedUser.name || phone})`, { orderId: order.id });
  events.emitApp("order:created", withNumber, updatedUser);
  return withNumber;
}

/** Bosqichni o'zgartirish (guruh tugmasi) — ichki */
export async function applyStage(order: Order, stage: Stage, by: StageActor, _opts?: { pushToBito?: boolean; stateId?: string; stateName?: string }): Promise<Order> {
  const prev = order.stateKey;
  const history = ((order.history as unknown as HistoryEntry[]) || []).slice(-30);
  history.push({ at: new Date().toISOString(), stage, by });
  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { stateKey: stage, stateName: null, history: history as unknown as object },
  });
  await activity("order_stage", `Buyurtma #${order.number}: ${prev} → ${stage} (${by.type === "staff" ? by.name : by.type})`);
  // Buyurtma bajarilganda ombordan avtomatik chiqim + kassaga tushum (bir marta)
  if (stage === "done") {
    if (!updated.stockApplied) { const { applyOrderStock } = await import("./warehouse.ts"); await applyOrderStock(updated); }
    if (!updated.cashApplied) { const { applyOrderCash } = await import("./cashbox.ts"); await applyOrderCash(updated); }
  }
  events.emitApp("order:stage", updated, prev, by);
  return updated;
}

/** Ichki ERP'da tashqi solishtirish yo'q */
export async function reconcileOrder(order: Order): Promise<Order> { return order; }
export function startOrderReconcileLoop() { void log; void errMsg; /* noop — ichki buyurtmalar */ }
