/**
 * Kassa (pul kirim/chiqim), mijozlar balansi va moliyaviy hisobot.
 * Kassa qoldig'i — barcha kirimlar minus chiqimlar.
 */
import { prisma } from "../db.ts";
import type { Order } from "@prisma/client";
import { activity, errMsg, log } from "../logger.ts";

const round2 = (n: number) => Math.round((n || 0) * 100) / 100;

export type CashKind = "income" | "expense";
export type CashMethod = "cash" | "card" | "transfer" | "other";
export type CashCategory = "sale" | "debt_payment" | "purchase" | "salary" | "rent" | "refund" | "other";

/** Joriy kassa qoldig'i */
export async function cashBalance(): Promise<number> {
  const [inc, exp] = await Promise.all([
    prisma.cashTransaction.aggregate({ _sum: { amount: true }, where: { kind: "income" } }),
    prisma.cashTransaction.aggregate({ _sum: { amount: true }, where: { kind: "expense" } }),
  ]);
  return round2((inc._sum.amount || 0) - (exp._sum.amount || 0));
}

export interface CashInput {
  kind: CashKind;
  amount: number;
  method?: CashMethod;
  category?: CashCategory;
  note?: string | null;
  userId?: number | null;
  orderId?: number | null;
  createdBy?: string | null;
}

/** Bitta kassa harakati */
export async function recordCash(input: CashInput) {
  const amount = round2(Math.abs(Number(input.amount || 0)));
  if (!(amount > 0)) throw new Error("Summa noto'g'ri");
  const prev = await cashBalance();
  const balanceAfter = round2(prev + (input.kind === "income" ? amount : -amount));
  return prisma.cashTransaction.create({
    data: {
      kind: input.kind, amount, method: input.method || "cash", category: input.category || "other",
      note: input.note || null, userId: input.userId ?? null, orderId: input.orderId ?? null,
      balanceAfter, createdBy: input.createdBy || null,
    },
  });
}

/** Mijoz to'lovini qabul qilish: kassaga kirim + mijoz qarzini kamaytirish */
export async function acceptPayment(opts: { userId: number; amount: number; method?: CashMethod; note?: string | null; createdBy?: string | null }) {
  const amount = round2(Math.abs(Number(opts.amount || 0)));
  if (!(amount > 0)) throw new Error("Summa noto'g'ri");
  const user = await prisma.user.findUnique({ where: { id: opts.userId } });
  if (!user) throw new Error("Mijoz topilmadi");
  const tx = await recordCash({ kind: "income", amount, method: opts.method || "cash", category: "debt_payment", userId: user.id, note: opts.note ?? null, createdBy: opts.createdBy ?? null });
  const updated = await prisma.user.update({ where: { id: user.id }, data: { balance: round2(Number(user.balance || 0) + amount) } });
  await activity("payment_received", `To'lov qabul qilindi: ${amount} — ${user.name || user.phone || user.id}`);
  return { tx, balance: updated.balance };
}

/** Mijoz balansini tuzatish (naqd pulsiz): musbat = haqdor qilish, manfiy = qarz yozish */
export async function adjustBalance(opts: { userId: number; delta: number; note?: string | null; createdBy?: string | null }) {
  const user = await prisma.user.findUnique({ where: { id: opts.userId } });
  if (!user) throw new Error("Mijoz topilmadi");
  const updated = await prisma.user.update({ where: { id: user.id }, data: { balance: round2(Number(user.balance || 0) + Number(opts.delta || 0)) } });
  await activity("balance_adjust", `Balans tuzatildi: ${opts.delta > 0 ? "+" : ""}${opts.delta} — ${user.name || user.phone || user.id}${opts.note ? ` (${opts.note})` : ""}`);
  return { balance: updated.balance };
}

/** Buyurtma bajarilganda kassaga avtomatik tushum (bir marta) */
export async function applyOrderCash(order: Order): Promise<void> {
  if (order.cashApplied) return;
  if (!(order.total > 0)) { await prisma.order.update({ where: { id: order.id }, data: { cashApplied: true } }); return; }
  try {
    await recordCash({ kind: "income", amount: order.total, method: order.isPaid ? "card" : "cash", category: "sale", orderId: order.id, userId: order.userId, note: `Buyurtma #${order.number || order.id}`, createdBy: "tizim" });
    await prisma.order.update({ where: { id: order.id }, data: { cashApplied: true } });
  } catch (e) {
    log.warn("applyOrderCash #" + order.id, errMsg(e));
  }
}

function dayRange(from: string, to: string): { gte: Date; lte: Date } {
  const gte = new Date(from + "T00:00:00.000");
  const lte = new Date(to + "T23:59:59.999");
  return { gte, lte };
}

/** Davr bo'yicha moliyaviy hisobot */
export async function financeReport(from: string, to: string) {
  const range = dayRange(from, to);
  const txs = await prisma.cashTransaction.findMany({ where: { createdAt: range }, select: { kind: true, amount: true, category: true } });
  let income = 0, expense = 0;
  const byCategory: Record<string, { income: number; expense: number }> = {};
  for (const t of txs) {
    const b = byCategory[t.category] || { income: 0, expense: 0 };
    if (t.kind === "income") { income += t.amount; b.income += t.amount; } else { expense += t.amount; b.expense += t.amount; }
    byCategory[t.category] = b;
  }
  // Sotuvlar: davr ichida bajarilgan buyurtmalar
  const doneOrders = await prisma.order.findMany({ where: { stateKey: "done", updatedAt: range }, select: { total: true, items: true } });
  const costByProduct = new Map<number, number>();
  const prods = await prisma.product.findMany({ select: { id: true, costPrice: true } });
  for (const p of prods) costByProduct.set(p.id, Number(p.costPrice || 0));
  let salesRevenue = 0, cogs = 0;
  for (const o of doneOrders) {
    salesRevenue += Number(o.total || 0);
    for (const it of ((o.items as unknown as { productId?: number; qty?: number }[]) || [])) {
      if (!it.productId) continue;
      cogs += (costByProduct.get(it.productId) || 0) * Number(it.qty || 0);
    }
  }
  // Mijozlar balansi (joriy)
  const [debt, credit] = await Promise.all([
    prisma.user.aggregate({ _sum: { balance: true }, where: { balance: { lt: 0 } } }),
    prisma.user.aggregate({ _sum: { balance: true }, where: { balance: { gt: 0 } } }),
  ]);
  return {
    from, to,
    income: round2(income), expense: round2(expense), net: round2(income - expense),
    byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, { income: round2(v.income), expense: round2(v.expense) }])),
    salesCount: doneOrders.length, salesRevenue: round2(salesRevenue), cogs: round2(cogs), grossProfit: round2(salesRevenue - cogs),
    cashBalance: await cashBalance(),
    customersDebt: round2(Math.abs(debt._sum.balance || 0)), customersCredit: round2(credit._sum.balance || 0),
  };
}
