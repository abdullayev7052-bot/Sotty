import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { User } from "@prisma/client";
import { env } from "../env.ts";
import { prisma, currentShopId, runWithShop, DEFAULT_SHOP_ID } from "../db.ts";
import { normalizeLang, getSettings } from "../settings/store.ts";
import { tokenForShop, shopIdBySlug, botForShop } from "../bot/manager.ts";
import { isShopInactive } from "../erp/limits.ts";
import { touchUser } from "../analytics/track.ts";
import { normalizePhone } from "../utils/format.ts";
import { errMsg } from "../logger.ts";

export interface TgInitUser { id: number; first_name?: string; last_name?: string; username?: string; language_code?: string }

/** So'rovdan do'kon (shopId) ni aniqlash: X-Shop sarlavhasi yoki ?shop=<slug> */
export async function resolveShopId(req: Request): Promise<number> {
  const slug = String(req.header("x-shop") || req.query.shop || "").trim();
  if (!slug || slug === "main") return DEFAULT_SHOP_ID;
  const cached = shopIdBySlug(slug);
  if (cached) return cached;
  const shop = await prisma.shop.findUnique({ where: { slug } }).catch(() => null);
  return shop?.id ?? DEFAULT_SHOP_ID;
}

/** Barcha so'rovni do'kon konteksti ichida ishlatuvchi middleware */
export async function shopContext(req: Request, _res: Response, next: NextFunction) {
  const shopId = await resolveShopId(req);
  runWithShop(shopId, () => next());
}

/** Telegram Mini App initData imzosini tekshirish (do'kon bot tokeni bilan) */
export function verifyInitData(initData: string, token: string): TgInitUser | null {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;
    params.delete("hash");
    const pairs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`);
    const secret = createHmac("sha256", "WebAppData").update(token).digest();
    const calc = createHmac("sha256", secret).update(pairs.join("\n")).digest("hex");
    const a = Buffer.from(calc, "hex"), b = Buffer.from(hash, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const authDate = Number(params.get("auth_date") || 0);
    if (!authDate || Date.now() / 1000 - authDate > 60 * 60 * 24 * 3) return null;
    const user = JSON.parse(params.get("user") || "null");
    if (!user || !user.id) return null;
    return user as TgInitUser;
  } catch {
    return null;
  }
}

export interface AppRequest extends Request {
  user: User;
}

/** Mini App uchun autentifikatsiya: Authorization: tma <initData> */
export async function appAuth(req: Request, res: Response, next: NextFunction) {
  const shopId = await resolveShopId(req);
  if (shopId !== DEFAULT_SHOP_ID) {
    const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { active: true, suspended: true, paidUntil: true, tariff: true } });
    if (!shop || isShopInactive(shop)) { res.status(403).json({ error: "Do'kon vaqtincha ishlamayapti", code: "shop_inactive" }); return; }
  }
  const header = req.header("authorization") || "";
  let tg: TgInitUser | null = null;
  if (header.startsWith("tma ")) tg = verifyInitData(header.slice(4), tokenForShop(shopId));
  if (!tg && env.ALLOW_DEV_AUTH) {
    const dev = req.header("x-dev-user") || (req.query.dev_user as string);
    if (dev && /^\d+$/.test(dev)) tg = { id: Number(dev), first_name: "Dev" };
  }
  if (!tg) { res.status(401).json({ error: "unauthorized" }); return; }
  const tgId = BigInt(tg.id);
  await runWithShop(shopId, async () => {
    let user = await prisma.user.findFirst({ where: { telegramId: tgId } });
    if (!user) {
      user = await prisma.user.create({
        data: { telegramId: tgId, tgUsername: tg!.username || null, tgFirstName: tg!.first_name || null, language: getSettings().general.languageMode === "telegram" ? normalizeLang(tg!.language_code?.slice(0, 2)) : normalizeLang(undefined) },
      });
    }
    (req as AppRequest).user = user;
    touchUser(user.id);
    next();
  });
}

// ---------------- Admin ----------------

const COOKIE_BASE = "admin_token";
/** Har do'kon uchun alohida cookie — bitta brauzerda bir nechta do'konga bir vaqtda kirish mumkin bo'lsin
 *  (umumiy bitta cookie bo'lsa, bir do'konga kirish boshqasidan chiqarib yuborardi). */
function adminCookieName(shopId: number): string { return `${COOKIE_BASE}_${shopId}`; }

export async function getAdminPasswordHash(): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { shopId_key: { shopId: currentShopId(), key: "auth" } } });
  const v = row?.value as { passwordHash?: string } | null;
  if (v?.passwordHash) return v.passwordHash;
  return bcrypt.hashSync(env.ADMIN_PASSWORD, 8);
}

export const ADMIN_PASSWORD_MIN = 6;

export async function setAdminPassword(password: string) {
  if (!password || password.length < ADMIN_PASSWORD_MIN) throw new Error(`Parol kamida ${ADMIN_PASSWORD_MIN} ta belgidan iborat bo'lishi kerak`);
  const passwordHash = bcrypt.hashSync(password, 10);
  const sid = currentShopId();
  await prisma.setting.upsert({ where: { shopId_key: { shopId: sid, key: "auth" } }, create: { shopId: sid, key: "auth", value: { passwordHash } }, update: { value: { passwordHash } } });
}

/** Do'konga biriktirilgan telefon raqami (login identifikatori). Bo'sh bo'lsa — hali ulanmagan. */
async function shopOwnerPhone(shopId: number): Promise<string> {
  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { ownerPhone: true } });
  return normalizePhone(shop?.ownerPhone || "");
}

export async function adminLogin(req: Request, res: Response) {
  const b = (req.body || {}) as { phone?: string; password?: string };
  const password = String(b.password || "");
  const sid = currentShopId();
  // Xavfsizlik: do'konga telefon biriktirilgan bo'lsa — login raqami aynan mos kelishi SHART.
  const storedPhone = await shopOwnerPhone(sid);
  if (storedPhone) {
    const given = normalizePhone(String(b.phone || ""));
    if (!given || given !== storedPhone) { res.status(401).json({ error: "Bu telefon raqami bu do'konga biriktirilmagan" }); return; }
  }
  const hash = await getAdminPasswordHash();
  if (!password || !bcrypt.compareSync(password, hash)) { res.status(401).json({ error: "Parol noto'g'ri" }); return; }
  // Admin faqat o'z do'koniga bog'lanadi (ko'p-do'kon izolyatsiyasi)
  const token = jwt.sign({ role: "admin", shopId: sid }, env.JWT_SECRET, { expiresIn: "7d" });
  res.cookie(adminCookieName(sid), token, { httpOnly: true, sameSite: "lax", maxAge: 7 * 24 * 3600 * 1000, path: "/" });
  res.json({ ok: true });
}

/** Parolni unutish: do'kon raqamiga do'kon boti orqali 6 xonali kod yuboriladi */
export async function adminForgot(req: Request, res: Response) {
  const sid = currentShopId();
  const storedPhone = await shopOwnerPhone(sid);
  const given = normalizePhone(String((req.body as { phone?: string })?.phone || ""));
  if (!storedPhone || !given || given !== storedPhone) { res.status(400).json({ error: "Bu telefon raqami bu do'konga biriktirilmagan" }); return; }
  // Egasini bot foydalanuvchisi sifatida topamiz (kod yuborish uchun telegramId kerak)
  const owner = await prisma.user.findFirst({ where: { phone: storedPhone }, select: { telegramId: true } });
  if (!owner) { res.status(400).json({ error: "Avval do'kon botini oching, /start bosib telefon raqamingizni ulang" }); return; }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const value = { codeHash: bcrypt.hashSync(code, 8), expiresAt: Date.now() + 10 * 60 * 1000, attempts: 0 };
  await prisma.setting.upsert({ where: { shopId_key: { shopId: sid, key: "pwreset" } }, create: { shopId: sid, key: "pwreset", value }, update: { value } });
  try {
    await botForShop(sid).api.sendMessage(Number(owner.telegramId), `🔐 Admin parolni tiklash kodi: <b>${code}</b>\n\nKod 10 daqiqa amal qiladi. Agar bu so'rovni siz yubormagan bo'lsangiz — e'tiborsiz qoldiring.`, { parse_mode: "HTML" });
  } catch (e) { res.status(500).json({ error: "Kod yuborib bo'lmadi: " + errMsg(e) }); return; }
  res.json({ ok: true });
}

/** Kod va yangi parol bilan tiklash */
export async function adminReset(req: Request, res: Response) {
  const sid = currentShopId();
  const b = (req.body || {}) as { phone?: string; code?: string; newPassword?: string };
  const storedPhone = await shopOwnerPhone(sid);
  const given = normalizePhone(String(b.phone || ""));
  if (!storedPhone || given !== storedPhone) { res.status(400).json({ error: "Telefon raqami noto'g'ri" }); return; }
  const row = await prisma.setting.findUnique({ where: { shopId_key: { shopId: sid, key: "pwreset" } } });
  const v = row?.value as { codeHash?: string; expiresAt?: number; attempts?: number } | null;
  if (!v?.codeHash || !v.expiresAt || Date.now() > v.expiresAt) { res.status(400).json({ error: "Kod muddati tugagan. Qaytadan so'rang." }); return; }
  if ((v.attempts || 0) >= 5) { res.status(400).json({ error: "Juda ko'p urinish. Qaytadan kod so'rang." }); return; }
  if (!b.code || !bcrypt.compareSync(String(b.code), v.codeHash)) {
    await prisma.setting.update({ where: { shopId_key: { shopId: sid, key: "pwreset" } }, data: { value: { ...v, attempts: (v.attempts || 0) + 1 } } });
    res.status(400).json({ error: "Kod noto'g'ri" }); return;
  }
  const np = String(b.newPassword || "");
  if (np.length < ADMIN_PASSWORD_MIN) { res.status(400).json({ error: `Parol kamida ${ADMIN_PASSWORD_MIN} ta belgi bo'lishi kerak` }); return; }
  await setAdminPassword(np);
  await prisma.setting.delete({ where: { shopId_key: { shopId: sid, key: "pwreset" } } }).catch(() => {});
  res.json({ ok: true });
}

export function adminLogout(_req: Request, res: Response) {
  res.clearCookie(adminCookieName(currentShopId()), { path: "/" });
  res.json({ ok: true });
}

export function adminAuth(req: Request, res: Response, next: NextFunction) {
  const token = (req as Request & { cookies?: Record<string, string> }).cookies?.[adminCookieName(currentShopId())] || (req.header("authorization") || "").replace(/^Bearer /, "");
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { role?: string; shopId?: number };
    if (payload.role !== "admin") throw new Error("no");
    // Boshqa do'kon ma'lumotiga kira olmaydi: token do'koni = so'rov do'koni bo'lishi shart
    if ((payload.shopId ?? DEFAULT_SHOP_ID) !== currentShopId()) throw new Error("wrong shop");
    next();
  } catch {
    res.status(401).json({ error: "unauthorized" });
  }
}

// ---------------- Super-admin (platforma) ----------------

const SUPER_COOKIE = "super_token";

export function superLogin(req: Request, res: Response) {
  // Google sozlangan bo'lsa — parol bilan kirish o'chiq (faqat Google orqali)
  if (env.GOOGLE_CLIENT_ID) { res.status(403).json({ error: "Faqat Google orqali kiring" }); return; }
  const password = String((req.body as { password?: string })?.password || "");
  if (!password || password !== env.SUPER_ADMIN_PASSWORD) { res.status(401).json({ error: "Parol noto'g'ri" }); return; }
  const token = jwt.sign({ role: "super" }, env.JWT_SECRET, { expiresIn: "7d" });
  res.cookie(SUPER_COOKIE, token, { httpOnly: true, sameSite: "lax", maxAge: 7 * 24 * 3600 * 1000, path: "/" });
  res.json({ ok: true });
}

/** Super-admin Google Sign-In: faqat ruxsat etilgan gmail (env.SUPER_ADMIN_EMAIL) kira oladi */
export async function superGoogle(req: Request, res: Response) {
  const idToken = String((req.body as { credential?: string })?.credential || "");
  if (!idToken) { res.status(400).json({ error: "Token yo'q" }); return; }
  try {
    const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken));
    const d = (await r.json().catch(() => ({}))) as { aud?: string; email?: string; email_verified?: string | boolean };
    if (!r.ok || !d.email) { res.status(401).json({ error: "Google tasdiqlamadi" }); return; }
    if (env.GOOGLE_CLIENT_ID && d.aud !== env.GOOGLE_CLIENT_ID) { res.status(401).json({ error: "Ilova (Client ID) mos emas" }); return; }
    const email = String(d.email).toLowerCase();
    const verified = d.email_verified === true || d.email_verified === "true";
    if (!verified || email !== env.SUPER_ADMIN_EMAIL) { res.status(403).json({ error: "Bu Google akkaunti ruxsat etilmagan" }); return; }
    const token = jwt.sign({ role: "super", email }, env.JWT_SECRET, { expiresIn: "7d" });
    res.cookie(SUPER_COOKIE, token, { httpOnly: true, sameSite: "lax", maxAge: 7 * 24 * 3600 * 1000, path: "/" });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: errMsg(e) }); }
}

export function superLogout(_req: Request, res: Response) {
  res.clearCookie(SUPER_COOKIE, { path: "/" });
  res.json({ ok: true });
}

export function superAuth(req: Request, res: Response, next: NextFunction) {
  const token = (req as Request & { cookies?: Record<string, string> }).cookies?.[SUPER_COOKIE] || (req.header("authorization") || "").replace(/^Bearer /, "");
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { role?: string };
    if (payload.role !== "super") throw new Error("no");
    next();
  } catch {
    res.status(401).json({ error: "unauthorized" });
  }
}
