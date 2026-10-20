import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";
import path from "node:path";

const alias = {
  "@": path.resolve(__dirname, "src"),
  "@core": path.resolve(__dirname, "core"),
};

const electronExternal = [
  "electron",
  "playwright",
  "nodemailer",
  "pdf-parse",
];

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: "electron/main.ts",
        vite: {
          resolve: { alias },
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              external: electronExternal,
            },
          },
        },
      },
      preload: {
        input: "electron/preload.ts",
        vite: {
          resolve: { alias },
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              external: ["electron"],
            },
          },
        },
      },
      renderer: {},
    }),
  ],
  resolve: { alias },
  server: {
    port: 5173,
  },
});
