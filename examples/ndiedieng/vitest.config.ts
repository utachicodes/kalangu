import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (name: string) => fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  test: {
    // Several tests build the whole fictitious commune (58 villages, 499 records) in
    // SQLite; on Windows CI machines that alone took just over the default 5 s.
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      "@kalangu/core": pkg("core"),
      "@kalangu/sim": pkg("sim"),
      "@kalangu/sms": pkg("sms"),
      "@kalangu/ussd": pkg("ussd"),
    },
  },
});
