import { createFileRoute } from "@tanstack/react-router";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  type CodexRateLimitWindow,
  type CodexTokenUsage,
  type CurrentUsage,
  useCurrentUsage,
} from "@/lib/api";
import { cn } from "@/lib/utils";

dayjs.extend(relativeTime);

export const Route = createFileRoute("/usage/")({
  component: UsagePage,
});

function formatResetsIn(resetsAt: string): string {
  const target = dayjs(resetsAt);
  const now = dayjs();
  const diffMs = target.diff(now);
  if (diffMs <= 0) return "Resets soon";
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) {
    return `Resets in ${hours} hr ${minutes} min`;
  }
  return `Resets in ${minutes} min`;
}

function formatResetsAt(resetsAt: string): string {
  const target = dayjs(resetsAt);
  return `Resets ${target.format("ddd h:mm A")}`;
}

function formatWindowName(windowMinutes: number | null): string {
  if (windowMinutes === 300) return "5-hour window";
  if (windowMinutes === 10080) return "7-day window";
  if (windowMinutes == null) return "Window";
  if (windowMinutes < 60) return `${windowMinutes}-minute window`;
  const hours = windowMinutes / 60;
  if (Number.isInteger(hours)) return `${hours}-hour window`;
  return `${windowMinutes}-minute window`;
}

const numberFormatter = new Intl.NumberFormat();

function RefreshControl({
  lastUpdatedLabel,
  isRefetching,
  onRefresh,
}: {
  lastUpdatedLabel: string;
  isRefetching: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span>{lastUpdatedLabel}</span>
      <Button
        variant="ghost"
        size="icon"
        className="size-6"
        onClick={onRefresh}
        disabled={isRefetching}
        aria-label="Refresh"
      >
        <RefreshCw className={cn("size-3.5", isRefetching && "animate-spin")} />
      </Button>
    </div>
  );
}

function UnavailableUsage({
  title,
  reason,
  codexHome,
}: {
  title: string;
  reason: string;
  codexHome?: string;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-md border bg-muted/40 px-3 py-3">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="text-sm text-muted-foreground">{reason}</p>
      {codexHome ? (
        <p className="break-all text-xs text-muted-foreground">
          Codex home: {codexHome}
        </p>
      ) : null}
    </section>
  );
}

function CodexRateLimit({
  title,
  rateLimit,
}: {
  title: string;
  rateLimit: CodexRateLimitWindow | null;
}) {
  if (!rateLimit) {
    return (
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-sm text-muted-foreground">No window data available</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-xs text-muted-foreground">
          {formatWindowName(rateLimit.window_minutes)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {rateLimit.resets_at
          ? formatResetsAt(rateLimit.resets_at)
          : "Reset time unavailable"}
      </p>
      <div className="flex items-center gap-3">
        <Progress value={Math.min(rateLimit.used_percent, 100)} className="flex-1" />
        <span className="text-sm text-muted-foreground">
          {rateLimit.used_percent}% used
        </span>
      </div>
    </section>
  );
}

function TokenUsageRows({
  title,
  usage,
}: {
  title: string;
  usage: CodexTokenUsage | null;
}) {
  if (!usage) {
    return (
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-sm text-muted-foreground">No token data available</p>
      </section>
    );
  }

  const rows = [
    ["Input", usage.input_tokens],
    ["Cached input", usage.cached_input_tokens],
    ["Output", usage.output_tokens],
    ["Reasoning", usage.reasoning_output_tokens],
    ["Total", usage.total_tokens],
  ];

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className="text-sm font-medium">
              {numberFormatter.format(value as number)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ClaudeUsageContent({
  usageState,
  isLoading,
  lastUpdatedLabel,
  isRefetching,
  onRefresh,
}: {
  usageState: Extract<CurrentUsage, { provider: "claude" }> | undefined;
  isLoading: boolean;
  lastUpdatedLabel: string;
  isRefetching: boolean;
  onRefresh: () => void;
}) {
  const usage = usageState?.claude.usage;
  return (
    <>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Current session</h3>
        {isLoading ? (
          <Skeleton className="h-2 w-full" />
        ) : usage?.five_hour ? (
          <>
            <p className="text-xs text-muted-foreground">
              {usage.five_hour.resets_at
                ? formatResetsIn(usage.five_hour.resets_at)
                : "Starts when a message is sent"}
            </p>
            <div className="flex items-center gap-3">
              <Progress
                value={Math.min(usage.five_hour.utilization, 100)}
                className="flex-1"
              />
              <span className="text-sm text-muted-foreground">
                {usage.five_hour.utilization}% used
              </span>
            </div>
          </>
        ) : null}
      </div>

      <Separator />

      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-medium">Weekly limits</h3>
        <a
          href="https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-muted-foreground hover:underline"
        >
          Learn more about usage limits
        </a>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">All models</h3>
          {isLoading ? (
            <Skeleton className="h-2 w-full" />
          ) : usage?.seven_day ? (
            <>
              <p className="text-xs text-muted-foreground">
                {formatResetsAt(usage.seven_day.resets_at)}
              </p>
              <div className="flex items-center gap-3">
                <Progress
                  value={Math.min(usage.seven_day.utilization, 100)}
                  className="flex-1"
                />
                <span className="text-sm text-muted-foreground">
                  {usage.seven_day.utilization}% used
                </span>
              </div>
            </>
          ) : null}
        </div>

        <RefreshControl
          lastUpdatedLabel={lastUpdatedLabel}
          isRefetching={isRefetching}
          onRefresh={onRefresh}
        />
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-medium">Extra usage</h3>
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Turn on extra usage to keep using Claude if you hit a limit.{" "}
            <a
              href="https://support.claude.com/en/articles/12429409-extra-usage-for-paid-claude-plans"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:underline"
            >
              Learn more
            </a>
          </p>
          {isLoading ? (
            <Skeleton className="size-8 w-14 shrink-0 rounded-full" />
          ) : (
            <Switch
              checked={usage?.extra_usage?.is_enabled ?? false}
              disabled
              aria-label="Extra usage"
            />
          )}
        </div>
      </section>
    </>
  );
}

function CodexUsageContent({
  usageState,
  lastUpdatedLabel,
  isRefetching,
  onRefresh,
}: {
  usageState: Extract<CurrentUsage, { provider: "codex" }>;
  lastUpdatedLabel: string;
  isRefetching: boolean;
  onRefresh: () => void;
}) {
  const usage = usageState.codex.usage;
  if (!usage) {
    return (
      <UnavailableUsage
        title="Codex telemetry unavailable"
        reason={usageState.codex.unavailable?.reason ?? "No Codex usage data"}
        codexHome={usageState.codex.unavailable?.codex_home}
      />
    );
  }

  return (
    <>
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Local telemetry</h3>
          {usage.plan_type ? (
            <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
              {usage.plan_type}
            </span>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          Derived from local Codex session logs, not official billing usage.
        </p>
      </section>

      <Separator />

      <CodexRateLimit title="Primary limit" rateLimit={usage.rate_limits.primary} />

      <Separator />

      <CodexRateLimit
        title="Secondary limit"
        rateLimit={usage.rate_limits.secondary}
      />

      <Separator />

      <TokenUsageRows title="Latest turn tokens" usage={usage.token_usage.last} />

      <Separator />

      <TokenUsageRows title="Session total tokens" usage={usage.token_usage.total} />

      <Separator />

      <section className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">
          Captured {dayjs(usage.captured_at).fromNow()}
          {usage.token_usage.model_context_window
            ? ` · Context window ${numberFormatter.format(
                usage.token_usage.model_context_window,
              )}`
            : ""}
        </p>
        <RefreshControl
          lastUpdatedLabel={lastUpdatedLabel}
          isRefetching={isRefetching}
          onRefresh={onRefresh}
        />
      </section>
    </>
  );
}

function UsagePage() {
  const {
    data: currentUsage,
    isLoading,
    isRefetching,
    refetch,
    dataUpdatedAt,
  } = useCurrentUsage();

  const lastUpdatedLabel =
    dataUpdatedAt != null
      ? `Last updated: ${dayjs(dataUpdatedAt).fromNow()}`
      : "Last updated: --";
  const title =
    currentUsage?.provider === "codex"
      ? "Codex rate limits"
      : currentUsage?.provider === "claude"
        ? "Claude usage limits"
        : "Usage";

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="container-md mx-auto flex max-w-2xl flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {isLoading ? (
              <>
                <Skeleton className="h-2 w-full" />
                <Skeleton className="h-2 w-2/3" />
                <Skeleton className="h-2 w-full" />
              </>
            ) : currentUsage?.provider === "codex" ? (
              <CodexUsageContent
                usageState={currentUsage}
                lastUpdatedLabel={lastUpdatedLabel}
                isRefetching={isRefetching}
                onRefresh={() => void refetch()}
              />
            ) : currentUsage?.provider === "claude" ? (
              <ClaudeUsageContent
                usageState={currentUsage}
                isLoading={isLoading}
                lastUpdatedLabel={lastUpdatedLabel}
                isRefetching={isRefetching}
                onRefresh={() => void refetch()}
              />
            ) : currentUsage?.provider === "unavailable" ? (
              <UnavailableUsage
                title="Usage unavailable"
                reason={currentUsage.unavailable.reason}
              />
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
