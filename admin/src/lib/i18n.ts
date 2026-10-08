import { create } from "zustand";

export type UiLang = "uz" | "ru" | "en";
const KEY = "admin-lang";

const D = {
  // Bo'limlar (sarlavha, bosilmaydi)
  content: { uz: "Kontent", ru: "Контент", en: "Content" },
  control: { uz: "Nazorat", ru: "Контроль", en: "Control" },
  integration: { uz: "Integratsiya", ru: "Интеграция", en: "Integration" },
  settings: { uz: "Sozlamalar", ru: "Настройки", en: "Settings" },
  // Menyular
  dashboard: { uz: "Dashboard", ru: "Дашборд", en: "Dashboard" },
  waitlist: { uz: "Talablar", ru: "Запросы", en: "Requests" },
  favorites: { uz: "Istaklarim", ru: "Избранное", en: "Favourites" },
  stories: { uz: "Storis", ru: "Сторис", en: "Stories" },
  banners: { uz: "Banner", ru: "Баннер", en: "Banner" },
  broadcast: { uz: "Post", ru: "Пост", en: "Post" },
  catalog: { uz: "Katalog", ru: "Каталог", en: "Catalog" },
  promotions: { uz: "Aksiyalar", ru: "Акции", en: "Promotions" },
  shop: { uz: "Do'kon", ru: "Магазин", en: "Store" },
  telegram: { uz: "Telegram", ru: "Telegram", en: "Telegram" },
  channel: { uz: "Kanal", ru: "Канал", en: "Channel" },
  bot: { uz: "Bot", ru: "Бот", en: "Bot" },
  groups: { uz: "Guruh", ru: "Группа", en: "Group" },
  payments: { uz: "To'lovlar", ru: "Платежи", en: "Payments" },
  general: { uz: "Umumiy", ru: "Общие", en: "General" },
  miniapp: { uz: "Mini App", ru: "Mini App", en: "Mini App" },
  design: { uz: "Dizayn", ru: "Дизайн", en: "Design" },
  catalogSettings: { uz: "Katalog", ru: "Каталог", en: "Catalog" },
  cart: { uz: "Savatcha", ru: "Корзина", en: "Cart" },
  order: { uz: "Buyurtma", ru: "Заказ", en: "Order" },
  profile: { uz: "Profil", ru: "Профиль", en: "Profile" },
  botTexts: { uz: "Bot matnlari", ru: "Тексты бота", en: "Bot texts" },
  statuses: { uz: "Buyurtma holatlari", ru: "Статусы заказов", en: "Order statuses" },
  adminPanel: { uz: "Admin panel", ru: "Админ-панель", en: "Admin panel" },
  activity: { uz: "Jurnal", ru: "Журнал", en: "Activity log" },
  // Umumiy
  search: { uz: "Qidiruv", ru: "Поиск", en: "Search" },
  searchHint: { uz: "Bo'lim, menyu yoki sozlama nomini yozing…", ru: "Введите название раздела, меню или настройки…", en: "Type a section, menu or setting name…" },
  searchEmpty: { uz: "Hech narsa topilmadi", ru: "Ничего не найдено", en: "Nothing found" },
  light: { uz: "Yorug' rejim", ru: "Светлая тема", en: "Light mode" },
  dark: { uz: "Tungi rejim", ru: "Тёмная тема", en: "Dark mode" },
  logout: { uz: "Chiqish", ru: "Выйти", en: "Log out" },
  login: { uz: "Kirish", ru: "Войти", en: "Sign in" },
  password: { uz: "Parol", ru: "Пароль", en: "Password" },
  phone: { uz: "Telefon raqami", ru: "Номер телефона", en: "Phone number" },
  forgotPassword: { uz: "Parolni unutdingizmi?", ru: "Забыли пароль?", en: "Forgot password?" },
  resetTitle: { uz: "Parolni tiklash", ru: "Сброс пароля", en: "Reset password" },
  sendCode: { uz: "Kod yuborish", ru: "Отправить код", en: "Send code" },
  codeSentHint: { uz: "Tasdiqlash kodi botingizga yuborildi", ru: "Код отправлен в ваш бот", en: "A code was sent to your bot" },
  code: { uz: "Tasdiqlash kodi", ru: "Код подтверждения", en: "Verification code" },
  newPassword: { uz: "Yangi parol", ru: "Новый пароль", en: "New password" },
  backToLogin: { uz: "← Kirishga qaytish", ru: "← Назад ко входу", en: "← Back to sign in" },
  passwordChanged: { uz: "Parol yangilandi. Endi kirishingiz mumkin.", ru: "Пароль обновлён. Теперь войдите.", en: "Password updated. You can sign in now." },
  language: { uz: "Til", ru: "Язык", en: "Language" },
  save: { uz: "Saqlash", ru: "Сохранить", en: "Save" },
  refresh: { uz: "Yangilash", ru: "Обновить", en: "Refresh" },
  // Sozlamalar bo'limlari (backend schema kalitlari bo'yicha)
  "sec.general": { uz: "Umumiy", ru: "Общие", en: "General" },
  "sec.adminPanel": { uz: "Admin panel ko'rinishi", ru: "Вид админ-панели", en: "Admin panel look" },
  "sec.shop": { uz: "Do'kon", ru: "Магазин", en: "Store" },
  "sec.payments": { uz: "To'lov tizimlari", ru: "Платёжные системы", en: "Payment systems" },
  "sec.statuses": { uz: "Buyurtma holatlari", ru: "Статусы заказов", en: "Order statuses" },
  "sec.bot": { uz: "Bot matnlari", ru: "Тексты бота", en: "Bot texts" },
  "sec.design": { uz: "Mini App dizayni", ru: "Дизайн Mini App", en: "Mini App design" },
  "sec.catalog": { uz: "Katalog", ru: "Каталог", en: "Catalog" },
  "sec.checkout": { uz: "Savatcha va buyurtma", ru: "Корзина и заказ", en: "Cart & checkout" },
  "sec.profile": { uz: "Profil", ru: "Профиль", en: "Profile" },
} as const;
export type TKey = keyof typeof D;

interface LangState { lang: UiLang; setLang: (l: UiLang) => void }
export const useLang = create<LangState>((set) => ({
  lang: ((): UiLang => { try { const v = localStorage.getItem(KEY); return v === "ru" || v === "en" ? v : "uz"; } catch { return "uz"; } })(),
  setLang: (lang) => { try { localStorage.setItem(KEY, lang); } catch { /* ignore */ } set({ lang }); },
}));

/** Admin interfeysi matnlari (nav, tugmalar). Maydon nomlari hozircha o'zbekcha. */
export function useT() {
  const lang = useLang((s) => s.lang);
  return (k: TKey | string, fallback?: string) => (D as Record<string, Record<UiLang, string>>)[k]?.[lang] ?? fallback ?? k;
}
/** Barcha tillardagi matn (qidiruv indeksi uchun) */
export function allLangs(k: TKey | string): string[] {
  const v = (D as Record<string, Record<UiLang, string>>)[k];
  return v ? Object.values(v) : [k];
}
