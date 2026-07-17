import { describe, expect, it } from "vitest";
import { nextStatus } from "../src/modules/trips/state-machine.js";
describe("trip state machine", () => {
    it("moves requested -> searching on dispatch", () => {
        expect(nextStatus("requested", "dispatch")).toBe("searching");
    });
    it("moves searching -> accepted on driver_accept", () => {
        expect(nextStatus("searching", "driver_accept")).toBe("accepted");
    });
    it("rejects invalid transitions", () => {
        expect(nextStatus("completed", "driver_accept")).toBeNull();
    });
    it("terminal states have no outgoing transitions", () => {
        expect(nextStatus("paid", "dispatch")).toBeNull();
    });
});
//# sourceMappingURL=state-machine.test.js.map