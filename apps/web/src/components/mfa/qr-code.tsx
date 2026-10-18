'use client';

import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';

interface QrCodeProps {
  /** Text to encode (an `otpauth://` URI here). */
  value: string;
  /** Accessible name; the secret is also shown as text next to the code. */
  label: string;
  size?: number;
}

/** Client-side QR rendering onto a canvas; nothing is sent anywhere. */
export function QrCode({ value, label, size = 192 }: QrCodeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    QRCode.toCanvas(canvas, value, { errorCorrectionLevel: 'M', margin: 2, width: size }).catch(
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [size, value]);

  if (failed) {
    return (
      <p role="status" className="text-muted-foreground text-sm">
        The QR code could not be drawn; enter the key manually instead.
      </p>
    );
  }
  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      width={size}
      height={size}
      className="rounded-md border bg-white"
    />
  );
}
