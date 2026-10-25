// Receipt / invoice extraction: prompt + strict server-side validation.
//
// The model only ever PROPOSES a draft. Every field is re-validated here — the
// date must be a real calendar day, the amounts are clamped and rounded, every
// category is mapped onto the family's own list — and the client shows the
// result for review before a single budget entry is created.
//
// Schema constraints follow assistant.ts: additionalProperties:false everywhere,
// every property required, no minLength/maximum (unsupported by Anthropic
// structured outputs) — all bounds live in validateReceipt, which never trusts
// the model output.
//
// An entry per LINE, not per receipt: the budget tracks spending per category,
// so "Alimentation" lines and "Maison" lines of the same ticket must land in
// their own category. A bill with no itemised lines (rent, electricity,
// subscription) yields items: [] and a single entry for its total.
//
// Every line also carries `pantry_item` / `pantry_unit` / `pantry_content`: the
// same purchase with the brand, the format and the promo text dropped, plus the
// unit the document shows and how much product the line holds in that unit.
// The pantry import stores the name and the unit; the receipt line keeps all
// three, so the analytics page can add up what the family bought. The name is
// also what makes the next ticket with the same product add up to one pantry row
// instead of opening a second one under a brand name. The `label` stays the
// printed text (it describes the budget entry), and `pantry_item` keeps the
// ticket's own language: translating it would stop the folded-name merge from
// meeting the family's existing rows, and it would stop the promo screen's
// "my products" mode from matching the Dutch and French product names the shops
// publish.
//
// The prompt also receives the names already in the household's pantry, and one
// rule is added with them: when a line IS one of those products, the model hands
// back that name unchanged. It is how 'Tomaten los' lands on 'Tomates' and 'Uien'
// on 'Uien - Oignon'. Naming alone cannot do it — dropping the brand leaves
// strings, and no string rule tells 'Riz' from 'Riz basmati' or 'poisson' from
// 'boisson' (lib/pantry.custom.ts, pantryKeyResolver, is the half that still runs
// with no model in the loop).
//
// `pantry_stock` is the model's verdict on whether that line is plainly
// household stock: only those lines are stocked automatically, the rest wait on
// the pantry page for the family to name and categorise them
// (lib/pantry.custom.ts, splitReceiptLines).

import { createHash } from 'node:crypto';
import { MAX_PANTRY_NAME, MAX_PANTRY_UNIT } from '../lib/pantry.custom';
import { inferLineAmount } from '../lib/quantityInference.custom';

/** Accepted for both the analyse route and the client-side pre-checks. */
export const RECEIPT_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;

/** Pages/scans per request, and the byte ceiling of one file. */
export const MAX_RECEIPT_FILES = 5;
export const MAX_RECEIPT_FILE_BYTES = 8 * 1024 * 1024;

/** Line items kept from one document (a long supermarket ticket fits). */
export const MAX_RECEIPT_ITEMS = 60;

/**
 * Pantry names offered to the model as the names to reuse. A household with
 * more products than this keeps the ones that sort first; the rest only costs a
 * missed match, never a wrong one (the merge falls back to the folded name).
 */
export const MAX_RECEIPT_PANTRY_NAMES = 150;

const MAX_MERCHANT = 120;
const MAX_LABEL = 160;
const MAX_AMOUNT = 1_000_000;

export const RECEIPT_SCHEMA: Record<string, unknown> = {
    type: 'object',
    additionalProperties: false,
    required: ['document_type', 'merchant', 'date', 'currency', 'total', 'category', 'items'],
    properties: {
        document_type: { type: 'string', enum: ['receipt', 'invoice'] },
        merchant: { type: 'string' },
        date: { type: 'string' },
        currency: { type: 'string' },
        total: { type: 'number' },
        category: { type: 'string' },
        items: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['label', 'quantity', 'unit_price', 'amount', 'category', 'pantry_item', 'pantry_unit', 'pantry_content', 'pantry_stock'],
                properties: {
                    label: { type: 'string' },
                    quantity: { type: 'number' },
                    unit_price: { type: 'number' },
                    amount: { type: 'number' },
                    category: { type: 'string' },
                    pantry_item: { type: 'string' },
                    pantry_unit: { type: 'string' },
                    pantry_content: { type: 'number' },
                    pantry_stock: { type: 'boolean' },
                },
            },
        },
    },
};

export interface ReceiptLine {
    label: string;
    /** Always > 0 (defaults to 1 when the document does not say). */
    quantity: number;
    /** 0 when the unit price is not on the document. */
    unit_price: number;
    /** Line total, 2 decimals, always > 0 — a line without an amount is dropped. */
    amount: number;
    category: string;
    /**
     * The same purchase as a pantry item: the brand, the format and the promo
     * text dropped, so 'LAIT DEMI-ECREME BIO VILLAGE 1L' becomes 'Lait
     * demi-écrémé' and a second ticket adds up to the same row instead of
     * creating a brand-named one. '' when the label is already the plain item.
     */
    pantry_item: string;
    /**
     * Packaging/content unit: what the document shows ('L', 'kg', 'pièce'…), else
     * the canonical unit the label inference found. '' when there is none.
     */
    pantry_unit: string;
    /**
     * Total content of the line in `pantry_unit`: 5 for 'RIJST BASMATI 5KG',
     * 1.25 for 'POMMES 1,250 KG'. The model's answer wins; when it is 0, the
     * extraction reads the size the label prints (lib/quantityInference.custom.ts),
     * so a 500 g pack is 0.5 kg and never '1 g'. 0 only when neither says.
     */
    pantry_content: number;
    /**
     * True only when this line is clearly household stock with an unambiguous
     * generic name: those go straight into the pantry. Everything else (a
     * service, a fee, fuel, an abbreviation nobody can name, a line the model is
     * unsure about) is kept for the family to sort out on the pantry page — see
     * lib/pantry.custom.ts, splitReceiptLines.
     */
    pantry_stock: boolean;
}

export interface ReceiptExtraction {
    document_type: 'receipt' | 'invoice';
    /** '' when unreadable — the client then falls back to the file name. */
    merchant: string;
    /** YYYY-MM-DD, '' when the document carries no readable date. */
    date: string;
    /** ISO 4217 when readable, '' otherwise. */
    currency: string;
    /** 0 when unreadable, or when it could be recovered from the lines. */
    total: number;
    /** Category of the document as a whole (used when there are no lines). */
    category: string;
    items: ReceiptLine[];
}

/**
 * System prompt. `categories` are the FAMILY's budget categories (issue #68) —
 * the model must map onto those, never onto invented ones.
 */
export function buildReceiptPrompt(
    categories: readonly string[],
    todayIso: string,
    currency: string,
    pantryNames: readonly string[] = [],
): string {
    // Family-typed names go into the prompt: one line each, whitespace flattened
    // so a name carrying a newline cannot pose as another line of instructions.
    const pantryList = pantryNames
        .map((name) => String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_PANTRY_NAME))
        .filter((name) => name.length > 0)
        .slice(0, MAX_RECEIPT_PANTRY_NAMES)
        .map((name) => `- ${name}`)
        .join('\n');

    return [
        `Tu analyses la photo ou le PDF d'un ticket de caisse ou d'une facture, pour l'application de budget familial d'un foyer.`,
        ``,
        `Date du jour : ${todayIso}. Devise habituelle du foyer : ${currency || 'EUR'}.`,
        ...(pantryList
            ? [
                  ``,
                  `Produits DÉJÀ dans le garde-manger de ce foyer (liste exhaustive) :`,
                  pantryList,
              ]
            : []),
        ``,
        `Réponds UNIQUEMENT avec un objet JSON, sans texte autour, avec exactement ces champs :`,
        `- "document_type" : "receipt" pour un ticket de caisse (achats détaillés), "invoice" pour une facture (abonnement, énergie, loyer, téléphone…).`,
        `- "merchant" : nom du commerce ou du fournisseur seulement, sans numéro de magasin ni adresse ("" si illisible).`,
        `- "date" : date d'achat ou d'émission au format "YYYY-MM-DD" ("" si absente ou illisible — ne devine jamais).`,
        `- "currency" : code ISO à 3 lettres ("EUR", "USD"…) ou "".`,
        `- "total" : montant total payé TTC, en nombre (0 si illisible). Prends la ligne "TOTAL" du document, pas la somme des prix unitaires.`,
        `- "category" : catégorie du document entier, choisie EXACTEMENT parmi : ${categories.join(', ')}.`,
        `- "items" : une entrée par ligne d'article réellement payée. Pour chacune :`,
        `  "label" = nom de l'article (garde la langue du ticket, sans code-barres ni référence),`,
        `  "quantity" = nombre (1 si le document ne le précise pas),`,
        `  "unit_price" = prix unitaire (0 si non précisé),`,
        `  "amount" = montant total de la ligne, remises déjà déduites,`,
        `  "category" = EXACTEMENT l'une de : ${categories.join(', ')}.`,
        `  "pantry_item" = le MÊME article réduit à ce qu'on stocke à la maison : enlève la marque, l'enseigne, le format, le poids, le volume et tout texte promotionnel ("LAIT DEMI-ECREME BIO VILLAGE 1L" → "Lait demi-écrémé", "POULET FERMIER S/O PESEE" → "Poulet", "LESSIVE LIQUIDE X 40D" → "Lessive"). Garde la langue du ticket et un nom court et générique : c'est ce qui sera additionné au garde-manger quand un autre ticket contiendra le même produit. "" si le libellé est déjà ce nom générique.`,
        `    SAUF si ce produit est DÉJÀ dans le garde-manger ci-dessus sous un autre nom : recopie alors EXACTEMENT le nom du garde-manger, caractère pour caractère, même s'il est dans une autre langue, au singulier ou au pluriel, ou accompagné d'un mot de plus ("Tomaten los" pour "Tomates", "Uien" pour "Uien - Oignon"). Deux noms pour un même produit créent deux lignes dans le garde-manger : le nom déjà présent a toujours la priorité.`,
        `    Un nom du garde-manger peut lui-même en contenir plusieurs, séparés par un tiret : "Uien - Oignon" veut dire que ce produit s'appelle uien ou oignon, et une ligne "UIEN" comme une ligne "OIGNON" doivent renvoyer exactement "Uien - Oignon" — c'est tout l'intérêt de cette liste.`,
        `    La liste est celle des produits du foyer, pas celle du ticket : ne l'utilise jamais pour inventer une ligne que le ticket ne porte pas, et ignore les produits du foyer qui ne sont pas sur ce ticket.`,
        `  "pantry_unit" = l'unité de conditionnement ou de contenu que le ticket précise ("L", "kg", "pièce", "pot", "paquet"…), "" sinon.`,
        `    "pantry_unit" ne contient QUE l'unité, jamais une taille : une taille ("500g", "1,5L", "6x33cl") va dans "pantry_content" (déjà demandée), qui reçoit alors la quantité totale de produit, pas le nombre de paquets.`,
        `  "pantry_content" = la quantité totale de produit de cette ligne, exprimée dans "pantry_unit", en nombre (0 si le ticket ne permet pas de la calculer) : "RIJST BASMATI 5KG" → 5, "2 x LAIT 1L" → 2, "POMMES 1,250 KG" → 1.25.`,
        `  "pantry_stock" = true UNIQUEMENT si cette ligne est clairement un produit que le foyer garde chez lui (alimentaire, boisson, entretien, hygiène…) ET que "pantry_item" est un nom générique net. false pour un service, une taxe, une consigne, du carburant, une ligne illisible ou abrégée, et dès que tu as un doute : ces lignes seront proposées à la famille, qui décidera elle-même.`,
        ``,
        `Règles :`,
        `- Ignore tout ce qui n'est pas un achat : rendu de monnaie, sous-total, TVA, moyens de paiement, points de fidélité, remises globales, remerciements, mentions légales.`,
        `- Ticket détaillé : "items" reprend ses lignes, et la somme des "amount" doit être égale au "total" (corrige les arrondis, mais ne réinvente pas les montants).`,
        `- Facture sans détail par article (loyer, électricité, abonnement) : "items" = [] et le montant complet dans "total".`,
        `- Ne devine aucun article, aucun montant et aucune date : dans le doute, laisse "" ou 0.`,
        `- Maximum ${MAX_RECEIPT_ITEMS} lignes ; si le document en compte davantage, garde les plus significatives.`,
        `- Un montant est toujours un nombre (point décimal), jamais une chaîne de caractères.`,
    ].join('\n');
}

// ─── Duplicate guard ──────────────────────────────────────────────────────────

/**
 * Identity of one physical receipt for a family: the same merchant on the same
 * day for the same amount is the same ticket, however many times it is scanned.
 * Compared against a UNIQUE(user_id, fingerprint) index, so the guard holds even
 * if two imports race.
 *
 * Letters and digits are kept in ANY script: stripping to [a-z0-9] collapsed
 * every Cyrillic or CJK shop name to the empty string, which made two different
 * shops on the same day for the same amount look like the same receipt.
 */
export const receiptFingerprint = (merchant: string, date: string, total: number): string =>
    createHash('sha256')
        .update(`${date}|${total.toFixed(2)}|${merchant.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')}`)
        .digest('hex');

// ─── Import payload (what actually reaches the database) ──────────────────────

export interface ReceiptImportEntry {
    category: string;
    amount: number;
    description: string;
}

export interface ReceiptImportPayload {
    merchant: string;
    /** YYYY-MM-DD, always a real calendar day (the column is NOT NULL). */
    date: string;
    currency: string;
    documentType: 'receipt' | 'invoice';
    /** Category of the document as a whole — the single entry's category. */
    category: string;
    total: number;
    /**
     * 'itemized' = one budget entry per line; 'single' = one entry for the total
     * (a billed amount with no useful breakdown). The lines are archived either
     * way, so the detail is never lost.
     */
    mode: 'itemized' | 'single';
    sourceName: string;
    items: ReceiptLine[];
    entries: ReceiptImportEntry[];
}

const cleanMode = (value: unknown): 'itemized' | 'single' =>
    value === 'single' ? 'single' : 'itemized';

/**
 * Validates the reviewed draft coming back from the client. Everything the model
 * produced went through validateReceipt already, but these values travelled
 * through the browser and were editable, so they are re-validated here — nothing
 * is trusted and nothing invalid reaches the database. Returns null when the
 * payload cannot be stored at all.
 */
export function validateReceiptImport(
    raw: Record<string, unknown>,
    categories: readonly string[],
    fallbackCurrency: string,
): ReceiptImportPayload | null {
    const date = cleanString(raw.date, 10);
    if (!isIsoDate(date)) return null;

    const merchant = cleanString(raw.merchant, MAX_MERCHANT);
    const currency = cleanString(raw.currency, 3).toUpperCase();
    const documentType = raw.document_type === 'invoice' ? 'invoice' : 'receipt';
    const category = resolveCategory(raw.category, categories);
    const mode = cleanMode(raw.mode);

    const rawItems = Array.isArray(raw.items) ? raw.items : [];
    const items: ReceiptLine[] = [];
    for (const entry of rawItems.slice(0, MAX_RECEIPT_ITEMS)) {
        if (!entry || typeof entry !== 'object') continue;
        const line = entry as Record<string, unknown>;
        const label = cleanString(line.label, MAX_LABEL);
        const amount = cleanAmount(line.amount, false);
        if (!label || amount <= 0) continue;
        const quantity = cleanQuantity(line.quantity);
        // The reviewed line is stored with an amount even when the model left
        // `pantry_content` at 0: the label already says it.
        const pantryAmount = resolvePantryAmount(
            label,
            quantity,
            cleanString(line.pantry_unit, MAX_PANTRY_UNIT),
            cleanContent(line.pantry_content),
        );
        items.push({
            label,
            quantity,
            unit_price: cleanAmount(line.unit_price, true),
            amount,
            category: resolveCategory(line.category, categories),
            pantry_item: cleanString(line.pantry_item, MAX_PANTRY_NAME),
            pantry_unit: pantryAmount.unit,
            pantry_content: pantryAmount.content,
            pantry_stock: line.pantry_stock === true,
        });
    }

    const rawEntries = Array.isArray(raw.entries) ? raw.entries : [];
    const entries: ReceiptImportEntry[] = [];
    for (const entry of rawEntries.slice(0, MAX_RECEIPT_ITEMS)) {
        if (!entry || typeof entry !== 'object') continue;
        const line = entry as Record<string, unknown>;
        const amount = cleanAmount(line.amount, false);
        if (amount <= 0) continue;
        entries.push({
            category: resolveCategory(line.category, categories),
            amount,
            description: cleanString(line.description, 200),
        });
    }

    // A "single" import is exactly one entry for the whole amount; an itemized
    // one must have lines. Either way the stored total equals what the entries
    // add up to, so a receipt row can never contradict its own entries.
    const submittedTotal = cleanAmount(raw.total, false);
    if (mode === 'single') {
        const total = entries[0]?.amount || submittedTotal;
        if (total <= 0) return null;
        return {
            merchant, date, documentType, category, mode, items,
            currency: /^[A-Z]{3}$/.test(currency) ? currency : fallbackCurrency,
            total,
            sourceName: cleanString(raw.source_name, 160),
            entries: [{
                category: entries[0]?.category || category,
                amount: total,
                description: entries[0]?.description || merchant,
            }],
        };
    }

    if (entries.length === 0) return null;
    const total = Math.round(entries.reduce((sum, entry) => sum + entry.amount, 0) * 100) / 100;

    // The archived lines and the entries describe the same purchase: a receipt
    // whose detail contradicts its own entries would poison the drill-down and
    // any later per-item analysis, so a mismatch beyond rounding is refused.
    // (In 'single' mode the lines are explicitly just the scanned detail — the
    //  edited total is what gets booked — so they may differ there.)
    const itemsTotal = Math.round(items.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
    if (items.length > 0 && Math.abs(itemsTotal - total) > 0.05) return null;

    return {
        merchant, date, documentType, category, mode, items,
        currency: /^[A-Z]{3}$/.test(currency) ? currency : fallbackCurrency,
        total,
        sourceName: cleanString(raw.source_name, 160),
        entries,
    };
}

// ─── Validation ───────────────────────────────────────────────────────────────

const cleanString = (value: unknown, maxLength: number): string =>
    typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : '';

/** Strict calendar check: the regex alone accepts 2026-13-45. */
const isIsoDate = (value: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/** Amounts: number or numeric string, positive, capped, 2 decimals. 0 = unusable. */
const cleanAmount = (value: unknown, allowZero: boolean): number => {
    const raw = typeof value === 'number' ? value : typeof value === 'string' ? value.replace(',', '.') : NaN;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_AMOUNT) return 0;
    if (parsed === 0 && !allowZero) return 0;
    return Math.round(parsed * 100) / 100;
};

const cleanQuantity = (value: unknown): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1000) return 1;
    return Math.round(parsed * 1000) / 1000;
};

/**
 * Content of a line in its printed unit: number or numeric string with a comma,
 * positive, capped, 3 decimals. 0 = unknown, and 0 is a real answer here ("the
 * ticket did not say how much the line holds"), so it never falls back to 1.
 */
const cleanContent = (value: unknown): number => {
    const raw = typeof value === 'number' ? value : typeof value === 'string' ? value.replace(',', '.') : NaN;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 10000) return 0;
    return Math.round(parsed * 1000) / 1000;
};

/**
 * The pantry amount of a line: the model's own content when it has one, the
 * label/unit inference otherwise. A ticket that prints 'RIJST BASMATI 5KG'
 * says the amount itself, and the extraction must not store a pack count under
 * the pack's unit instead (the '500 g broccoli → Broccoli 1 g' bug).
 *
 * The inferred unit is the canonical one ('kg', 'l', 'pièce'), so the pantry and
 * the analytics buckets agree with each other.
 */
const resolvePantryAmount = (
    label: string,
    quantity: number,
    unit: string,
    content: number,
): { unit: string; content: number } => {
    if (content > 0) return { unit, content };
    const inferred = inferLineAmount({ label, quantity, unit });
    return inferred ? { unit: inferred.unit, content: inferred.content } : { unit, content };
};

/**
 * Maps a model-proposed category onto the family's list (case-insensitive).
 * Unknown → "Autre" when the list has it, else the last entry (the family's
 * own catch-all, historically "Autre").
 */
const resolveCategory = (value: unknown, categories: readonly string[]): string => {
    const fallback = categories.find((c) => c.toLowerCase() === 'autre') ?? categories[categories.length - 1] ?? '';
    const proposed = cleanString(value, 50).toLowerCase();
    if (!proposed) return fallback;
    return categories.find((c) => c.toLowerCase() === proposed) ?? fallback;
};

/** Structural validation of the model output. Never throws on model garbage. */
export function validateReceipt(
    raw: Record<string, unknown>,
    categories: readonly string[],
    todayIso: string,
): ReceiptExtraction {
    const rawItems = Array.isArray(raw.items) ? raw.items : [];
    const items: ReceiptLine[] = [];

    for (const entry of rawItems.slice(0, MAX_RECEIPT_ITEMS)) {
        if (!entry || typeof entry !== 'object') continue;
        const line = entry as Record<string, unknown>;
        const label = cleanString(line.label, MAX_LABEL);
        if (!label) continue;

        const quantity = cleanQuantity(line.quantity);
        const unitPrice = cleanAmount(line.unit_price, true);
        // A line whose total is missing can still be recovered from qty × unit price.
        const amount = cleanAmount(line.amount, false)
            || Math.round(quantity * unitPrice * 100) / 100;
        if (amount <= 0) continue;

        const pantryAmount = resolvePantryAmount(
            label,
            quantity,
            cleanString(line.pantry_unit, MAX_PANTRY_UNIT),
            cleanContent(line.pantry_content),
        );

        items.push({
            label,
            quantity,
            unit_price: unitPrice,
            amount,
            category: resolveCategory(line.category, categories),
            pantry_item: cleanString(line.pantry_item, MAX_PANTRY_NAME),
            pantry_unit: pantryAmount.unit,
            pantry_content: pantryAmount.content,
            pantry_stock: line.pantry_stock === true,
        });
    }

    const date = cleanString(raw.date, 10);
    const currency = cleanString(raw.currency, 3).toUpperCase();
    const lineTotal = Math.round(items.reduce((sum, line) => sum + line.amount, 0) * 100) / 100;
    let total = cleanAmount(raw.total, false);

    // No readable total, or the total contradicts the lines by more than 2%:
    // the lines are more precise, so they win. Below that the printed total is
    // kept (it absorbs legit rounding and paper discounts).
    if (items.length > 0 && (total === 0 || Math.abs(total - lineTotal) > Math.max(0.05, total * 0.02))) {
        total = lineTotal;
    }

    return {
        document_type: raw.document_type === 'invoice' ? 'invoice' : 'receipt',
        merchant: cleanString(raw.merchant, MAX_MERCHANT),
        date: isIsoDate(date) && date <= todayIso ? date : '',
        currency: /^[A-Z]{3}$/.test(currency) ? currency : '',
        total,
        category: resolveCategory(raw.category, categories),
        items,
    };
}

/**
 * One line typed by hand into a stored receipt (POST/PUT
 * /api/budget/receipts/:id/items). Same rules as an extracted line: a label, a
 * quantity (1 when absent or nonsense), a positive amount — or, absent, the
 * quantity × unit price — and a category mapped onto the family's list.
 * Returns null when nothing usable was sent.
 */
export function validateReceiptLine(
    raw: Record<string, unknown>,
    categories: readonly string[],
): ReceiptLine | null {
    const label = cleanString(raw.label, MAX_LABEL);
    if (!label) return null;

    const quantity = cleanQuantity(raw.quantity);
    const unitPrice = cleanAmount(raw.unit_price, true);
    const amount = cleanAmount(raw.amount, false) || Math.round(quantity * unitPrice * 100) / 100;
    if (amount <= 0) return null;

    // A line typed by hand was never seen by the model: there is no pantry name
    // to propose and no verdict on whether it is stock, so the pantry import
    // sends it to the pending list (the label is its stand-in name).
    //
    // Its amount is deliberately left at 0: there is no read ticket behind it,
    // so nothing here can be trusted to know how much the line holds. The label
    // inference (lib/quantityInference.custom.ts) runs at the analytics read and
    // in the pantry import, where the family can still correct it.
    return {
        label,
        quantity,
        unit_price: unitPrice,
        amount,
        category: resolveCategory(raw.category, categories),
        pantry_item: '',
        pantry_unit: '',
        // Nothing was read off a document: how much the line holds is unknown.
        pantry_content: 0,
        pantry_stock: false,
    };
}
