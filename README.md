# 🛍 Sotty

**Sotty** — har bir do'kon egasi o'z Telegram botini va Mini App do'konini ochib, mahsulotlarini sotishi uchun tizim. Loyiha **o'z ichki ERP tizimiga** ega — tashqi hech qanday tizimga (jumladan Bito'ga) bog'liq emas.

> Bu loyiha `Abdullayev-testbot` asosida yaratilgan, ammo undagi **Bito integratsiyasi butunlay olib tashlanib**, o'rniga loyihaning o'z ichki ERP yadrosi qo'yilgan.

## Tarkibi (monorepo)

| Qism | Texnologiya | Vazifasi |
|------|-------------|----------|
| `backend` | Node + TypeScript + Express + Prisma/PostgreSQL + grammY | API, Telegram bot, ma'lumotlar bazasi |
| `miniapp` | React + Vite | Telegram Mini App (mijoz ko'radigan do'kon) |
| `admin` | React + Vite | Admin panel (do'kon egasi uchun) |

## Nima ishlaydi (1-bosqich — MVP)

- ✅ **Ichki katalog** — mahsulot va kategoriyalarni admin paneldan qo'shish, tahrirlash, o'chirish (narx, qoldiq, rasm, SKU, izoh, kategoriya, chegirma, tavsiya, yashirish, tartiblash).
- ✅ **Buyurtmalar** — Mini App savatchasidan buyurtma ichki bazada yaratiladi, holatlari (yangi → qabul → tayyor → yetkazildi) bot guruhidagi tugmalar orqali boshqariladi.
- ✅ **Mijozlar** — Telegram orqali ro'yxatdan o'tish (telefon + ism), buyurtmalar tarixi.
- ✅ **Mini App** — storis, bannerlar, bosh sahifa bloklari, qidiruv, filtrlar, istaklar, "savatda turganlar", "kelganda eslatish".
- ✅ **To'lov** — Payme (ixtiyoriy).
- ✅ Tashqi tizimga **hech qanday tarmoq so'rovi yo'q** — barcha ma'lumot loyihaning o'z PostgreSQL bazasida.

## Keyingi bosqichlarda rejalashtirilgan

- Ombor: kirim/chiqim (xaridlar va sotuv), qoldiqni avtomatik hisoblash
- Kassa, moliyaviy hisobotlar, mijozlar balansi va qarzdorlik
- Valyuta tanlash, chegirma/aksiya qoidalari
- Ko'p do'kon rejimi
- Eng yuqori (SaaS) admin panel: bir panelda ko'p akkauntni boshqarish, reklama orqali ro'yxatdan o'tish mini-app

## Ishga tushirish

```bash
# 1. .env faylini tayyorlang (.env.example dan nusxa oling)
cp .env.example .env   # DATABASE_URL, BOT_TOKEN, ADMIN_TELEGRAM_ID ni to'ldiring

# 2. O'rnatish + baza + build
npm run setup

# 3. Ishga tushirish
npm start
```

Admin panel: `http://localhost:4000/admin/` · Mini App: `http://localhost:4000/app/`

## Railway'ga deploy

`railway.json` tayyor. Railway'da yangi loyiha yarating, shu GitHub reponi ulang va quyidagi muhit o'zgaruvchilarini kiriting:

- `DATABASE_URL` — PostgreSQL (masalan Neon)
- `BOT_TOKEN` — Telegram bot tokeni
- `ADMIN_TELEGRAM_ID`, `ADMIN_PASSWORD`, `JWT_SECRET`
- `PUBLIC_URL` — Railway bergan domen (masalan `https://sotty.up.railway.app`)

Build: `npm run railway:build` · Start: `npm run db:check && npm start`
