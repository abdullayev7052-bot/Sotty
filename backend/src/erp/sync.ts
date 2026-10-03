/**
 * Ichki katalog yordamchilari. Mahsulotlar endi admin panel orqali boshqariladi
 * (tashqi tizimdan sinxronizatsiya yo'q). Bu fayl "qoldiq keldi" hodisasini va
 * eski chaqiruvlar bilan moslikni ta'minlaydi.
 */
let stockArrivedHandler: ((productIds: number[]) => Promise<void>) | null = null;

export function onStockArrived(fn: (productIds: number[]) => Promise<void>) {
  stockArrivedHandler = fn;
}

/** Admin mahsulot qoldig'ini 0 dan yuqoriga ko'targanda chaqiriladi */
export async function notifyStockArrived(productIds: number[]) {
  if (stockArrivedHandler && productIds.length) await stockArrivedHandler(productIds);
}

let lastResult: { at: string; ok: boolean; message: string; products: number; categories: number } | null = null;

export function getSyncStatus() {
  return { running: false, last: lastResult };
}

/** Ichki ERP'da sinxronizatsiya kerak emas — moslik uchun qoldirilgan */
export async function syncCatalog(_reason = "interval"): Promise<typeof lastResult> {
  lastResult = { at: new Date().toISOString(), ok: true, message: "Ichki katalog — sinxronizatsiya shart emas", products: 0, categories: 0 };
  return lastResult;
}

export async function ensureContext(): Promise<void> { /* ichki ERP — kontekst yo'q */ }
export async function autoMapStates(): Promise<void> { /* ichki ERP — holatlar ichki */ }
export function scheduleCatalogSync(_delayMs = 0, _reason = "") { /* noop */ }
export async function syncOneProduct(_id: string): Promise<void> { /* noop */ }
export function startCatalogSyncLoop() { /* noop — ichki katalog */ }
