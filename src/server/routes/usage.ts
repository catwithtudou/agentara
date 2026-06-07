import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { Hono } from "hono";

import { config, createLogger } from "@/shared";

const logger = createLogger("usage");

/**
 * Token usage values emitted by Codex token_count events.
 */
export interface CodexTokenUsage {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
}

/**
 * Codex rate-limit window telemetry derived from local session logs.
 */
export interface CodexRateLimitWindow {
  used_percent: number;
  window_minutes: number | null;
  resets_at: string | null;
}

/**
 * Local Codex usage telemetry inferred from Codex session JSONL files.
 */
export interface CodexUsageTelemetry {
  captured_at: string;
  codex_home: string;
  plan_type: string | null;
  rate_limits: {
    primary: CodexRateLimitWindow | null;
    secondary: CodexRateLimitWindow | null;
    rate_limit_reached_type: string | null;
  };
  token_usage: {
    total: CodexTokenUsage | null;
    last: CodexTokenUsage | null;
    model_context_window: number | null;
  };
}

interface ClaudeUsage {
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
}

/**
 * Options for wiring usage routes in tests or alternate runtime contexts.
 */
export interface UsageRoutesOptions {
  /** Returns the currently configured default agent type. */
  getActiveAgentType?: () => string;
  /** Returns the Codex home directory to inspect for local telemetry. */
  getCodexHome?: () => string;
  /** Reads Claude usage data from the underlying provider. */
  queryClaudeUsage?: typeof queryClaudeUsage;
  /** Reads local Codex usage telemetry. */
  queryCodexUsage?: typeof queryCodexUsage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function dateStringOrNull(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  return null;
}

function normalizeTokenUsage(value: unknown): CodexTokenUsage | null {
  if (!isRecord(value)) return null;
  const inputTokens = numberOrNull(value.input_tokens);
  const cachedInputTokens = numberOrNull(value.cached_input_tokens);
  const outputTokens = numberOrNull(value.output_tokens);
  const reasoningOutputTokens = numberOrNull(value.reasoning_output_tokens);
  const totalTokens = numberOrNull(value.total_tokens);
  if (
    inputTokens == null ||
    cachedInputTokens == null ||
    outputTokens == null ||
    reasoningOutputTokens == null ||
    totalTokens == null
  ) {
    return null;
  }
  return {
    input_tokens: inputTokens,
    cached_input_tokens: cachedInputTokens,
    output_tokens: outputTokens,
    reasoning_output_tokens: reasoningOutputTokens,
    total_tokens: totalTokens,
  };
}

function normalizeRateLimitWindow(
  value: unknown,
): CodexRateLimitWindow | null {
  if (!isRecord(value)) return null;
  const usedPercent = numberOrNull(value.used_percent);
  if (usedPercent == null) return null;
  return {
    used_percent: usedPercent,
    window_minutes: numberOrNull(value.window_minutes),
    resets_at: dateStringOrNull(value.resets_at),
  };
}

function listJsonlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJsonlFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(path);
    }
  }
  return files;
}

function parseCodexTelemetryLine(
  line: string,
  codexHome: string,
): CodexUsageTelemetry | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const timestamp = dateStringOrNull(parsed.timestamp);
  if (!timestamp) return null;
  const payload = parsed.payload;
  if (!isRecord(payload) || payload.type !== "token_count") return null;

  const info = isRecord(payload.info) ? payload.info : {};
  const rateLimits = isRecord(payload.rate_limits) ? payload.rate_limits : {};
  return {
    captured_at: timestamp,
    codex_home: codexHome,
    plan_type: stringOrNull(rateLimits.plan_type),
    rate_limits: {
      primary: normalizeRateLimitWindow(rateLimits.primary),
      secondary: normalizeRateLimitWindow(rateLimits.secondary),
      rate_limit_reached_type: stringOrNull(
        rateLimits.rate_limit_reached_type,
      ),
    },
    token_usage: {
      total: normalizeTokenUsage(info.total_token_usage),
      last: normalizeTokenUsage(info.last_token_usage),
      model_context_window: numberOrNull(info.model_context_window),
    },
  };
}

function getDefaultCodexHome() {
  return Bun.env.CODEX_HOME ?? join(homedir(), ".codex");
}

function queryCodexUsage(codexHome: string): CodexUsageTelemetry | null {
  const files = [
    ...listJsonlFiles(join(codexHome, "sessions")),
    ...listJsonlFiles(join(codexHome, "archived_sessions")),
  ];
  let latest: CodexUsageTelemetry | null = null;
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch (err) {
      logger.warn({ err, file }, "failed to read Codex session file");
      continue;
    }
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const telemetry = parseCodexTelemetryLine(line, codexHome);
      if (
        telemetry &&
        (!latest ||
          new Date(telemetry.captured_at).getTime() >
            new Date(latest.captured_at).getTime())
      ) {
        latest = telemetry;
      }
    }
  }
  return latest;
}

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
  return (await response.json()) as ClaudeUsage;
}

/**
 * Creates the usage route group. Codex telemetry is inferred from local session
 * logs and should not be treated as official billing usage.
 */
export function createUsageRoutes(options: UsageRoutesOptions = {}) {
  const getActiveAgentType =
    options.getActiveAgentType ?? (() => config.agents.default.type);
  const getCodexHome = options.getCodexHome ?? getDefaultCodexHome;
  const readClaudeUsage = options.queryClaudeUsage ?? queryClaudeUsage;
  const readCodexUsage = options.queryCodexUsage ?? queryCodexUsage;

  async function getClaudeUsageResponse() {
    try {
      const usage = await readClaudeUsage();
      return { usage };
    } catch (err) {
      logger.error({ err }, "failed to read Claude usage");
      throw err;
    }
  }

  function getCodexUsageResponse() {
    const codexHome = getCodexHome();
    const usage = readCodexUsage(codexHome);
    if (!usage) {
      return {
        usage: null,
        unavailable: {
          codex_home: codexHome,
          reason: "No local Codex usage telemetry was found.",
        },
      };
    }
    return { usage, unavailable: null };
  }

  return new Hono()
    .get("/", (c) => {
      return c.json({ active_agent_type: getActiveAgentType() });
    })
    .get("/current", async (c) => {
      const activeAgentType = getActiveAgentType();
      if (activeAgentType === "codex") {
        return c.json({
          active_agent_type: activeAgentType,
          provider: "codex",
          codex: getCodexUsageResponse(),
        });
      }
      if (activeAgentType === "claude") {
        try {
          return c.json({
            active_agent_type: activeAgentType,
            provider: "claude",
            claude: await getClaudeUsageResponse(),
          });
        } catch (err) {
          return c.json(
            { error: err instanceof Error ? err.message : "unknown error" },
            500,
          );
        }
      }
      return c.json({
        active_agent_type: activeAgentType,
        provider: "unavailable",
        unavailable: {
          reason: `Usage telemetry is not available for agent type ${activeAgentType}.`,
        },
      });
    })
    .get("/claude", async (c) => {
      try {
        return c.json(await getClaudeUsageResponse());
      } catch (err) {
        return c.json(
          { error: err instanceof Error ? err.message : "unknown error" },
          500,
        );
      }
    })
    .get("/codex", (c) => {
      return c.json(getCodexUsageResponse());
    });
}

export const usageRoutes = createUsageRoutes();
