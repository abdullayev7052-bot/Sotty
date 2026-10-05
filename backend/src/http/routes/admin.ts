import { Router, type Request, type Response } from "express";
import { refreshShareAdmins } from "../../erp/share.ts";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma, currentShopId } from "../../db.ts";
import { env } from "../../env.ts";
import { adminAuth, adminLogin, adminLogout, adminForgot, adminReset, setAdminPassword, shopContext } from "../auth.ts";
import { settingsSchema } from "../../settings/schema.ts";
import { getSettings, loadSettings, updateSection } from "../../settings/store.ts";
import { fileUrl } from "../../erp/images.ts";
import { getSyncStatus, notifyStockArrived } from "../../erp/sync.ts";
import { getWebhookState } from "../../erp/webhook.ts";
import { getPublicUrl, setPublicUrlManually } from "../../utils/publicUrl.ts";
import { activity, errMsg, log } from "../../logger.ts";
import { botForShop } from "../../bot/manager.ts";
import { updateMenuButton, restartBot } from "../../bot/index.ts";
import { sendToUser } from "../../bot/send.ts";
import { invalidateProductCache } from "./app.ts";
import { priceFor, storeIsUzs } from "../../erp/stores.ts";
import { InputFile, InlineKeyboard } from "grammy";
import { buildReport, presetRange, ymd, type Group } from "../../analytics/report.ts";
import { valueOf } from "../../erp/productFields.ts";
import { listStores } from "../../erp/stores.ts";
import { buildSearchKey } from "../../utils/search.ts";
import { recordMovement, recordPurchase, warehouseSummary } from "../../erp/warehouse.ts";
import { cashBalance, recordCash, acceptPayment, adjustBalance, financeReport } from "../../erp/cashbox.ts";
import { enforceLimit, shopUsage, type LimitKey } from "../../erp/limits.ts";

/** Tarif limitini tekshirish — oshsa 403 qaytaradi (true = davom etma) */
async function overLimit(res: Response, key: LimitKey): Promise<boolean> {
  try { await enforceLimit(key); return false; }
  catch (e) { res.status(403).json({ error: errMsg(e) }); return true; }
}

export const adminRouter = Router();

adminRouter.use(shopContext);
adminRouter.get("/branding", (_req, res) => { res.json(getSettings().adminPanel); });
adminRouter.post("/login", adminLogin);
adminRouter.post("/logout", adminLogout);
adminRouter.post("/forgot", adminForgot);
adminRouter.post("/reset", adminReset);
adminRouter.use(adminAuth);
adminRouter.get("/me", (_req, res) => { res.json({ ok: true }); });
adminRouter.get("/limits", async (_req, res) => { res.json(await shopUsage()); });

// ---------- Sozlamalar ----------
adminRouter.get("/schema", (_req, res) => { res.json(settingsSchema); });
adminRouter.get("/settings", (_req, res) => {
  const s = getSettings() as unknown as Record<string, Record<string, unknown>>;
  const out = { ...s, general: { ...s.general, adminPassword: "", botToken: s.general.botToken ? "••••••••" + String(s.general.botToken).slice(-6) : "" } };
  res.json(out);
});
adminRouter.put("/settings/:section", async (req, res) => {
  const section = String(req.params.section);
  const patch = (req.body || {}) as Record<string, unknown>;
  const before = getSettings();
  if (section === "general" && typeof patch.botToken === "string" && patch.botToken.startsWith("••••")) delete patch.botToken;
  if (section === "general" && typeof patch.adminPassword === "string" && patch.adminPassword.trim()) {
    const pw = patch.adminPassword.trim();
    if (pw.length < 6) { res.status(400).json({ error: "Parol kamida 6 ta belgidan iborat bo'lishi kerak" }); return; }
    await setAdminPassword(pw);
    await activity("admin", "Admin paroli o'zgartirildi");
  }
  if (section === "general") patch.adminPassword = "";
  if (section === "general" && typeof patch.botToken === "string" && patch.botToken.trim() !== (before.general.botToken || "").trim()) {
    try { const me = await restartBot(patch.botToken); await activity("admin", `Bot almashtirildi: @${me.username}`); }
    catch (e) { res.status(400).json({ error: "Bot tokeni noto'g'ri: " + errMsg(e) }); return; }
  }
  try {
    await updateSection(section, patch);
  } catch (e) { res.status(400).json({ error: errMsg(e) }); return; }
  if (section === "bot" || section === "general") void updateMenuButton();
  invalidateProductCache();
  res.json({ ok: true, settings: { ...(getSettings() as unknown as Record<string, unknown>), general: { ...getSettings().general, adminPassword: "", botToken: getSettings().general.botToken ? "••••••••" + String(getSettings().general.botToken).slice(-6) : "" } } });
});

// ---------- Katalog variantlari (ichki) ----------
adminRouter.get("/erp/options", async (_req, res) => {
  const [products, categories] = await Promise.all([
    prisma.product.findMany({ where: { isDeleted: false }, select: { customFields: true } }),
    prisma.category.findMany({ where: { isDeleted: false }, select: { bitoId: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const cf = new Map<string, string>();
  for (const p of products) for (const c of ((p.customFields as { id?: string; name?: string }[]) || [])) if (c.id) cf.set(c.id, c.name || c.id);
  res.json({
    ok: true,
    "shop:productFields": [...cf.entries()].map(([id, name]) => ({ value: `cf:${id}`, label: name })),
    "shop:categories": categories.map((c) => ({ value: c.bitoId, label: c.name })),
  });
});

// ---------- Mahsulot CRUD (ichki ERP) ----------
const productBody = z.object({
  name: z.string().trim().min(1).max(200),
  price: z.number().min(0).optional(),
  stock: z.number().min(0).optional(),
  image: z.string().max(400).nullable().optional(),
  images: z.array(z.string().max(400)).max(12).optional(),
  sku: z.string().max(80).nullable().optional(),
  barcode: z.string().max(80).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  measure: z.string().max(40).nullable().optional(),
  boxItem: z.number().min(0).optional(),
  categoryCode: z.string().max(60).nullable().optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  customFields: z.array(z.object({ id: z.string().max(60), name: z.string().max(120), value: z.string().max(500) })).max(40).optional(),
  hidden: z.boolean().optional(),
  featured: z.boolean().optional(),
});

function newCode(prefix: string): string { return prefix + randomBytes(8).toString("hex"); }

async function categoryName(code: string | null | undefined): Promise<string | null> {
  if (!code) return null;
  const c = await prisma.category.findUnique({ where: { bitoId: code }, select: { name: true } });
  return c?.name || null;
}

adminRouter.post("/catalog/products/create", async (req, res) => {
  if (await overLimit(res, "products")) return;
  const b = productBody.parse(req.body);
  const images = (b.images || (b.image ? [b.image] : [])).filter(Boolean) as string[];
  const catName = await categoryName(b.categoryCode);
  const max = (await prisma.product.aggregate({ _max: { sortOrder: true } }))._max.sortOrder || 0;
  const p = await prisma.product.create({ data: {
    bitoId: newCode("p_"), name: b.name,
    searchKey: buildSearchKey(b.name, b.sku, b.barcode, catName, ...(b.customFields || []).map((c) => c.value)),
    image: images[0] || null, images, price: b.price || 0, stock: b.stock || 0,
    stores: { main: { price: b.price || 0, stock: b.stock || 0, available: true } },
    sku: b.sku || null, barcode: b.barcode || null, note: b.note || null, measure: b.measure || null, boxItem: b.boxItem || 0,
    categoryBitoId: b.categoryCode || null, categoryName: catName,
    discountPercent: b.discountPercent || 0, customFields: (b.customFields || []) as object,
    hidden: b.hidden ?? false, featured: b.featured ?? false, sortOrder: max + 1,
  } });
  invalidateProductCache();
  await activity("product_created", `Mahsulot qo'shildi: ${p.name}`);
  res.json({ ok: true, id: p.id });
});

adminRouter.put("/catalog/products/:id/full", async (req, res) => {
  const b = productBody.partial().parse(req.body);
  const id = Number(req.params.id);
  const cur = await prisma.product.findUnique({ where: { id } });
  if (!cur) { res.status(404).json({ error: "not found" }); return; }
  const data: Record<string, unknown> = {};
  if (b.name !== undefined) data.name = b.name;
  if (b.images !== undefined || b.image !== undefined) { const imgs = (b.images || (b.image ? [b.image] : [])).filter(Boolean); data.images = imgs; data.image = imgs[0] || null; }
  if (b.sku !== undefined) data.sku = b.sku || null;
  if (b.barcode !== undefined) data.barcode = b.barcode || null;
  if (b.note !== undefined) data.note = b.note || null;
  if (b.measure !== undefined) data.measure = b.measure || null;
  if (b.boxItem !== undefined) data.boxItem = b.boxItem;
  if (b.discountPercent !== undefined) data.discountPercent = b.discountPercent;
  if (b.hidden !== undefined) data.hidden = b.hidden;
  if (b.featured !== undefined) data.featured = b.featured;
  if (b.customFields !== undefined) data.customFields = b.customFields as object;
  let catName = cur.categoryName;
  if (b.categoryCode !== undefined) { catName = await categoryName(b.categoryCode); data.categoryBitoId = b.categoryCode || null; data.categoryName = catName; }
  const price = b.price !== undefined ? b.price : cur.price;
  const stock = b.stock !== undefined ? b.stock : cur.stock;
  if (b.price !== undefined) data.price = price;
  if (b.stock !== undefined) data.stock = stock;
  data.stores = { main: { price, stock, available: true } };
  data.searchKey = buildSearchKey(b.name ?? cur.name, b.sku ?? cur.sku, b.barcode ?? cur.barcode, catName, ...(((b.customFields ?? (cur.customFields as { value?: string }[])) || []).map((c) => c.value || "")));
  const wasStock = Number(((cur.stores as Record<string, { stock?: number }>)?.main?.stock) ?? cur.stock ?? 0);
  const p = await prisma.product.update({ where: { id }, data });
  invalidateProductCache();
  if (wasStock <= 0 && stock > 0) void notifyStockArrived([id]);
  res.json({ ok: true, id: p.id });
});

adminRouter.delete("/catalog/products/:id", async (req, res) => {
  await prisma.product.update({ where: { id: Number(req.params.id) }, data: { isDeleted: true } });
  invalidateProductCache();
  res.json({ ok: true });
});

// ---------- Kategoriya CRUD (ichki ERP) ----------
const categoryBody = z.object({ name: z.string().trim().min(1).max(120), parentCode: z.string().max(60).nullable().optional(), image: z.string().max(400).nullable().optional() });
adminRouter.post("/catalog/categories/create", async (req, res) => {
  if (await overLimit(res, "categories")) return;
  const b = categoryBody.parse(req.body);
  const max = (await prisma.category.aggregate({ _max: { sortOrder: true } }))._max.sortOrder || 0;
  const c = await prisma.category.create({ data: { bitoId: newCode("c_"), name: b.name, parentId: b.parentCode || null, image: b.image || null, sortOrder: max + 1 } });
  res.json({ ok: true, id: c.id, code: c.bitoId });
});
adminRouter.put("/catalog/categories/:id/full", async (req, res) => {
  const b = categoryBody.partial().parse(req.body);
  const data: Record<string, unknown> = {};
  if (b.name !== undefined) data.name = b.name;
  if (b.parentCode !== undefined) data.parentId = b.parentCode || null;
  if (b.image !== undefined) data.image = b.image || null;
  const c = await prisma.category.update({ where: { id: Number(req.params.id) }, data });
  invalidateProductCache();
  res.json({ ok: true, id: c.id });
});
adminRouter.delete("/catalog/categories/:id", async (req, res) => {
  await prisma.category.update({ where: { id: Number(req.params.id) }, data: { isDeleted: true } });
  invalidateProductCache();
  res.json({ ok: true });
});

// ---------- Ombor (kirim/chiqim) ----------
adminRouter.get("/warehouse/summary", async (_req, res) => { res.json(await warehouseSummary()); });

/** Ombor uchun mahsulotlar ro'yxati (tanlash + qoldiq/tan narx) */
adminRouter.get("/warehouse/products", async (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const products = await prisma.product.findMany({ where: { isDeleted: false }, orderBy: { name: "asc" }, select: { id: true, name: true, sku: true, stock: true, price: true, costPrice: true, measure: true } });
  const list = q ? products.filter((p) => p.name.toLowerCase().includes(q) || (p.sku || "").toLowerCase().includes(q)) : products;
  res.json(list.slice(0, 500));
});

/** Ombor harakatlari tarixi (filtr: productId, reason, type) */
adminRouter.get("/warehouse/movements", async (req, res) => {
  const where: Record<string, unknown> = {};
  if (req.query.productId) where.productId = Number(req.query.productId);
  if (req.query.reason) where.reason = String(req.query.reason);
  if (req.query.type) where.type = String(req.query.type);
  const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
  const rows = await prisma.stockMovement.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, include: { product: { select: { name: true, measure: true } }, supplier: { select: { name: true } } } });
  res.json(rows.map((m) => ({
    id: m.id, productId: m.productId, product: m.product?.name || `#${m.productId}`, measure: m.product?.measure || null,
    type: m.type, reason: m.reason, qty: m.qty, unitPrice: m.unitPrice, total: m.total, balance: m.balance,
    supplier: m.supplier?.name || null, orderId: m.orderId, note: m.note, createdBy: m.createdBy, createdAt: m.createdAt,
  })));
});

/** Bitta harakat: kirim / chiqim / tuzatish */
adminRouter.post("/warehouse/movement", async (req, res) => {
  const b = z.object({
    productId: z.number().int(),
    type: z.enum(["in", "out", "adjust"]),
    qty: z.number(),
    unitPrice: z.number().min(0).optional(),
    reason: z.enum(["manual", "purchase", "sale", "order"]).optional(),
    supplierId: z.number().int().nullable().optional(),
    note: z.string().max(500).nullable().optional(),
  }).parse(req.body);
  try {
    const mv = await recordMovement({ ...b, createdBy: "admin" });
    invalidateProductCache();
    res.json({ ok: true, id: mv.id, balance: mv.balance });
  } catch (e) { res.status(400).json({ error: errMsg(e) }); }
});

/** Ko'p qatorli xarid (kirim) */
adminRouter.post("/warehouse/purchase", async (req, res) => {
  const b = z.object({
    supplierId: z.number().int().nullable().optional(),
    note: z.string().max(500).nullable().optional(),
    rows: z.array(z.object({ productId: z.number().int(), qty: z.number().positive(), unitPrice: z.number().min(0) })).min(1).max(200),
  }).parse(req.body);
  try {
    const created = await recordPurchase(b.rows, { supplierId: b.supplierId ?? null, note: b.note ?? null, createdBy: "admin" });
    invalidateProductCache();
    res.json({ ok: true, count: created.length });
  } catch (e) { res.status(400).json({ error: errMsg(e) }); }
});

// ---------- Yetkazib beruvchilar ----------
adminRouter.get("/suppliers", async (_req, res) => { res.json(await prisma.supplier.findMany({ orderBy: { name: "asc" } })); });
adminRouter.post("/suppliers", async (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(120), phone: z.string().max(40).nullable().optional(), note: z.string().max(300).nullable().optional() }).parse(req.body);
  res.json(await prisma.supplier.create({ data: { name: b.name, phone: b.phone || null, note: b.note || null } }));
});
adminRouter.put("/suppliers/:id", async (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(120).optional(), phone: z.string().max(40).nullable().optional(), note: z.string().max(300).nullable().optional() }).parse(req.body);
  res.json(await prisma.supplier.update({ where: { id: Number(req.params.id) }, data: { name: b.name, phone: b.phone === undefined ? undefined : (b.phone || null), note: b.note === undefined ? undefined : (b.note || null) } }));
});
adminRouter.delete("/suppliers/:id", async (req, res) => { await prisma.supplier.delete({ where: { id: Number(req.params.id) } }); res.json({ ok: true }); });

// ---------- Kassa (pul kirim/chiqim) ----------
adminRouter.get("/cash/summary", async (_req, res) => { res.json({ balance: await cashBalance() }); });
adminRouter.get("/cash/transactions", async (req, res) => {
  const where: Record<string, unknown> = {};
  if (req.query.kind) where.kind = String(req.query.kind);
  if (req.query.category) where.category = String(req.query.category);
  const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
  const rows = await prisma.cashTransaction.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, include: { user: { select: { name: true, phone: true } } } });
  res.json(rows.map((t) => ({ id: t.id, kind: t.kind, amount: t.amount, method: t.method, category: t.category, note: t.note, orderId: t.orderId, customer: t.user ? (t.user.name || t.user.phone || "") : null, balanceAfter: t.balanceAfter, createdBy: t.createdBy, createdAt: t.createdAt })));
});
adminRouter.post("/cash", async (req, res) => {
  const b = z.object({
    kind: z.enum(["income", "expense"]),
    amount: z.number().positive(),
    method: z.enum(["cash", "card", "transfer", "other"]).optional(),
    category: z.enum(["sale", "debt_payment", "purchase", "salary", "rent", "refund", "other"]).optional(),
    note: z.string().max(500).nullable().optional(),
  }).parse(req.body);
  try { const tx = await recordCash({ ...b, createdBy: "admin" }); res.json({ ok: true, id: tx.id, balance: tx.balanceAfter }); }
  catch (e) { res.status(400).json({ error: errMsg(e) }); }
});

// ---------- Moliyaviy hisobot ----------
adminRouter.get("/finance/report", async (req, res) => {
  const isYmd = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const today = new Date().toISOString().slice(0, 10);
  let from = isYmd(String(req.query.from)) ? String(req.query.from) : today;
  let to = isYmd(String(req.query.to)) ? String(req.query.to) : today;
  if (from > to) [from, to] = [to, from];
  try { res.json(await financeReport(from, to)); } catch (e) { res.status(500).json({ error: errMsg(e) }); }
});

// ---------- Mijozlar balansi ----------
adminRouter.get("/customers", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const onlyDebt = req.query.onlyDebt === "1";
  const where: Record<string, unknown> = {};
  if (onlyDebt) where.balance = { not: 0 };
  if (q) where.OR = [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }];
  const rows = await prisma.user.findMany({ where, orderBy: onlyDebt ? { balance: "asc" } : { createdAt: "desc" }, take: 100, select: { id: true, name: true, tgFirstName: true, phone: true, balance: true, telegramId: true } });
  res.json(rows.map((u) => ({ id: u.id, name: u.name || u.tgFirstName || "—", phone: u.phone, balance: u.balance, telegramId: String(u.telegramId) })));
});
adminRouter.post("/customers/:id/payment", async (req, res) => {
  const b = z.object({ amount: z.number().positive(), method: z.enum(["cash", "card", "transfer", "other"]).optional(), note: z.string().max(500).nullable().optional() }).parse(req.body);
  try { const r = await acceptPayment({ userId: Number(req.params.id), amount: b.amount, method: b.method, note: b.note, createdBy: "admin" }); res.json({ ok: true, balance: r.balance }); }
  catch (e) { res.status(400).json({ error: errMsg(e) }); }
});
adminRouter.post("/customers/:id/adjust", async (req, res) => {
  const b = z.object({ delta: z.number(), note: z.string().max(500).nullable().optional() }).parse(req.body);
  try { const r = await adjustBalance({ userId: Number(req.params.id), delta: b.delta, note: b.note, createdBy: "admin" }); res.json({ ok: true, balance: r.balance }); }
  catch (e) { res.status(400).json({ error: errMsg(e) }); }
});

// ---------- Aksiyalar / chegirmalar ----------
const promoBody = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(["percent", "fixed"]).optional(),
  value: z.number().min(0).optional(),
  minTotal: z.number().min(0).optional(),
  promoCode: z.string().trim().max(40).nullable().optional(),
  active: z.boolean().optional(),
  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
});
adminRouter.get("/promotions", async (_req, res) => { res.json(await prisma.promotion.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] })); });
adminRouter.post("/promotions", async (req, res) => {
  if (await overLimit(res, "promotions")) return;
  const b = promoBody.parse(req.body);
  const max = (await prisma.promotion.aggregate({ _max: { sortOrder: true } }))._max.sortOrder || 0;
  const p = await prisma.promotion.create({ data: {
    name: b.name, type: b.type || "percent", value: b.value || 0, minTotal: b.minTotal || 0,
    promoCode: b.promoCode?.trim() || null, active: b.active ?? true,
    startsAt: b.startsAt ? new Date(b.startsAt) : null, endsAt: b.endsAt ? new Date(b.endsAt) : null, sortOrder: max + 1,
  } });
  res.json(p);
});
adminRouter.put("/promotions/:id", async (req, res) => {
  const b = promoBody.partial().parse(req.body);
  const data: Record<string, unknown> = {};
  if (b.name !== undefined) data.name = b.name;
  if (b.type !== undefined) data.type = b.type;
  if (b.value !== undefined) data.value = b.value;
  if (b.minTotal !== undefined) data.minTotal = b.minTotal;
  if (b.promoCode !== undefined) data.promoCode = b.promoCode?.trim() || null;
  if (b.active !== undefined) data.active = b.active;
  if (b.startsAt !== undefined) data.startsAt = b.startsAt ? new Date(b.startsAt) : null;
  if (b.endsAt !== undefined) data.endsAt = b.endsAt ? new Date(b.endsAt) : null;
  res.json(await prisma.promotion.update({ where: { id: Number(req.params.id) }, data }));
});
adminRouter.delete("/promotions/:id", async (req, res) => { await prisma.promotion.delete({ where: { id: Number(req.params.id) } }); res.json({ ok: true }); });
adminRouter.post("/public-url", async (req, res) => {
  const url = String((req.body as { url?: string })?.url || "").trim();
  if (url && !/^https:\/\//.test(url)) { res.status(400).json({ error: "Manzil https:// bilan boshlanishi kerak" }); return; }
  setPublicUrlManually(url);
  res.json({ ok: true, url: getPublicUrl() });
});

// ---------- Holat (dashboard) ----------
adminRouter.get("/status", async (_req, res) => {
  const [users, registered, products, orders, ordersToday, waitlist, groups, webhook, activityRows, me] = await Promise.all([
    prisma.user.count(), prisma.user.count({ where: { step: "done" } }), prisma.product.count({ where: { isDeleted: false } }),
    prisma.order.count(), prisma.order.count({ where: { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } }),
    prisma.waitlist.count({ where: { notifiedAt: null } }), prisma.adminGroup.findMany(), getWebhookState(),
    prisma.activityLog.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    botForShop(currentShopId()).api.getMe().catch(() => null),
  ]);
  const s = getSettings();
  res.json({
    bot: me ? { username: me.username, name: me.first_name } : null,
    publicUrl: getPublicUrl(), port: env.PORT,
    appUrl: getPublicUrl() ? `${getPublicUrl()}/app/` : null,
    shop: { name: s.shop.mainStoreName },
    sync: getSyncStatus(), webhook,
    counts: { users, registered, products, orders, ordersToday, waitlist, groups: groups.filter((g) => g.enabled).length },
    activity: activityRows,
  });
});
// ---------- Analitika (Dashboard) ----------
adminRouter.get("/analytics", async (req, res) => {
  const qs = req.query as Record<string, string | undefined>;
  const preset = qs.preset ? presetRange(qs.preset) : null;
  const isYmd = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const today = ymd(new Date());
  let from = preset?.from || (isYmd(qs.from) ? qs.from! : today);
  let to = preset?.to || (isYmd(qs.to) ? qs.to! : today);
  if (from > to) [from, to] = [to, from];
  const group = (["day", "week", "month"].includes(qs.group || "") ? qs.group : "day") as Group;
  try {
    const report = await buildReport({ from, to, group, storeId: qs.storeId || null, type: qs.type || null, platform: qs.platform || null, lang: qs.lang || null });
    res.json({ ...report, stores: listStores().map((s) => ({ id: s.id, name: s.name("uz") })) });
  } catch (e) { log.error("analytics", e); res.status(500).json({ error: errMsg(e) }); }
});
adminRouter.get("/activity", async (req, res) => {
  const take = Math.min(300, Number(req.query.limit || 100));
  res.json(await prisma.activityLog.findMany({ orderBy: { createdAt: "desc" }, take }));
});

// ---------- Fayl yuklash ----------
fs.mkdirSync(env.UPLOADS_DIR, { recursive: true });
/** Media limitlari (server tomonida qat'iy, admin o'zgartira olmaydi) */
export const MEDIA_LIMITS = {
  imageBytes: 5 * 1024 * 1024,      // rasm: 5 MB
  gifBytes: 10 * 1024 * 1024,       // GIF: 10 MB
  videoBytes: 25 * 1024 * 1024,     // storis/banner video: 25 MB
  broadcastBytes: 50 * 1024 * 1024, // xabar tarqatish (Telegram chegarasi): 50 MB
  stories: 15, slidesPerStory: 10, banners: 12,
  totalBytes: 600 * 1024 * 1024,    // barcha yuklangan fayllar jami: 600 MB
};
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MEDIA_LIMITS.broadcastBytes },
  fileFilter: (_req, file, cb) => cb(null, /^image[/](png|jpe?g|webp|gif|svg[+]xml)$|^video[/](mp4|webm|quicktime)$/.test(file.mimetype)),
});
adminRouter.post("/upload", upload.single("file"), async (req, res) => {
  const f = (req as Request & { file?: Express.Multer.File }).file;
  if (!f) { res.status(400).json({ error: "Fayl tanlanmadi (rasm yoki video: mp4/webm/gif)" }); return; }
  const purpose = String(req.query.purpose || "media"); // media | broadcast
  const isGif = f.mimetype === "image/gif", isVid = f.mimetype.startsWith("video/");
  const max = purpose === "broadcast" ? MEDIA_LIMITS.broadcastBytes : isVid ? MEDIA_LIMITS.videoBytes : isGif ? MEDIA_LIMITS.gifBytes : MEDIA_LIMITS.imageBytes;
  if (f.size > max) { res.status(400).json({ error: `Fayl juda katta: ${(f.size / 1048576).toFixed(1)} MB. Limit: ${Math.round(max / 1048576)} MB (${isVid ? "video" : isGif ? "GIF" : "rasm"})` }); return; }
  const total = await prisma.upload.aggregate({ _sum: { size: true } });
  if ((total._sum.size || 0) + f.size > MEDIA_LIMITS.totalBytes) { res.status(400).json({ error: "Yuklangan fayllar umumiy limiti (600 MB) to'ldi. Eski storis/bannerlarni o'chiring." }); return; }
  const ext = (path.extname(f.originalname) || (f.mimetype.startsWith("video/") ? ".mp4" : ".png")).toLowerCase().slice(0, 8);
  const name = `${Date.now()}-${randomBytes(4).toString("hex")}${ext}`;
  await prisma.upload.create({ data: { name, mime: f.mimetype, size: f.size, data: new Uint8Array(f.buffer) as never } });
  res.json({ ok: true, path: `/uploads/${name}`, url: `/uploads/${name}`, mime: f.mimetype, size: f.size });
});

// ---------- Storis ----------
adminRouter.get("/stories", async (_req, res) => {
  res.json(await prisma.story.findMany({ orderBy: { sortOrder: "asc" }, include: { slides: { orderBy: { sortOrder: "asc" } } } }));
});
const storySchema = z.object({ title: z.string().trim().min(1).max(60), cover: z.string().min(1), active: z.boolean().optional(), expiresAt: z.string().nullable().optional() });
adminRouter.post("/stories", async (req, res) => {
  if (await overLimit(res, "stories")) return;
  const b = storySchema.parse(req.body);
  if ((await prisma.story.count()) >= MEDIA_LIMITS.stories) { res.status(400).json({ error: `Storislar limiti: ko'pi bilan ${MEDIA_LIMITS.stories} ta. Eskisini o'chiring.` }); return; }
  const max = (await prisma.story.aggregate({ _max: { sortOrder: true } }))._max.sortOrder || 0;
  const st = await prisma.story.create({ data: { title: b.title, cover: b.cover, active: b.active ?? true, sortOrder: max + 1, expiresAt: b.expiresAt ? new Date(b.expiresAt) : null } });
  res.json(st);
});
adminRouter.put("/stories/:id", async (req, res) => {
  const b = storySchema.partial().extend({ sortOrder: z.number().optional() }).parse(req.body);
  const st = await prisma.story.update({ where: { id: Number(req.params.id) }, data: { ...b, expiresAt: b.expiresAt === undefined ? undefined : b.expiresAt ? new Date(b.expiresAt) : null } });
  res.json(st);
});
async function dropUpload(url: string | null | undefined) {
  if (!url || !url.startsWith("/uploads/")) return;
  const name = path.basename(url);
  const used = await Promise.all([prisma.story.count({ where: { cover: url } }), prisma.storySlide.count({ where: { image: url } }), prisma.banner.count({ where: { image: url } })]);
  if (used.reduce((x, y) => x + y, 0) <= 1) await prisma.upload.deleteMany({ where: { name } }).catch(() => {});
}
adminRouter.get("/media/limits", async (_req, res) => {
  const [stories, banners, total] = await Promise.all([prisma.story.count(), prisma.banner.count(), prisma.upload.aggregate({ _sum: { size: true } })]);
  res.json({ ...MEDIA_LIMITS, used: { stories, banners, bytes: total._sum.size || 0 } });
});
adminRouter.delete("/stories/:id", async (req, res) => {
  const st = await prisma.story.findUnique({ where: { id: Number(req.params.id) }, include: { slides: true } });
  await prisma.story.delete({ where: { id: Number(req.params.id) } });
  if (st) { await dropUpload(st.cover); for (const sl of st.slides) await dropUpload(sl.image); }
  res.json({ ok: true });
});
const slideSchema = z.object({ image: z.string().min(1), caption: z.string().max(200).nullable().optional(), link: z.string().max(300).nullable().optional(), duration: z.number().min(1).max(180).optional(), buttonText: z.string().max(60).nullable().optional() });
adminRouter.post("/stories/:id/slides", async (req, res) => {
  const b = slideSchema.parse(req.body);
  const storyId = Number(req.params.id);
  if ((await prisma.storySlide.count({ where: { storyId } })) >= MEDIA_LIMITS.slidesPerStory) { res.status(400).json({ error: `Bitta storisda ko'pi bilan ${MEDIA_LIMITS.slidesPerStory} ta slayd.` }); return; }
  const max = (await prisma.storySlide.aggregate({ where: { storyId }, _max: { sortOrder: true } }))._max.sortOrder || 0;
  res.json(await prisma.storySlide.create({ data: { storyId, image: b.image, caption: b.caption || null, link: b.link || null, duration: b.duration || 5, buttonText: b.buttonText || null, sortOrder: max + 1 } }));
});
adminRouter.put("/slides/:id", async (req, res) => {
  const b = slideSchema.partial().extend({ sortOrder: z.number().optional() }).parse(req.body);
  res.json(await prisma.storySlide.update({ where: { id: Number(req.params.id) }, data: b }));
});
adminRouter.delete("/slides/:id", async (req, res) => {
  const sl = await prisma.storySlide.findUnique({ where: { id: Number(req.params.id) } });
  await prisma.storySlide.delete({ where: { id: Number(req.params.id) } });
  if (sl) await dropUpload(sl.image);
  res.json({ ok: true });
});
adminRouter.post("/stories/reorder", async (req, res) => {
  const ids = z.array(z.number()).parse((req.body as { ids?: number[] })?.ids);
  await Promise.all(ids.map((id, i) => prisma.story.update({ where: { id }, data: { sortOrder: i + 1 } })));
  res.json({ ok: true });
});

// ---------- Bannerlar ----------
adminRouter.get("/banners", async (_req, res) => { res.json(await prisma.banner.findMany({ orderBy: { sortOrder: "asc" } })); });
const bannerSchema = z.object({ image: z.string().min(1), link: z.string().max(300).nullable().optional(), active: z.boolean().optional(), productIds: z.array(z.number()).max(200).optional() });
adminRouter.post("/banners", async (req, res) => {
  if (await overLimit(res, "banners")) return;
  const b = bannerSchema.parse(req.body);
  if ((await prisma.banner.count()) >= MEDIA_LIMITS.banners) { res.status(400).json({ error: `Bannerlar limiti: ko'pi bilan ${MEDIA_LIMITS.banners} ta. Eskisini o'chiring.` }); return; }
  const max = (await prisma.banner.aggregate({ _max: { sortOrder: true } }))._max.sortOrder || 0;
  res.json(await prisma.banner.create({ data: { image: b.image, link: b.link || null, active: b.active ?? true, productIds: (b.productIds || []) as object, sortOrder: max + 1 } }));
});
adminRouter.put("/banners/:id", async (req, res) => {
  const b = bannerSchema.partial().extend({ sortOrder: z.number().optional() }).parse(req.body);
  res.json(await prisma.banner.update({ where: { id: Number(req.params.id) }, data: { ...b, productIds: b.productIds as object | undefined } }));
});
adminRouter.delete("/banners/:id", async (req, res) => { const b = await prisma.banner.findUnique({ where: { id: Number(req.params.id) } }); await prisma.banner.delete({ where: { id: Number(req.params.id) } }); if (b) await dropUpload(b.image); res.json({ ok: true }); });
adminRouter.post("/banners/reorder", async (req, res) => {
  const ids = z.array(z.number()).parse((req.body as { ids?: number[] })?.ids);
  await Promise.all(ids.map((id, i) => prisma.banner.update({ where: { id }, data: { sortOrder: i + 1 } })));
  res.json({ ok: true });
});

// ---------- Katalog boshqaruvi ----------
adminRouter.get("/catalog", async (_req, res) => {
  const [products, categories] = await Promise.all([
    prisma.product.findMany({ where: { isDeleted: false }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.category.findMany({ where: { isDeleted: false }, orderBy: { sortOrder: "asc" } }),
  ]);
  res.json({
    products: products.map((p) => ({ id: p.id, bitoId: p.bitoId, name: p.name, image: fileUrl(p.image), images: ((p.images as string[]) || []).map((x) => fileUrl(x)).filter(Boolean), price: p.price, finalPrice: priceFor(p, { storeId: "main", bitoCustomerId: null }).price, discountPercent: p.discountPercent, roundStep: p.roundStep, roundMode: p.roundMode, stock: p.stock, categoryId: p.categoryBitoId, categoryName: p.categoryName, hidden: p.hidden, featured: p.featured, sortOrder: p.sortOrder, boxItem: p.boxItem, sku: p.sku, barcode: p.barcode, note: p.note, measure: p.measure, customFields: p.customFields })),
    uzs: storeIsUzs("main"),
    categories: categories.map((c) => ({ id: c.id, bitoId: c.bitoId, name: c.name, parentId: c.parentId, image: fileUrl(c.image), hidden: c.hidden, sortOrder: c.sortOrder, itemCount: c.itemCount })),
    sync: getSyncStatus(),
  });
});
adminRouter.put("/catalog/products/:id", async (req, res) => {
  const b = z.object({ hidden: z.boolean().optional(), featured: z.boolean().optional(), sortOrder: z.number().optional() }).parse(req.body);
  const p = await prisma.product.update({ where: { id: Number(req.params.id) }, data: b });
  invalidateProductCache();
  res.json({ ok: true, id: p.id, hidden: p.hidden, featured: p.featured, sortOrder: p.sortOrder });
});
adminRouter.post("/catalog/products/bulk", async (req, res) => {
  const b = z.object({ ids: z.array(z.number()), hidden: z.boolean().optional(), featured: z.boolean().optional() }).parse(req.body);
  const data: Record<string, boolean> = {};
  if (b.hidden !== undefined) data.hidden = b.hidden;
  if (b.featured !== undefined) data.featured = b.featured;
  await prisma.product.updateMany({ where: { id: { in: b.ids } }, data });
  invalidateProductCache();
  res.json({ ok: true });
});
adminRouter.post("/catalog/products/discount", async (req, res) => {
  const b = z.object({ ids: z.array(z.number()).min(1), percent: z.number().min(0).max(100), roundStep: z.number().int().min(0).optional(), roundMode: z.enum(["nearest", "up", "down"]).optional() }).parse(req.body);
  await prisma.product.updateMany({ where: { id: { in: b.ids } }, data: { discountPercent: b.percent, roundStep: b.percent > 0 ? (b.roundStep || 0) : 0, roundMode: b.roundMode || "nearest" } });
  invalidateProductCache();
  await activity("discount", `Chegirma ${b.percent}% → ${b.ids.length} ta mahsulot${b.roundStep ? ` (yaxlitlash /${b.roundStep} ${b.roundMode})` : ""}`);
  res.json({ ok: true });
});
adminRouter.post("/catalog/products/reorder", async (req, res) => {
  const ids = z.array(z.number()).parse((req.body as { ids?: number[] })?.ids);
  const orders = ids.map((_, i) => i + 1);
  await prisma.$executeRaw`UPDATE "Product" AS p SET "sortOrder" = v.ord FROM unnest(${ids}::int[], ${orders}::int[]) AS v(id, ord) WHERE p.id = v.id`;
  invalidateProductCache();
  res.json({ ok: true });
});
adminRouter.put("/catalog/categories/:id", async (req, res) => {
  const b = z.object({ hidden: z.boolean().optional(), sortOrder: z.number().optional() }).parse(req.body);
  const c = await prisma.category.update({ where: { id: Number(req.params.id) }, data: b });
  res.json({ ok: true, id: c.id, hidden: c.hidden, sortOrder: c.sortOrder });
});
adminRouter.post("/catalog/categories/reorder", async (req, res) => {
  const ids = z.array(z.number()).parse((req.body as { ids?: number[] })?.ids);
  const orders = ids.map((_, i) => i + 1);
  await prisma.$executeRaw`UPDATE "Category" AS c SET "sortOrder" = v.ord FROM unnest(${ids}::int[], ${orders}::int[]) AS v(id, ord) WHERE c.id = v.id`;
  res.json({ ok: true });
});

// ---------- Kutilayotgan mahsulotlar ----------
/**
 * Nazorat: "Kutilayotgan mahsulotlar" va "Istaklar" — mahsulot bo'yicha guruhlangan,
 * eng ko'p kutilgan/yoqtirilgan yuqorida. Rasmlar yuborilmaydi (serverga ortiqcha yuk).
 */
async function interestGroups(kind: "wait" | "fav") {
  const rows = kind === "wait"
    ? await prisma.waitlist.groupBy({ by: ["productId"], where: { notifiedAt: null }, _count: { userId: true }, _max: { createdAt: true } })
    : await prisma.favorite.groupBy({ by: ["productId"], _count: { userId: true }, _max: { createdAt: true } });
  const products = await prisma.product.findMany({
    where: { id: { in: rows.map((r) => r.productId) } },
    select: { id: true, name: true, stock: true, sku: true, isDeleted: true, hidden: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  return rows
    .map((r) => {
      const p = byId.get(r.productId);
      return {
        productId: r.productId,
        name: p?.name || `#${r.productId}`,
        stock: p?.stock ?? 0,
        sku: p?.sku || null,
        gone: !p || p.isDeleted,
        hidden: !!p?.hidden,
        count: r._count.userId,
        lastAt: r._max.createdAt,
      };
    })
    .sort((a, b) => b.count - a.count || (b.lastAt?.getTime() || 0) - (a.lastAt?.getTime() || 0));
}

async function interestUsers(kind: "wait" | "fav", productId: number) {
  const rows = kind === "wait"
    ? await prisma.waitlist.findMany({ where: { productId, notifiedAt: null }, orderBy: { createdAt: "desc" }, include: { user: true } })
    : await prisma.favorite.findMany({ where: { productId }, orderBy: { createdAt: "desc" }, include: { user: true } });
  return rows.map((r) => ({
    id: r.id, createdAt: r.createdAt,
    user: { id: r.user.id, name: r.user.name || r.user.tgFirstName, phone: r.user.phone, username: r.user.tgUsername, telegramId: String(r.user.telegramId), registered: r.user.step === "done" },
  }));
}

adminRouter.get("/waitlist", async (_req, res) => { res.json(await interestGroups("wait")); });
adminRouter.get("/waitlist/product/:productId", async (req, res) => { res.json(await interestUsers("wait", Number(req.params.productId))); });
adminRouter.delete("/waitlist/:id", async (req, res) => { await prisma.waitlist.delete({ where: { id: Number(req.params.id) } }); res.json({ ok: true }); });
adminRouter.delete("/waitlist/product/:productId", async (req, res) => {
  const r = await prisma.waitlist.deleteMany({ where: { productId: Number(req.params.productId) } });
  res.json({ ok: true, count: r.count });
});

adminRouter.get("/favorites", async (_req, res) => { res.json(await interestGroups("fav")); });
adminRouter.get("/favorites/product/:productId", async (req, res) => { res.json(await interestUsers("fav", Number(req.params.productId))); });
adminRouter.delete("/favorites/:id", async (req, res) => { await prisma.favorite.delete({ where: { id: Number(req.params.id) } }); res.json({ ok: true }); });
adminRouter.delete("/favorites/product/:productId", async (req, res) => {
  const r = await prisma.favorite.deleteMany({ where: { productId: Number(req.params.productId) } });
  res.json({ ok: true, count: r.count });
});

/**
 * Admin panelda yuklangan fayl manzili (/uploads/...) — Bito fayl serveriga tegishli emas.
 * Bito manzili bilan noto'g'ri saqlangan eski qiymatlarni ham tozalaydi.
 */
function localImage(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = /^https?:\/\/[^/]+(?:\/[^/]*)*?(\/uploads\/[\w.-]+)$/.exec(s);
  if (m) return m[1];
  return s;
}

// ---------- Bosh sahifa bloklari ----------
adminRouter.get("/home-blocks", async (_req, res) => {
  const blocks = await prisma.homeBlock.findMany({ orderBy: { sortOrder: "asc" }, include: { items: { orderBy: { sortOrder: "asc" } } } });
  const ids = blocks.flatMap((b) => b.items.map((i) => i.productId).filter(Boolean)) as number[];
  const products = ids.length ? await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true } }) : [];
  const byId = new Map(products.map((p) => [p.id, p]));
  res.json(blocks.map((b) => ({
    ...b,
    items: b.items.map((i) => ({ ...i, image: localImage(i.image), productName: i.productId ? byId.get(i.productId)?.name || `#${i.productId}` : null })),
  })));
});
const blockSchema = z.object({
  kind: z.enum(["products", "chips"]).optional(),
  source: z.enum(["manual", "featured", "new", "popular", "field"]).optional(),
  fieldKey: z.string().max(80).nullable().optional(),
  title: z.record(z.string(), z.string()).optional(),
  style: z.record(z.string(), z.unknown()).optional(),
  limit: z.number().int().min(1).max(60).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});
adminRouter.post("/home-blocks", async (req, res) => {
  const b = blockSchema.parse(req.body);
  const max = (await prisma.homeBlock.aggregate({ _max: { sortOrder: true } }))._max.sortOrder || 0;
  const created = await prisma.homeBlock.create({ data: { ...b, title: (b.title || {}) as object, style: (b.style || {}) as object, sortOrder: max + 1 } });
  res.json({ ...created, items: [] });
});
adminRouter.put("/home-blocks/:id", async (req, res) => {
  const b = blockSchema.parse(req.body);
  const updated = await prisma.homeBlock.update({ where: { id: Number(req.params.id) }, data: { ...b, title: b.title as object | undefined, style: b.style as object | undefined }, include: { items: { orderBy: { sortOrder: "asc" } } } });
  res.json({ ...updated, items: updated.items.map((i) => ({ ...i, image: localImage(i.image) })) });
});
adminRouter.delete("/home-blocks/:id", async (req, res) => {
  await prisma.homeBlock.delete({ where: { id: Number(req.params.id) } });
  res.json({ ok: true });
});
adminRouter.post("/home-blocks/reorder", async (req, res) => {
  const ids = z.array(z.number()).parse((req.body as { ids?: number[] })?.ids || []);
  await prisma.$transaction(ids.map((id, i) => prisma.homeBlock.update({ where: { id }, data: { sortOrder: i + 1 } })));
  res.json({ ok: true });
});
/** Blok tarkibi: mahsulotlar (products) yoki qiymatlar+rasm (chips) */
adminRouter.put("/home-blocks/:id/items", async (req, res) => {
  const id = Number(req.params.id);
  const body = z.object({
    products: z.array(z.number()).max(200).optional(),
    entries: z.array(z.object({ value: z.string().max(120), image: z.string().max(400).optional(), title: z.string().max(120).optional(), titleSize: z.number().int().min(8).max(24).optional() })).max(200).optional(),
  }).parse(req.body);
  await prisma.homeBlockItem.deleteMany({ where: { blockId: id } });
  if (body.products?.length) {
    await prisma.homeBlockItem.createMany({ data: body.products.map((productId, i) => ({ blockId: id, productId, sortOrder: i })) });
  }
  if (body.entries?.length) {
    await prisma.homeBlockItem.createMany({ data: body.entries.map((e, i) => ({ blockId: id, value: e.value, image: localImage(e.image) || null, title: e.title || null, titleSize: e.titleSize || null, sortOrder: i })) });
  }
  res.json({ ok: true });
});
/** Qo'shimcha maydon qiymatlari (chips bloklari uchun tanlash ro'yxati) */
adminRouter.get("/field-values", async (req, res) => {
  const key = String(req.query.key || "");
  if (!key) { res.json([]); return; }
  const products = await prisma.product.findMany({ where: { isDeleted: false, hidden: false } });
  const counts = new Map<string, number>();
  for (const p of products) {
    const v = valueOf(p, key);
    if (v) counts.set(v, (counts.get(v) || 0) + 1);
  }
  res.json([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "uz")).map(([value, count]) => ({ value, count })));
});

// ---------- Guruhlar va xodimlar ----------
adminRouter.get("/groups", async (_req, res) => { res.json(await prisma.adminGroup.findMany({ orderBy: { createdAt: "desc" } })); });
adminRouter.post("/groups", async (req, res) => {
  const b = z.object({ chatId: z.string().trim().min(3), title: z.string().optional() }).parse(req.body);
  const g = await prisma.adminGroup.upsert({ where: { shopId_chatId: { shopId: currentShopId(), chatId: b.chatId } }, create: { chatId: b.chatId, title: b.title || null, enabled: true }, update: { enabled: true, title: b.title || undefined } });
  res.json(g);
});
adminRouter.put("/groups/:id", async (req, res) => {
  const b = z.object({ enabled: z.boolean() }).parse(req.body);
  res.json(await prisma.adminGroup.update({ where: { id: Number(req.params.id) }, data: b }));
});
adminRouter.delete("/groups/:id", async (req, res) => { await prisma.adminGroup.delete({ where: { id: Number(req.params.id) } }); res.json({ ok: true }); });
adminRouter.post("/groups/:id/test", async (req, res) => {
  const g = await prisma.adminGroup.findUnique({ where: { id: Number(req.params.id) } });
  if (!g) { res.status(404).json({ error: "not found" }); return; }
  try { await botForShop(currentShopId()).api.sendMessage(g.chatId, "✅ Test: bot bu guruhga xabar yubora oladi."); res.json({ ok: true }); }
  catch (e) { res.json({ ok: false, error: errMsg(e) }); }
});
adminRouter.get("/staff", async (_req, res) => { res.json(await prisma.staff.findMany({ orderBy: { createdAt: "desc" } })); });

const staffBody = z.object({
  telegramId: z.string().trim().regex(/^\d+$/, "Telegram ID faqat raqamlardan iborat bo'lishi kerak"),
  name: z.string().max(80).optional(),
  username: z.string().max(80).optional(),
  role: z.string().optional(),
  shareAdmin: z.boolean().optional(),
});

adminRouter.post("/staff", async (req, res) => {
  const b = staffBody.parse(req.body);
  // yangi xodim qo'shilayotgan bo'lsa limitni tekshiramiz
  const exists = await prisma.staff.findFirst({ where: { telegramId: b.telegramId }, select: { id: true } });
  if (!exists && await overLimit(res, "staff")) return;
  const row = await prisma.staff.upsert({
    where: { shopId_telegramId: { shopId: currentShopId(), telegramId: b.telegramId } },
    create: { telegramId: b.telegramId, name: b.name || null, username: b.username || null, role: b.role || "staff", shareAdmin: b.shareAdmin ?? false },
    update: { name: b.name || undefined, username: b.username || undefined, role: b.role || undefined, shareAdmin: b.shareAdmin },
  });
  await refreshShareAdmins();
  res.json(row);
});

/** Xodimni tahrirlash (ID, ism, username, roli, ulashish rejimi) */
adminRouter.put("/staff/:id", async (req, res) => {
  const b = staffBody.partial().parse(req.body);
  if (b.telegramId) {
    const busy = await prisma.staff.findFirst({ where: { telegramId: b.telegramId }, select: { id: true } });
    if (busy && busy.id !== Number(req.params.id)) { res.status(400).json({ error: "Bu Telegram ID allaqachon ro'yxatda bor" }); return; }
  }
  const row = await prisma.staff.update({
    where: { id: Number(req.params.id) },
    data: {
      telegramId: b.telegramId || undefined,
      name: b.name === undefined ? undefined : (b.name || null),
      username: b.username === undefined ? undefined : (b.username || null),
      role: b.role || undefined,
      shareAdmin: b.shareAdmin,
    },
  });
  await refreshShareAdmins();
  res.json(row);
});

adminRouter.delete("/staff/:id", async (req, res) => {
  await prisma.staff.delete({ where: { id: Number(req.params.id) } });
  await refreshShareAdmins();
  res.json({ ok: true });
});

// ---------- Xabar tarqatish ----------
adminRouter.post("/broadcast", async (req, res) => {
  const b = z.object({
    text: z.string().trim().min(1).max(3500),
    media: z.string().optional(),
    mediaType: z.enum(["photo", "video", "document", "animation"]).optional(),
    hd: z.boolean().optional(),
    language: z.enum(["all", "uz", "ru", "en"]).optional(),
    buttonText: z.string().trim().max(60).optional(),
    buttonTarget: z.string().trim().max(300).optional(),
    /** Faqat tugmadagi mahsulotni "Istaklarim"ga qo'shganlarga yuborish */
    onlyFavorites: z.boolean().optional(),
  }).parse(req.body);
  // "Istaklarga qo'shganlar uchun": tugma mahsulotga (product:ID) qaratilgan bo'lishi kerak
  let favUserIds: number[] | null = null;
  if (b.onlyFavorites) {
    const m = /^product:(\d+)$/.exec(b.buttonTarget || "");
    if (!m) { res.status(400).json({ error: "«Istaklarga qo'shganlar uchun» — tugmaga mahsulot tanlang" }); return; }
    const rows = await prisma.favorite.findMany({ where: { productId: Number(m[1]) }, select: { userId: true } });
    favUserIds = rows.map((r) => r.userId);
    if (!favUserIds.length) { res.json({ ok: true, total: 0 }); return; }
  }
  const users = await prisma.user.findMany({ where: { step: "done", isBlocked: false, ...(favUserIds ? { id: { in: favUserIds } } : {}), ...(b.language && b.language !== "all" ? { language: b.language } : {}) } });
  res.json({ ok: true, total: users.length });
  // Tugma: url / product:ID / category:ID → Mini App ichida ochiladi
  const pub = getPublicUrl();
  let markup: InlineKeyboard | undefined;
  if (b.buttonText && b.buttonTarget) {
    const t = b.buttonTarget;
    const kb = new InlineKeyboard();
    if (/^https?:\/\//.test(t)) kb.url(b.buttonText, t);
    else if (pub) kb.webApp(b.buttonText, `${pub}/app/?go=${encodeURIComponent(t)}`);
    if (kb.inline_keyboard.length) markup = kb;
  }
  const mediaName = b.media ? path.basename(b.media) : null;
  const dbFile = mediaName ? await prisma.upload.findUnique({ where: { name: mediaName } }) : null;
  const diskPath = mediaName ? path.join(env.UPLOADS_DIR, mediaName) : null;
  const file: InputFile | null = dbFile ? new InputFile(Buffer.from(dbFile.data), dbFile.name) : diskPath && fs.existsSync(diskPath) ? new InputFile(diskPath) : null;
  const isVideo = mediaName ? /[.](mp4|webm|mov)$/i.test(mediaName) : false;
  const isGif = mediaName ? /[.]gif$/i.test(mediaName) : false;
  const type = b.mediaType || (isVideo ? "video" : isGif ? "animation" : b.hd ? "document" : "photo");
  let sent = 0;
  let fileId: string | null = null;
  (async () => {
    for (const usr of users) {
      try {
        const chat = String(usr.telegramId);
        const media = fileId || file;
        const opts = { caption: b.text, parse_mode: "HTML" as const, reply_markup: markup };
        let m: { photo?: { file_id: string }[]; video?: { file_id: string }; document?: { file_id: string }; animation?: { file_id: string } } | null = null;
        if (!media) await botForShop(currentShopId()).api.sendMessage(chat, b.text, { parse_mode: "HTML", reply_markup: markup, link_preview_options: { is_disabled: true } });
        else if (type === "video") m = await botForShop(currentShopId()).api.sendVideo(chat, media, { ...opts, supports_streaming: true });
        else if (type === "animation") m = await botForShop(currentShopId()).api.sendAnimation(chat, media, opts);
        else if (type === "document") m = await botForShop(currentShopId()).api.sendDocument(chat, media, opts);
        else m = await botForShop(currentShopId()).api.sendPhoto(chat, media, opts);
        // Telegram'ga bir marta yuklab, keyin file_id bilan yuborish (tez va sifatli)
        if (m && !fileId) fileId = m.video?.file_id || m.document?.file_id || m.animation?.file_id || m.photo?.[m.photo.length - 1]?.file_id || null;
        sent++;
      } catch (e) { log.warn("broadcast", errMsg(e)); }
      await new Promise((r) => setTimeout(r, 50));
    }
    await activity("broadcast", `Xabar tarqatildi: ${sent}/${users.length}`);
  })().catch(() => {});
});

/** Havola tanlash uchun mahsulot/kategoriya ro'yxati (id + nom) */
adminRouter.get("/picker", async (_req, res) => {
  const [products, categories] = await Promise.all([
    prisma.product.findMany({ where: { isDeleted: false }, select: { id: true, name: true, bitoId: true, categoryName: true }, orderBy: { name: "asc" } }),
    prisma.category.findMany({ where: { isDeleted: false }, select: { bitoId: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  res.json({ products: products.map((p) => ({ id: p.id, name: p.name, category: p.categoryName })), categories: categories.map((c) => ({ id: c.bitoId, name: c.name })) });
});

// ---------- Foydalanuvchilar statistikasi ----------
adminRouter.get("/users/summary", async (_req, res) => {
  const [total, registered, linked, blocked] = await Promise.all([
    prisma.user.count(), prisma.user.count({ where: { step: "done" } }), prisma.user.count({ where: { bitoCustomerId: { not: null } } }), prisma.user.count({ where: { isBlocked: true } }),
  ]);
  res.json({ total, registered, linked, blocked });
});

adminRouter.post("/settings/reload", async (_req, res) => { await loadSettings(); res.json({ ok: true }); });

adminRouter.use((err: unknown, _req: Request, res: Response, _next: unknown) => {
  if (err instanceof z.ZodError) { res.status(400).json({ error: "Ma'lumotlar noto'g'ri: " + err.issues.map((i) => i.path.join(".") + " " + i.message).join("; ") }); return; }
  log.error("admin api", err);
  res.status(500).json({ error: errMsg(err) });
});
