import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (name: string) => fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@kalangu/core": pkg("core"),
      "@kalangu/sim": pkg("sim"),
      "@kalangu/sms": pkg("sms"),
      "@kalangu/ussd": pkg("ussd"),
    },
  },
});
