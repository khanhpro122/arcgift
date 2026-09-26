import { defineConfig } from "vitest/config";

// Arc Testnet integration run (real chain). Not part of `npm test`.
export default defineConfig({
  test: { include: ["testnet/**/*.itest.ts"], environment: "node", fileParallelism: false, testTimeout: 300_000 },
});
