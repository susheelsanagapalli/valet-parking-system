import { useEffect, useRef, useState } from 'react';

/** Guest signs on the attendant's screen for the handover confirmation (FR-OUT-13). */
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * ratio;
    canvas.height = canvas.clientHeight * ratio;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#15202e';
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  return (
    <div className="stack">
      <canvas
        ref={canvasRef}
        className="signature"
        aria-label="Signature area"
        onPointerDown={(e) => {
          const ctx = e.currentTarget.getContext('2d');
          const p = point(e);
          drawing.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          ctx?.beginPath();
          ctx?.moveTo(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext('2d');
          const p = point(e);
          ctx?.lineTo(p.x, p.y);
          ctx?.stroke();
        }}
        onPointerUp={(e) => {
          drawing.current = false;
          setEmpty(false);
          onChange(e.currentTarget.toDataURL('image/png'));
        }}
      />
      <button
        type="button"
        disabled={empty}
        onClick={() => {
          const c = canvasRef.current;
          c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
          setEmpty(true);
          onChange(null);
        }}
      >
        Clear signature
      </button>
    </div>
  );
}
