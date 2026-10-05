/**
 * Boshlang'ich ma'lumotlar: bosh admin, namunaviy banner.
 * Bir necha marta ishga tushirsa ham xavfsiz (mavjudlarini o'zgartirmaydi).
 */
import { env } from "../src/env.ts";
import { prisma, DEFAULT_SHOP_ID } from "../src/db.ts";
import { loadSettings } from "../src/settings/store.ts";
import { setAdminPassword, getAdminPasswordHash } from "../src/http/auth.ts";

async function main() {
  await prisma.$connect();

  // Asosiy (bootstrap) do'kon — mavjud ma'lumot shunga tegishli
  await prisma.shop.upsert({ where: { id: DEFAULT_SHOP_ID }, create: { id: DEFAULT_SHOP_ID, slug: "main", name: "Asosiy do'kon" }, update: {} });

  await loadSettings(DEFAULT_SHOP_ID);

  const authRow = await prisma.setting.findUnique({ where: { shopId_key: { shopId: DEFAULT_SHOP_ID, key: "auth" } } });
  if (!authRow) {
    await setAdminPassword(env.ADMIN_PASSWORD);
    console.log("✔ Admin paroli o'rnatildi (.env → ADMIN_PASSWORD)");
  } else {
    await getAdminPasswordHash();
  }

  if (env.ADMIN_TELEGRAM_ID) {
    await prisma.staff.upsert({ where: { shopId_telegramId: { shopId: DEFAULT_SHOP_ID, telegramId: env.ADMIN_TELEGRAM_ID } }, create: { telegramId: env.ADMIN_TELEGRAM_ID, name: "Bosh admin", role: "admin" }, update: { role: "admin" } });
    console.log("✔ Bosh admin xodimlar ro'yxatiga qo'shildi");
  }

  if ((await prisma.banner.count()) === 0) {
    await prisma.banner.create({ data: { image: "/uploads/sample-banner.svg", title: "Xush kelibsiz!", subtitle: "Bannerlarni admin paneldan o'zgartiring", textColor: "#ffffff", sortOrder: 1 } });
    console.log("✔ Namunaviy banner qo'shildi");
  }

  await prisma.$disconnect();
  console.log("✅ Seed yakunlandi");
}

main().catch((e) => { console.error(e); process.exit(1); });
