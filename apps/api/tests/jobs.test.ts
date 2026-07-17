import { afterAll, describe, expect, it } from "vitest";
import { closeJobs, demoQueue, demoWorker } from "../src/jobs/index.js";

describe("jobs (BullMQ demo queue)", () => {
  afterAll(async () => {
    await closeJobs();
  });

  it("processes an enqueued job", async () => {
    // The completion listener must be registered before the job is added:
    // the worker can complete a job faster than the next line of this
    // function runs, and Worker's "completed" event isn't replayed for
    // late subscribers.
    const completed = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("job did not complete in time")), 5000);
      demoWorker.on("completed", function handler(completedJob) {
        if (completedJob.data.marker === "jobs.test.ts") {
          clearTimeout(timeout);
          demoWorker.off("completed", handler);
          resolve(completedJob.returnvalue);
        }
      });
    });

    await demoQueue.add("ping", { marker: "jobs.test.ts" });

    await expect(completed).resolves.toBeUndefined(); // demo worker doesn't return a value, just logs
  });
});
