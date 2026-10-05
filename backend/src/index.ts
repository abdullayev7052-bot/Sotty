import { env } from "./env.ts";
import { prisma, DEFAULT_SHOP_ID } from "./db.ts";
import { log, errMsg } from "./logger.ts";
import { loadSettings } from "./settings/store.ts";
import { refreshShareAdmins } from "./erp/share.ts";
import { pruneStalePayments } from "./payments/payme.ts";
import { listen, migrateDiskUploads } from "./http/server.ts";
import { startBot } from "./bot/index.ts";
import { startExtraShopBots } from "./bot/manager.ts";
import { getPublicUrl, startPublicUrlWatcher } from "./utils/publicUrl.ts";
import { startTunnelAutostart } from "./utils/tunnel.ts";
import { pruneEvents } from "./analytics/track.ts";

async function main() {
  log.info("🚀 Sotty ishga tushmoqda...");
  await prisma.$connect();
  // Asosiy (bootstrap) do'kon mavjudligini ta'minlash — mavjud ma'lumot shunga tegishli
  try { await prisma.shop.upsert({ where: { id: DEFAULT_SHOP_ID }, create: { id: DEFAULT_SHOP_ID, slug: "main", name: "Asosiy do'kon" }, update: {} }); } catch (e) { log.warn("bootstrap shop", errMsg(e)); }
  await loadSettings(DEFAULT_SHOP_ID);
  await refreshShareAdmins();

  await listen();
  void migrateDiskUploads();
  await startBot();
  void startExtraShopBots();

  await startPublicUrlWatcher();
  startTunnelAutostart();

  // Analitika: eski hodisalarni kuniga bir marta tozalash
  void pruneEvents();
  setInterval(() => { void pruneEvents(); }, 24 * 3600 * 1000);
  // To'lov: 12 soatdan oshgan tugallanmagan tranzaksiyalarni bekor qilish
  void pruneStalePayments();
  setInterval(() => { void pruneStalePayments(); }, 30 * 60 * 1000);

  log.info(`✅ Tayyor. Admin: http://localhost:${env.PORT}/admin/`);
  if (!getPublicUrl()) log.info("Ommaviy manzil hali yo'q — ngrok/cloudflared avtomatik ishga tushiriladi yoki alohida oynada: ngrok http " + env.PORT);
}

process.on("unhandledRejection", (e) => log.error("unhandledRejection", errMsg(e)));
process.on("uncaughtException", (e) => log.error("uncaughtException", errMsg(e)));

main().catch((e) => {
  log.error("Ishga tushirishda xato:", e);
  process.exit(1);
});
