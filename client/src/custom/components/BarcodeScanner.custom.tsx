// The camera, wrapped. react-zxing owns the decoding loop; the page owns the
// state machine (idle / loading / found), so this component does nothing but
// hand the decoded digits back and surface a camera failure.
//
// No format hint is passed: the default multi-format reader already reads the
// EAN-13/UPC-A/EAN-8 of a grocery barcode, and a hint would mean importing
// BarcodeFormat from react-zxing's transitive @zxing/library dependency.
//
// `paused` releases the camera (and the browser's recording indicator), which
// is what we want as soon as a barcode has been decoded.
//
// Constraints are the only camera switch a web page gets: react-zxing keys its
// effect on `JSON.stringify(constraints)` and re-opens the stream when the value
// changes, and its cleanup resets the reader, which stops the previous video
// tracks — so the old camera is released before the new one is asked for.
// Passing constraints at all replaces the library default, which is why
// `audio: false` is spelled out rather than left implicit.

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SwitchCamera } from 'lucide-react';
import { useZxing } from 'react-zxing';
import { Button } from '../../components/ui';

type CameraFacing = 'environment' | 'user';

interface BarcodeScannerProps {
    onResult: (barcode: string) => void;
    paused?: boolean;
    onError?: (error: unknown) => void;
}

const BarcodeScanner: React.FC<BarcodeScannerProps> = ({ onResult, paused = false, onError }) => {
    const { t } = useTranslation('scan.custom');
    const [facing, setFacing] = useState<CameraFacing>('environment');

    const { ref } = useZxing({
        paused,
        constraints: { video: { facingMode: facing }, audio: false },
        onDecodeResult: (result) => onResult(result.getText()),
        onError: (error) => onError?.(error),
    });

    return (
        <div className="relative">
            <video
                // react-zxing declares its ref as RefObject<HTMLVideoElement | null>
                // (the React 19 shape); against this project's @types/react 18 the
                // ref types are compared by variance, where `| null` fails the
                // HTMLVideoElement side. Same object at runtime.
                ref={ref as React.RefObject<HTMLVideoElement>}
                muted
                playsInline
                className="aspect-square w-full rounded-card bg-black object-cover"
            />
            {!paused && (
                <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="absolute right-3 top-3"
                    onClick={() => setFacing((prev) => (prev === 'environment' ? 'user' : 'environment'))}
                    aria-label={t('scanner.flipCamera')}
                    title={t('scanner.flipCamera')}
                >
                    <SwitchCamera className="h-4 w-4" />
                </Button>
            )}
        </div>
    );
};

export default BarcodeScanner;
