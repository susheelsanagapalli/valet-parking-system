import { useState } from 'react';
import { api, errorText } from '../api';
import { compressImage } from '../image';

interface Props {
  label: string;
  hint?: string;
  max: number;
  onChange: (refs: string[]) => void;
}

/** Takes photos with the phone camera, compresses and uploads them, and reports the file references. */
export function PhotoPicker({ label, hint, max, onChange }: Props) {
  const [photos, setPhotos] = useState<Array<{ ref: string; preview: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      const next = [...photos];
      for (const file of [...files].slice(0, max - photos.length)) {
        const dataUrl = await compressImage(file);
        const { fileRef } = await api<{ fileRef: string }>('/uploads', { body: { dataUrl } });
        next.push({ ref: fileRef, preview: dataUrl });
      }
      setPhotos(next);
      onChange(next.map((p) => p.ref));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function remove(ref: string) {
    const next = photos.filter((p) => p.ref !== ref);
    setPhotos(next);
    onChange(next.map((p) => p.ref));
  }

  return (
    <div className="stack">
      <label>
        {label} ({photos.length}/{max})
        {hint && <span className="hint">{hint}</span>}
        <input type="file" accept="image/*" capture="environment" multiple disabled={busy || photos.length >= max} onChange={(e) => void add(e.target.files)} />
      </label>
      {busy && <span className="muted">Uploading…</span>}
      {error && <div className="notice error">{error}</div>}
      {photos.length > 0 && (
        <div className="thumbs">
          {photos.map((p) => (
            <button key={p.ref} type="button" onClick={() => remove(p.ref)} title="Remove photo" style={{ padding: 0, border: 0, background: 'none' }}>
              <img src={p.preview} alt="Vehicle photo" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
