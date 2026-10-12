import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin } from 'lucide-react';
import { Card, CardContent, Button, Input, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { useSavedLocation } from '../hooks/useWeather.custom';

// =============================================================================
// Settings card: the city whose weather the dashboard widgets show.
//
// The city belongs to the family: it is geocoded server-side (Open-Meteo) and
// stored as coordinates on the family owner's row.
//
// The endpoint is the custom weather surface (PUT /api/weather/location), not an
// auth route: the fork hung it off /api/auth, which forced the location into the
// auth context. Here the saved location is read back from the same weather
// surface (`useSavedLocation`), so nothing upstream has to carry it.
// =============================================================================

const WeatherLocation: React.FC = () => {
    const { t } = useTranslation('weather.custom');
    const { showToast } = useToast();
    const location = useSavedLocation();
    const [saving, setSaving] = useState(false);
    // null = "not edited": the input shows the saved city as soon as it loads.
    const [draft, setDraft] = useState<string | null>(null);
    const city = draft ?? location.data?.city ?? '';

    const handleSave = async (event: React.FormEvent) => {
        event.preventDefault();
        const value = city.trim();
        if (!value) return;

        setSaving(true);
        try {
            await api.put('/api/weather/location', { city: value });
            // Drop the cached location so the next read reflects the new city.
            location.refetch();
            setDraft(null);
            showToast({ title: t('settings.saved'), description: t('settings.savedDescription', { city: value }) });
        } catch (error) {
            // The server answers 422 with `error: 'CITY_NOT_FOUND'`, which the
            // API client surfaces as the Error message.
            const notFound = error instanceof Error && error.message === 'CITY_NOT_FOUND';
            showToast({
                title: notFound ? t('settings.cityNotFound') : t('settings.saveError'),
                description: notFound ? t('settings.cityNotFoundDescription') : undefined,
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card>
            <CardContent className="p-6">
                <form onSubmit={(e) => void handleSave(e)} className="flex items-start gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card bg-primary-soft text-primary">
                        <MapPin className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-caption font-semibold text-foreground">{t('settings.title')}</h3>
                        <p className="mt-1 text-micro text-muted-foreground">{t('settings.subtitle')}</p>
                        <p className="mt-1 text-micro text-muted-foreground">{t('settings.sharedHint')}</p>
                        <div className="mt-4 flex flex-wrap items-end gap-2 max-w-md">
                            <div className="flex-1 min-w-[12rem]">
                                <Input
                                    label={t('settings.label')}
                                    value={city}
                                    onChange={(e) => setDraft(e.target.value)}
                                    placeholder={t('settings.placeholder')}
                                />
                            </div>
                            <Button type="submit" disabled={saving || city.trim().length === 0}>
                                {t('settings.save')}
                            </Button>
                        </div>
                    </div>
                </form>
            </CardContent>
        </Card>
    );
};

export default WeatherLocation;
