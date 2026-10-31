// Reading a list of payments off a screenshot: prompt + strict validation.
//
// The family's payments live outside the app — a meal-voucher app (Edenred), a
// bank app — and the budget only knows what someone typed or scanned. This is
// the reading half of the check: one screenshot goes to the configured model,
// which proposes the money-out lines it sees, and every field is re-validated
// here before a row is stored (`lib/expenseCheck.custom.ts` then decides which
// of them the budget already accounts for).
//
// Only money that LEFT the account counts: a top-up ("Money added via Apple
// Pay"), a balance header and the month tabs of a bank app are not expenses.
// The model is told so and the validator enforces it (a positive amount is
// dropped), because a wrongly kept top-up would be offered as a missing expense
// and one click away from a fake budget entry.
//
// The sign is the model's job: amounts come back NEGATIVE for a payment. A
// screenshot whose amounts carry no sign at all is a reading the family must
// verify, which is why the page shows every extracted line with its amount and
// lets the family delete one that the model misread.

import { createHash } from 'node:crypto';

/** Accepted screenshot types. A statement screenshot is never a PDF. */
export const TXN_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Screenshots per request, and the byte ceiling of one file. */
export const MAX_TXN_FILES = 6;
export const MAX_TXN_FILE_BYTES = 8 * 1024 * 1024;

/** Lines kept from one request (a bank app screenshot of one month fits). */
export const MAX_TXN_LINES = 150;

const MAX_SOURCE = 40;
const MAX_LABEL = 200;
const MAX_AMOUNT = 1_000_000;

export const TXN_SCHEMA: Record<string, unknown> = {
    type: 'object',
    additionalProperties: false,
    required: ['transactions'],
    properties: {
        transactions: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['source', 'date', 'label', 'amount', 'category'],
                properties: {
                    source: { type: 'string' },
                    date: { type: 'string' },
                    label: { type: 'string' },
                    amount: { type: 'number' },
                    category: { type: 'string' },
                },
            },
        },
    },
};

export interface ExtractedTransaction {
    /** App or bank the line comes from ('Edenred Meal', 'Belfius'), 'other' when unseen. */
    source: string;
    /** YYYY-MM-DD. The day the model could not place is replaced by `todayIso`. */
    date: string;
    /** Payee as the screen prints it, without the trailing '…'. */
    label: string;
    /** Amount paid, always > 0 (the screenshot's minus sign is dropped). */
    amount: number;
    /** A family budget category (mapped by the route, never invented). */
    category: string;
}

/**
 * System prompt. `categories` are the FAMILY's budget categories: the model must
 * map onto those, never onto invented ones.
 */
export function buildTransactionPrompt(
    categories: readonly string[],
    todayIso: string,
    currency: string,
): string {
    return [
        `Tu lis la capture d'écran d'une application de paiement ou de banque, pour l'application de budget familial d'un foyer.`,
        ``,
        `Date du jour : ${todayIso}. Devise habituelle du foyer : ${currency || 'EUR'}.`,
        ``,
        `Réponds UNIQUEMENT avec un objet JSON, sans texte autour, avec exactement ces champs :`,
        `- "transactions" : une entrée par PAIEMENT réellement effectué (argent SORTI du compte). Pour chacune :`,
        `  "source" = l'application ou la banque que la capture montre ("Edenred Meal", "Edenred Eco", "Belfius", "Bunq"…), recopiée telle quelle pour toutes ses lignes, "other" si on ne peut pas la nommer.`,
        `  "date" = la date du paiement, au format "YYYY-MM-DD". Un écran qui n'affiche que le jour et le mois ("29 oct") suit l'année en cours, ou l'année précédente si cette date est encore dans le futur : c'est toujours le jour le plus récent. "" seulement si aucune date n'est lisible.`,
        `  "label" = le commerçant ou le bénéficiaire exactement comme l'écran l'affiche ("ALBERT HEIJN LOKEREN", "BAKKERIJ CHEF FARINI"), sans le "..." d'une troncature et sans rien inventer pour la compléter.`,
        `  "amount" = le montant payé, en NOMBRE NÉGATIF ("-2.84"), même quand l'écran écrit "-2,84 €". Jamais une chaîne de caractères.`,
        `  "category" = la catégorie de ce paiement, choisie EXACTEMENT parmi : ${categories.join(', ')}.`,
        ``,
        `Règles :`,
        `- Ignore tout ce qui n'est pas un paiement : argent AJOUTÉ au compte ("Money added via Apple Pay", "Rechargement", un "+70"), le solde en haut de l'écran, les totaux par jour ou par mois, les onglets de mois, les en-têtes de date, les frais annoncés ("2 free transactions left") et les remboursements.`,
        `- Un montant positif ou sans signe n'est pas un paiement : ne le mets pas dans "transactions". Si l'écran n'affiche aucun signe du tout et liste des dépenses, considère chaque ligne comme un paiement et renvoie son montant en négatif.`,
        `- Ne devine ni commerçant, ni date, ni montant : dans le doute, laisse "" et n'invente pas de ligne.`,
        `- Une même dépense qui apparaît deux fois sur une capture ne compte qu'une fois. Si deux captures montrent la même ligne, renvoie-la une seule fois.`,
        `- Recopie les montants tels quels : ne les additionne pas, ne les arrondis pas et n'applique aucune conversion de devise.`,
        `- Maximum ${MAX_TXN_LINES} lignes.`,
    ].join('\n');
}

const cleanString = (value: unknown, maxLength: number): string =>
    typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : '';

const isIsoDate = (value: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/**
 * Maps a model-proposed category onto the family's list. Unknown → their
 * catch-all, same rule as the receipt import (`ai/receipt.custom.ts`).
 */
const resolveCategory = (value: unknown, categories: readonly string[]): string => {
    const fallback = categories.find((c) => c.toLowerCase() === 'autre') ?? categories[categories.length - 1] ?? '';
    const proposed = cleanString(value, 50).toLowerCase();
    if (!proposed) return fallback;
    return categories.find((c) => c.toLowerCase() === proposed) ?? fallback;
};

/**
 * Identity of one payment for a family: the same label on the same day for the
 * same amount is the same payment. It is what stops a second scan of the same
 * screenshot from queueing the same line twice. Two identical purchases at the
 * same shop on the same day collapse into one — accepted, like the receipt
 * fingerprint, because the alternative duplicates on every re-scan.
 */
export const transactionFingerprint = (source: string, date: string, amount: number, label: string): string =>
    createHash('sha256')
        .update(`${date}|${amount.toFixed(2)}|${label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')}|${source.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')}`)
        .digest('hex');

export interface TransactionExtraction {
    transactions: ExtractedTransaction[];
    /** Lines the model returned that are not a payment (income, zero, unreadable). */
    skipped: number;
}

/** Structural validation of the model output. Never throws on model garbage. */
export function validateTransactions(
    raw: Record<string, unknown>,
    categories: readonly string[],
    todayIso: string,
): TransactionExtraction {
    const lines = Array.isArray(raw.transactions) ? raw.transactions : [];
    const transactions: ExtractedTransaction[] = [];
    const seen = new Set<string>();
    let skipped = 0;

    for (const entry of lines.slice(0, MAX_TXN_LINES)) {
        if (!entry || typeof entry !== 'object') {
            skipped += 1;
            continue;
        }
        const line = entry as Record<string, unknown>;
        const label = cleanString(line.label, MAX_LABEL);
        const amount = typeof line.amount === 'number' ? line.amount : Number(String(line.amount ?? '').replace(',', '.'));
        // Money in (or nothing at all) is not an expense: this is the rule the
        // whole page rests on.
        if (!label || !Number.isFinite(amount) || amount >= 0 || amount < -MAX_AMOUNT) {
            skipped += 1;
            continue;
        }
        const date = cleanString(line.date, 10);
        const day = isIsoDate(date) ? date : todayIso;
        const source = cleanString(line.source, MAX_SOURCE) || 'other';
        const rounded = Math.round(Math.abs(amount) * 100) / 100;
        if (rounded <= 0) {
            skipped += 1;
            continue;
        }
        const fingerprint = transactionFingerprint(source, day, rounded, label);
        if (seen.has(fingerprint)) {
            skipped += 1;
            continue;
        }
        seen.add(fingerprint);
        transactions.push({
            source,
            date: day,
            label,
            amount: rounded,
            category: resolveCategory(line.category, categories),
        });
    }

    return { transactions, skipped };
}
