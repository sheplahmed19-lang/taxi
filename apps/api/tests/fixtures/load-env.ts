// Fixture for env-secrets-guard.test.ts: importing config/env.ts is enough
// to trigger its module-load-time production-secrets check (see
// src/config/env.ts). Run as a subprocess so the check's `process.exit`-via-throw
// behavior can be observed in isolation, without touching the shared module
// cache the rest of the (parallel) test suite relies on.
import "../../src/config/env.js";
console.log("OK");
