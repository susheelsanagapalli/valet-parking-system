import jsQR from 'jsqr';
import { useEffect, useRef, useState } from 'react';

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike;

/** Live camera needs a secure page (https or localhost); taking a photo works everywhere. */
export function canScanLive(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia);
}

/** Kept for callers: scanning is always possible, live or from a photo. */
export function canScanQr(): boolean {
  return true;
}

const SCAN_SIZE = 1024;

function decodeFrom(source: CanvasImageSource, width: number, height: number, canvas: HTMLCanvasElement): string | null {
  const scale = Math.min(1, SCAN_SIZE / Math.max(width, height));
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
}

/** Reads a QR code from a photo (iPhone camera via the file picker works over plain http). */
export async function decodeQrFromFile(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  try {
    return decodeFrom(bitmap, bitmap.width, bitmap.height, document.createElement('canvas'));
  } finally {
    bitmap.close();
  }
}

/**
 * Scans a guest's ticket QR: live through the camera where the browser allows it, otherwise (or on
 * request) from a photo taken with the phone camera. Works on iPhone and Android.
 */
export function QrScanner({ onResult, onClose }: { onResult: (value: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [live, setLive] = useState(canScanLive());
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!live) return;
    let stream: MediaStream | undefined;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    const detector = Detector ? new Detector({ formats: ['qr_code'] }) : null;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        const tick = async () => {
          if (stopped) return;
          let value: string | null = null;
          if (video.videoWidth > 0) {
            value = detector
              ? ((await detector.detect(video).catch(() => []))[0]?.rawValue ?? null)
              : decodeFrom(video, video.videoWidth, video.videoHeight, canvas);
          }
          if (value) {
            onResult(value);
            return;
          }
          setTimeout(() => void tick(), 250);
        };
        void tick();
      } catch {
        setLive(false);
        setMessage('Live camera is not available here. Take a photo of the QR instead.');
      }
    }
    void start();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [live, onResult]);

  async function fromPhoto(file?: File) {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const value = await decodeQrFromFile(file);
      if (value) onResult(value);
      else setMessage('No QR code found in the photo. Hold the phone closer so the QR fills most of the picture, and try again.');
    } catch {
      setMessage('Could not read that photo. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {live && <video ref={videoRef} muted playsInline style={{ width: '100%', borderRadius: 10, background: '#000' }} aria-label="Camera view" />}
      {live && <p className="muted" style={{ margin: 0 }}>Point the camera at the guest's QR code.</p>}
      <label className="button primary" style={{ cursor: 'pointer' }}>
        {busy ? 'Reading QR…' : live ? 'Or take a photo of the QR' : 'Take a photo of the QR'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          aria-label="Photo of the ticket QR"
          onChange={(e) => {
            void fromPhoto(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>
      {message && <div className="notice warn">{message}</div>}
      <button type="button" onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}
