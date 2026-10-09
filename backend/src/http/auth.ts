import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { User } from "@prisma/client";
import { env } from "../env.ts";
import { prisma, currentShopId, runWithShop, DEFAULT_SHOP_ID } from "../db.ts";
import { normalizeLang } from "../settings/store.ts";
import { tokenForShop, shopIdBySlug, botForShop } from "../bot/manager.ts";
import { isShopInactive } from "../erp/limits.ts";
import { touchUser } from "../analytics/track.ts";
import { normalizePhone } from "../utils/format.ts";
import { errMsg, log } from "../logger.ts";

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
        data: { telegramId: tgId, tgUsername: tg!.username || null, tgFirstName: tg!.first_name || null, language: normalizeLang(undefined) },
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

export async function getAdminPasswordHash(): Promise<string | null> {
  const sid = currentShopId();
  const row = await prisma.setting.findUnique({ where: { shopId_key: { shopId: sid, key: "auth" } } });
  const v = row?.value as { passwordHash?: string } | null;
  if (v?.passwordHash) return v.passwordHash;
  // XAVFSIZLIK: umumiy zaxira parol YO'Q. Faqat asosiy (platforma) do'koni uchun env.ADMIN_PASSWORD
  // zaxira bo'ladi; boshqa har bir do'kon O'Z parolига ega bo'lishi SHART (admin123 boshqa
  // do'konlarda ishlamaydi). O'z paroli yo'q bo'lsa — kirish mumkin emas.
  if (sid === DEFAULT_SHOP_ID) return bcrypt.hashSync(env.ADMIN_PASSWORD, 8);
  return null;
}

export const ADMIN_PASSWORD_MIN = 6;

/** Joriy do'kon paroli to'g'riligini tekshirish (eski parolni so'rashda) */
export async function verifyAdminPassword(password: string): Promise<boolean> {
  if (!password) return false;
  const hash = await getAdminPasswordHash();
  return !!hash && bcrypt.compareSync(password, hash);
}

export async function setAdminPassword(password: string) {
  if (!password || password.length < ADMIN_PASSWORD_MIN) throw new Error(`Parol kamida ${ADMIN_PASSWORD_MIN} ta belgidan iborat bo'lishi kerak`);
  const passwordHash = bcrypt.hashSync(password, 10);
  const sid = currentShopId();
  await prisma.setting.upsert({ where: { shopId_key: { shopId: sid, key: "auth" } }, create: { shopId: sid, key: "auth", value: { passwordHash } }, update: { value: { passwordHash } } });
}

/** Login = TELEFON: raqam bo'yicha do'konni topamiz (URL'dagi ?shop muhim emas).
 *  ownerPhone normalizatsiya bilan solishtiriladi; main uchun ADMIN_PHONE zaxira. */
async function shopByPhone(phone: string): Promise<{ id: number; slug: string; deviceLimit: number } | null> {
  if (!phone) return null;
  const shops = await prisma.shop.findMany({ select: { id: true, slug: true, ownerPhone: true, deviceLimit: true } });
  for (const s of shops) if (normalizePhone(s.ownerPhone || "") === phone) return { id: s.id, slug: s.slug, deviceLimit: s.deviceLimit };
  if (env.ADMIN_PHONE && normalizePhone(env.ADMIN_PHONE) === phone) {
    const main = shops.find((s) => s.id === DEFAULT_SHOP_ID);
    if (main) return { id: main.id, slug: main.slug, deviceLimit: main.deviceLimit };
  }
  return null;
}

export async function adminLogin(req: Request, res: Response) {
  const b = (req.body || {}) as { phone?: string; password?: string };
  const password = String(b.password || "");
  const given = normalizePhone(String(b.phone || ""));
  const fail = () => res.status(401).json({ error: "Telefon raqami yoki parol noto'g'ri" });
  if (!given || !password) { fail(); return; }
  // Telefon bo'yicha do'konni topamiz — qaysi do'konga tegishli bo'lsa, o'shanga kiritamiz
  const target = await shopByPhone(given);
  if (!target) { fail(); return; }
  const hash = await runWithShop(target.id, () => getAdminPasswordHash());
  if (!hash || !bcrypt.compareSync(password, hash)) { fail(); return; }
  // jti — sessiya (qurilma) kaliti; token o'sha do'konga bog'lanadi
  const jti = randomUUID();
  const token = jwt.sign({ role: "admin", shopId: target.id, jti }, env.JWT_SECRET, { expiresIn: "7d" });
  try {
    const { device, ip } = deviceInfo(req);
    await prisma.adminSession.create({ data: { shopId: target.id, jti, device, ip } });
    const limit = Math.max(1, target.deviceLimit ?? 3);
    const sessions = await prisma.adminSession.findMany({ where: { shopId: target.id }, orderBy: { lastSeenAt: "desc" }, select: { id: true } });
    if (sessions.length > limit) await prisma.adminSession.deleteMany({ where: { id: { in: sessions.slice(limit).map((s) => s.id) } } });
  } catch (e) { log.warn("adminSession", errMsg(e)); }
  res.cookie(adminCookieName(target.id), token, { httpOnly: true, sameSite: "lax", maxAge: 7 * 24 * 3600 * 1000, path: "/" });
  // Frontend shu do'kon kontekstiga o'tadi (?shop=<slug>)
  res.json({ ok: true, shop: target.slug });
}

/** So'rovdan qurilma (brauzer/OS) va IP ni qisqa tavsiflash */
function deviceInfo(req: Request): { device: string; ip: string } {
  const ua = String(req.header("user-agent") || "");
  const ip = String((req.header("x-forwarded-for") || "").split(",")[0] || req.socket?.remoteAddress || "").trim();
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad|iPod|iOS/i.test(ua) ? "iPhone/iPad" : /Windows/i.test(ua) ? "Windows" : /Macintosh|Mac OS/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "Qurilma";
  const br = /Edg/i.test(ua) ? "Edge" : /Chrome/i.test(ua) ? "Chrome" : /Firefox/i.test(ua) ? "Firefox" : /Safari/i.test(ua) ? "Safari" : "";
  return { device: br ? `${os} · ${br}` : os, ip };
}

/** Parolni unutish: telefon bo'yicha do'kon topiladi, boti orqali 6 xonali kod yuboriladi */
export async function adminForgot(req: Request, res: Response) {
  const given = normalizePhone(String((req.body as { phone?: string })?.phone || ""));
  const target = await shopByPhone(given);
  if (!target) { res.status(400).json({ error: "Bu telefon raqami hech bir do'konga biriktirilmagan" }); return; }
  // Egasini bot foydalanuvchisi sifatida topamiz (kod yuborish uchun telegramId kerak)
  const owner = await runWithShop(target.id, () => prisma.user.findFirst({ where: { phone: given }, select: { telegramId: true } }));
  if (!owner) { res.status(400).json({ error: "Avval do'kon botini oching, /start bosib telefon raqamingizni ulang" }); return; }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const value = { codeHash: bcrypt.hashSync(code, 8), expiresAt: Date.now() + 10 * 60 * 1000, attempts: 0 };
  await prisma.setting.upsert({ where: { shopId_key: { shopId: target.id, key: "pwreset" } }, create: { shopId: target.id, key: "pwreset", value }, update: { value } });
  try {
    await botForShop(target.id).api.sendMessage(Number(owner.telegramId), `🔐 Admin parolni tiklash kodi: <b>${code}</b>\n\nKod 10 daqiqa amal qiladi. Agar bu so'rovni siz yubormagan bo'lsangiz — e'tiborsiz qoldiring.`, { parse_mode: "HTML" });
  } catch (e) { res.status(500).json({ error: "Kod yuborib bo'lmadi: " + errMsg(e) }); return; }
  res.json({ ok: true });
}

/** Kod va yangi parol bilan tiklash (telefon bo'yicha do'kon) */
export async function adminReset(req: Request, res: Response) {
  const b = (req.body || {}) as { phone?: string; code?: string; newPassword?: string };
  const given = normalizePhone(String(b.phone || ""));
  const target = await shopByPhone(given);
  if (!target) { res.status(400).json({ error: "Telefon raqami noto'g'ri" }); return; }
  const sid = target.id;
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
  await runWithShop(sid, () => setAdminPassword(np));
  await prisma.setting.delete({ where: { shopId_key: { shopId: sid, key: "pwreset" } } }).catch(() => {});
  res.json({ ok: true });
}

export async function adminLogout(req: Request, res: Response) {
  const token = (req as Request & { cookies?: Record<string, string> }).cookies?.[adminCookieName(currentShopId())] || (req.header("authorization") || "").replace(/^Bearer /, "");
  try { const p = jwt.verify(token, env.JWT_SECRET) as { jti?: string }; if (p.jti) await prisma.adminSession.delete({ where: { jti: p.jti } }).catch(() => {}); } catch { /* ignore */ }
  res.clearCookie(adminCookieName(currentShopId()), { path: "/" });
  res.json({ ok: true });
}

export async function adminAuth(req: Request, res: Response, next: NextFunction) {
  const token = (req as Request & { cookies?: Record<string, string> }).cookies?.[adminCookieName(currentShopId())] || (req.header("authorization") || "").replace(/^Bearer /, "");
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { role?: string; shopId?: number; jti?: string };
    if (payload.role !== "admin") throw new Error("no");
    // Boshqa do'kon ma'lumotiga kira olmaydi: token do'koni = so'rov do'koni bo'lishi shart
    if ((payload.shopId ?? DEFAULT_SHOP_ID) !== currentShopId()) throw new Error("wrong shop");
    // Qurilma sessiyasi bekor qilingan bo'lsa (super-admin yoki limit) — kirish yopiladi
    if (payload.jti) {
      const s = await prisma.adminSession.findUnique({ where: { jti: payload.jti }, select: { id: true } });
      if (!s) throw new Error("session revoked");
      void prisma.adminSession.update({ where: { jti: payload.jti }, data: { lastSeenAt: new Date() } }).catch(() => {});
    }
    next();
  } catch {
    res.status(401).json({ error: "unauthorized" });
  }
}

// ---------------- Super-admin (platforma) ----------------

const SUPER_COOKIE = "super_token";

export function superLogin(req: Request, res: Response) {
  // Parol har doim zaxira (break-glass) sifatida ishlaydi — Google noto'g'ri sozlansa
  // ham platformadan butunlay chiqib qolmaslik uchun (lockout bo'lmasin).
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
