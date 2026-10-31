// A picked screenshot, ready for the model.
//
// Phone screenshots are 1000x2500 PNGs of 1-2 MB. The payment screenshots route
// takes base64 JSON, so the long side is capped at 1600px and re-encoded to JPEG
// (~200-400 kB): the text stays readable and a handful of screenshots fit in one
// request body. Same cap as the receipt import (components/ReceiptImport.custom.tsx).

const MAX_DIMENSION = 1600;

export interface ScreenshotAttachment {
    name: string;
    mime_type: string;
    data: string;
}

/** Throws when the browser cannot decode the file. */
export const toScreenshotAttachment = async (file: File): Promise<ScreenshotAttachment> => {
    // createImageBitmap decodes off the main thread and applies the EXIF
    // orientation, which a plain <img> would not.
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return {
        name: file.name,
        mime_type: 'image/jpeg',
        data: canvas.toDataURL('image/jpeg', 0.85).split(',')[1],
    };
};
