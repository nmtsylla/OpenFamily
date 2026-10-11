// =============================================================================
// /api/lunchbox — lunchboxes (custom_lunchboxes) plus the two AI calls the
// lunchbox page makes.
//
// Ported from KeurTonux, which kept its lunchboxes as extra rows in `meal_plans`
// discriminated by a French meal type. This fork does not touch upstream tables,
// so the lunchbox lives in its own table with its own four components; the
// household meal planner stays exactly as upstream ships it.
//
// Everything user-visible is free text the family types, so this router holds no
// copy: the four component names, the children's names and the shopping
// categories are data. The two AI calls ask the model for the reader's language
// (`lang` in the body, see lib/promptLanguage.custom.ts) and answer with
// machine-readable codes the client translates.
// =============================================================================

import { Router } from 'express';
import { query } from '../../db';
import { authMiddleware, AuthRequest } from '../../middleware/auth';
import { toNullIfEmpty } from '../../lib/normalize';
import { broadcast } from '../../lib/broadcaster';
import { getFamilyCategories } from '../../routes/categories';
import logger from '../../lib/logger';
import type { AiSettings } from '../../services/ai';
import { handleAiError, loadAiSettingsRow, toAiSettings } from '../lib/aiSettings.custom';
import {
    isCalendarDate,
    isUniqueViolation,
} from '../lib/validation.custom';
import { resolvePromptLanguage } from '../lib/promptLanguage.custom';
import {
    LUNCHBOX_FIELDS,
    lunchboxItemsFromRow,
    sanitizeLunchboxItems,
    tallyForShopping,
    tallyLunchboxItems,
    type LunchboxItems,
} from '../lib/lunchbox.custom';
import {
    generateLunchboxIdeas,
    LUNCHBOX_LOCATIONS,
    MAX_LUNCHBOX_IDEAS,
    type LunchboxGenerationInput,
    type LunchboxLocation,
} from '../ai/lunchbox.custom';
import { analyzeWeeklyMeals, type PlannedMealLine } from '../ai/nutrition.custom';

const router = Router();
router.use(authMiddleware);

const MAX_PANTRY_ITEMS = 30;

interface LunchboxRow {
    id: string;
    date: string;
    family_member_id: string;
    family_member_name: string;
    family_member_color: string | null;
    [key: string]: unknown;
}

const LUNCHBOX_SELECT = `
    SELECT lb.*, fm.name AS family_member_name, fm.color AS family_member_color
    FROM custom_lunchboxes lb
    JOIN family_members fm ON fm.id = lb.family_member_id
`;

const toLunchbox = (row: LunchboxRow) => ({
    id: row.id,
    date: String(row.date).slice(0, 10),
    family_member_id: row.family_member_id,
    family_member: {
        id: row.family_member_id,
        name: row.family_member_name,
        color: row.family_member_color,
    },
    items: lunchboxItemsFromRow(row),
    notes: (row.notes as string | null) ?? null,
});

/** Loads one row with its member, or null when it is not this family's. */
const loadLunchbox = async (id: string, userId: string): Promise<LunchboxRow | null> => {
    const result = await query(`${LUNCHBOX_SELECT} WHERE lb.id = $1 AND lb.user_id = $2`, [id, userId]);
    return (result.rows[0] as LunchboxRow | undefined) ?? null;
};

const ensureFamilyMemberBelongsToUser = async (memberId: string, userId: string): Promise<boolean> => {
    const result = await query('SELECT id FROM family_members WHERE id = $1 AND user_id = $2', [
        memberId,
        userId,
    ]);
    return result.rows.length > 0;
};

/** AI settings, or the machine-readable code the client already translates. */
const requireAiSettings = async (
    userId: string,
): Promise<AiSettings | 'AI_NOT_CONFIGURED' | 'AI_DISABLED'> => {
    const row = await loadAiSettingsRow(userId);
    if (!row || !row.model) return 'AI_NOT_CONFIGURED';
    if (!row.enabled) return 'AI_DISABLED';
    return toAiSettings(row);
};

// GET /api/lunchbox?start_date=&end_date= — the week's lunchboxes.
router.get('/', async (req: AuthRequest, res) => {
    try {
        const start = toNullIfEmpty(req.query.start_date) as string | null;
        const end = toNullIfEmpty(req.query.end_date) as string | null;

        const params: string[] = [req.userId!];
        let where = 'WHERE lb.user_id = $1';
        if (start) {
            params.push(start);
            where += ` AND lb.date >= $${params.length}`;
        }
        if (end) {
            params.push(end);
            where += ` AND lb.date <= $${params.length}`;
        }

        const result = await query(
            `${LUNCHBOX_SELECT} ${where} ORDER BY lb.date ASC, fm.name ASC`,
            params,
        );
        res.json({ success: true, data: (result.rows as LunchboxRow[]).map(toLunchbox) });
    } catch (error) {
        logger.error('lunchbox.list_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/lunchbox — create or replace one child's day (unique per child+day).
router.post('/', async (req: AuthRequest, res) => {
    try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const date = toNullIfEmpty(body.date) as string | null;
        const familyMemberId = toNullIfEmpty(body.family_member_id) as string | null;
        const items = sanitizeLunchboxItems(body.items);

        if (!isCalendarDate(date)) {
            return res.status(400).json({ success: false, error: 'date is required (YYYY-MM-DD)' });
        }
        if (!familyMemberId) {
            return res.status(400).json({ success: false, error: 'family_member_id is required' });
        }
        if (!items) {
            return res.status(400).json({ success: false, error: 'LUNCHBOX_EMPTY' });
        }
        if (!(await ensureFamilyMemberBelongsToUser(familyMemberId, req.userId!))) {
            return res.status(400).json({ success: false, error: 'Family member not found' });
        }

        const result = await query(
            `INSERT INTO custom_lunchboxes (user_id, family_member_id, date, main, fruit, snack, drink, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (user_id, family_member_id, date) DO UPDATE SET
               main = EXCLUDED.main,
               fruit = EXCLUDED.fruit,
               snack = EXCLUDED.snack,
               drink = EXCLUDED.drink,
               notes = EXCLUDED.notes,
               updated_at = CURRENT_TIMESTAMP
             RETURNING id`,
            [
                req.userId,
                familyMemberId,
                date,
                items.main ?? null,
                items.fruit ?? null,
                items.snack ?? null,
                items.drink ?? null,
                toNullIfEmpty(body.notes),
            ],
        );

        const saved = await loadLunchbox(result.rows[0].id as string, req.userId!);
        broadcast(req.userId!, { type: 'update', entity: 'meal-plans', action: 'created' });
        res.json({ success: true, data: saved ? toLunchbox(saved) : null });
    } catch (error) {
        logger.error('lunchbox.create_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// PUT /api/lunchbox/:id — partial update.
router.put('/:id', async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;
        const body = (req.body ?? {}) as Record<string, unknown>;
        const updates: string[] = [];
        const values: unknown[] = [];

        const push = (column: string, value: unknown) => {
            values.push(value);
            updates.push(`${column} = $${values.length}`);
        };

        if (body.date !== undefined) {
            const date = toNullIfEmpty(body.date) as string | null;
            if (!isCalendarDate(date)) {
                return res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD' });
            }
            push('date', date);
        }

        if (body.family_member_id !== undefined) {
            const memberId = toNullIfEmpty(body.family_member_id) as string | null;
            if (!memberId || !(await ensureFamilyMemberBelongsToUser(memberId, req.userId!))) {
                return res.status(400).json({ success: false, error: 'Family member not found' });
            }
            push('family_member_id', memberId);
        }

        if (body.items !== undefined) {
            const items: LunchboxItems | null = sanitizeLunchboxItems(body.items);
            for (const field of LUNCHBOX_FIELDS) push(field, items?.[field] ?? null);
        }

        if (body.notes !== undefined) push('notes', toNullIfEmpty(body.notes));

        if (updates.length === 0) {
            return res.status(400).json({ success: false, error: 'No fields to update' });
        }

        const result = await query(
            `UPDATE custom_lunchboxes SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
             WHERE id = $${values.length + 1} AND user_id = $${values.length + 2}
             RETURNING id`,
            [...values, id, req.userId],
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Lunchbox not found' });
        }

        const saved = await loadLunchbox(id, req.userId!);
        broadcast(req.userId!, { type: 'update', entity: 'meal-plans', action: 'updated' });
        res.json({ success: true, data: saved ? toLunchbox(saved) : null });
    } catch (error) {
        // Moving a lunchbox onto a day the same child already has is the unique
        // constraint (custom/0003), not a server fault: the same 409 the pantry
        // answers from the same helper.
        if (isUniqueViolation(error)) {
            return res.status(409).json({ success: false, error: 'LUNCHBOX_DAY_TAKEN' });
        }
        logger.error('lunchbox.update_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// DELETE /api/lunchbox/:id
router.delete('/:id', async (req: AuthRequest, res) => {
    try {
        const result = await query(
            'DELETE FROM custom_lunchboxes WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.userId],
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Lunchbox not found' });
        }
        broadcast(req.userId!, { type: 'update', entity: 'meal-plans', action: 'deleted' });
        res.json({ success: true, message: 'Lunchbox deleted' });
    } catch (error) {
        logger.error('lunchbox.delete_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/lunchbox/history/:familyMemberId?limit=30 — most recent first.
router.get('/history/:familyMemberId', async (req: AuthRequest, res) => {
    try {
        const { familyMemberId } = req.params;
        const rawLimit = Number.parseInt(String(req.query.limit ?? '30'), 10);
        const limit = Number.isFinite(rawLimit) && rawLimit > 0 && rawLimit <= 200 ? rawLimit : 30;

        if (!(await ensureFamilyMemberBelongsToUser(familyMemberId, req.userId!))) {
            return res.status(400).json({ success: false, error: 'Family member not found' });
        }

        const result = await query(
            `${LUNCHBOX_SELECT} WHERE lb.user_id = $1 AND lb.family_member_id = $2
             ORDER BY lb.date DESC LIMIT $3`,
            [req.userId, familyMemberId, limit],
        );
        res.json({ success: true, data: (result.rows as LunchboxRow[]).map(toLunchbox) });
    } catch (error) {
        logger.error('lunchbox.history_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/lunchbox/stats/:familyMemberId?start_date=&end_date=
// How often each component appears, per bucket. Defaults to the last 60 days.
router.get('/stats/:familyMemberId', async (req: AuthRequest, res) => {
    try {
        const { familyMemberId } = req.params;
        const start = toNullIfEmpty(req.query.start_date) as string | null;
        const end = toNullIfEmpty(req.query.end_date) as string | null;

        if (!(await ensureFamilyMemberBelongsToUser(familyMemberId, req.userId!))) {
            return res.status(400).json({ success: false, error: 'Family member not found' });
        }

        const params: string[] = [req.userId!, familyMemberId];
        let where = 'WHERE lb.user_id = $1 AND lb.family_member_id = $2';
        if (start) {
            params.push(start);
            where += ` AND lb.date >= $${params.length}`;
        } else {
            where += " AND lb.date >= CURRENT_DATE - INTERVAL '60 days'";
        }
        if (end) {
            params.push(end);
            where += ` AND lb.date <= $${params.length}`;
        }

        // Aggregated in JS: a few weeks of one child's lunchboxes, and the
        // grouping rules (case-insensitive, most recent spelling wins) read
        // better here than as jsonb_each plus a lateral join.
        const result = await query(
            `SELECT lb.main, lb.fruit, lb.snack, lb.drink, lb.date
             FROM custom_lunchboxes lb ${where}
             ORDER BY lb.date DESC`,
            params,
        );
        res.json({ success: true, data: tallyLunchboxItems(result.rows as Array<Record<string, unknown>>) });
    } catch (error) {
        logger.error('lunchbox.stats_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/lunchbox/shopping-list — one shopping item per distinct component of
// the lunchboxes in [start_date, end_date]. A component already on the list
// unchecked is left alone, so re-running the week is idempotent.
router.post('/shopping-list', async (req: AuthRequest, res) => {
    try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const start = toNullIfEmpty(body.start_date) as string | null;
        const end = toNullIfEmpty(body.end_date) as string | null;
        if (!isCalendarDate(start) || !isCalendarDate(end)) {
            return res
                .status(400)
                .json({ success: false, error: 'start_date and end_date are required (YYYY-MM-DD)' });
        }

        const result = await query(
            `SELECT main, fruit, snack, drink FROM custom_lunchboxes
             WHERE user_id = $1 AND date BETWEEN $2 AND $3`,
            [req.userId, start, end],
        );
        const tally = tallyForShopping(result.rows as Array<Record<string, unknown>>);

        // Shopping categories are family-customizable (routes/categories.ts), so
        // ask for theirs and prefer the historical food category by name.
        const categories = await getFamilyCategories(req.userId!);
        const foodCategory =
            categories.shopping.find((name) => name.toLowerCase() === 'alimentation') ??
            categories.shopping[0] ??
            'Alimentation';

        const existing = await query(
            'SELECT LOWER(TRIM(name)) AS key FROM shopping_items WHERE user_id = $1 AND is_checked = false',
            [req.userId],
        );
        const onList = new Set(existing.rows.map((row) => row.key as string));

        let created = 0;
        let skipped = 0;
        for (const [key, item] of tally) {
            if (onList.has(key)) {
                skipped += 1;
                continue;
            }
            await query(
                'INSERT INTO shopping_items (user_id, name, category, quantity) VALUES ($1, $2, $3, $4)',
                [req.userId, item.label, foodCategory, item.count],
            );
            created += 1;
        }

        if (created > 0) {
            broadcast(req.userId!, { type: 'update', entity: 'shopping', action: 'created' });
        }
        res.json({
            success: true,
            data: { created, skipped, total_lunchboxes: result.rows.length },
        });
    } catch (error) {
        logger.error('lunchbox.shopping_list_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/lunchbox/ai/ideas — lunchbox ideas from what is at home. Nothing is
// saved: the client fills its form with the idea the parent picks.
router.post('/ai/ideas', async (req: AuthRequest, res) => {
    try {
        const settings = await requireAiSettings(req.userId!);
        if (typeof settings === 'string') {
            return res.status(400).json({ success: false, error: settings });
        }

        const body = (req.body ?? {}) as Record<string, unknown>;
        const pantry = (value: unknown): string[] | undefined =>
            Array.isArray(value)
                ? value
                      .filter((entry): entry is string => typeof entry === 'string')
                      .map((entry) => entry.trim().slice(0, 80))
                      .filter((entry) => entry.length > 0)
                      .slice(0, MAX_PANTRY_ITEMS)
                : undefined;

        const location = LUNCHBOX_LOCATIONS.includes(body.location as LunchboxLocation)
            ? (body.location as LunchboxLocation)
            : 'school';
        const rawCount = typeof body.count === 'number' ? Math.round(body.count) : MAX_LUNCHBOX_IDEAS;
        const count = Math.max(1, Math.min(rawCount, MAX_LUNCHBOX_IDEAS));

        const availableMains = pantry(body.availableMains);
        const availableFruits = pantry(body.availableFruits);
        const availableSnacks = pantry(body.availableSnacks);
        const availableDrinks = pantry(body.availableDrinks);
        if (![availableMains, availableFruits, availableSnacks, availableDrinks].some((list) => list && list.length > 0)) {
            return res.status(400).json({ success: false, error: 'PANTRY_EMPTY' });
        }

        // The child's allergies and age are the two safety inputs the prompt needs.
        let member: LunchboxGenerationInput['member'];
        const familyMemberId = toNullIfEmpty(body.familyMemberId) as string | null;
        if (familyMemberId) {
            const memberRow = await query(
                'SELECT name, birth_date, allergies FROM family_members WHERE id = $1 AND user_id = $2',
                [familyMemberId, req.userId],
            );
            const row = memberRow.rows[0] as
                | { name: string; birth_date: string | null; allergies: string | null }
                | undefined;
            if (row) {
                const birthDate = row.birth_date ? new Date(`${String(row.birth_date).slice(0, 10)}T00:00:00`) : null;
                member = {
                    name: row.name,
                    ageYears:
                        birthDate && !Number.isNaN(birthDate.getTime())
                            ? Math.max(
                                  0,
                                  Math.floor(
                                      (Date.now() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000),
                                  ),
                              )
                            : undefined,
                    allergies: row.allergies
                        ? row.allergies
                              .split(/[,;\n]+/)
                              .map((entry) => entry.trim())
                              .filter((entry) => entry.length > 0)
                              .slice(0, 10)
                        : undefined,
                };
            }
        }

        const result = await generateLunchboxIdeas(
            settings,
            {
                availableMains,
                availableFruits,
                availableSnacks,
                availableDrinks,
                location,
                member,
                count,
                notesContext: typeof body.context === 'string' ? body.context : undefined,
            },
            resolvePromptLanguage(body.lang),
        );

        res.json({ success: true, data: result });
    } catch (error) {
        handleAiError(res, error, 'lunchbox_ideas');
    }
});

// POST /api/lunchbox/nutrition — nutritional read of the week: the household
// meals planned upstream plus the lunchboxes planned here. Read-only.
router.post('/nutrition', async (req: AuthRequest, res) => {
    try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const start = toNullIfEmpty(body.start_date) as string | null;
        const end = toNullIfEmpty(body.end_date) as string | null;
        if (!isCalendarDate(start) || !isCalendarDate(end)) {
            return res
                .status(400)
                .json({ success: false, error: 'start_date and end_date are required (YYYY-MM-DD)' });
        }

        const meals: PlannedMealLine[] = [];

        const household = await query(
            `SELECT mp.date, mp.meal_type, mp.custom_meal, r.name AS recipe_name, r.category AS recipe_category
             FROM meal_plans mp
             LEFT JOIN recipes r ON mp.recipe_id = r.id
             WHERE mp.user_id = $1 AND mp.date BETWEEN $2 AND $3
             ORDER BY mp.date ASC, mp.meal_type ASC`,
            [req.userId, start, end],
        );
        for (const row of household.rows as Array<Record<string, unknown>>) {
            const label = (row.recipe_name as string | null) ?? (row.custom_meal as string | null);
            if (!label) continue; // an empty cell is not a meal
            meals.push({
                date: String(row.date).slice(0, 10),
                mealType: String(row.meal_type),
                label,
                recipeCategory: (row.recipe_category as string | null) ?? null,
            });
        }

        const lunchboxes = await query(
            `SELECT lb.date, fm.name AS member_name, lb.main, lb.fruit, lb.snack, lb.drink
             FROM custom_lunchboxes lb
             JOIN family_members fm ON fm.id = lb.family_member_id
             WHERE lb.user_id = $1 AND lb.date BETWEEN $2 AND $3
             ORDER BY lb.date ASC, fm.name ASC`,
            [req.userId, start, end],
        );
        for (const row of lunchboxes.rows as Array<Record<string, unknown>>) {
            const items = lunchboxItemsFromRow(row);
            const contents = LUNCHBOX_FIELDS.map((field) => items[field]).filter(Boolean);
            if (contents.length === 0) continue;
            meals.push({
                date: String(row.date).slice(0, 10),
                mealType: String(row.member_name),
                label: contents.join(', '),
            });
        }

        if (meals.length === 0) {
            return res.status(400).json({ success: false, error: 'NO_PLANNED_MEALS' });
        }

        const settings = await requireAiSettings(req.userId!);
        if (typeof settings === 'string') {
            return res.status(400).json({ success: false, error: settings });
        }

        const members = await query('SELECT COUNT(*)::int AS total FROM family_members WHERE user_id = $1', [
            req.userId,
        ]);
        const total = (members.rows[0] as { total: number }).total;

        const result = await analyzeWeeklyMeals(
            settings,
            {
                weekStartIso: start,
                weekEndIso: end,
                meals,
                familySummary: total > 0 ? String(total) : undefined,
            },
            resolvePromptLanguage(body.lang),
        );

        res.json({ success: true, data: { ...result, mealsAnalyzed: meals.length } });
    } catch (error) {
        handleAiError(res, error, 'lunchbox_nutrition');
    }
});

export default router;
