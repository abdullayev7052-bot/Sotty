/**
 * Ko'p-do'kon bot menejeri. 1-do'kon (bootstrap) boti instance.ts/index.ts orqali
 * ishga tushadi. Qolgan faol do'konlar (o'z bot tokeni bilan) shu yerda boshqariladi:
 * har bir bot update'i o'z do'koni konteksti (runWithShop) ichida ishlaydi.
 */
import { Bot } from "grammy";
import type { MyContext } from "./context.ts";
import { prisma, runWithShop, DEFAULT_SHOP_ID } from "../db.ts";
import { bot as bootstrapBot, botToken as bootstrapToken } from "./instance.ts";
import { registerHandlers } from "./index.ts";
import { log, errMsg } from "../logger.ts";

interface ShopBot { bot: Bot<MyContext>; token: string; slug: string }
const extra = new Map<number, ShopBot>();
const slugById = new Map<number, string>();
const tokenById = new Map<number, string>();
const idBySlug = new Map<string, number>();

/** Do'kon uchun bot (yo'q bo'lsa — bootstrap bot) */
export function botForShop(shopId: number): Bot<MyContext> {
  return extra.get(shopId)?.bot ?? (bootstrapBot as unknown as Bot<MyContext>);
}
export function shopSlug(shopId: number): string { return slugById.get(shopId) || "main"; }
export function tokenForShop(shopId: number): string { return tokenById.get(shopId) || bootstrapToken; }
export function shopIdBySlug(slug: string): number | null { return idBySlug.get(slug) ?? null; }

/** Barcha faol qo'shimcha do'kon botlarini ishga tushirish (1-do'kondan tashqari) */
export async function startExtraShopBots() {
  try {
    const shop1 = await prisma.shop.findUnique({ where: { id: DEFAULT_SHOP_ID } });
    slugById.set(DEFAULT_SHOP_ID, shop1?.slug || "main");
    tokenById.set(DEFAULT_SHOP_ID, shop1?.botToken || bootstrapToken);
    idBySlug.set(shop1?.slug || "main", DEFAULT_SHOP_ID);

    const shops = await prisma.shop.findMany({ where: { active: true, suspended: false, id: { not: DEFAULT_SHOP_ID }, NOT: { botToken: null } } });
    for (const s of shops) {
      if (!s.botToken) continue;
      idBySlug.set(s.slug, s.id);
      await startShopBot(s.id, s.slug, s.botToken);
    }
    if (shops.length) log.info(`🤖 Qo'shimcha do'kon botlari: ${shops.length} ta`);
  } catch (e) {
    log.warn("startExtraShopBots", errMsg(e));
  }
}

/** Bitta do'kon botini ishga tushirish (yoki qayta ulash) */
export async function startShopBot(shopId: number, slug: string, token: string) {
  await stopShopBot(shopId);
  const b = new Bot<MyContext>(token);
  // Har bir update shu do'kon konteksti ichida ishlaydi
  b.use((_ctx, next) => runWithShop(shopId, () => next()));
  registerHandlers(b);
  slugById.set(shopId, slug);
  tokenById.set(shopId, token);
  idBySlug.set(slug, shopId);
  extra.set(shopId, { bot: b, token, slug });
  let me: { username?: string } = {};
  try { await b.api.deleteWebhook({ drop_pending_updates: false }).catch(() => {}); me = await b.api.getMe(); } catch (e) { log.warn(`bot @${slug} token xato`, errMsg(e)); return; }
  void prisma.shop.update({ where: { id: shopId }, data: { botUsername: me.username || null } }).catch(() => {});
  const start = (attempt = 1) => {
    b.start({ allowed_updates: ["message", "callback_query", "my_chat_member", "chat_member"], onStart: () => log.info(`📡 Do'kon ${shopId} (@${me.username}) polling faol`) })
      .catch((e) => { const msg = errMsg(e); const delay = /409/.test(msg) ? Math.min(60000, 5000 * attempt) : 15000; log.warn(`bot ${shopId} start: ${msg} — ${delay / 1000}s`); setTimeout(() => start(attempt + 1), delay); });
  };
  start();
}

/** Do'kon botini to'xtatish */
export async function stopShopBot(shopId: number) {
  const e = extra.get(shopId);
  if (e) { try { await e.bot.stop(); } catch { /* ishlamayotgan bo'lishi mumkin */ } extra.delete(shopId); }
}
