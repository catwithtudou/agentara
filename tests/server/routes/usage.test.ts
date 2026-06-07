import { describe, expect, test } from "bun:test";

import { createUsageRoutes } from "@/server/routes/usage";

describe("usageRoutes", () => {
  test("queries Claude usage when the active agent is Claude", async () => {
    let queried = false;
    const usage = {
      five_hour: {
        utilization: 0.25,
        resets_at: null,
      },
      seven_day: {
        utilization: 0.5,
        resets_at: "2026-06-07T12:00:00Z",
      },
      extra_usage: {
        is_enabled: false as const,
        monthly_limit: null,
        used_credits: null,
        utilization: null,
      },
    };
    const routes = createUsageRoutes({
      getActiveAgentType: () => "claude",
      queryUsage: async () => {
        queried = true;
        return usage;
      },
    });

    const response = await routes.request("/claude");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(queried).toBe(true);
    expect(body).toEqual({ usage });
  });

  test("does not query Claude usage when the active agent is not Claude", async () => {
    let queried = false;
    const routes = createUsageRoutes({
      getActiveAgentType: () => "codex",
      queryUsage: async () => {
        queried = true;
        throw new Error("should not query Claude usage");
      },
    });

    const response = await routes.request("/claude");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(queried).toBe(false);
    expect(body).toEqual({
      usage: null,
      unavailable: {
        active_agent_type: "codex",
        reason: "Claude usage is only available when the active agent is Claude.",
      },
    });
  });
});
