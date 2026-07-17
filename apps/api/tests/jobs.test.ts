import { afterAll, describe, expect, it } from "vitest";
import { closeJobs, demoQueue, demoWorker } from "../src/jobs/index.js";

describe("jobs (BullMQ demo queue)", () => {
  afterAll(async () => {
    await closeJobs();
  });

  it("processes an enqueued job", async () => {
    const job = await demoQueue.add("ping", { hello: "world" });

    const completed = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("job did not complete in time")), 5000);
      demoWorker.once("completed", (completedJob) => {
        if (completedJob.id === job.id) {
          clearTimeout(timeout);
          resolve(completedJob.returnvalue);
        }
      });
    });

    expect(completed).toBeUndefined(); // demo worker doesn't return a value, just logs
  });
});
