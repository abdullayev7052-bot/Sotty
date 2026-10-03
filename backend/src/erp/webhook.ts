/**
 * Ichki ERP'da tashqi webhook yo'q. Moslik uchun stub funksiyalar.
 */
import type { Request, Response } from "express";

export async function webhookHandler(_req: Request, res: Response): Promise<void> {
  res.status(404).json({ error: "not found" });
}

export async function ensureWebhookSubscription(_url: string, _force = false): Promise<{ destination: string; secret: string; at: string; error?: string } | null> {
  return null;
}

export function getWebhookState(): { destination: string; secret: string; at: string; error?: string } | null {
  return null;
}
