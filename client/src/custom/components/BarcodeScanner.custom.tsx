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

import React from 'react';
import { useZxing } from 'react-zxing';

interface BarcodeScannerProps {
    onResult: (barcode: string) => void;
    paused?: boolean;
    onError?: (error: unknown) => void;
}

const BarcodeScanner: React.FC<BarcodeScannerProps> = ({ onResult, paused = false, onError }) => {
    const { ref } = useZxing({
        paused,
        onDecodeResult: (result) => onResult(result.getText()),
        onError: (error) => onError?.(error),
    });

    return (
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
    );
};

export default BarcodeScanner;
