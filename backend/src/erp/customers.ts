import type { User } from "@prisma/client";
import { prisma } from "../db.ts";
import { normalizePhone } from "../utils/format.ts";

/** Ichki mijoz ko'rinishi (tashqi tizim o'rniga — foydalanuvchining o'zi) */
export interface LocalCustomer {
  _id: string;
  name: string;
  phone_number?: string;
  loyalty_card_id?: string;
}

function toCustomer(user: User): LocalCustomer {
  return { _id: String(user.id), name: user.name || user.tgFirstName || "", phone_number: user.phone || "" };
}

export interface LinkResult { customer: LocalCustomer; isNew: boolean }

/** Ro'yxatdan o'tgan foydalanuvchini "mijoz" sifatida saqlash (ichki) */
export async function linkOrCreateCustomer(user: User, opts: { phone: string; name?: string }): Promise<LinkResult> {
  const phone = normalizePhone(opts.phone);
  const name = (opts.name || user.name || user.tgFirstName || phone).trim();
  const updated = await prisma.user.update({ where: { id: user.id }, data: { phone, name: user.name || name } });
  return { customer: toCustomer(updated), isNew: !user.phone };
}

/** Buyurtma uchun mijozni kafolatlash (ichki) */
export async function ensureCustomer(user: User, opts: { phone: string; name?: string }): Promise<string> {
  const data: Record<string, unknown> = { phone: normalizePhone(opts.phone || user.phone || "") };
  if (opts.name && opts.name.trim() && opts.name.trim() !== user.name) data.name = opts.name.trim();
  await prisma.user.update({ where: { id: user.id }, data });
  return String(user.id);
}

export async function fetchCustomer(user: User): Promise<LocalCustomer | null> {
  return toCustomer(user);
}

export interface BalanceLine { organization: string; amount: number; currency: string }

/** Mijoz balansi (musbat = haqdor, manfiy = qarzdor) */
export async function fetchBalances(user: User, _onlyStore = true): Promise<BalanceLine[]> {
  const bal = Number(user.balance || 0);
  if (!bal) return [];
  return [{ organization: "", amount: bal, currency: "" }];
}

/** Mijoz manzilini yangilash (ichki — foydalanuvchida saqlanadi, buyurtmada bajariladi) */
export async function updateCustomerAddress(_customerId: string, _lat: number, _lng: number, _address: string): Promise<void> {
  /* ichki: manzil foydalanuvchi profilida saqlanadi */
}
