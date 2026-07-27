import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(__dirname, "fixtures", "load-env.ts");
const tsxBin = path.join(__dirname, "..", "node_modules", ".bin", "tsx");

function loadEnvIn(extraEnv: Record<string, string>): { status: number; output: string } {
  try {
    const output = execFileSync(tsxBin, [fixture], {
      env: { ...process.env, ...extraEnv },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output };
  } catch (err) {
    const e = err as { status: number | null; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

// Run as real subprocesses (not vi.resetModules + re-import) — this is a
// module-load-time check, and a subprocess is the only way to observe it in
// full isolation without touching the module cache the rest of this
// (parallel) test suite shares.
describe("production secrets guard (Phase 5.2)", () => {
  it("refuses to start in production with the schema's literal default secrets", () => {
    const result = loadEnvIn({ NODE_ENV: "production", JWT_ACCESS_SECRET: "", JWT_REFRESH_SECRET: "" });
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/high-entropy secret/i);
    expect(result.output).toMatch(/JWT_ACCESS_SECRET/);
  });

  it("refuses to start in production with a short, guessable placeholder like this sandbox's own .env uses", () => {
    const result = loadEnvIn({ NODE_ENV: "production", JWT_ACCESS_SECRET: "change-me", JWT_REFRESH_SECRET: "change-me-too" });
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/high-entropy secret/i);
  });

  it("starts fine in production once real, sufficiently long secrets are set", () => {
    const result = loadEnvIn({
      NODE_ENV: "production",
      JWT_ACCESS_SECRET: "a-real-production-secret-with-plenty-of-entropy-1",
      JWT_REFRESH_SECRET: "another-real-production-secret-with-plenty-entropy-2",
    });
    expect(result.status).toBe(0);
    expect(result.output).toContain("OK");
  });

  it("does not enforce the guard outside production (dev stays frictionless)", () => {
    const result = loadEnvIn({ NODE_ENV: "development" });
    expect(result.status).toBe(0);
    expect(result.output).toContain("OK");
  });
});
