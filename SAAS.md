# 🏢 Sotty SaaS — ko'p-do'kon (multi-tenant) rejasi

Maqsad: bitta tizimda ko'p do'kon (akkaunt). Har bir do'kon egasi o'z botini, mahsulotlari,
buyurtmalari va sozlamalariga ega. **Eng yuqori (platforma) admin** bitta paneldan barcha
do'konlarni ko'radi, qo'shadi, tarif/faollikni boshqaradi.

Arxitektura: **bitta baza, qatorli ko'p-ijara (row-level multitenancy)** + bitta serverda ko'p bot.

## Bosqichlar

### ✅ 6.1 — Boshqaruv paneli (poydevor) — BAJARILDI
- `Shop` (tenant) modeli: slug, nomi, egasi, bot tokeni, tarif, faollik, muddat.
- Super-admin autentifikatsiyasi (`SUPER_ADMIN_PASSWORD`, alohida cookie/rol).
- `/api/super/*` — do'konlar CRUD, statistika.
- `/super` — alohida platforma paneli (do'konlar ro'yxati, qo'shish/tahrirlash, to'xtatish).
- Mavjud bir-do'konli tizim buzilmaydi (hamma narsa ishlayveradi).

### ⏳ 6.2 — Ma'lumot izolyatsiyasi (shopId scoping)
- Tenant jadvallariga `shopId` qo'shish: User, Product, Category, Order, StockMovement,
  CashTransaction, Supplier, Promotion, Setting, Story, Banner, HomeBlock, AdminGroup,
  Staff, Waitlist, Favorite, CartItem, Share, AppEvent, ActivityLog, SyncState.
- Mavjud ma'lumotni "1-do'kon"ga biriktirish (bootstrap).
- Har bir so'rovda do'konni aniqlash (tenant resolver):
  - **Admin/Mini App:** domen yoki slug yoki JWT ichidagi shopId orqali.
  - **Bot:** qaysi bot tokeni update qabul qilganiga qarab.
- Barcha `prisma.*` so'rovlarini `shopId` bilan cheklash (markazlashgan yordamchi: `db(shopId)`),
  settings'ni do'kon bo'yicha o'qish/yozish.
- `Setting` kaliti: `shopId + key`.

### ⏳ 6.3 — Ko'p-bot runtime + ro'yxatdan o'tish
- Har bir faol do'kon tokeni uchun alohida grammY bot (bitta jarayonda).
- Token qo'shilganda/o'zgarganda botni ishga tushirish/qayta ulash; to'xtatilganda o'chirish.
- **Ro'yxatdan o'tish mini-app/sayt:** do'kon egasi reklama orqali kiradi, ma'lumot va bot
  tokenini kiritadi, tarif tanlaydi — do'kon avtomatik yaratiladi va boti 2 daqiqada ishga tushadi.
- Admin panel super-admin uchun: har do'konga "impersonate" (do'kon panelini ochish).

### ⏳ 6.4 — Tariflar va cheklovlar
- Tarif bo'yicha limitlar (mahsulotlar soni, buyurtmalar, bannerlar...).
- To'lov muddati tugaganda do'konni avtomatik to'xtatish/ogohlantirish.

## Hozircha qanday ishlatiladi
1. `SUPER_ADMIN_PASSWORD` ni Railway Variables'ga qo'ying.
2. `https://<domen>/super` — platforma paneliga kiring.
3. Do'konlar qo'shib, ma'lumotlarini (egasi, bot tokeni, tarif) saqlang.

> Eslatma: 6.2 bajarilgunicha do'konlar yagona umumiy katalog/bazani bo'lishadi —
> to'liq ajratish (har do'kon o'z mahsuloti/boti) keyingi bosqichlarda yoqiladi.
