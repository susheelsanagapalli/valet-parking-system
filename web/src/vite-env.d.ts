/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Address of the Valet server when the web app is hosted elsewhere. */
  readonly VITE_API_BASE?: string;
  /** "true" in the demo build (the server runs in the browser). */
  readonly VITE_PREVIEW?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
