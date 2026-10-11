import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';

// =============================================================================
// Home Assistant entities for the family dashboard.
//
// One state list on a 30 s poll, shared by the whole screen, plus a service
// caller that every tile routes through. Same house pattern as
// useWeather.custom.ts (no query library): a refetch function, a `busy` set for
// the entity being toggled, and an explicit error kind so the page can tell
// "no integration configured" apart from "HA is down".
// =============================================================================

const POLL_MS = 30_000;

/** Backend error codes, translated to a state the page can act on. */
export type HaFailure = 'missing' | 'offline' | 'error';

export interface HaDevice {
    entity_id: string;
    domain: string;
    friendly_name: string;
    state: string;
    attributes: Record<string, unknown>;
}

export interface HaDeviceState {
    devices: HaDevice[];
    byDomain: Record<string, HaDevice[]>;
    loading: boolean;
    failure: HaFailure | null;
    /** Entity ids with a service call in flight — tiles disable while true. */
    busy: Record<string, boolean>;
    refresh: () => Promise<void>;
    callService: (
        domain: string,
        service: string,
        payload: Record<string, unknown>,
    ) => Promise<void>;
}

const failureFor = (error: unknown): HaFailure => {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('integration_not_found')) return 'missing';
    // Only "could not reach it" and "it answered 5xx" are outages. A rejected
    // service call (400) leaves the screen usable: one tile did nothing.
    if (message.includes('unreachable') || message.includes('service_failed')) return 'offline';
    return 'error';
};

export function useHomeAssistant(enabled = true): HaDeviceState {
    const [devices, setDevices] = useState<HaDevice[]>([]);
    const [loading, setLoading] = useState(enabled);
    const [failure, setFailure] = useState<HaFailure | null>(null);
    const [busy, setBusy] = useState<Record<string, boolean>>({});

    // The poll must not restart on every render, and a state list that arrives
    // after unmount is harmless but noisy — one flag covers both.
    const alive = useRef(true);
    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);

    const refresh = useCallback(async () => {
        if (!enabled) {
            setLoading(false);
            return;
        }
        try {
            const response = await api.get<{ success: boolean; data: HaDevice[] }>(
                '/api/custom/ha/states',
            );
            if (!alive.current) return;
            setDevices(Array.isArray(response.data) ? response.data : []);
            setFailure(null);
        } catch (error) {
            if (alive.current) setFailure(failureFor(error));
        } finally {
            if (alive.current) setLoading(false);
        }
    }, [enabled]);

    useEffect(() => {
        if (!enabled) {
            setLoading(false);
            return;
        }
        void refresh();
        const timer = setInterval(() => void refresh(), POLL_MS);
        // A tablet that spent the night asleep must not show yesterday's states:
        // poll immediately whenever the page becomes visible again.
        const onVisible = () => {
            if (document.visibilityState === 'visible') void refresh();
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [enabled, refresh]);

    const callService = useCallback(
        async (domain: string, service: string, payload: Record<string, unknown>) => {
            const entityId = typeof payload.entity_id === 'string' ? payload.entity_id : domain;
            setBusy((prev) => ({ ...prev, [entityId]: true }));
            try {
                await api.post(`/api/custom/ha/services/${domain}/${service}`, payload);
                setFailure(null);
            } catch (error) {
                const kind = failureFor(error);
                // A rejected service call is the tile's problem, not an outage:
                // leave the rest of the screen usable and let the next poll
                // correct the state. Only "cannot reach it" is global.
                if (kind !== 'error') setFailure(kind);
                throw error;
            } finally {
                setBusy((prev) => {
                    const next = { ...prev };
                    delete next[entityId];
                    return next;
                });
                // HA applies the service asynchronously; re-reading a moment
                // later turns the optimistic tile into the real state, and the
                // 30 s poll is too slow for a light switch.
                setTimeout(() => void refresh(), 700);
            }
        },
        [refresh],
    );

    const byDomain = useMemo(() => {
        const grouped: Record<string, HaDevice[]> = {};
        for (const device of devices) {
            (grouped[device.domain] ??= []).push(device);
        }
        return grouped;
    }, [devices]);

    return { devices, byDomain, loading, failure, busy, refresh, callService };
}

export const isOn = (device: HaDevice): boolean =>
    device.state === 'on' || device.state === 'open' || device.state === 'playing';

/** First entity whose name matches, else undefined — the name-heuristic lookup. */
export const findByName = (devices: HaDevice[], needles: string[]): HaDevice | undefined => {
    const lowered = needles.map((n) => n.toLowerCase());
    return devices.find((device) => {
        const name = device.friendly_name.toLowerCase();
        return lowered.some((needle) => name.includes(needle));
    });
};
