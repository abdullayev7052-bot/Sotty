/**
 * Do'kon egalari uchun ochiq ro'yxatdan o'tish (self-service).
 * Egasi ma'lumot + bot tokenini kiritadi — do'kon yaratiladi, bot darhol ishga tushadi.
 */
import { Router } from "express";
import { Bot } from "grammy";
import { z } from "zod";
import { prisma, runWithShop } from "../../db.ts";
import { setAdminPassword } from "../auth.ts";
import { normalizePhone } from "../../utils/format.ts";
import { startShopBot } from "../../bot/manager.ts";
import { errMsg, log } from "../../logger.ts";

export const registerRouter = Router();

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/['’ʻ`]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "dokon";
}
async function uniqueSlug(base: string): Promise<string> {
  const slug = slugify(base);
  for (let i = 0; i < 50; i++) {
    const c = i === 0 ? slug : `${slug}-${i + 1}`;
    if (!(await prisma.shop.findUnique({ where: { slug: c }, select: { id: true } }))) return c;
  }
  return `${slug}-${Date.now()}`;
}

const body = z.object({
  name: z.string().trim().min(2).max(120),
  ownerName: z.string().trim().max(120).optional(),
  ownerPhone: z.string().trim().min(7, "Telefon raqamini kiriting").max(40),
  botToken: z.string().trim().regex(/^\d{6,}:[A-Za-z0-9_-]{30,}$/, "Bot tokeni noto'g'ri"),
  adminPassword: z.string().min(6, "Parol kamida 6 ta belgidan iborat bo'lishi kerak").max(100),
  tariff: z.enum(["free", "basic", "pro"]).optional(),
});

registerRouter.post("/", async (req, res) => {
  const parsed = body.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message || "Ma'lumotlar noto'g'ri" }); return; }
  const b = parsed.data;
  const ownerPhone = normalizePhone(b.ownerPhone);
  if (!ownerPhone) { res.status(400).json({ error: "Telefon raqami noto'g'ri" }); return; }
  // Bir xil token bilan allaqachon do'kon bormi
  if (await prisma.shop.findFirst({ where: { botToken: b.botToken }, select: { id: true } })) {
    res.status(400).json({ error: "Bu bot allaqachon ro'yxatdan o'tgan" }); return;
  }
  // Tokenni tekshirish (BotFather)
  let username = "";
  try { const me = await new Bot(b.botToken).api.getMe(); username = me.username || ""; }
  catch { res.status(400).json({ error: "Bot tokeni ishlamadi. BotFather'dan to'g'ri token oling." }); return; }

  try {
    const slug = await uniqueSlug(b.name);
    const shop = await prisma.shop.create({ data: {
      slug, name: b.name, ownerName: b.ownerName || null, ownerPhone,
      botToken: b.botToken, botUsername: username, tariff: b.tariff || "free", active: true, suspended: false,
    } });
    // Do'kon admin paroli + umumiy sozlamalarni ro'yxatdan boshlab to'ldiramiz
    await runWithShop(shop.id, async () => {
      await setAdminPassword(b.adminPassword);
      // Do'kon nomi 3 tilga nusxalanadi; aloqa telefoni ro'yxatdan olingan raqam bilan boshlanadi
      const general = { shopName: { uz: b.name, ru: b.name, en: b.name }, supportPhone: ownerPhone };
      await prisma.setting.upsert({ where: { shopId_key: { shopId: shop.id, key: "general" } }, create: { shopId: shop.id, key: "general", value: general }, update: { value: general } });
    });
    await startShopBot(shop.id, slug, b.botToken);
    log.info(`🆕 Yangi do'kon ro'yxatdan o'tdi: ${b.name} (@${username})`);
    res.json({ ok: true, slug, botUsername: username, adminUrl: `/admin/?shop=${slug}`, appUrl: `/app/?shop=${slug}` });
  } catch (e) { res.status(500).json({ error: errMsg(e) }); }
});
