# ☁️ Sotty — Railway'ga joylash va ishga tushirish

Bitta Railway xizmati **hammasini** ishga tushiradi: bot + API + Mini App + Admin panel.
Railway domeni: `https://<nom>.up.railway.app` → Mini App `/app/`, Admin panel `/admin/`.
Hech qanday ngrok, Vercel yoki tashqi tizim kerak emas.

---

## 1-qadam. Ma'lumotlar bazasi (PostgreSQL)

Ikki yo'ldan birini tanlang:

**A) Railway Postgres (eng oson):**
1. Railway loyihangizda **New → Database → Add PostgreSQL**.
2. Keyin backend xizmatiga `DATABASE_URL` ni Postgres'dan **reference** qilib ulaysiz (quyida).

**B) Neon (bepul):** https://neon.tech → yangi proyekt → **connection string** ni oling
(`postgresql://...neon.tech/neondb?sslmode=require`). Bu — sizning `DATABASE_URL`.

---

## 2-qadam. Telegram bot tokeni (BotFather)

1. Telegramda **@BotFather** ni oching → `/newbot`.
2. Botga **nom** bering (masalan: `Mening Dokonim`).
3. Botga **username** bering (`...bot` bilan tugashi shart, masalan `mening_dokon_bot`).
4. BotFather sizga **token** beradi — masalan:
   `7712345678:AAE...xYz`. Bu — sizning `BOT_TOKEN`.

> Tokenni hech kimga bermang. U — botingizning kalitidir.

**Telegram ID ni bilish:** botingizni oching → `/start` dan keyin `/id` buyrug'ini yuboring,
bot sizning raqamli ID'ingizni ko'rsatadi (masalan `5246953735`). Bu — `ADMIN_TELEGRAM_ID`
(siz — bosh admin bo'lasiz).

---

## 3-qadam. Railway loyihasini yaratish

1. https://railway.com → **New Project → Deploy from GitHub repo** → `Sotty` reposini tanlang.
   (Branch: `main` yoki siz ishlayotgan branch.)
2. Railway `railway.json` ni o'zi o'qiydi — build va start buyruqlari tayyor.

---

## 4-qadam. Muhit o'zgaruvchilari (Variables)

Xizmat → **Variables → Raw Editor** → quyidagini qo'ying va qiymatlarni to'ldiring:

```
DATABASE_URL=postgresql://USER:PASSWORD@HOST/neondb?sslmode=require
BOT_TOKEN=7712345678:AAE...xYz
ADMIN_TELEGRAM_ID=5246953735
ADMIN_PASSWORD=kuchli-parol-qoying
JWT_SECRET=uzun-tasodifiy-matn-ixtiyoriy-32-belgidan-ortiq
```

| O'zgaruvchi | Nima |
|---|---|
| `DATABASE_URL` | 1-qadamdagi Postgres manzili (Railway Postgres'da `${{Postgres.DATABASE_URL}}` reference qiling) |
| `BOT_TOKEN` | 2-qadamdagi BotFather tokeni |
| `ADMIN_TELEGRAM_ID` | Sizning Telegram ID (bosh admin) |
| `ADMIN_PASSWORD` | Admin panelga birinchi kirish paroli (keyin paneldan o'zgartirasiz) |
| `JWT_SECRET` | Sessiya kaliti — istalgan uzun tasodifiy matn |

> `PUBLIC_URL` ni **qo'ymaslik** mumkin — Railway domeni avtomatik aniqlanadi.
> `TUNNEL` ham kerak emas (hosting domeni bor).

---

## 5-qadam. Ommaviy domen (Mini App uchun shart)

Xizmat → **Settings → Networking → Generate Domain** ni bosing.
Railway sizga `https://<nom>.up.railway.app` manzilini beradi.
Shu domen avtomatik Mini App manzili bo'ladi (hech narsa sozlash shart emas).

Domen yaratilgach, Railway qayta deploy qiladi. Deploy tugashini kuting (yashil holat).

---

## 6-qadam. Tekshirish

Domeningiz `https://sizning-nom.up.railway.app` deylik:

1. **Server ishlayaptimi:** `https://sizning-nom.up.railway.app/api/health` → `{"ok":true,...}` chiqishi kerak.
2. **Admin panel:** `https://sizning-nom.up.railway.app/admin/` → `ADMIN_PASSWORD` bilan kiring.
3. **Mahsulot qo'shing:** Admin panel → **Katalog boshqaruvi** → *Kategoriya qo'shish*, keyin *Mahsulot qo'shish* (nom, narx, qoldiq, rasm).
4. **Mini App (brauzerda tez test):** `https://sizning-nom.up.railway.app/app/` — telegram ichida ochsangiz to'liq ishlaydi.
5. **Botda:** botingizni Telegramda oching → `/start`. Pastdagi **Menu** tugmasi yoki "Do'konni ochish" tugmasi Mini App'ni ochadi. Mahsulotni savatga qo'shib, buyurtma bering.

---

## 7-qadam. Buyurtmalar tushadigan guruh (ixtiyoriy, tavsiya)

1. Telegramda guruh oching, botingizni guruhga **admin** qilib qo'shing.
2. Bot guruhga qo'shilganda guruh ID'sini yozadi va o'zi ro'yxatga oladi.
3. Admin panel → **Guruhlar** → shu guruhni **yoqing**.
4. Endi har bir yangi buyurtma guruhga tushadi; u yerdagi tugmalar bilan holatni o'zgartirasiz
   (Qabul qilindi → Tayyor → Yetkazildi). **Yetkazildi** bo'lganda qoldiq avtomatik kamayadi
   va kassaga tushum yoziladi.

---

## Ishlash zanjiri (ERP)

**Katalog → Aksiya/chegirma → Buyurtma → Ombor (qoldiq) → Kassa/Moliya.**
Hammasi bitta ichki bazada, bir-biriga bog'langan:

- **Katalog boshqaruvi** — mahsulot/kategoriya qo'shish, narx, chegirma.
- **Ombor** — kirim (xarid), chiqim (sotuv), qoldiq, tan narx, yetkazib beruvchilar.
- **Moliya** — kassa (kirim/chiqim), mijozlar balansi (qarz/to'lov), davr bo'yicha hisobot va foyda.
- **Aksiyalar** — savat darajasidagi chegirma va promo-kodlar.
- **Umumiy sozlamalar** — do'kon nomi, til, **valyuta** (so'm/dollar/...).

---

## Keyingi deploylar

GitHub'ga har push qilsangiz, Railway avtomatik qayta build qiladi va bazani
(`prisma db push`) yangilaydi — qo'lda hech narsa qilish shart emas.

## Lokal (kompyuterda) ishga tushirish

```bash
cp .env.example .env     # DATABASE_URL, BOT_TOKEN, ADMIN_TELEGRAM_ID ni to'ldiring
npm run setup            # o'rnatish + baza + build
npm start                # ishga tushirish (http://localhost:4000)
```
Lokalda Mini App'ni telefonda sinash uchun ngrok avtomatik ishga tushadi (yoki `.env` da `PUBLIC_URL` bering).
