/** Resizes a camera photo to a JPEG of about 300 KB or less before upload (SRS 2.6). */
export async function compressImage(file: File, maxSide = 1280, maxBytes = 300_000): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (let quality = 0.8; quality >= 0.3; quality -= 0.1) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if ((url.length * 3) / 4 <= maxBytes) return url;
  }
  return canvas.toDataURL('image/jpeg', 0.3);
}

export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
