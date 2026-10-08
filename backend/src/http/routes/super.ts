import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma, runWithShop } from "../../db.ts";
import { superAuth, superLogin, superLogout, superGoogle, setAdminPassword } from "../auth.ts";
import { env } from "../../env.ts";
import { normalizePhone } from "../../utils/format.ts";
import { DEFAULT_SHOP_ID } from "../../db.ts";
import { startShopBot, stopShopBot } from "../../bot/manager.ts";
import { clearTariffCache } from "../../erp/limits.ts";
import { errMsg, log } from "../../logger.ts";

/** Do'kon holatiga qarab botini ishga tushirish yoki to'xtatish */
async function syncShopBot(shopId: number) {
  clearTariffCache(shopId);
  const s = await prisma.shop.findUnique({ where: { id: shopId } });
  if (s && s.active && !s.suspended && s.botToken) await startShopBot(s.id, s.slug, s.botToken);
  else await stopShopBot(shopId);
}

export const superRouter = Router();

// Ochiq (autentifikatsiyasiz) endpointlar
superRouter.get("/config", (_req, res) => { res.json({ google: env.GOOGLE_CLIENT_ID || null, email: env.SUPER_ADMIN_EMAIL }); });
superRouter.post("/login", superLogin);
superRouter.post("/google", superGoogle);
superRouter.post("/logout", superLogout);
superRouter.use(superAuth);
superRouter.get("/me", (_req, res) => { res.json({ ok: true }); });

/** Platforma umumiy ko'rsatkichlari */
superRouter.get("/stats", async (_req, res) => {
  const [shops, active, suspended, users, orders] = await Promise.all([
    prisma.shop.count(), prisma.shop.count({ where: { active: true, suspended: false } }), prisma.shop.count({ where: { suspended: true } }),
    prisma.user.count(), prisma.order.count(),
  ]);
  res.json({ shops, active, suspended, users, orders });
});

function slugify(s: string): string {
  return s.toLowerCase().trim()
    .replace(/['’ʻ`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "dokon";
}

const shopBody = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().max(40).optional(),
  ownerName: z.string().max(120).nullable().optional(),
  ownerPhone: z.string().max(40).nullable().optional(),
  botToken: z.string().max(120).nullable().optional(),
  botUsername: z.string().max(80).nullable().optional(),
  tariff: z.enum(["free", "basic", "pro"]).optional(),
  active: z.boolean().optional(),
  suspended: z.boolean().optional(),
  note: z.string().max(500).nullable().optional(),
  tariffStart: z.string().nullable().optional(),
  paidUntil: z.string().nullable().optional(),
  deviceLimit: z.number().int().min(1).max(100).optional(),
});

superRouter.get("/shops", async (_req, res) => {
  const shops = await prisma.shop.findMany({ orderBy: { createdAt: "desc" } });
  // Bot tokenni to'liq ko'rsatmaymiz (xavfsizlik) — faqat oxirgi 6 belgi
  res.json(shops.map((s) => ({ ...s, botToken: s.botToken ? "••••••" + s.botToken.slice(-6) : null, hasToken: !!s.botToken })));
});

async function uniqueSlug(base: string, excludeId?: number): Promise<string> {
  let slug = slugify(base);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? slug : `${slug}-${i + 1}`;
    const existing = await prisma.shop.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing || existing.id === excludeId) return candidate;
  }
  return `${slug}-${Date.now()}`;
}

superRouter.post("/shops", async (req, res) => {
  try {
    const b = shopBody.parse(req.body);
    const slug = await uniqueSlug(b.slug || b.name);
    const shop = await prisma.shop.create({
      data: {
        slug, name: b.name, ownerName: b.ownerName || null, ownerPhone: b.ownerPhone || null,
        botToken: b.botToken?.trim() || null, botUsername: b.botUsername?.trim() || null,
        tariff: b.tariff || "free", active: b.active ?? true, suspended: b.suspended ?? false,
        note: b.note || null, paidUntil: b.paidUntil ? new Date(b.paidUntil) : null,
      },
    });
    if (shop.id !== 1) void syncShopBot(shop.id);
    res.json({ ok: true, id: shop.id, slug: shop.slug });
  } catch (e) { res.status(400).json({ error: errMsg(e) }); }
});

superRouter.put("/shops/:id", async (req, res) => {
  try {
    const b = shopBody.partial().parse(req.body);
    const data: Record<string, unknown> = {};
    if (b.name !== undefined) data.name = b.name;
    if (b.slug !== undefined && b.slug) data.slug = await uniqueSlug(b.slug, Number(req.params.id));
    if (b.ownerName !== undefined) data.ownerName = b.ownerName || null;
    if (b.ownerPhone !== undefined) data.ownerPhone = b.ownerPhone || null;
    // Bo'sh/yulduzcha token yuborilsa — o'zgartirmaymiz
    if (b.botToken !== undefined && b.botToken && !b.botToken.startsWith("••••")) data.botToken = b.botToken.trim();
    if (b.botUsername !== undefined) data.botUsername = b.botUsername?.trim() || null;
    if (b.tariff !== undefined) data.tariff = b.tariff;
    if (b.active !== undefined) data.active = b.active;
    if (b.suspended !== undefined) data.suspended = b.suspended;
    if (b.note !== undefined) data.note = b.note || null;
    if (b.tariffStart !== undefined) data.tariffStart = b.tariffStart ? new Date(b.tariffStart) : null;
    if (b.paidUntil !== undefined) data.paidUntil = b.paidUntil ? new Date(b.paidUntil) : null;
    if (b.deviceLimit !== undefined) data.deviceLimit = b.deviceLimit;
    const shop = await prisma.shop.update({ where: { id: Number(req.params.id) }, data });
    if (shop.id !== 1) void syncShopBot(shop.id);
    res.json({ ok: true, id: shop.id });
  } catch (e) { res.status(400).json({ error: errMsg(e) }); }
});

superRouter.delete("/shops/:id", async (req, res) => {
  try { const id = Number(req.params.id); if (id !== 1) await stopShopBot(id); await prisma.adminSession.deleteMany({ where: { shopId: id } }); await prisma.shopPayment.deleteMany({ where: { shopId: id } }); await prisma.shop.delete({ where: { id } }); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: errMsg(e) }); }
});

/** Do'kon batafsil ko'rinishi: ko'rsatkichlar, qurilmalar, bo'lim faolligi, to'lovlar */
superRouter.get("/shops/:id", async (req, res) => {
  const id = Number(req.params.id);
  const shop = await prisma.shop.findUnique({ where: { id } });
  if (!shop) { res.status(404).json({ error: "Do'kon topilmadi" }); return; }
  const [users, customers, products, orders, ordersAgg, sections] = await runWithShop(id, () => Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { step: "done" } }),
    prisma.product.count({ where: { isDeleted: false } }),
    prisma.order.count(),
    prisma.order.aggregate({ _sum: { total: true } }),
    prisma.activityLog.groupBy({ by: ["type"], _count: { _all: true } }),
  ]));
  const [devices, payments, authRow] = await Promise.all([
    prisma.adminSession.count({ where: { shopId: id } }),
    prisma.shopPayment.findMany({ where: { shopId: id }, orderBy: { createdAt: "desc" }, take: 20 }),
    runWithShop(id, () => prisma.setting.findUnique({ where: { shopId_key: { shopId: id, key: "auth" } }, select: { key: true } })),
  ]);
  // Login diagnostikasi: aynan qaysi telefon raqami bilan kiriladi va parol o'rnatilganmi
  let loginPhone = normalizePhone(shop.ownerPhone || "");
  if (!loginPhone && id === DEFAULT_SHOP_ID && env.ADMIN_PHONE) loginPhone = normalizePhone(env.ADMIN_PHONE);
  const hasPassword = !!authRow || id === DEFAULT_SHOP_ID;
  res.json({
    shop: { ...shop, botToken: shop.botToken ? "••••••" + shop.botToken.slice(-6) : null, hasToken: !!shop.botToken },
    counts: { users, customers, products, orders, revenue: ordersAgg._sum.total || 0, devices },
    login: { phone: loginPhone || null, hasPassword },
    sections: sections.map((r) => ({ type: r.type, count: r._count._all })).sort((a, b) => b.count - a.count),
    payments,
  });
});

/** Do'kon faoliyati (loglar) */
superRouter.get("/shops/:id/logs", async (req, res) => {
  const id = Number(req.params.id);
  const logs = await runWithShop(id, () => prisma.activityLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 }));
  res.json(logs);
});

/** Qurilmalar (sessiyalar) ro'yxati */
superRouter.get("/shops/:id/devices", async (req, res) => {
  const devices = await prisma.adminSession.findMany({ where: { shopId: Number(req.params.id) }, orderBy: { lastSeenAt: "desc" } });
  res.json(devices);
});

/** Qurilmani (sessiyani) bekor qilish — super-admin */
superRouter.delete("/shops/:id/devices/:sid", async (req, res) => {
  await prisma.adminSession.deleteMany({ where: { id: String(req.params.sid), shopId: Number(req.params.id) } });
  res.json({ ok: true });
});

/** Do'kon admin parolini tiklash (super-admin yangisini o'rnatadi) */
superRouter.post("/shops/:id/password", async (req, res) => {
  const id = Number(req.params.id);
  const pw = String((req.body as { password?: string })?.password || "");
  try {
    await runWithShop(id, () => setAdminPassword(pw));
    // Barcha eski sessiyalarni bekor qilamiz (yangi parol bilan qayta kirsin)
    await prisma.adminSession.deleteMany({ where: { shopId: id } });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: errMsg(e) }); }
});

/** Obuna to'lovlari tarixi */
superRouter.get("/shops/:id/payments", async (req, res) => {
  res.json(await prisma.shopPayment.findMany({ where: { shopId: Number(req.params.id) }, orderBy: { createdAt: "desc" } }));
});

/** To'lov qo'shish (ixtiyoriy: tarif muddatini uzaytiradi) */
superRouter.post("/shops/:id/payments", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const b = z.object({ amount: z.number().min(0), tariff: z.string().max(20).optional(), months: z.number().int().min(1).max(60).optional(), note: z.string().max(300).optional(), extend: z.boolean().optional() }).parse(req.body);
    const pay = await prisma.shopPayment.create({ data: { shopId: id, amount: b.amount, tariff: b.tariff || "", months: b.months || 1, note: b.note || null } });
    if (b.extend) {
      const shop = await prisma.shop.findUnique({ where: { id } });
      const base = shop?.paidUntil && shop.paidUntil > new Date() ? new Date(shop.paidUntil) : new Date();
      base.setMonth(base.getMonth() + (b.months || 1));
      await prisma.shop.update({ where: { id }, data: { paidUntil: base, tariffStart: shop?.tariffStart || new Date(), suspended: false } });
      if (id !== 1) void syncShopBot(id);
    }
    res.json({ ok: true, id: pay.id });
  } catch (e) { res.status(400).json({ error: errMsg(e) }); }
});

superRouter.use((err: unknown, _req: Request, res: Response, _next: unknown) => {
  if (err instanceof z.ZodError) { res.status(400).json({ error: "Ma'lumotlar noto'g'ri" }); return; }
  log.error("super api", err);
  res.status(500).json({ error: errMsg(err) });
});
