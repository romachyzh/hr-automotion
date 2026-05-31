import { describe, it, expect } from "vitest";
import {
  aggregateByPolicy,
  describeDayCounting,
  normaliseStatus,
} from "../../src/reporting/leave-aggregation.js";
import type { LeaveRequest } from "@hr-automotion/sagehr-client";

function req(partial: Partial<LeaveRequest>): LeaveRequest {
  return { id: 1, employee_id: 1, ...partial } as LeaveRequest;
}

describe("normaliseStatus", () => {
  it("prefers status_code", () => {
    expect(normaliseStatus(req({ status_code: "approved", status: "Rejected" }))).toBe("approved");
    expect(normaliseStatus(req({ status_code: "declined" }))).toBe("rejected");
    expect(normaliseStatus(req({ status_code: "canceled" }))).toBe("cancelled");
  });
  it("falls back to fuzzy human status", () => {
    expect(normaliseStatus(req({ status: "Pending approval" }))).toBe("pending");
    expect(normaliseStatus(req({ status: "Approved" }))).toBe("approved");
    expect(normaliseStatus(req({}))).toBe("other");
  });
});

describe("aggregateByPolicy", () => {
  it("buckets approved business days per policy", () => {
    // Mon 2026-04-20 → Fri 2026-04-24 = 5 business days, approved.
    const result = aggregateByPolicy([
      req({
        policy_id: 7,
        status_code: "approved",
        start_date: "2026-04-20",
        end_date: "2026-04-24",
      }),
      // Pending request on the same policy — counted in totals but in the
      // pending status bucket, not approved.
      req({ policy_id: 7, status_code: "pending", start_date: "2026-04-27" }),
    ]);
    expect(result.by_policy).toHaveLength(1);
    const bucket = result.by_policy[0]!;
    expect(bucket.policy_id).toBe(7);
    expect(bucket.by_status.approved.days).toBe(5);
    expect(bucket.by_status.pending.days).toBe(1);
    expect(result.totals.days_total).toBe(6);
  });
});

describe("describeDayCounting", () => {
  it("reports business vs calendar basis", () => {
    expect(describeDayCounting({}).basis).toBe("business_days");
    expect(describeDayCounting({ countWeekends: true }).basis).toBe("calendar_days");
    expect(describeDayCounting({ holidays: ["2026-01-01", "2026-12-25"] }).holidays_excluded).toBe(
      2,
    );
  });
});
