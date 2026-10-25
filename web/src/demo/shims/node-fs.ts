/** Browser stand-in for node:fs: the browser demo never writes files (no queue file is configured). */
export const existsSync = (): boolean => false;
export function readFileSync(): never {
  throw new Error('Files are not available in the browser demo');
}
export function writeFileSync(): void {}
export function renameSync(): void {}
export function mkdirSync(): void {}
