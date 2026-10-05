import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { User } from "@prisma/client";
import { env } from "../env.ts";
import { prisma, currentShopId, runWithShop, DEFAULT_SHOP_ID } from "../db.ts";
import { normalizeLang, getSettings } from "../settings/store.ts";
import { tokenForShop, shopIdBySlug } from "../bot/manager.ts";
import { touchUser } from "../analytics/track.ts";

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

const COOKIE = "admin_token";

export async function getAdminPasswordHash(): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { shopId_key: { shopId: currentShopId(), key: "auth" } } });
  const v = row?.value as { passwordHash?: string } | null;
  if (v?.passwordHash) return v.passwordHash;
  return bcrypt.hashSync(env.ADMIN_PASSWORD, 8);
}

export async function setAdminPassword(password: string) {
  const passwordHash = bcrypt.hashSync(password, 10);
  const sid = currentShopId();
  await prisma.setting.upsert({ where: { shopId_key: { shopId: sid, key: "auth" } }, create: { shopId: sid, key: "auth", value: { passwordHash } }, update: { value: { passwordHash } } });
}

export async function adminLogin(req: Request, res: Response) {
  const password = String((req.body as { password?: string })?.password || "");
  const hash = await getAdminPasswordHash();
  if (!password || !bcrypt.compareSync(password, hash)) { res.status(401).json({ error: "Parol noto'g'ri" }); return; }
  // Admin faqat o'z do'koniga bog'lanadi (ko'p-do'kon izolyatsiyasi)
  const token = jwt.sign({ role: "admin", shopId: currentShopId() }, env.JWT_SECRET, { expiresIn: "7d" });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", maxAge: 7 * 24 * 3600 * 1000, path: "/" });
  res.json({ ok: true });
}

export function adminLogout(_req: Request, res: Response) {
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
}

export function adminAuth(req: Request, res: Response, next: NextFunction) {
  const token = (req as Request & { cookies?: Record<string, string> }).cookies?.[COOKIE] || (req.header("authorization") || "").replace(/^Bearer /, "");
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
  const password = String((req.body as { password?: string })?.password || "");
  if (!password || password !== env.SUPER_ADMIN_PASSWORD) { res.status(401).json({ error: "Parol noto'g'ri" }); return; }
  const token = jwt.sign({ role: "super" }, env.JWT_SECRET, { expiresIn: "7d" });
  res.cookie(SUPER_COOKIE, token, { httpOnly: true, sameSite: "lax", maxAge: 7 * 24 * 3600 * 1000, path: "/" });
  res.json({ ok: true });
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
