// In-browser mock backend for the static GitHub Pages demo. No network, no
// persistence: the store is recreated on every page load. It mirrors the shape
// of the real API responses ({ success, data }).
import { createSeed, type DemoStore } from './seed';

let store: DemoStore = createSeed();

// Family-customizable category lists (mirrors /api/categories). Reset on reload,
// like everything else in the demo. Keep in sync with hooks/useCategories.ts.
let demoCategories: Record<'shopping' | 'recipe' | 'budget', string[]> = {
    shopping: ['Alimentation', 'Bebe', 'Menage', 'Sante', 'Autre'],
    recipe: ['Entrée', 'Plat', 'Dessert', 'Snack'],
    budget: [
        'Logement', 'Alimentation', 'Transport', 'Santé', 'Loisirs',
        'Abonnements', 'Assurance', 'Enfants', 'Maison', 'Autre',
    ],
};

type Json = Record<string, unknown>;
const ok = <T,>(data: T) => ({ success: true, data });
// FORK-START: budget-custom
// Receipts imported during the demo session: the seeded store has none, and the
// demo has no backend to keep them, so they live here for the session.
let demoReceipts: Json[] = [];
// FORK-END: budget-custom
// FORK-START: lunchbox
// Same for the lunchboxes (see the /api/lunchbox handlers below).
let demoLunchboxes: Json[] = [];
const lunchboxHasItems = (items: unknown): boolean =>
    !!items &&
    typeof items === 'object' &&
    Object.values(items as Json).some((value) => typeof value === 'string' && value.trim().length > 0);
const lunchboxWithMember = (box: Json) => {
    const member = (store.familyMembers as Json[]).find((entry) => entry.id === box.family_member_id);
    return {
        ...box,
        family_member: { id: box.family_member_id, name: member?.name ?? '', color: member?.color ?? '#999' },
    };
};
// FORK-END: lunchbox
// FORK-START: pantry
// The pantry (see the /api/pantry handlers below): seeded with a few rows so the
// demo's page, its tabs and the dashboard widget have something to show.
const pantryKey = (name: string) =>
    name.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/œ/gi, 'oe').toLowerCase().trim().replace(/\s+/g, ' ');
// The server's second rule (lib/pantry.custom.ts, pantryHeadKey): a bare name
// lands on the household's own qualified row, so a ticket's 'Uien' adds up to
// 'Uien - Oignon' instead of opening a second row.
const pantryHeadKey = (name: string) => {
    const key = pantryKey(name);
    const cut = key.search(/[-–—,;:•·|/()[\]{}«»]/);
    return cut > 0 ? key.slice(0, cut).trim() : key;
};
let demoPantry: Json[] = [
    { id: 'pantry-demo-1', name: 'Lait', category: 'Alimentation', quantity: 1, unit: 'L', location: 'fridge', expires_on: null, low_stock_threshold: 1, lunchbox_bucket: 'drink', notes: null, source: 'manual' },
    { id: 'pantry-demo-2', name: 'Pommes', category: 'Alimentation', quantity: 6, unit: null, location: 'cellar', expires_on: null, low_stock_threshold: null, lunchbox_bucket: 'fruit', notes: null, source: 'manual' },
    { id: 'pantry-demo-3', name: 'Pâtes', category: 'Alimentation', quantity: 2, unit: 'paquet', location: 'pantry', expires_on: null, low_stock_threshold: 3, lunchbox_bucket: null, notes: null, source: 'manual' },
];
// The expiry demo: relative to the visitor's own day, so "use it up" always has
// two rows whatever day the demo is opened.
const demoPantrySeed = (): Json[] => {
    const inDays = (days: number) => {
        const date = new Date();
        date.setDate(date.getDate() + days);
        return date.toISOString().slice(0, 10);
    };
    return demoPantry.map((item, index) =>
        index === 0 ? { ...item, expires_on: inDays(2) } : index === 1 ? { ...item, expires_on: inDays(5) } : item);
};
const pantryAsItem = (item: Json) => ({ ...item, quantity: Number(item.quantity ?? 1) });

/**
 * Receipt lines the import refused to guess at (a fee, an unreadable label):
 * they wait here until the pantry page names or ignores them. Seeded so the
 * demo shows the review banner without importing a ticket first.
 */
let demoPantryPending: Json[] = [
    { id: 'pantry-pending-1', receipt_id: 'demo-receipt-1', label: 'SAC POUBELLE 30L X20', item: '', quantity: 1, unit: null, category: 'Maison', merchant: 'Supermarché Léon', date: null, created_at: new Date().toISOString() },
    { id: 'pantry-pending-2', receipt_id: 'demo-receipt-1', label: 'COTISATION MUTUELLE', item: '', quantity: 1, unit: null, category: 'Santé', merchant: 'Mutuelle Solidaris', date: null, created_at: new Date().toISOString() },
];

/** Merge lines into the demo pantry, by folded name, like the server does. */
const mergePantryLines = (lines: Json[], source = 'receipt'): { created: number; updated: number } => {
    let created = 0;
    let updated = 0;
    for (const line of lines) {
        const name = String(line.name ?? line.pantry_item ?? line.label ?? '').trim();
        if (!name) continue;
        const key = pantryKey(name);
        const mergeable = demoPantry.filter((item) => item.source !== 'grocy');
        const existing = mergeable.find((item) => pantryKey(String(item.name)) === key)
            ?? mergeable.find((item) => pantryHeadKey(String(item.name)) === key);
        if (existing) {
            existing.quantity = Number(existing.quantity ?? 0) + Number(line.quantity ?? 1);
            updated += 1;
        } else {
            demoPantry = [{
                id: uid(), name, category: line.category ?? 'Autre', quantity: Number(line.quantity ?? 1),
                unit: line.pantry_unit || line.unit || null, location: 'pantry', expires_on: null,
                low_stock_threshold: null, lunchbox_bucket: null, notes: null, source,
            }, ...demoPantry];
            created += 1;
        }
    }
    return { created, updated };
};

/**
 * The server's split (lib/pantry.custom.ts, splitReceiptLines): only a line the
 * model called stock AND named is merged straight in; the rest is queued.
 */
const splitReceiptLines = (items: Json[]): { stock: Json[]; pending: Json[] } => {
    const stock: Json[] = [];
    const pending: Json[] = [];
    for (const line of items) {
        const item = String(line.pantry_item ?? '').trim();
        const label = String(line.label ?? '').trim();
        if (!item && !label) continue;
        const row = {
            label: label || item, item, quantity: Number(line.quantity ?? 1) || 1,
            unit: line.pantry_unit || null, category: line.category ?? 'Autre',
        };
        if (item && line.pantry_stock === true) stock.push({ ...row, name: item });
        else pending.push(row);
    }
    return { stock, pending };
};

/** The manual "add to pantry" call: it has no per-line verdict, so it merges all. */
const importReceiptIntoPantry = (receipt: Json): { created: number; updated: number } =>
    mergePantryLines(Array.isArray(receipt?.items) ? (receipt.items as Json[]) : []);
// FORK-END: pantry
const uid = () =>
    (typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : 'id-' + Math.random().toString(36).slice(2));

const stripQuery = (ep: string) => {
    const i = ep.indexOf('?');
    return i >= 0 ? ep.slice(0, i) : ep;
};
const queryParams = (ep: string): Record<string, string> => {
    const i = ep.indexOf('?');
    if (i < 0) return {};
    return Object.fromEntries(new URLSearchParams(ep.slice(i + 1)));
};

const num = (v: unknown): number => {
    const n = typeof v === 'string' ? parseFloat(v) : (v as number);
    return Number.isFinite(n) ? (n as number) : 0;
};

function create(coll: keyof DemoStore, body: Json): Json {
    const item = { id: uid(), created_at: new Date().toISOString(), ...body };
    (store[coll] as Json[]).unshift(item);
    return item;
}
function update(coll: keyof DemoStore, id: string, body: Json): Json | null {
    const arr = store[coll] as Json[];
    const idx = arr.findIndex((x) => x.id === id);
    if (idx < 0) return null;
    arr[idx] = { ...arr[idx], ...body };
    return arr[idx];
}
function remove(coll: keyof DemoStore, id: string): void {
    store[coll] = (store[coll] as Json[]).filter((x) => x.id !== id) as never;
}

// Dates are naive ISO strings ("YYYY-MM-DD…"): parse month/year textually to
// avoid UTC-vs-local shifts. Month is 1-based, like the API's `month` params.
const monthOf = (iso: string) => parseInt(iso.slice(5, 7), 10);
const yearOf = (iso: string) => parseInt(iso.slice(0, 4), 10);

const monthYearOf = (q: Record<string, string>) => {
    const now = new Date();
    return {
        month: q.month ? parseInt(q.month, 10) : now.getMonth() + 1,
        year: q.year ? parseInt(q.year, 10) : now.getFullYear(),
    };
};

const entriesForMonth = (month: number, year: number) =>
    (store.budgetEntries as Json[]).filter(
        (e) => monthOf(e.date as string) === month && yearOf(e.date as string) === year
    );

function dashboard() {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const expenses = entriesForMonth(month, year).filter((e) => e.is_expense);
    const spentByCat: Record<string, number> = {};
    for (const e of expenses) spentByCat[e.category as string] = (spentByCat[e.category as string] || 0) + num(e.amount);
    // Like the server: only categories strictly OVER their limit for the current month.
    const budgetAlerts = (store.budgetLimits as Json[]).filter(
        (l) => num(l.month) === month && num(l.year) === year && (spentByCat[l.category as string] || 0) > num(l.monthly_limit)
    ).length;
    // Like the server: appointments starting within the next 7 days.
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return {
        upcomingAppointments: (store.appointments as Json[]).filter((a) => {
            const start = new Date(a.start_time as string);
            return start >= now && start <= in7Days;
        }).length,
        pendingTasks: (store.tasks as Json[]).filter((t) => !t.is_completed).length,
        shoppingItems: (store.shopping as Json[]).filter((s) => !s.is_checked).length,
        thisMonthExpenses: expenses.reduce((s, e) => s + num(e.amount), 0),
        budgetAlerts,
    };
}

// ── Rewards (gamified kids mode) ─────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, '0');
const naiveNow = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};

const rewardTx = () => store.rewardTransactions as Json[];

// One 'earn' transaction per assigned member, like the server.
function awardTaskPoints(task: Json): void {
    const assigned = (task.assigned_to as string[]) || [];
    for (const memberId of assigned) {
        rewardTx().unshift({
            id: uid(), member_id: memberId, task_id: task.id, points: num(task.points),
            type: 'earn', note: task.title, created_at: naiveNow(),
        });
    }
}

// Consecutive-day streak ending today or yesterday (same rule as the server).
function computeStreak(days: Set<string>): number {
    const key = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const cursor = new Date();
    if (!days.has(key(cursor))) {
        cursor.setDate(cursor.getDate() - 1);
        if (!days.has(key(cursor))) return 0;
    }
    let streak = 0;
    while (days.has(key(cursor))) {
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
}

function rewardsSummary() {
    const pointsValue = num((store.rewardSettings as Json).points_value) || 0.1;
    const tasks = store.tasks as Json[];
    const members = (store.familyMembers as Json[]).map((m) => {
        const txs = rewardTx().filter((t) => t.member_id === m.id);
        const balance = txs.reduce((s, t) => s + num(t.points), 0);
        const pending = tasks.filter(
            (t) => t.pending_approval && ((t.assigned_to as string[]) || []).includes(m.id as string)
        ).length;
        const days = new Set<string>();
        for (const t of txs) if (t.type === 'earn') days.add((t.created_at as string).slice(0, 10));
        for (const t of tasks) {
            if (t.is_completed && t.completed_at && ((t.assigned_to as string[]) || []).includes(m.id as string)) {
                days.add((t.completed_at as string).slice(0, 10));
            }
        }
        return {
            id: m.id, name: m.name, color: m.color, role: m.role,
            linked_user_id: (m.linked_user_id as string) ?? null,
            balance,
            currency_value: Math.round(balance * pointsValue * 100) / 100,
            pending_count: pending,
            streak: computeStreak(days),
            has_activity: txs.length > 0,
        };
    });
    const membersById = new Map((store.familyMembers as Json[]).map((m) => [m.id, m]));
    const pendingTasks = tasks.filter((t) => t.pending_approval).map((t) => ({
        id: t.id, title: t.title, points: num(t.points),
        assigned_to_members: ((t.assigned_to as string[]) || [])
            .map((mid) => membersById.get(mid))
            .filter(Boolean)
            .map((m) => ({ id: (m as Json).id, name: (m as Json).name, color: (m as Json).color })),
    }));
    return { points_value: pointsValue, currency: (store.user.currency as string) || 'EUR', members, pending_tasks: pendingTasks };
}

function taskStats() {
    const tasks = store.tasks as Json[];
    const total = tasks.length;
    const completed = tasks.filter((t) => t.is_completed).length;
    const pending = total - completed;
    const byPriority = { Haute: 0, Moyenne: 0, Basse: 0 } as Record<string, number>;
    for (const t of tasks) if (t.priority) byPriority[t.priority as string] = (byPriority[t.priority as string] || 0) + 1;
    return { total, completed, pending, completionRate: total ? Math.round((completed / total) * 100) : 0, byPriority };
}

// Pointing status is tracked per month/year, like the server's
// recurring_expense_logs table. The seed's is_pointed flags are the baseline
// for the current month; other months start unpointed.
const recurringLogs = new Map<string, boolean>();
const logKey = (id: string, month: number, year: number) => `${id}:${month}:${year}`;

function recurringForMonth(month: number, year: number): Json[] {
    const now = new Date();
    const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear();
    return (store.budgetRecurring as Json[])
        .filter((r) => r.is_active !== false)
        .map((r) => {
            const logged = recurringLogs.get(logKey(r.id as string, month, year));
            // Same shape as the server: one monthly occurrence on the debit day,
            // clamped to the month's last day.
            const day = Math.min(num(r.debit_day) || 1, new Date(year, month, 0).getDate());
            const occurrenceDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            return {
                recurrence_frequency: 'monthly',
                recurrence_interval: 1,
                recurrence_until: null,
                is_expense: true,
                start_date: `${year}-01-${String(Math.min(num(r.debit_day) || 1, 28)).padStart(2, '0')}`,
                ...r,
                series_id: r.id,
                occurrence_id: `${r.id}:${occurrenceDate}`,
                occurrence_date: occurrenceDate,
                is_pointed: logged !== undefined ? logged : isCurrentMonth && Boolean(r.is_pointed),
            };
        });
}

function budgetForecast(month: number, year: number) {
    const entries = entriesForMonth(month, year);
    const income = entries.filter((e) => !e.is_expense).reduce((s, e) => s + num(e.amount), 0);
    const oneTimeExpenses = entries.filter((e) => e.is_expense).reduce((s, e) => s + num(e.amount), 0);
    const recurring = recurringForMonth(month, year);
    const pointedRecurring = recurring.filter((r) => r.is_pointed).reduce((s, r) => s + num(r.amount), 0);
    const unpointedRecurring = recurring.filter((r) => !r.is_pointed).reduce((s, r) => s + num(r.amount), 0);
    const currentBalance = income - oneTimeExpenses - pointedRecurring;
    return { income, oneTimeExpenses, pointedRecurring, unpointedRecurring, currentBalance, forecastBalance: currentBalance - unpointedRecurring };
}

function budgetStatistics(month: number, year: number) {
    const entries = entriesForMonth(month, year);
    const totalExpenses = entries.filter((e) => e.is_expense).reduce((s, e) => s + num(e.amount), 0);
    const totalIncome = entries.filter((e) => !e.is_expense).reduce((s, e) => s + num(e.amount), 0);
    const byCatMap: Record<string, number> = {};
    for (const e of entries) if (e.is_expense) byCatMap[e.category as string] = (byCatMap[e.category as string] || 0) + num(e.amount);
    // Mirror the server: recurring debits show as one dedicated "Prélèvements"
    // slice in the category pie (not merged into their own categories).
    const recurringTotal = recurringForMonth(month, year).reduce((s, r) => s + num(r.amount), 0);
    if (recurringTotal > 0) byCatMap['Prélèvements'] = (byCatMap['Prélèvements'] || 0) + recurringTotal;
    const byCategory = Object.entries(byCatMap).map(([category, category_total]) => ({ category, category_total }));
    return { totalExpenses, totalIncome, balance: totalIncome - totalExpenses, byCategory };
}

// ── Kakeibo (mirrors server/src/routes/kakeibo.ts) ──────────────────────────
const KAKEIBO_PILLAR_BY_CATEGORY: Record<string, string> = {
    'Logement': 'survival', 'Alimentation': 'survival', 'Transport': 'survival',
    'Santé': 'survival', 'Assurance': 'survival', 'Enfants': 'survival',
    'Abonnements': 'wants', 'Maison': 'wants', 'Loisirs': 'culture',
    'Autre': 'extra', 'Prélèvements': 'survival',
};
const kakeiboState = { savingsGoal: 400, notes: '' as string };
const pillarFor = (cat: string) => KAKEIBO_PILLAR_BY_CATEGORY[cat] || 'wants';

function kakeiboSummary(month: number, year: number) {
    const members = store.familyMembers as Json[];
    const incomes = members
        .filter((m) => num(m.monthly_income) > 0)
        .map((m) => ({ id: m.id, name: m.name, color: m.color, monthly_income: num(m.monthly_income) }));
    const salaryIncome = incomes.reduce((s, m) => s + m.monthly_income, 0);
    const entries = entriesForMonth(month, year);
    const extraIncome = entries.filter((e) => !e.is_expense).reduce((s, e) => s + num(e.amount), 0);
    const totalIncome = salaryIncome + extraIncome;

    const spentByCategory: Record<string, number> = {};
    for (const e of entries) if (e.is_expense) spentByCategory[e.category as string] = (spentByCategory[e.category as string] || 0) + num(e.amount);
    for (const r of recurringForMonth(month, year)) {
        const c = (r.category as string) || 'Maison';
        spentByCategory[c] = (spentByCategory[c] || 0) + num(r.amount);
    }
    const byPillar: Record<string, number> = { survival: 0, wants: 0, culture: 0, extra: 0 };
    const byCategory = Object.entries(spentByCategory).map(([category, amount]) => {
        const pillar = pillarFor(category);
        byPillar[pillar] += amount;
        return { category, amount, pillar };
    }).sort((a, b) => b.amount - a.amount);
    const totalExpenses = Object.values(spentByCategory).reduce((s, v) => s + v, 0);

    const savingsGoal = kakeiboState.savingsGoal;
    const availableToSpend = totalIncome - savingsGoal;
    const actualSavings = totalIncome - totalExpenses;
    return {
        month, year, incomes, salaryIncome, extraIncome, totalIncome,
        savingsGoal, availableToSpend, totalExpenses, actualSavings,
        savingsGoalReached: actualSavings >= savingsGoal, byPillar, byCategory,
        notes: kakeiboState.notes || null,
    };
}

function budgetMonthly(year: number) {
    const totalRecurring = (store.budgetRecurring as Json[])
        .filter((r) => r.is_active !== false)
        .reduce((s, r) => s + num(r.amount), 0);
    return Array.from({ length: 12 }, (_, i) => {
        const stats = budgetStatistics(i + 1, year);
        return {
            month: i + 1,
            totalExpenses: stats.totalExpenses,
            totalIncome: stats.totalIncome,
            totalRecurring,
            balance: stats.balance,
        };
    });
}

async function route(method: string, path: string, q: Record<string, string>, body: Json): Promise<unknown> {
    const seg = path.split('/').filter(Boolean); // e.g. ['api','tasks','123']
    const last = seg[seg.length - 1];

    // ── Auth ──────────────────────────────────────────────────────────────────
    if (path === '/api/auth/me') return ok({ user: store.user });
    if (path === '/api/auth/login' || path === '/api/auth/register' || path === '/api/auth/refresh' || path === '/api/invites/join' || path === '/api/invites/leave')
        return ok({ token: 'demo-token', user: store.user });
    if (path === '/api/auth/currency') { store.user = { ...store.user, currency: body.currency }; return ok({ user: store.user }); }
    if (path === '/api/auth/language') {
        if (!['fr', 'en', 'pt', 'ru', 'zh', 'es'].includes(String(body.language))) throw new Error('Invalid language'); // mirrors the server's 400
        store.user = { ...store.user, language: body.language };
        return ok({ user: store.user });
    }
    if (path === '/api/auth/regional-preferences') {
        const raw = body.week_start_day;
        const day = raw === null || raw === '' || raw === undefined ? null : Number(raw);
        if (day !== null && (!Number.isInteger(day) || day < 1 || day > 7)) throw new Error('Invalid week_start_day'); // mirrors the server's 400
        store.user = { ...store.user, week_start_day: day };
        return ok({ user: store.user });
    }
    if (path === '/api/auth/profile') { store.user = { ...store.user, ...body }; return ok({ user: store.user }); }
    // FORK-START: demo-prefs
    // The catch-all at the bottom answers `[]`, which is not a DashboardPrefs
    // object: the dashboard then throws on `prefs.order.filter` and the demo's
    // default route renders nothing. The demo has no weather backend, so the two
    // custom widgets start hidden here and the upstream widgets keep their
    // default order.
    if (path === '/api/auth/dashboard-prefs' && method === 'GET') {
        return ok({ order: ['stats', 'weather', 'activities', 'pantry', 'agenda', 'planning', 'quick', 'notes'], hidden: ['weather', 'activities'], agendaView: 'day' });
    }
    if (path === '/api/auth/dashboard-prefs' && method === 'PUT') {
        // Echo what the customiser sent, as the server does.
        return ok(body);
    }
    // ── Dashboard ───────────────────────────────────────────────────────────
    if (path === '/api/posts/latest') {
        // Same trap as the prefs above: the catch-all answers `[]`, the dashboard
        // stores it as the latest post and then dereferences `author_name`. This
        // endpoint returns an object or null, so answer null (no post yet).
        return ok(null);
    }
    // FORK-END: demo-prefs
    if (path === '/api/auth/modules') {
        if (method === 'PUT') {
            const list = Array.isArray(body.disabled_modules) ? (body.disabled_modules as string[]) : [];
            const cleaned = Array.from(new Set(list));
            store.user = { ...store.user, disabled_modules: cleaned };
            return ok({ disabled_modules: cleaned });
        }
        return ok({ disabled_modules: (store.user.disabled_modules as string[]) ?? [] });
    }

    // ── Categories (family-customizable lists) ───────────────────────────────
    if (path === '/api/categories') {
        if (method === 'PUT') {
            const mod = body.module as string;
            const list = Array.isArray(body.categories) ? (body.categories as string[]) : [];
            if ((mod === 'shopping' || mod === 'recipe' || mod === 'budget') && list.length > 0) {
                demoCategories = { ...demoCategories, [mod]: list.map((c) => String(c).trim()).filter(Boolean) };
            }
        }
        return ok({ categories: demoCategories });
    }

    // ── Dashboard ───────────────────────────────────────────────────────────
    if (path === '/api/dashboard') return ok(dashboard());

    // ── Shopping ──────────────────────────────────────────────────────────────
    if (path === '/api/shopping' && method === 'GET') return ok(store.shopping);
    if (path === '/api/shopping' && method === 'POST') return ok(create('shopping', { is_checked: false, ...body }));
    if (path === '/api/shopping/templates' && method === 'GET') return ok(store.shoppingTemplates);
    if (path === '/api/shopping/templates' && method === 'POST') return ok(create('shoppingTemplates', body));
    if (path === '/api/shopping/checked/clear') { store.shopping = (store.shopping as Json[]).filter((s) => !s.is_checked) as never; return ok({}); }
    if (seg[1] === 'shopping' && seg[2] === 'templates' && seg[4] === 'apply') {
        const tpl = (store.shoppingTemplates as Json[]).find((t) => t.id === seg[3]);
        const items = (tpl?.items as Json[]) || [];
        for (const it of items) create('shopping', { is_checked: false, ...it });
        return ok({});
    }
    if (seg[1] === 'shopping' && seg[2] === 'templates' && method === 'DELETE') { remove('shoppingTemplates', seg[3]); return ok({}); }
    if (seg[1] === 'shopping' && seg.length === 3) {
        if (method === 'PUT') return ok(update('shopping', seg[2], body));
        if (method === 'DELETE') { remove('shopping', seg[2]); return ok({}); }
    }

    // ── Family ────────────────────────────────────────────────────────────────
    if (path === '/api/family' && method === 'GET') return ok(store.familyMembers);
    if (path === '/api/family' && method === 'POST') return ok(create('familyMembers', body));
    // Link a member profile to a user account (one profile per account, like the server).
    if (seg[1] === 'family' && seg.length === 4 && seg[3] === 'link' && method === 'PUT') {
        const targetUserId = (body.user_id as string) || null;
        if (targetUserId) {
            for (const m of store.familyMembers as Json[]) {
                if (m.linked_user_id === targetUserId && m.id !== seg[2]) m.linked_user_id = null;
            }
        }
        return ok(update('familyMembers', seg[2], { linked_user_id: targetUserId }));
    }
    if (seg[1] === 'family' && seg.length === 3) {
        if (method === 'PUT') return ok(update('familyMembers', seg[2], body));
        if (method === 'DELETE') { remove('familyMembers', seg[2]); return ok({}); }
    }

    // ── Tasks ─────────────────────────────────────────────────────────────────
    if (path === '/api/tasks' && method === 'GET') return ok(store.tasks);
    if (path === '/api/tasks' && method === 'POST') return ok(create('tasks', { is_completed: false, points: 0, pending_approval: false, ...body }));
    if (path === '/api/tasks/statistics') return ok(taskStats());
    // Parent approval of a child-completed chore (the demo account is a parent).
    if (seg[1] === 'tasks' && seg.length === 4 && (seg[3] === 'approve' || seg[3] === 'reject') && method === 'POST') {
        const task = (store.tasks as Json[]).find((x) => x.id === seg[2]);
        if (!task) return ok(null);
        if (seg[3] === 'approve') {
            if (task.pending_approval && num(task.points) > 0) awardTaskPoints(task);
            return ok(update('tasks', seg[2], { pending_approval: false }));
        }
        return ok(update('tasks', seg[2], { pending_approval: false, is_completed: false, completed_at: undefined }));
    }
    if (seg[1] === 'tasks' && seg.length === 3) {
        if (method === 'PUT') {
            const existing = (store.tasks as Json[]).find((x) => x.id === seg[2]);
            const wasCompleted = Boolean(existing?.is_completed);
            const updated = update('tasks', seg[2], body);
            if (updated && body.is_completed === true && !wasCompleted) {
                updated.completed_at = naiveNow();
                // The demo user is a parent → award immediately (false→true only).
                if (num(updated.points) > 0 && ((updated.assigned_to as string[]) || []).length > 0) {
                    awardTaskPoints(updated);
                }
            }
            if (updated && body.is_completed === false && wasCompleted) {
                // Reverse the current completion: drop its earn transactions.
                const since = (existing?.completed_at as string) || '';
                store.rewardTransactions = rewardTx().filter(
                    (t) => !(t.task_id === seg[2] && t.type === 'earn' && (t.created_at as string) >= since)
                ) as never;
                updated.pending_approval = false;
                updated.completed_at = undefined;
            }
            return ok(updated);
        }
        if (method === 'DELETE') { remove('tasks', seg[2]); return ok({}); }
    }

    // ── Rewards ─────────────────────────────────────────────────────────────────
    if (path === '/api/rewards/summary') return ok(rewardsSummary());
    if (path === '/api/rewards/transactions') {
        let list = rewardTx();
        if (q.member_id) list = list.filter((t) => t.member_id === q.member_id);
        return ok([...list].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 50));
    }
    if (path === '/api/rewards/adjust' && method === 'POST') {
        const item = { id: uid(), member_id: body.member_id, task_id: null, points: num(body.points), type: 'adjust', note: body.note || null, created_at: naiveNow() };
        rewardTx().unshift(item);
        return ok(item);
    }
    if (path === '/api/rewards/redeem' && method === 'POST') {
        const item = { id: uid(), member_id: body.member_id, task_id: null, points: -Math.abs(num(body.points)), type: 'redeem', note: body.note || null, created_at: naiveNow() };
        rewardTx().unshift(item);
        return ok(item);
    }
    if (path === '/api/rewards/settings' && method === 'GET') return ok({ points_value: num((store.rewardSettings as Json).points_value) || 0.1 });
    if (path === '/api/rewards/settings' && method === 'PUT') {
        store.rewardSettings = { points_value: num(body.points_value) };
        return ok({ points_value: num(body.points_value) });
    }
    // Savings goals (one active goal per member, like the server).
    if (path === '/api/rewards/goals' && method === 'GET') return ok(store.rewardGoals);
    if (path === '/api/rewards/goals' && method === 'POST') {
        const hasActive = (store.rewardGoals as Json[]).some((g) => g.member_id === body.member_id && g.status === 'active');
        if (hasActive) throw new Error('An active goal already exists for this member');
        return ok(create('rewardGoals', {
            member_id: body.member_id,
            title: String(body.title || '').trim(),
            emoji: body.emoji ? String(body.emoji).trim().slice(0, 16) : null,
            target_amount: Math.round(num(body.target_amount) * 100) / 100,
            status: 'active',
            achieved_at: null,
        }));
    }
    // Parent marks the goal achieved → auto-redeem the equivalent points, capped at the balance.
    if (seg[1] === 'rewards' && seg[2] === 'goals' && seg.length === 5 && seg[4] === 'achieve' && method === 'POST') {
        const goal = (store.rewardGoals as Json[]).find((g) => g.id === seg[3] && g.status === 'active');
        if (!goal) return ok(null);
        update('rewardGoals', seg[3], { status: 'achieved', achieved_at: naiveNow() });
        const pointsValue = num((store.rewardSettings as Json).points_value) || 0.1;
        const balance = rewardTx().filter((t) => t.member_id === goal.member_id).reduce((s, t) => s + num(t.points), 0);
        const redeemPoints = Math.min(Math.max(Math.round(num(goal.target_amount) / pointsValue), 0), Math.max(balance, 0));
        if (redeemPoints > 0) {
            rewardTx().unshift({
                id: uid(), member_id: goal.member_id, task_id: null, points: -redeemPoints,
                type: 'redeem', note: goal.emoji ? `${goal.emoji} ${goal.title}` : goal.title, created_at: naiveNow(),
            });
        }
        return ok({ ...goal, redeemed_points: redeemPoints });
    }
    if (seg[1] === 'rewards' && seg[2] === 'goals' && seg.length === 4) {
        if (method === 'PUT') return ok(update('rewardGoals', seg[3], {
            ...(body.title !== undefined ? { title: String(body.title || '').trim() } : {}),
            ...(body.emoji !== undefined ? { emoji: body.emoji ? String(body.emoji).trim().slice(0, 16) : null } : {}),
            ...(body.target_amount !== undefined ? { target_amount: Math.round(num(body.target_amount) * 100) / 100 } : {}),
        }));
        if (method === 'DELETE') { remove('rewardGoals', seg[3]); return ok({}); }
    }

    // ── Appointments / calendar ────────────────────────────────────────────────
    if (path === '/api/appointments' && method === 'GET') {
        let list = store.appointments as Json[];
        // Like the server, match any appointment OVERLAPPING the range:
        // COALESCE(end_time, start_time) >= start_date AND start_time <= end_date.
        // Timestamps are naive "YYYY-MM-DDTHH:mm:ss" strings, so plain string
        // comparison is correct.
        if (q.start_date) list = list.filter((a) => ((a.end_time as string) || (a.start_time as string)) >= q.start_date);
        if (q.end_date) list = list.filter((a) => (a.start_time as string) <= q.end_date);
        return ok(list);
    }
    if (path === '/api/appointments' && method === 'POST') return ok(create('appointments', body));
    if (seg[1] === 'appointments' && seg.length === 3) {
        if (method === 'PUT') return ok(update('appointments', seg[2], body));
        if (method === 'DELETE') { remove('appointments', seg[2]); return ok({}); }
    }
    if (path === '/api/calendar/token' || path === '/api/calendar/token/reset') return ok({ token: 'demo-ical-token' });

    // ── Planning ────────────────────────────────────────────────────────────────
    // The server denormalises the participants into each entry; do the same here
    // or the week grid has colours and names to show for nobody.
    const withParticipants = (entry: Json): Json => {
        const byId = new Map((store.familyMembers as Json[]).map((m) => [m.id, m]));
        const ids = Array.isArray(entry.family_member_ids)
            ? (entry.family_member_ids as string[])
            : [entry.family_member_id as string];
        const people = ids.map((id) => byId.get(id)).filter(Boolean) as Json[];
        const primary = people[0];
        return {
            ...entry,
            family_member_id: primary?.id ?? entry.family_member_id,
            family_member_name: primary?.name ?? entry.family_member_name,
            family_member_color: primary?.color ?? entry.family_member_color,
            family_member_role: primary?.role ?? entry.family_member_role,
            participants: people.map((m) => ({ id: m.id, name: m.name, color: m.color, role: m.role })),
            participant_ids: people.map((m) => m.id),
            excluded_dates: (entry.excluded_dates as string[]) || [],
        };
    };

    if (path === '/api/planning' && method === 'GET') {
        return ok((store.planning as Json[]).map(withParticipants));
    }
    if (path === '/api/planning' && method === 'POST') {
        return ok(withParticipants(create('planning', body)));
    }
    if (path === '/api/planning/bulk') {
        const days = (body.day_of_week_list as number[]) || [];
        const created = days.map((d) => withParticipants(create('planning', { ...body, day_of_week: d })));
        return ok({ entries: created, created: created.length, updated: 0, conflicts: [] });
    }
    // Skipping one occurrence: /api/planning/:id/exceptions[/:date]
    if (seg[1] === 'planning' && seg[3] === 'exceptions') {
        const entry = (store.planning as Json[]).find((e) => e.id === seg[2]);
        if (!entry) return ok(null);
        const dates = new Set((entry.excluded_dates as string[]) || []);
        if (method === 'POST' && typeof body.date === 'string') dates.add(body.date);
        if (method === 'DELETE' && seg[4]) dates.delete(decodeURIComponent(seg[4]));
        entry.excluded_dates = [...dates].sort();
        return ok(withParticipants(entry));
    }
    if (seg[1] === 'planning' && seg.length === 3) {
        if (method === 'PUT') {
            const updated = update('planning', seg[2], body);
            return ok(updated ? withParticipants(updated) : null);
        }
        if (method === 'DELETE') { remove('planning', seg[2]); return ok({}); }
    }

    // ── Recipes ─────────────────────────────────────────────────────────────────
    if (path === '/api/recipes/import-url' && method === 'POST') {
        // Static demo: no server to fetch/parse the page (CORS would block it
        // anyway), so return a canned parsed recipe after a realistic delay.
        await new Promise((resolve) => setTimeout(resolve, 900));
        return ok({
            name: 'Ratatouille traditionnelle',
            category: 'Plat',
            description: 'La ratatouille provençale mijotée : des légumes du soleil fondants, parfumés au thym et à l\'huile d\'olive.',
            ingredients: [
                '2 aubergines',
                '3 courgettes',
                '2 poivrons (1 rouge, 1 jaune)',
                '4 tomates bien mûres',
                '2 oignons',
                '3 gousses d\'ail',
                '4 c. à soupe d\'huile d\'olive',
                '1 bouquet garni (thym, laurier)',
                'Sel et poivre du moulin',
            ],
            instructions: [
                'Laver et couper tous les légumes en dés réguliers.',
                'Faire revenir les oignons et l\'ail émincés dans l\'huile d\'olive.',
                'Ajouter les poivrons, puis les aubergines et les courgettes, et faire dorer 10 minutes.',
                'Incorporer les tomates concassées et le bouquet garni, saler et poivrer.',
                'Couvrir et laisser mijoter 45 minutes à feu doux en remuant de temps en temps.',
                'Rectifier l\'assaisonnement et servir bien chaud, ou tiède avec un filet d\'huile d\'olive.',
            ],
            prep_time: 25,
            cook_time: 55,
            servings: 6,
            difficulty: null,
            tags: ['provençal', 'légumes', 'été', 'végétarien'],
            image_url: null,
        });
    }
    if (path === '/api/recipes' && method === 'GET') return ok(store.recipes);
    if (path === '/api/recipes' && method === 'POST') return ok(create('recipes', body));
    if (seg[1] === 'recipes' && seg.length === 3) {
        if (method === 'PUT') return ok(update('recipes', seg[2], body));
        if (method === 'DELETE') { remove('recipes', seg[2]); return ok({}); }
    }

    // ── Meal plans ──────────────────────────────────────────────────────────────
    if (path === '/api/meal-plans' && method === 'GET') {
        let list = store.mealPlans as Json[];
        if (q.start_date && q.end_date) {
            list = list.filter((mp) => (mp.date as string) >= q.start_date && (mp.date as string) <= q.end_date);
        }
        return ok(list);
    }
    if (path === '/api/meal-plans' && method === 'POST') {
        const recipe = (store.recipes as Json[]).find((r) => r.id === body.recipe_id);
        return ok(create('mealPlans', { ...body, recipe: recipe ? { id: recipe.id, name: recipe.name } : undefined }));
    }
    if (seg[1] === 'meal-plans' && seg.length === 3) {
        if (method === 'PUT') {
            const recipe = (store.recipes as Json[]).find((r) => r.id === body.recipe_id);
            return ok(update('mealPlans', seg[2], { ...body, recipe: recipe ? { id: recipe.id, name: recipe.name } : undefined }));
        }
        if (method === 'DELETE') { remove('mealPlans', seg[2]); return ok({}); }
    }

    // ── Lunchboxes (fork) ───────────────────────────────────────────────────────
    // FORK-START: lunchbox
    // The session's lunchboxes live outside the seeded store (upstream owns
    // seed.ts), like the imported receipts. The two AI endpoints answer from the
    // caller's own input instead of canned prose: a demo has no language, and a
    // hardcoded sentence would be wrong in five of the six locales.
    if (path === '/api/lunchbox' && method === 'GET') {
        let list = demoLunchboxes;
        if (q.start_date && q.end_date) {
            list = list.filter((lb) => (lb.date as string) >= q.start_date && (lb.date as string) <= q.end_date);
        }
        return ok(list.map(lunchboxWithMember));
    }
    if (path === '/api/lunchbox' && method === 'POST') {
        if (!lunchboxHasItems(body.items)) return { success: false, error: 'LUNCHBOX_EMPTY' };
        const existing = demoLunchboxes.find(
            (lb) => lb.family_member_id === body.family_member_id && lb.date === body.date);
        const row: Json = existing ? { ...existing, ...body } : { id: uid(), ...body };
        demoLunchboxes = existing
            ? demoLunchboxes.map((lb) => (lb.id === row.id ? row : lb))
            : [row, ...demoLunchboxes];
        return ok(lunchboxWithMember(row));
    }
    if (path === '/api/lunchbox/shopping-list' && method === 'POST') {
        const boxes = demoLunchboxes.filter(
            (lb) => (lb.date as string) >= String(body.start_date) && (lb.date as string) <= String(body.end_date));
        const tally = new Map<string, { label: string; count: number }>();
        for (const box of boxes) {
            const items = (box.items || {}) as Json;
            for (const value of Object.values(items)) {
                if (typeof value !== 'string' || !value.trim()) continue;
                const key = value.trim().toLowerCase();
                const current = tally.get(key);
                if (current) current.count += 1;
                else tally.set(key, { label: value.trim(), count: 1 });
            }
        }
        const onList = new Set(
            (store.shopping as Json[]).filter((s) => !s.is_checked).map((s) => String(s.name).trim().toLowerCase()));
        let created = 0;
        let skipped = 0;
        for (const [key, item] of tally) {
            if (onList.has(key)) { skipped += 1; continue; }
            create('shopping', { user_id: 'demo', name: item.label, category: demoCategories.shopping[0], quantity: item.count, is_checked: false, notes: null });
            created += 1;
        }
        return ok({ created, skipped, total_lunchboxes: boxes.length });
    }
    if (path === '/api/lunchbox/ai/ideas' && method === 'POST') {
        const mains = (body.availableMains as string[]) || [];
        const fruits = (body.availableFruits as string[]) || [];
        const snacks = (body.availableSnacks as string[]) || [];
        const drinks = (body.availableDrinks as string[]) || [];
        const ideas = mains.slice(0, 3).map((main, index) => ({
            main,
            fruit: fruits[index % Math.max(fruits.length, 1)] ?? '',
            snack: snacks[index % Math.max(snacks.length, 1)] ?? '',
            drink: drinks[index % Math.max(drinks.length, 1)] ?? '',
            reasoning: '',
            warnings: [],
        }));
        return ok({ ideas, model: 'demo' });
    }
    if (path === '/api/lunchbox/nutrition' && method === 'POST') {
        const labels = (store.mealPlans as Json[])
            .filter((mp) => (mp.date as string) >= String(body.start_date) && (mp.date as string) <= String(body.end_date))
            .map((mp) => (mp.custom_meal as string) || ((mp.recipe as Json)?.name as string) || '')
            .filter(Boolean);
        for (const box of demoLunchboxes) {
            const items = Object.values((box.items || {}) as Json).filter((v) => typeof v === 'string' && v.trim());
            if (items.length > 0) labels.push(items.join(', '));
        }
        if (labels.length === 0) return { success: false, error: 'NO_PLANNED_MEALS' };
        // The server derives the verdict from the score's band; the demo must not
        // hand a gauge and a chip that disagree (62 is not "good").
        const score = 72;
        return ok({
            analysis: {
                score,
                verdict: score >= 80 ? 'excellent' : score >= 65 ? 'good' : score >= 45 ? 'needs_improvement' : 'unbalanced',
                summary: labels.join(' · '),
                strengths: [],
                weaknesses: [],
                missingFoodGroups: [],
                recommendations: [],
            },
            mealsAnalyzed: labels.length,
            model: 'demo',
        });
    }
    if (seg[1] === 'lunchbox' && seg.length === 3) {
        if (method === 'PUT') return ok(lunchboxWithMember({ ...(demoLunchboxes.find((lb) => lb.id === seg[2]) || {}), ...body }));
        if (method === 'DELETE') { demoLunchboxes = demoLunchboxes.filter((lb) => lb.id !== seg[2]); return ok({}); }
    }
    // ── Pantry (fork) ───────────────────────────────────────────────────────────
    // FORK-START: pantry
    // Same shape as the real router, including the two answers the page reacts
    // to: DUPLICATE_NAME when a name is already in the pantry, and
    // NO_GROCY_INTEGRATION (a demo has no Grocy to talk to).
    if (path === '/api/pantry' && method === 'GET') {
        let list = demoPantrySeed();
        if (q.location) list = list.filter((item) => item.location === q.location);
        if (q.filter === 'low_stock') {
            list = list.filter((item) => item.low_stock_threshold !== null && Number(item.quantity) <= Number(item.low_stock_threshold));
        }
        if (q.filter === 'expiring') {
            const days = Number(q.days ?? 14);
            const limit = new Date();
            limit.setDate(limit.getDate() + (Number.isFinite(days) ? days : 14));
            const today = new Date().toISOString().slice(0, 10);
            const end = limit.toISOString().slice(0, 10);
            list = list.filter((item) => typeof item.expires_on === 'string' && item.expires_on >= today && item.expires_on <= end);
        }
        return ok({ items: list.map(pantryAsItem) });
    }
    if (path === '/api/pantry' && method === 'POST') {
        const name = String(body.name ?? '').trim();
        if (!name) return { success: false, error: 'INVALID_ITEM' };
        const key = pantryKey(name);
        if (demoPantry.some((item) => pantryKey(String(item.name)) === key && item.source !== 'grocy')) {
            return { success: false, error: 'DUPLICATE_NAME' };
        }
        const row: Json = {
            id: uid(), category: 'Autre', quantity: 1, unit: null, location: 'pantry',
            expires_on: null, low_stock_threshold: null, lunchbox_bucket: null, notes: null,
            source: 'manual', ...body, name,
        };
        demoPantry = [row, ...demoPantry];
        return ok({ item: pantryAsItem(row) });
    }
    if (seg[1] === 'pantry' && seg[2] === 'shopping-list' && method === 'POST') {
        const onList = new Set((store.shopping as Json[]).filter((s) => !s.is_checked).map((s) => pantryKey(String(s.name))));
        let created = 0;
        let skipped = 0;
        for (const item of demoPantry) {
            if (item.low_stock_threshold === null || Number(item.quantity) > Number(item.low_stock_threshold)) continue;
            const key = pantryKey(String(item.name));
            if (onList.has(key)) { skipped += 1; continue; }
            (store.shopping as Json[]).unshift({
                id: uid(), name: item.name, category: item.category, quantity: 1, unit: item.unit,
                price: null, is_checked: false, notes: null, created_at: new Date().toISOString(),
            });
            onList.add(key);
            created += 1;
        }
        return ok({ created, skipped });
    }
    if (seg[1] === 'pantry' && seg[2] === 'stock' && method === 'POST') {
        let created = 0;
        let updated = 0;
        for (const entry of Array.isArray(body.items) ? (body.items as Json[]) : []) {
            const name = String(entry.name ?? '').trim();
            if (!name) continue;
            const key = pantryKey(name);
            const existing = demoPantry.find((item) => pantryKey(String(item.name)) === key && item.source !== 'grocy');
            if (existing) {
                existing.quantity = Number(existing.quantity ?? 0) + Number(entry.quantity ?? 1);
                if (!existing.unit && entry.unit) existing.unit = entry.unit;
                updated += 1;
            } else {
                demoPantry = [{
                    id: uid(), name, category: entry.category ?? 'Autre', quantity: Number(entry.quantity ?? 1),
                    unit: entry.unit ?? null, location: 'pantry', expires_on: null, low_stock_threshold: null,
                    lunchbox_bucket: null, notes: null, source: 'shopping',
                }, ...demoPantry];
                created += 1;
            }
        }
        return ok({ created, updated });
    }
    if (seg[1] === 'pantry' && seg[2] === 'import' && seg[3] === 'grocy') {
        return { success: false, error: 'NO_GROCY_INTEGRATION' };
    }
    if (seg[1] === 'pantry' && seg[2] === 'import' && seg[3] === 'receipt') {
        const receipt = demoReceipts.find((r) => r.id === body.receiptId);
        if (!receipt) return { success: false, error: 'NOT_FOUND' };
        return ok(importReceiptIntoPantry(receipt));
    }
    // The receipt lines waiting for a name, and the two ways out: confirm (with
    // the family's own name and category) or ignore.
    if (path === '/api/pantry/pending' && method === 'GET') {
        return ok({ items: demoPantryPending.map((line) => ({ ...line, quantity: Number(line.quantity ?? 1) })) });
    }
    if (seg[1] === 'pantry' && seg[2] === 'pending' && seg[4] === 'confirm' && method === 'POST') {
        const line = demoPantryPending.find((entry) => entry.id === seg[3]);
        if (!line) return { success: false, error: 'NOT_FOUND' };
        const name = String(body.name ?? '').trim();
        if (!name) return { success: false, error: 'INVALID_ITEM' };
        const merged = mergePantryLines([{
            name, quantity: Number(body.quantity ?? 1) || 1,
            unit: body.unit ?? line.unit ?? null, category: body.category ?? line.category ?? 'Autre',
        }]);
        demoPantryPending = demoPantryPending.filter((entry) => entry.id !== seg[3]);
        return ok(merged);
    }
    if (seg[1] === 'pantry' && seg[2] === 'pending' && seg.length === 4 && method === 'DELETE') {
        if (!demoPantryPending.some((entry) => entry.id === seg[3])) return { success: false, error: 'NOT_FOUND' };
        demoPantryPending = demoPantryPending.filter((entry) => entry.id !== seg[3]);
        return ok({});
    }
    if (seg[1] === 'pantry' && seg.length === 3 && !['shopping-list', 'stock', 'import', 'pending'].includes(seg[2])) {
        if (method === 'PUT') {
            const row = demoPantry.find((item) => item.id === seg[2]);
            if (!row) return { success: false, error: 'NOT_FOUND' };
            const name = String(body.name ?? row.name).trim();
            const key = pantryKey(name);
            if (demoPantry.some((item) => item.id !== row.id && pantryKey(String(item.name)) === key && item.source !== 'grocy')) {
                return { success: false, error: 'DUPLICATE_NAME' };
            }
            Object.assign(row, body, { name });
            return ok({ item: pantryAsItem(row) });
        }
        if (method === 'DELETE') {
            demoPantry = demoPantry.filter((item) => item.id !== seg[2]);
            return ok({});
        }
    }
    // FORK-END: pantry

    // FORK-START: outings
    // The demo has no OpenStreetMap and no model, so the planner is answered with
    // a fixed, plausible set (the page's own "add to the planning" button then
    // goes through the mock /api/planning above, like any other entry).
    const isDemoOutingArea = (value: unknown): boolean =>
        typeof value === 'string' &&
        value.trim().toLowerCase().replace(/,\s*(?:be|belgium)$/, '') === 'sint-niklaas';
    if (path === '/api/outings/area' && method === 'POST') {
        const city = typeof body.city === 'string' ? body.city.trim() : '';
        if (!isDemoOutingArea(city)) throw new Error('CITY_NOT_FOUND');
        return ok({ city: 'Sint-Niklaas', country_code: 'BE', latitude: 51.16, longitude: 4.14 });
    }

    const demoOutingIdeas = [
        { title: 'Chasse au trésor dans le quartier', description: 'Une liste de dix choses à photographier, à faire à pied autour de la maison.', indoor: false },
        { title: 'Après-midi jeux de société', description: 'Sortir les jeux oubliés, un goûter, et pas d’écran jusqu’au dîner.', indoor: true },
    ];

    if (path === '/api/outings/suggest' && method === 'POST') {
        const date = typeof body.date === 'string' ? body.date : new Date().toISOString().slice(0, 10);
        const party = typeof body.party === 'string' ? body.party : 'family';
        const duration = typeof body.duration === 'string' ? body.duration : 'half_day';
        if (body.location === 'current') {
            return ok({
                date,
                party,
                duration,
                city: null,
                weather: null,
                ai: 'failed',
                placesSource: 'unavailable',
                places: [],
                ideas: demoOutingIdeas,
            });
        }
        if (body.location === 'area' && !isDemoOutingArea(body.city)) throw new Error('CITY_NOT_FOUND');
        const city = 'Sint-Niklaas';
        // Two-phase like the server: the instant call carries the places and says
        // the ranking is still to come, so the demo exercises the same panel path.
        const instant = body.instant === true;
        return ok({
            date,
            party,
            duration,
            city,
            weather: { label: 'Partiellement nuageux', tempMin: 11, tempMax: 17, weatherCode: 2, precipitationProbability: 20 },
            ai: instant ? 'pending' : 'ok',
            placesSource: 'osm',
            places: [
                {
                    id: 'osm:way/demo-1', name: 'Parc communal', category: 'park',
                    latitude: 51.16, longitude: 4.14, distanceKm: 1.2,
                    openingHours: '24/7', website: null, fee: 'no',
                    why: 'À dix minutes à pied : de la place pour courir et un banc à l’ombre pour les parents.',
                    startTime: '10:00', endTime: '14:00',
                },
                {
                    id: 'osm:node/demo-2', name: 'Musée communal', category: 'museum',
                    latitude: 51.17, longitude: 4.15, distanceKm: 2.4,
                    openingHours: 'Tu-Su 10:00-17:00', website: 'https://example.org', fee: 'yes',
                    why: 'Couvert, donc parfait si le ciel se gâte, et les enfants paient demi-tarif.',
                    startTime: '10:00', endTime: '14:00',
                },
                {
                    id: 'osm:node/demo-3', name: 'Aire de jeux du Beestenmarkt', category: 'playground',
                    latitude: 51.165, longitude: 4.142, distanceKm: 0.8,
                    openingHours: null, website: null, fee: null,
                    why: 'Le plus proche : idéal pour une sortie courte avant le déjeuner.',
                    startTime: '10:00', endTime: '12:00',
                },
            ],
            ideas: demoOutingIdeas,
        });
    }
    // FORK-END: outings
    if (seg[1] === 'lunchbox' && seg[2] === 'history' && seg[3]) {
        return ok(demoLunchboxes
            .filter((lb) => lb.family_member_id === seg[3])
            .sort((a, b) => String(b.date).localeCompare(String(a.date)))
            .slice(0, 30)
            .map(lunchboxWithMember));
    }
    if (seg[1] === 'lunchbox' && seg[2] === 'stats' && seg[3]) {
        const boxes = demoLunchboxes.filter((lb) => lb.family_member_id === seg[3]);
        const byField: Record<string, Map<string, { label: string; count: number }>> = {
            main: new Map(), fruit: new Map(), snack: new Map(), drink: new Map(),
        };
        for (const box of boxes) {
            const items = (box.items || {}) as Json;
            for (const field of Object.keys(byField)) {
                const value = items[field];
                if (typeof value !== 'string' || !value.trim()) continue;
                const key = value.trim().toLowerCase();
                const current = byField[field].get(key);
                if (current) current.count += 1;
                else byField[field].set(key, { label: value.trim(), count: 1 });
            }
        }
        const ranked = (field: string) =>
            Array.from(byField[field].values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
        return ok({
            totalLunchboxes: boxes.length,
            byField: { main: ranked('main'), fruit: ranked('fruit'), snack: ranked('snack'), drink: ranked('drink') },
        });
    }
    // FORK-END: lunchbox

    // ── Budget ──────────────────────────────────────────────────────────────────
    if (path === '/api/budget/forecast') { const { month, year } = monthYearOf(q); return ok(budgetForecast(month, year)); }
    if (path === '/api/budget/statistics') { const { month, year } = monthYearOf(q); return ok(budgetStatistics(month, year)); }
    if (path === '/api/budget/statistics/monthly') return ok(budgetMonthly(monthYearOf(q).year));

    // ── Kakeibo ───────────────────────────────────────────────────────────────
    if (path === '/api/kakeibo') { const { month, year } = monthYearOf(q); return ok(kakeiboSummary(month, year)); }
    if (path === '/api/kakeibo/income' && method === 'PUT') {
        const incomes = (body.incomes || {}) as Record<string, number>;
        store.familyMembers = (store.familyMembers as Json[]).map((m) =>
            typeof m.id === 'string' && m.id in incomes ? { ...m, monthly_income: num(incomes[m.id]) } : m) as never;
        return ok({});
    }
    if (path === '/api/kakeibo/month' && method === 'PUT') {
        kakeiboState.savingsGoal = num(body.savings_goal);
        kakeiboState.notes = typeof body.notes === 'string' ? body.notes : '';
        return ok({});
    }
    if (path === '/api/kakeibo/pillars') {
        const budget = demoCategories.budget;
        const mapping: Record<string, string> = {};
        for (const c of budget) mapping[c] = pillarFor(c);
        return ok({ pillars: ['survival', 'wants', 'culture', 'extra'], mapping });
    }
    if (path === '/api/budget/recurring' && method === 'GET') { const { month, year } = monthYearOf(q); return ok(recurringForMonth(month, year)); }
    if (path === '/api/budget/recurring' && method === 'POST') return ok(create('budgetRecurring', { is_active: true, is_pointed: false, ...body }));
    if (seg[1] === 'budget' && seg[2] === 'recurring' && seg[4] === 'point') {
        const now = new Date();
        const occurrence = typeof body.occurrence_date === 'string' ? body.occurrence_date : '';
        const month = num(occurrence.slice(5, 7)) || num(body.month) || now.getMonth() + 1;
        const year = num(occurrence.slice(0, 4)) || num(body.year) || now.getFullYear();
        recurringLogs.set(logKey(seg[3], month, year), Boolean(body.is_pointed));
        const item = (store.budgetRecurring as Json[]).find((r) => r.id === seg[3]);
        return ok({ ...item, is_pointed: Boolean(body.is_pointed) });
    }
    if (seg[1] === 'budget' && seg[2] === 'recurring' && seg.length === 4) {
        if (method === 'PUT') return ok(update('budgetRecurring', seg[3], body));
        if (method === 'DELETE') { remove('budgetRecurring', seg[3]); return ok({}); }
    }
    if (path === '/api/budget/entries' && method === 'GET') {
        let list = store.budgetEntries as Json[];
        if (q.start_date) list = list.filter((e) => (e.date as string) >= q.start_date);
        if (q.end_date) list = list.filter((e) => (e.date as string) <= q.end_date);
        return ok(list);
    }
    if (path === '/api/budget/entries' && method === 'POST') return ok(create('budgetEntries', body));
    if (seg[1] === 'budget' && seg[2] === 'entries' && seg.length === 4) {
        if (method === 'PUT') return ok(update('budgetEntries', seg[3], body));
        if (method === 'DELETE') { remove('budgetEntries', seg[3]); return ok({}); }
    }
    if (path === '/api/budget/limits' && method === 'GET') {
        let list = store.budgetLimits as Json[];
        if (q.month) list = list.filter((l) => num(l.month) === parseInt(q.month, 10));
        if (q.year) list = list.filter((l) => num(l.year) === parseInt(q.year, 10));
        return ok(list);
    }
    if (path === '/api/budget/limits' && method === 'POST') {
        const existing = (store.budgetLimits as Json[]).find((l) => l.category === body.category);
        if (existing) return ok(update('budgetLimits', existing.id as string, body));
        return ok(create('budgetLimits', body));
    }

    // FORK-START: budget-custom
    // Imported receipts: kept in memory for the session, like the entries above.
    if (path === '/api/budget/receipts' && method === 'GET') {
        let list = demoReceipts;
        if (q.start_date) list = list.filter((r) => (r.date as string) >= q.start_date);
        if (q.end_date) list = list.filter((r) => (r.date as string) <= q.end_date);
        return ok(list);
    }
    if (path === '/api/budget/receipts' && method === 'POST') {
        const entries = Array.isArray(body.entries) ? (body.entries as Json[]) : [];
        const created = entries.map((entry) => create('budgetEntries', {
            ...entry,
            date: body.date,
            is_expense: true,
        }));
        // Same field names as the API: `import_mode` (not `mode`) and an id per
        // archived line, so the drill-down renders exactly like it does online.
        const { mode, items, ...rest } = body;
        const receipt: Json = {
            id: uid(),
            created_at: new Date().toISOString(),
            ...rest,
            import_mode: mode === 'single' ? 'single' : 'itemized',
            entry_count: created.length,
            entry_ids: created.map((entry) => entry.id),
            pantry_imported: true,
            items: (Array.isArray(items) ? (items as Json[]) : []).map((item, index) => ({
                ...item,
                id: `${index + 1}`,
            })),
        };
        demoReceipts.unshift(receipt);
        // Like the server: the same call stocks the obvious products and queues
        // the rest for the pantry page (one transaction, one ticket).
        const { stock, pending } = splitReceiptLines(receipt.items as Json[]);
        const pantry = mergePantryLines(stock);
        for (const line of pending) {
            demoPantryPending.unshift({
                id: uid(), receipt_id: receipt.id, label: line.label, item: line.item,
                quantity: line.quantity, unit: line.unit, category: line.category,
                merchant: receipt.merchant ?? null, date: receipt.date ?? null,
                created_at: new Date().toISOString(),
            });
        }
        return ok({ receipt, entry_count: created.length, pantry: { ...pantry, pending: pending.length } });
    }
    if (seg[1] === 'budget' && seg[2] === 'receipts' && seg.length === 4 && method === 'DELETE') {
        const receipt = demoReceipts.find((r) => r.id === seg[3]);
        for (const id of (receipt?.entry_ids as string[] | undefined) ?? []) remove('budgetEntries', id);
        demoReceipts = demoReceipts.filter((r) => r.id !== seg[3]);
        return ok({});
    }

    // Budget analytics: the shipped page fetches an overview the demo has no
    // store for, so derive one from the seeded budget entries (no recurring
    // expansion, no members, no merchants — the demo has none of those).
    if (path === '/api/budget-analytics/overview' && method === 'GET') {
        const start = q.start || '';
        const end = q.end || '';
        const round2 = (n: number) => Math.round(n * 100) / 100;
        const entries = (store.budgetEntries as Json[])
            .filter((e) => (e.date as string) >= start && (e.date as string) <= end);
        const pick = (expense: boolean) => entries.filter((e) => Boolean(e.is_expense) === expense);
        const sum = (list: Json[]) => round2(list.reduce((total, e) => total + num(e.amount), 0));
        const expenses = sum(pick(true));
        const income = sum(pick(false));

        const byDay: Json[] = [];
        let cumulativeExpenses = 0;
        let cumulativeIncome = 0;
        for (const date = new Date(`${start}T00:00:00Z`); date <= new Date(`${end}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1)) {
            const iso = date.toISOString().slice(0, 10);
            const day = entries.filter((e) => e.date === iso);
            cumulativeExpenses = round2(cumulativeExpenses + sum(day.filter((e) => e.is_expense)));
            cumulativeIncome = round2(cumulativeIncome + sum(day.filter((e) => !e.is_expense)));
            byDay.push({
                date: iso,
                expenses: sum(day.filter((e) => e.is_expense)),
                income: sum(day.filter((e) => !e.is_expense)),
                cumulativeExpenses,
                cumulativeBalance: round2(cumulativeIncome - cumulativeExpenses),
            });
        }

        const group = (list: Json[], key: (e: Json) => string) => {
            const map = new Map<string, Json[]>();
            for (const entry of list) map.set(key(entry), [...(map.get(key(entry)) ?? []), entry]);
            return map;
        };
        const spending = pick(true);
        const byCategory = [...group(spending, (e) => String(e.category || 'Autre'))].map(([category, list]) => ({
            category,
            expenses: sum(list),
            count: list.length,
            share: expenses > 0 ? round2(sum(list) / expenses) : 0,
        })).sort((a, b) => b.expenses - a.expenses);
        const byMonth = [...group(entries, (e) => String(e.date).slice(0, 7))].map(([month, list]) => ({
            month,
            expenses: sum(list.filter((e) => e.is_expense)),
            income: sum(list.filter((e) => !e.is_expense)),
        })).sort((a, b) => a.month.localeCompare(b.month));
        const byWeekday = [...group(spending, (e) => String(((new Date(`${e.date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1))]
            .map(([weekday, list]) => ({ weekday: Number(weekday), expenses: sum(list) }))
            .sort((a, b) => a.weekday - b.weekday);

        const daysTotal = Math.max(1, Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1);
        const todayIso = new Date().toISOString().slice(0, 10);
        const daysElapsed = Math.min(daysTotal, Math.max(0, Math.round((Date.parse(`${todayIso}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1));
        const pace = {
            daysElapsed,
            daysTotal,
            dailyAverage: daysElapsed > 0 ? round2(expenses / daysElapsed) : 0,
            projectedExpenses: daysElapsed > 0 ? round2((expenses / daysElapsed) * daysTotal) : 0,
        };

        return ok({
            start,
            end,
            totals: { income, expenses, balance: round2(income - expenses), count: entries.length },
            split: {
                actual: { expenses, income, count: entries.length },
                recurring: { expenses: 0, income: 0, count: 0 },
            },
            byDay,
            byCategory,
            byMember: [],
            byMerchant: [],
            byMonth,
            byWeekday,
            pace,
        });
    }
    // FORK-END: budget-custom

    // ── AI assistant ────────────────────────────────────────────────────────────
    // The demo pretends a local Ollama is configured so the ✨ features show up.
    if (path === '/api/ai/settings' && method === 'GET') {
        return ok({ configured: true, enabled: true, provider: 'ollama', base_url: 'http://localhost:11434', model: 'llama3.1', has_api_key: false });
    }
    if (path === '/api/ai/settings' && method === 'PUT') {
        return ok({
            configured: true,
            enabled: body.enabled !== false,
            provider: (body.provider as string) || 'ollama',
            base_url: (body.base_url as string) ?? null,
            model: (body.model as string) || 'llama3.1',
            has_api_key: Boolean(body.api_key),
        });
    }
    if (path === '/api/ai/test' && method === 'POST') {
        await new Promise((resolve) => setTimeout(resolve, 600));
        return { success: true, message: 'OK' };
    }
    if (path === '/api/ai/parse' && method === 'POST') {
        // Canned heuristic: no model runs in the browser — derive 2 plausible
        // proposals from the note so the review→confirm flow can be demoed.
        await new Promise((resolve) => setTimeout(resolve, 900));
        const text = String(body.text || '').trim();
        const firstWords = text.split(/\s+/).slice(0, 4).join(' ') || 'Lasagnes';
        const label = firstWords.charAt(0).toUpperCase() + firstWords.slice(1);
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowIso = `${tomorrow.getFullYear()}-${pad2(tomorrow.getMonth() + 1)}-${pad2(tomorrow.getDate())}`;
        return ok({
            items: [
                { type: 'shopping_item', name: label, category: 'Alimentation', quantity: null, unit: null },
                { type: 'task', title: `Rappel : ${label}`, description: null, due_date: tomorrowIso, priority: 'Moyenne', frequency: 'Une fois', assigned_to: ['m-kid1'], member_names: ['Mia'] },
            ],
        });
    }
    if (path === '/api/ai/suggest-meals' && method === 'POST') {
        // Assign the seeded recipes round-robin to the week's dinner-less days.
        await new Promise((resolve) => setTimeout(resolve, 900));
        const weekStartIso = String(body.week_start || '').slice(0, 10);
        const weekStartDate = new Date(`${weekStartIso}T12:00:00`);
        const recipePool = store.recipes as Json[];
        if (Number.isNaN(weekStartDate.getTime()) || recipePool.length === 0) return ok({ proposals: [] });
        const plannedDinners = new Set(
            (store.mealPlans as Json[]).filter((mp) => mp.meal_type === 'Dîner').map((mp) => mp.date as string)
        );
        const proposals: Json[] = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(weekStartDate);
            d.setDate(d.getDate() + i);
            const iso = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
            if (plannedDinners.has(iso)) continue;
            const recipe = recipePool[proposals.length % recipePool.length];
            proposals.push({ date: iso, meal_type: 'Dîner', recipe_id: recipe.id, recipe_name: recipe.name });
        }
        return ok({ proposals });
    }
    // FORK-START: budget-custom
    if (path === '/api/ai/extract-receipt' && method === 'POST') {
        // No model runs in the browser: a canned supermarket ticket so the
        // import → review → confirm flow can be demoed end to end.
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const today = new Date();
        const iso = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
        return ok({
            receipt: {
                document_type: 'receipt',
                merchant: 'Supermarché Léon',
                date: iso,
                currency: 'EUR',
                total: 27.32,
                category: 'Alimentation',
                items: [
                    { label: 'LAIT DEMI-ECREME BIO VILLAGE 1L', quantity: 2, unit_price: 1.15, amount: 2.3, category: 'Alimentation', pantry_item: 'Lait demi-écrémé', pantry_unit: 'L', pantry_stock: true },
                    { label: 'POULET FERMIER S/O PESEE', quantity: 1, unit_price: 9.9, amount: 9.9, category: 'Alimentation', pantry_item: 'Poulet', pantry_unit: '', pantry_stock: true },
                    { label: 'LESSIVE LIQUIDE X 40D', quantity: 1, unit_price: 12.45, amount: 12.45, category: 'Maison', pantry_item: 'Lessive', pantry_unit: '', pantry_stock: true },
                    { label: 'DOLIPRANE 1000MG', quantity: 1, unit_price: 2.67, amount: 2.67, category: 'Santé', pantry_item: 'Paracétamol', pantry_unit: '', pantry_stock: false },
                ],
            },
            usage: null,
            duplicate: null,
        });
    }
    // FORK-END: budget-custom

    // ── Integrations ────────────────────────────────────────────────────────────
    if (path === '/api/integrations' && method === 'GET') return ok(store.integrations);
    if (path === '/api/integrations/test') return { success: true, message: 'Connection successful (demo).' };
    if (path === '/api/integrations' && method === 'POST') return ok(create('integrations', { display_name: body.type, base_url: body.base_url, status: 'connected', last_synced_at: new Date().toISOString(), last_error: null, ...body }));
    if (seg[1] === 'integrations' && seg[3] === 'sync') return ok({});
    if (seg[1] === 'integrations' && seg.length === 3 && method === 'DELETE') { remove('integrations', seg[2]); return ok({}); }

    // ── Invites (read-only-ish in demo) ─────────────────────────────────────────
    if (path === '/api/invites/members') return ok([{ id: store.user.id, name: store.user.name, email: store.user.email, is_owner: true, role: 'parent' }]);
    if (path === '/api/invites/requests') return ok([]);
    if (path === '/api/invites/requests/mine') return ok(null);
    if (path === '/api/invites' && method === 'POST') return ok({ token: 'demo-invite-token' });
    if (seg[1] === 'invites') return ok({});

    // ── Family notes (fridge post-its) ──────────────────────────────────────────
    if (path === '/api/notes' && method === 'GET') {
        // Like the server: drop expired notes, newest first (naive local strings
        // compare correctly as plain strings).
        const cutoff = naiveNow();
        const list = (store.notes as Json[]).filter((n) => !n.expires_at || (n.expires_at as string) > cutoff);
        return ok([...list].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))));
    }
    if (path === '/api/notes' && method === 'POST') {
        return ok(create('notes', {
            author_name: store.user.name,
            content: String(body.content || '').trim().slice(0, 500),
            color: body.color || 'yellow',
            expires_at: (body.expires_at as string) || null,
            created_at: naiveNow(),
        }));
    }
    if (seg[1] === 'notes' && seg.length === 3) {
        if (method === 'PUT') return ok(update('notes', seg[2], body));
        if (method === 'DELETE') { remove('notes', seg[2]); return ok({}); }
    }

    // ── Notifications ───────────────────────────────────────────────────────────
    if (path === '/api/notifications' && method === 'GET') return ok(store.notifications);
    if (path === '/api/notifications/unread-count') return ok({ count: (store.notifications as Json[]).filter((n) => !n.is_read).length });
    if (path === '/api/notifications/vapid-public-key') return ok('');
    if (path === '/api/notifications/subscribe') return ok({});
    if (path === '/api/notifications/read-all') { store.notifications = (store.notifications as Json[]).map((n) => ({ ...n, is_read: true })) as never; return ok({}); }
    if (seg[1] === 'notifications' && last === 'read') { update('notifications', seg[2], { is_read: true }); return ok({}); }

    // ── Data export/import ──────────────────────────────────────────────────────
    if (path === '/api/data/export') return ok({
        ...store,
        format: 'openfamily-portable',
        version: '2.0',
        appVersion: 'demo',
        exportedAt: new Date().toISOString(),
        scope: 'family',
    });
    if (path === '/api/data/import') return ok({ format: 'openfamily-portable', version: '2.0', imported: {} });

    // Fallback: empty success so the UI never crashes in the demo.
    return ok([]);
}

export async function mockRequest<T>(method: string, endpoint: string, body?: unknown): Promise<T> {
    const path = stripQuery(endpoint);
    const q = queryParams(endpoint);
    const result = await route(method.toUpperCase(), path, q, (body as Json) || {});
    return result as T;
}
