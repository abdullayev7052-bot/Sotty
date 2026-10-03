/**
 * Boshlang'ich ma'lumotlar: bosh admin, namunaviy banner.
 * Bir necha marta ishga tushirsa ham xavfsiz (mavjudlarini o'zgartirmaydi).
 */
import { env } from "../src/env.ts";
import { prisma } from "../src/db.ts";
import { loadSettings } from "../src/settings/store.ts";
import { setAdminPassword, getAdminPasswordHash } from "../src/http/auth.ts";

async function main() {
  await prisma.$connect();
  await loadSettings();

  const authRow = await prisma.setting.findUnique({ where: { key: "auth" } });
  if (!authRow) {
    await setAdminPassword(env.ADMIN_PASSWORD);
    console.log("✔ Admin paroli o'rnatildi (.env → ADMIN_PASSWORD)");
  } else {
    await getAdminPasswordHash();
  }

  if (env.ADMIN_TELEGRAM_ID) {
    await prisma.staff.upsert({ where: { telegramId: env.ADMIN_TELEGRAM_ID }, create: { telegramId: env.ADMIN_TELEGRAM_ID, name: "Bosh admin", role: "admin" }, update: { role: "admin" } });
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
