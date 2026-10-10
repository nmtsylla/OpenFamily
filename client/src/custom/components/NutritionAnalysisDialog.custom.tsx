import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { Sparkles, Loader2, AlertTriangle, CheckCircle2, XCircle, Lightbulb, Info } from 'lucide-react';
import { api } from '../../lib/api';
import { aiErrorKey } from '../../components/app/MagicInput';
import { Card, CardContent, Button, Dialog } from '../../components/ui';

// Ported from KeurTonux's NutritionAnalysisDialog: the week's planned meals,
// read back by the model as a score, three buckets and a few recommendations.
//
// Two things changed for this fork: the meals analysed are the upstream planner's
// plus this fork's lunchboxes (the server merges both), and the verdict travels
// as a locale-neutral code — KeurTonux sent French words the UI printed as-is.

type Verdict = 'excellent' | 'good' | 'needs_improvement' | 'unbalanced';

interface Recommendation {
    title: string;
    detail: string;
}

interface NutritionAnalysis {
    score: number;
    verdict: Verdict;
    summary: string;
    strengths: string[];
    weaknesses: string[];
    missingFoodGroups: string[];
    recommendations: Recommendation[];
}

interface AnalyzeResponse {
    analysis: NutritionAnalysis;
    mealsAnalyzed: number;
    model: string;
}

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** ISO YYYY-MM-DD */
    weekStart: string;
    /** ISO YYYY-MM-DD */
    weekEnd: string;
}

// text / background / ring per verdict, so the gauge colour matches the headline.
const VERDICT_STYLE: Record<Verdict, { text: string; bg: string; ring: string; varName: string; emoji: string }> = {
    excellent: { text: 'text-success', bg: 'bg-success-soft', ring: 'ring-success', varName: 'success', emoji: '🌿' },
    good: { text: 'text-info', bg: 'bg-info-soft', ring: 'ring-info', varName: 'info', emoji: '👍' },
    needs_improvement: { text: 'text-warning', bg: 'bg-warning-soft', ring: 'ring-warning', varName: 'warning', emoji: '⚠️' },
    unbalanced: { text: 'text-danger', bg: 'bg-danger-soft', ring: 'ring-danger', varName: 'danger', emoji: '🛟' },
};

const isVerdict = (value: unknown): value is Verdict => typeof value === 'string' && value in VERDICT_STYLE;

const ScoreGauge: React.FC<{ score: number; verdict: Verdict }> = ({ score, verdict }) => {
    const { t } = useTranslation('lunchbox.custom');
    const style = VERDICT_STYLE[verdict];
    // Conic gradient angle (0–360) mapped from the 0–100 score.
    const angle = Math.round((score / 100) * 360);
    return (
        <div className="flex flex-col items-center">
            <div
                className={`relative h-28 w-28 rounded-full ring-4 ${style.ring}`}
                style={{
                    background: `conic-gradient(rgb(var(--${style.varName})) ${angle}deg, rgb(var(--surface-2-rgb)) ${angle}deg)`,
                }}
            >
                <div className="absolute inset-2 flex flex-col items-center justify-center rounded-full bg-card">
                    <span className={`text-3xl font-bold ${style.text}`}>{score}</span>
                    <span className="text-label-sm text-muted-foreground">/ 100</span>
                </div>
            </div>
            <div
                className={`mt-3 inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-label-sm font-medium ${style.bg} ${style.text}`}
            >
                <span>{style.emoji}</span>
                {t(`nutrition.verdicts.${verdict}`)}
            </div>
        </div>
    );
};

export const NutritionAnalysisDialog: React.FC<Props> = ({ open, onOpenChange, weekStart, weekEnd }) => {
    const { t } = useTranslation(['lunchbox.custom', 'ai']);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [empty, setEmpty] = useState(false);
    const [data, setData] = useState<AnalyzeResponse | null>(null);
    // Which week this analysis belongs to: re-opening for another week re-runs it.
    const [analyzedFor, setAnalyzedFor] = useState('');

    // The server answers with machine-readable codes: the AI_* family is the one
    // the rest of the app already translates (`ai:errors.*`), anything else shows
    // its own message.
    const errorText = useCallback(
        (error: unknown) => {
            const code = aiErrorKey(error) ?? (typeof error === 'string' ? error : null);
            if (code && (code.startsWith('AI_') || code === 'NO_PLANNED_MEALS')) {
                return t(code === 'NO_PLANNED_MEALS' ? 'lunchbox.custom:nutrition.empty' : `ai:errors.${code}`);
            }
            return error instanceof Error ? error.message : t('lunchbox.custom:nutrition.failed');
        },
        [t],
    );

    const runAnalysis = useCallback(async () => {
        setLoading(true);
        setError('');
        setEmpty(false);
        setData(null);
        const key = `${weekStart}|${weekEnd}`;
        try {
            // The demo answers in-process with the same envelope instead of an
            // HTTP error, hence the explicit `success` branch next to catch.
            const response = await api.post<{
                success: boolean;
                data: AnalyzeResponse;
                error?: string;
            }>('/api/lunchbox/nutrition', {
                start_date: weekStart,
                end_date: weekEnd,
                lang: String(i18n.language || 'en').split('-')[0],
            });
            if (!response.success) {
                // Nothing planned is not an error, it just isn't worth a model call.
                if (response.error === 'NO_PLANNED_MEALS') setEmpty(true);
                else setError(errorText(response.error));
                setAnalyzedFor(key);
                return;
            }
            setData(response.data);
            setAnalyzedFor(key);
        } catch (err) {
            if (err instanceof Error && err.message === 'NO_PLANNED_MEALS') setEmpty(true);
            else setError(errorText(err));
            setAnalyzedFor(key);
        } finally {
            setLoading(false);
        }
    }, [weekStart, weekEnd, errorText]);

    // Runs on open, once per week: the dialog is the only trigger.
    useEffect(() => {
        if (!open) return;
        if (analyzedFor === `${weekStart}|${weekEnd}`) return;
        void runAnalysis();
    }, [open, weekStart, weekEnd, analyzedFor, runAnalysis]);

    const analysis = data && isVerdict(data.analysis?.verdict) ? data.analysis : null;

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            title={t('lunchbox.custom:nutrition.title')}
            description={t('lunchbox.custom:nutrition.description')}
            className="sm:max-w-3xl"
        >
            <div className="space-y-5">
                {loading && (
                    <div className="flex flex-col items-center justify-center py-12">
                        <Loader2 className="mb-3 h-10 w-10 animate-spin text-primary" />
                        <p className="text-body text-muted-foreground">
                            {t('lunchbox.custom:nutrition.analyzing')}
                        </p>
                    </div>
                )}

                {error && (
                    <div className="flex items-start gap-2 rounded-input border border-danger/30 bg-danger-soft px-4 py-3 text-caption text-danger">
                        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                {empty && !loading && (
                    <div className="flex items-start gap-2 rounded-input border border-warning/30 bg-warning-soft px-4 py-3 text-caption text-warning">
                        <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
                        <span>{t('lunchbox.custom:nutrition.empty')}</span>
                    </div>
                )}

                {analysis && !loading && data && (
                    <>
                        <Card>
                            <CardContent className="flex flex-col items-start gap-5 p-5 sm:flex-row">
                                <ScoreGauge score={analysis.score} verdict={analysis.verdict} />
                                <div className="min-w-0 flex-1">
                                    <p className="text-body leading-relaxed text-foreground">{analysis.summary}</p>
                                    <p className="mt-3 text-label-sm text-muted-foreground">
                                        {t('lunchbox.custom:nutrition.mealsAnalyzed', { count: data.mealsAnalyzed })}
                                    </p>
                                </div>
                            </CardContent>
                        </Card>

                        {(analysis.strengths.length > 0 || analysis.weaknesses.length > 0) && (
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                {analysis.strengths.length > 0 && (
                                    <Card>
                                        <CardContent className="p-4">
                                            <h4 className="mb-2 flex items-center gap-2 text-body font-semibold">
                                                <CheckCircle2 className="h-4 w-4 text-success" />
                                                {t('lunchbox.custom:nutrition.strengths')}
                                            </h4>
                                            <ul className="space-y-1.5 text-caption text-muted-foreground">
                                                {analysis.strengths.map((item, index) => (
                                                    <li key={index} className="flex gap-2">
                                                        <span className="mt-0.5 text-success">✓</span>
                                                        <span>{item}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </CardContent>
                                    </Card>
                                )}
                                {analysis.weaknesses.length > 0 && (
                                    <Card>
                                        <CardContent className="p-4">
                                            <h4 className="mb-2 flex items-center gap-2 text-body font-semibold">
                                                <XCircle className="h-4 w-4 text-danger" />
                                                {t('lunchbox.custom:nutrition.weaknesses')}
                                            </h4>
                                            <ul className="space-y-1.5 text-caption text-muted-foreground">
                                                {analysis.weaknesses.map((item, index) => (
                                                    <li key={index} className="flex gap-2">
                                                        <span className="mt-0.5 text-danger">!</span>
                                                        <span>{item}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </CardContent>
                                    </Card>
                                )}
                            </div>
                        )}

                        {analysis.missingFoodGroups.length > 0 && (
                            <Card>
                                <CardContent className="p-4">
                                    <h4 className="mb-2 flex items-center gap-2 text-body font-semibold">
                                        <Info className="h-4 w-4 text-info" />
                                        {t('lunchbox.custom:nutrition.missingGroups')}
                                    </h4>
                                    <div className="flex flex-wrap gap-2">
                                        {analysis.missingFoodGroups.map((group, index) => (
                                            <span
                                                key={index}
                                                className="rounded-pill bg-info-soft px-3 py-1 text-label-sm text-info"
                                            >
                                                {group}
                                            </span>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        )}

                        {analysis.recommendations.length > 0 && (
                            <Card>
                                <CardContent className="p-4">
                                    <h4 className="mb-3 flex items-center gap-2 text-body font-semibold">
                                        <Lightbulb className="h-4 w-4 text-accent" />
                                        {t('lunchbox.custom:nutrition.recommendations')}
                                    </h4>
                                    <ol className="space-y-3">
                                        {analysis.recommendations.map((recommendation, index) => (
                                            <li
                                                key={index}
                                                className="rounded-input border border-border bg-surface p-3"
                                            >
                                                <p className="text-caption font-semibold">{recommendation.title}</p>
                                                {recommendation.detail && (
                                                    <p className="mt-1 text-micro text-muted-foreground">
                                                        {recommendation.detail}
                                                    </p>
                                                )}
                                            </li>
                                        ))}
                                    </ol>
                                </CardContent>
                            </Card>
                        )}
                    </>
                )}

                <div className="flex justify-end gap-3">
                    <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                        {t('common:actions.close')}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => void runAnalysis()} disabled={loading}>
                        <Sparkles className="mr-1.5 h-4 w-4" />
                        {t('lunchbox.custom:nutrition.rerun')}
                    </Button>
                </div>
            </div>
        </Dialog>
    );
};
