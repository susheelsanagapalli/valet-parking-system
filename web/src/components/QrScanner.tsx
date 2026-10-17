import { useEffect, useRef, useState } from 'react';

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike;

export function canScanQr(): boolean {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window && Boolean(navigator.mediaDevices?.getUserMedia);
}

/** Scans the guest's ticket QR with the phone camera, where the browser supports it. */
export function QrScanner({ onResult, onClose }: { onResult: (value: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let stopped = false;
    const Detector = (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector;
    const detector = new Detector({ formats: ['qr_code'] });

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        const tick = async () => {
          if (stopped) return;
          const codes = await detector.detect(video).catch(() => []);
          if (codes[0]?.rawValue) {
            onResult(codes[0].rawValue);
            return;
          }
          setTimeout(() => void tick(), 300);
        };
        void tick();
      } catch {
        setError('Camera not available. Enter the PIN instead.');
      }
    }
    void start();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onResult]);

  return (
    <div className="stack">
      {error ? <div className="notice warn">{error}</div> : <video ref={videoRef} muted playsInline style={{ width: '100%', borderRadius: 10 }} />}
      <button type="button" onClick={onClose}>
        Close scanner
      </button>
    </div>
  );
}
