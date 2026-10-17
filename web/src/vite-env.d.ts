/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Address of the Valet server when the web app is hosted elsewhere (e.g. GitHub Pages). */
  readonly VITE_API_BASE?: string;
  /** "true" in the GitHub Pages build. */
  readonly VITE_PREVIEW?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
