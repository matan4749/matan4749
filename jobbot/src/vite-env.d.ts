/// <reference types="vite/client" />

import type { JobbotApi } from "../electron/preload";

declare global {
  interface Window {
    jobbot: JobbotApi;
  }
}

export {};
