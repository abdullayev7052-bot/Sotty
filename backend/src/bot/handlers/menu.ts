import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import type { MyContext, BotTextKey } from "../context.ts";
import { languageKeyboard, mainKeyboard, openAppInline, storeKeyboard } from "../keyboards.ts";
import { isMultiStore, getStore } from "../../erp/stores.ts";
import { getSettings, lt, normalizeLang } from "../../settings/store.ts";
import type { Lang } from "../../settings/schema.ts";
import { LANGS } from "../../settings/schema.ts";
import { prisma } from "../../db.ts";
import { fetchCustomer } from "../../erp/customers.ts";
import { stageName, type Stage } from "../../erp/orders.ts";
import { esc, fmtDate, money, prettyPhone, qty } from "../../utils/format.ts";
import { log } from "../../logger.ts";

type MenuKey = "mOrders" | "mMyInfo" | "mSettings" | "mStore";

/** Matn qaysi menyu tugmasiga mos kelishini aniqlash (barcha tillarda) */
function menuKeyOf(text: string): MenuKey | "openApp" | null {
  const b = getSettings().bot;
  const keys: (MenuKey | "openAppButton")[] = ["mOrders", "mMyInfo", "mSettings", "openAppButton"];
  const t = text.trim();
  for (const k of keys) {
    const v = b[k] as Record<Lang, string>;
    for (const l of LANGS) if (v?.[l] && v[l].trim() === t) return k === "openAppButton" ? "openApp" : (k as MenuKey);
  }
  const sb = getSettings().shop.storeButton as Record<Lang, string>;
  for (const l of LANGS) if (sb?.[l] && sb[l].trim() === t) return "mStore";
  return null;
}

export async function showOrders(ctx: MyContext) {
  const lang = ctx.lang;
  const limit = Math.max(3, Number(getSettings().bot.listLimit || 10));
  const local = await prisma.order.findMany({ where: { userId: ctx.user.id }, orderBy: { createdAt: "desc" }, take: limit });
  if (!local.length) { await ctx.reply(ctx.t("noOrders"), { reply_markup: openAppInline(lang) }); return; }
  const lines = local.map((o) => `• <b>#${esc(String(o.number || o.id))}</b> — ${fmtDate(o.createdAt, lang, false)} — ${money(o.total, lang)} · ${esc(stageName((o.stateKey || "new") as Stage, lang, o.stateName))}`);
  const kb = new InlineKeyboard();
  local.forEach((o, i) => { kb.text(`#${o.number || o.id}`, `od:l:${o.id}`); if (i % 3 === 2) kb.row(); });
  await ctx.reply(`<b>${esc(ctx.t("ordersTitle"))}</b>\n\n${lines.join("\n")}\n\n${esc(ctx.t("listHint"))}`, { parse_mode: "HTML", reply_markup: kb });
}

/** Bitta buyurtma tafsiloti (mijoz uchun) */
export async function sendOrderDetail(ctx: MyContext, key: string) {
  const lang = ctx.lang;
  const b = getSettings().bot;
  const L = (k: keyof typeof b) => lt(b[k] as never, lang);
  const [, , id] = key.split(":");
  const o = await prisma.order.findFirst({ where: { id: Number(id), userId: ctx.user.id } });
  if (!o) { await ctx.reply(ctx.t("noOrders")); return; }
  const number = String(o.number || o.id);
  const status = stageName((o.stateKey || "new") as Stage, lang, o.stateName);
  const type = o.type === "pickup" ? lt(getSettings().checkout.pickupLabel, lang) : lt(getSettings().checkout.deliveryLabel, lang);
  const items = ((o.items as unknown as { name: string; qty: number; price: number; measure?: string | null }[]) || []);
  const lines = [`<b>${esc(L("orderDetailTitle"))} #${esc(number)}</b>`, `🕒 ${esc(L("lTime"))}: ${fmtDate(o.createdAt, lang)}`, `📌 ${esc(L("lStatus"))}: <b>${esc(status)}</b>`];
  if (type) lines.push(`🚚 ${esc(L("lType"))}: ${esc(type)}`);
  if (o.address) lines.push(`📍 ${esc(L("lAddress"))}: ${esc(o.address)}`);
  lines.push("", `🛒 <b>${esc(L("lProducts"))}:</b>`);
  let tq = 0;
  items.forEach((it, i) => { tq += Number(it.qty || 0); lines.push(`${i + 1}. ${esc(it.name)} — ${qty(it.qty)} ${esc(it.measure || "")} × ${money(it.price, lang, { suffix: false })} = ${money(it.price * it.qty, lang, { suffix: false })}`); });
  lines.push("", `📦 ${esc(L("lTotalQty"))}: ${qty(tq)}`, `💰 <b>${esc(L("lTotal"))}: ${money(o.total, lang)}</b>`);
  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
}

export async function showMyInfo(ctx: MyContext) {
  const c = await fetchCustomer(ctx.user);
  const name = c?.name || ctx.user.name || ctx.user.tgFirstName || "—";
  const phone = c?.phone_number || ctx.user.phone || "";
  await ctx.reply(ctx.t("myInfo", { name: esc(name), phone: prettyPhone(phone), tg: String(ctx.user.telegramId) }), { parse_mode: "HTML" });
}

export async function showSettings(ctx: MyContext) {
  await ctx.reply(ctx.t("chooseLanguage"), { reply_markup: languageKeyboard() });
}

export async function showStore(ctx: MyContext) {
  if (!isMultiStore()) return;
  const cur = getStore(ctx.user.storeId);
  await ctx.reply(`${lt(getSettings().shop.storeChooseLabel, ctx.lang)}\n\n${esc(cur.name(ctx.lang))}`, { parse_mode: "HTML", reply_markup: storeKeyboard(ctx.lang, cur.id) });
}

export function registerMenu(bot: Bot<MyContext>) {
  bot.callbackQuery(/^store:([a-zA-Z0-9_-]+)$/, async (ctx) => {
    const st = getStore(ctx.match[1]);
    ctx.user = await prisma.user.update({ where: { id: ctx.user.id }, data: { storeId: st.id } });
    const { fill } = await import("../../settings/store.ts");
    await ctx.answerCallbackQuery({ text: fill(lt(getSettings().shop.storeChanged, ctx.lang), { store: st.name(ctx.lang) }) }).catch(() => {});
    await ctx.editMessageText(`${lt(getSettings().shop.storeChooseLabel, ctx.lang)}\n\n✅ ${esc(st.name(ctx.lang))}`, { parse_mode: "HTML", reply_markup: storeKeyboard(ctx.lang, st.id) }).catch(() => {});
  });
  bot.command(["dokon", "store"], async (ctx) => { if (ctx.chat.type === "private" && ctx.user.step === "done") await showStore(ctx); });

  const only = (fn: (ctx: MyContext) => Promise<void>) => async (ctx: MyContext) => {
    if (ctx.chat?.type !== "private") return;
    if (ctx.user.step !== "done") { await ctx.reply(ctx.t("askPhone")); return; }
    try { await fn(ctx); } catch (e) { log.error("menu", e); await ctx.reply(ctx.t("errorGeneric")); }
  };

  bot.command(["buyurtmalar", "orders", "zakazy"], only(showOrders));
  bot.command(["malumotlarim", "me", "myinfo"], only(showMyInfo));
  bot.command(["sozlamalar", "settings"], only(showSettings));
  bot.command("menu", only(async (ctx) => { await ctx.reply("👇", { reply_markup: mainKeyboard(ctx.lang) }); }));

  bot.callbackQuery(/^od:(l|b):([a-zA-Z0-9]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (ctx.user?.step !== "done") return;
    await sendOrderDetail(ctx, `od:${ctx.match[1]}:${ctx.match[2]}`);
  });

  bot.command("id", async (ctx) => {
    await ctx.reply(`🆔 <code>${ctx.from?.id}</code>`, { parse_mode: "HTML" });
  });

  bot.callbackQuery(/^lang:(uz|ru|en)$/, async (ctx) => {
    const lang = normalizeLang(ctx.match[1]);
    ctx.user = await prisma.user.update({ where: { id: ctx.user.id }, data: { language: lang } });
    ctx.lang = lang;
    await ctx.answerCallbackQuery({ text: ctx.t("languageChanged") });
    await ctx.editMessageText(ctx.t("languageChanged")).catch(() => {});
    await ctx.reply(ctx.t("welcomeBack", { name: ctx.user.name || ctx.user.tgFirstName || "" }), { reply_markup: mainKeyboard(lang), parse_mode: "HTML" });
  });

  bot.on("message:text", async (ctx, next) => {
    if (ctx.chat.type !== "private") return next();
    const key = menuKeyOf(ctx.message.text);
    if (!key) return next();
    if (ctx.user.step !== "done") { await ctx.reply(ctx.t("askPhone")); return; }
    const map: Record<MenuKey | "openApp", (c: MyContext) => Promise<void>> = {
      mOrders: showOrders, mMyInfo: showMyInfo, mSettings: showSettings, mStore: showStore,
      openApp: async (c) => {
        const kb = openAppInline(c.lang);
        if (kb) await c.reply(lt(getSettings().bot.openAppButton, c.lang), { reply_markup: kb });
        else await c.reply("⚠️ Mini App manzili hali sozlanmagan (ngrok ishga tushirilmagan yoki PUBLIC_URL berilmagan).");
      },
    };
    try { await map[key](ctx); } catch (e) { log.error("menu", e); await ctx.reply(ctx.t("errorGeneric")); }
  });
}

export const menuTextKeys: BotTextKey[] = ["mOrders", "mMyInfo", "mSettings"];
export { qty };
