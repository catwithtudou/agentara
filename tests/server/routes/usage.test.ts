import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { createUsageRoutes } from "@/server/routes/usage";

const tempDirs: string[] = [];

function createCodexHome() {
  const codexHome = mkdtempSync(join(tmpdir(), "agentara-codex-home-"));
  tempDirs.push(codexHome);
  mkdirSync(join(codexHome, "sessions"), { recursive: true });
  mkdirSync(join(codexHome, "archived_sessions"), { recursive: true });
  return codexHome;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("usageRoutes", () => {
  test("returns Codex telemetry from current usage when Codex is active", async () => {
    const codexHome = "/tmp/codex-home";
    const usage = {
      captured_at: "2026-06-07T04:00:00.000Z",
      codex_home: codexHome,
      plan_type: "pro",
      rate_limits: {
        primary: {
          used_percent: 15,
          window_minutes: 300,
          resets_at: "2025-10-09T08:58:20.000Z",
        },
        secondary: null,
        rate_limit_reached_type: null,
      },
      token_usage: {
        total: null,
        last: null,
        model_context_window: null,
      },
    };
    const routes = createUsageRoutes({
      getActiveAgentType: () => "codex",
      getCodexHome: () => codexHome,
      queryCodexUsage: () => usage,
    });

    const response = await routes.request("/current");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      active_agent_type: "codex",
      provider: "codex",
      codex: {
        usage,
        unavailable: null,
      },
    });
  });

  test("returns latest Codex usage telemetry from local session logs", async () => {
    const codexHome = createCodexHome();
    writeFileSync(
      join(codexHome, "sessions", "older.jsonl"),
      [
        "not-json",
        JSON.stringify({ timestamp: "2026-06-07T02:00:00.000Z" }),
        JSON.stringify({
          timestamp: "2026-06-07T03:00:00.000Z",
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 10,
                cached_input_tokens: 2,
                output_tokens: 3,
                reasoning_output_tokens: 1,
                total_tokens: 13,
              },
              last_token_usage: {
                input_tokens: 10,
                cached_input_tokens: 2,
                output_tokens: 3,
                reasoning_output_tokens: 1,
                total_tokens: 13,
              },
              model_context_window: 258400,
            },
            rate_limits: {
              limit_id: "codex",
              primary: {
                used_percent: 12,
                window_minutes: 300,
                resets_at: 1760000000,
              },
              secondary: {
                used_percent: 7,
                window_minutes: 10080,
                resets_at: 1760600000,
              },
              credits: null,
              plan_type: "prolite",
              rate_limit_reached_type: null,
            },
          },
        }),
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(codexHome, "archived_sessions", "newer.jsonl"),
      `${JSON.stringify({
        timestamp: "2026-06-07T04:00:00.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 20,
              cached_input_tokens: 4,
              output_tokens: 6,
              reasoning_output_tokens: 2,
              total_tokens: 26,
            },
            last_token_usage: {
              input_tokens: 5,
              cached_input_tokens: 1,
              output_tokens: 2,
              reasoning_output_tokens: 1,
              total_tokens: 7,
            },
            model_context_window: 258400,
          },
          rate_limits: {
            limit_id: "codex",
            primary: {
              used_percent: 15,
              window_minutes: 300,
              resets_at: 1760000300,
            },
            secondary: {
              used_percent: 8,
              window_minutes: 10080,
              resets_at: 1760600300,
            },
            credits: null,
            plan_type: "pro",
            rate_limit_reached_type: null,
          },
        },
      })}\n`,
      "utf-8",
    );

    const routes = createUsageRoutes({
      getCodexHome: () => codexHome,
    });
    const response = await routes.request("/codex");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      usage: {
        captured_at: "2026-06-07T04:00:00.000Z",
        codex_home: codexHome,
        plan_type: "pro",
        rate_limits: {
          primary: {
            used_percent: 15,
            window_minutes: 300,
            resets_at: "2025-10-09T08:58:20.000Z",
          },
          secondary: {
            used_percent: 8,
            window_minutes: 10080,
            resets_at: "2025-10-16T07:38:20.000Z",
          },
          rate_limit_reached_type: null,
        },
        token_usage: {
          total: {
            input_tokens: 20,
            cached_input_tokens: 4,
            output_tokens: 6,
            reasoning_output_tokens: 2,
            total_tokens: 26,
          },
          last: {
            input_tokens: 5,
            cached_input_tokens: 1,
            output_tokens: 2,
            reasoning_output_tokens: 1,
            total_tokens: 7,
          },
          model_context_window: 258400,
        },
      },
      unavailable: null,
    });
  });

  test("returns unavailable when Codex telemetry is not present", async () => {
    const codexHome = createCodexHome();
    const routes = createUsageRoutes({
      getCodexHome: () => codexHome,
    });

    const response = await routes.request("/codex");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      usage: null,
      unavailable: {
        codex_home: codexHome,
        reason: "No local Codex usage telemetry was found.",
      },
    });
  });
});
