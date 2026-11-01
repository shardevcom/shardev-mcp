import { defineConfig } from "vitest/config";

// `vitest run` (npm test) NO corre las pruebas *.slow.test.ts: generan un proyecto real e instalan
// dependencias (red, varios minutos). Se lanzan aparte con `npm run test:slow`.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.slow.test.ts"],
  },
});
