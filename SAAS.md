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

### ✅ 6.2 — Ma'lumot izolyatsiyasi (shopId scoping) — BAJARILDI
- Tenant jadvallariga `shopId` qo'shildi (User, Product, Category, Order, StockMovement,
  CashTransaction, Supplier, Promotion, Setting, Story, Banner, HomeBlock, AdminGroup,
  Staff, Waitlist, Favorite, CartItem, AppEvent, ActivityLog). Mavjud ma'lumot `default(1)`
  orqali "1-do'kon"ga biriktiriladi.
- `User/Staff/AdminGroup/Setting` — kompozit unique (`shopId` bilan).
- **Markazlashgan avtomatik ajratish:** `db.ts`da Prisma kengaytmasi har bir o'qish/yozishga
  `shopId`ni avtomatik qo'shadi (AsyncLocalStorage konteksti `currentShopId()` orqali).
  Natijada so'rovlarda qo'lda filtr yozish shart emas — unutib qoldirish xavfi yo'q.
- Sozlamalar do'kon bo'yicha (`getSettings()` kontekstdan o'qiydi, kesh do'kon bo'yicha).
- Bootstrap do'kon (id=1) startup/seedda yaratiladi.
- Hozircha barcha so'rovlar `currentShopId()` = 1 (kontekst o'rnatilmagan) — mavjud tizim
  bir xil ishlaydi. Haqiqiy per-so'rov do'kon aniqlash (domen/slug/bot) — 6.3da ulanadi.

### ✅ 6.3 — Ko'p-bot runtime + do'kon aniqlash + ro'yxatdan o'tish — BAJARILDI
- `bot/manager.ts`: har bir faol do'kon tokeni uchun alohida grammY bot (bitta jarayonda),
  har update `runWithShop(shopId)` ichida. 1-do'kon boti o'zgarmay ishlaydi.
- Chiquvchi xabarlar (buyurtma, to'lov, broadcast) `botForShop(currentShopId())` orqali
  to'g'ri do'kon botidan yuboriladi.
- **Do'kon aniqlash:** Mini App/admin `?shop=<slug>` (yoki `X-Shop` sarlavha) orqali;
  Mini App initData o'sha do'kon bot tokeni bilan tekshiriladi; admin JWT do'konga bog'langan
  (boshqa do'kon ma'lumotiga kira olmaydi). Bot menyu havolasi slug'ni o'zi qo'shadi.
- Super-admin do'kon qo'sh/o'zgartirganda boti avtomatik ishga tushadi/to'xtaydi;
  panelda har do'kon uchun "Admin" havolasi (impersonate).
- **Ochiq ro'yxatdan o'tish:** `/register` sahifasi — egasi nomi, bot tokeni, parol, tarifni
  kiritadi → do'kon yaratiladi, admin paroli o'rnatiladi, bot darhol ishga tushadi.

### ⏳ 6.4 — Tariflar va cheklovlar (keyingi)
- Tarif bo'yicha limitlar (mahsulotlar soni, buyurtmalar, bannerlar...).
- To'lov muddati tugaganda do'konni avtomatik to'xtatish/ogohlantirish.

## Qanday ishlatiladi

**Platforma egasi (siz):**
1. `SUPER_ADMIN_PASSWORD` ni Railway Variables'ga qo'ying.
2. `https://<domen>/super` — platforma paneliga kiring; do'konlar qo'shing/boshqaring,
   har biri uchun "Admin" havolasi orqali o'sha do'kon paneliga o'ting.

**Do'kon egasi (mijoz):**
1. `https://<domen>/register` — nomi, bot tokeni (BotFather), parol, tarifni kiritadi.
2. Do'kon darhol yaratiladi, boti ishga tushadi.
3. `https://<domen>/admin/?shop=<slug>` — o'z admin paneli; `.../app/?shop=<slug>` — Mini App.
   Botini Telegramda ochib /start bosadi — menyu tugmasi o'z do'koniga ulangan.

Har bir do'konning mahsuloti, buyurtmasi, mijozlari, kassasi va boti **to'liq ajratilgan**
(shopId + alohida bot). Ma'lumotlar bir-biriga aralashmaydi.
