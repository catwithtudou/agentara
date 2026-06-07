import { Hono } from "hono";

import { config, createLogger } from "@/shared";

const logger = createLogger("usage");

/**
 * Reads Claude Code credentials from macOS Keychain via `security find-generic-password`.
 * Returns the stored value (a JSON string) parsed as an object.
 */
async function getClaudeCredentials() {
  const proc = Bun.spawn(
    [
      "security",
      "find-generic-password",
      "-s",
      "Claude Code-credentials",
      "-w",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exit = await proc.exited;
  if (exit !== 0) {
    logger.warn({ exit, stderr }, "security find-generic-password failed");
    throw new Error(stderr || `security command exited with code ${exit}`);
  }
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("empty credentials from keychain");
  }
  return JSON.parse(trimmed) as {
    claudeAiOauth: {
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
    };
  };
}

async function queryClaudeUsage() {
  const credentials = await getClaudeCredentials();
  const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
    headers: new Headers({
      "anthropic-beta": "oauth-2025-04-20",
      Authorization: `Bearer ${credentials.claudeAiOauth.accessToken}`,
    }),
  });
  return (await response.json()) as {
    five_hour: {
      utilization: number;
      resets_at: string | null;
    };
    seven_day: {
      utilization: number;
      resets_at: string;
    };
    extra_usage:
      | {
          is_enabled: true;
          monthly_limit: number;
          used_credits: number;
          utilization: number;
        }
      | {
          is_enabled: false;
          monthly_limit: null;
          used_credits: null;
          utilization: null;
        };
  };
}

/**
 * Options for wiring usage routes in tests or alternate runtime contexts.
 */
export interface UsageRoutesOptions {
  /** Returns the currently configured default agent type. */
  getActiveAgentType?: () => string;
  /** Reads Claude usage data from the underlying provider. */
  queryUsage?: typeof queryClaudeUsage;
}

/**
 * Creates the usage route group. The Claude endpoint only reads Claude
 * credentials when the active agent is Claude.
 */
export function createUsageRoutes(options: UsageRoutesOptions = {}) {
  const getActiveAgentType =
    options.getActiveAgentType ?? (() => config.agents.default.type);
  const queryUsage = options.queryUsage ?? queryClaudeUsage;

  return new Hono().get("/claude", async (c) => {
    const activeAgentType = getActiveAgentType();
    if (activeAgentType !== "claude") {
      return c.json({
        usage: null,
        unavailable: {
          active_agent_type: activeAgentType,
          reason:
            "Claude usage is only available when the active agent is Claude.",
        },
      });
    }

    try {
      const usage = await queryUsage();
      return c.json({ usage });
    } catch (err) {
      logger.error({ err }, "failed to read Claude usage");
      return c.json(
        { error: err instanceof Error ? err.message : "unknown error" },
        500,
      );
    }
  });
}

export const usageRoutes = createUsageRoutes();
