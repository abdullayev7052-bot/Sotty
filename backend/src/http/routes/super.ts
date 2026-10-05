import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../../db.ts";
import { superAuth, superLogin, superLogout } from "../auth.ts";
import { startShopBot, stopShopBot } from "../../bot/manager.ts";
import { errMsg, log } from "../../logger.ts";

/** Do'kon holatiga qarab botini ishga tushirish yoki to'xtatish */
async function syncShopBot(shopId: number) {
  const s = await prisma.shop.findUnique({ where: { id: shopId } });
  if (s && s.active && !s.suspended && s.botToken) await startShopBot(s.id, s.slug, s.botToken);
  else await stopShopBot(shopId);
}

export const superRouter = Router();

superRouter.post("/login", superLogin);
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
  paidUntil: z.string().nullable().optional(),
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
    if (b.paidUntil !== undefined) data.paidUntil = b.paidUntil ? new Date(b.paidUntil) : null;
    const shop = await prisma.shop.update({ where: { id: Number(req.params.id) }, data });
    if (shop.id !== 1) void syncShopBot(shop.id);
    res.json({ ok: true, id: shop.id });
  } catch (e) { res.status(400).json({ error: errMsg(e) }); }
});

superRouter.delete("/shops/:id", async (req, res) => {
  try { const id = Number(req.params.id); if (id !== 1) await stopShopBot(id); await prisma.shop.delete({ where: { id } }); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: errMsg(e) }); }
});

superRouter.use((err: unknown, _req: Request, res: Response, _next: unknown) => {
  if (err instanceof z.ZodError) { res.status(400).json({ error: "Ma'lumotlar noto'g'ri" }); return; }
  log.error("super api", err);
  res.status(500).json({ error: errMsg(err) });
});
