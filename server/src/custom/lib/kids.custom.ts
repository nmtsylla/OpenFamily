// =============================================================================
// The family's children, as the prompt builders need them.
//
// Extracted from the dashboard widget route when the outing planner needed the
// same rows: a child's birth date, the notes the family wrote on their card and
// their allergies are what makes an AI suggestion about THEM rather than about
// children in general.
//
// `notes` and `allergies` are server-only. They feed a prompt and are projected
// out of every response, so a child's medical notes never reach the browser.
// =============================================================================

import { query } from '../../db';
import { parseStringArray } from '../../lib/normalize';

export interface FamilyKid {
    id: string;
    name: string;
    color: string;
    birth_date: string | null;
    ageYears: number;
    notes: string | null;
    allergies: string[];
}

export const ageYearsFromBirthDate = (birthDate: unknown, fallback: number): number => {
    if (!(birthDate instanceof Date) && typeof birthDate !== 'string') return fallback;
    const d = birthDate instanceof Date ? birthDate : new Date(`${birthDate}T00:00:00`);
    if (Number.isNaN(d.getTime())) return fallback;
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const before =
        now.getMonth() < d.getMonth() ||
        (now.getMonth() === d.getMonth() && now.getDate() < d.getDate());
    if (before) age -= 1;
    return Math.max(0, Math.min(120, age));
};

/** The free-text notes, read the way the family card displays them (`notes ?? medical_notes`). */
const pickNotes = (notes: unknown, medicalNotes: unknown): string | null => {
    for (const value of [notes, medicalNotes]) {
        if (typeof value === 'string' && value.trim()) return value;
    }
    return null;
};

/** The family's children — the only members an outfit, an idea or an outing is tailored to. */
export const loadFamilyKids = async (userId: string): Promise<FamilyKid[]> => {
    const result = await query(
        `SELECT id, name, birth_date, color, notes, medical_notes, allergies
         FROM family_members
         WHERE user_id = $1 AND role = 'Enfant'
         ORDER BY birth_date NULLS LAST, name ASC`,
        [userId],
    );
    return (result.rows as Array<Record<string, unknown>>).map((r) => ({
        id: String(r.id),
        name: String(r.name),
        color: String(r.color),
        birth_date: r.birth_date === null || r.birth_date === undefined ? null : String(r.birth_date),
        ageYears: ageYearsFromBirthDate(r.birth_date, 8),
        notes: pickNotes(r.notes, r.medical_notes),
        allergies: parseStringArray(r.allergies),
    }));
};
