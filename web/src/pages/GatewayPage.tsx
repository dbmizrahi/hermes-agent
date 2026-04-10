import { useQuery, useMutation } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Power, Loader2, Zap, Clock, AlertTriangle, MessageSquare, Inbox } from "lucide-react";
import { toast } from "sonner";

// API response shape from GET /api/gateway/status
interface GatewayStatusResponse {
  status: string;
  platform: string;
  uptime_seconds: number;
  version: string;
  model: string;
  active_sessions: number;
  platforms: Array<{
    name: string;
    type: string;
    connected: boolean;
    connected_since: string | null;
    error: string | null;
  }>;
}

// API response shape from GET /api/gateway/metrics
interface GatewayMetricsResponse {
  requests_per_second: number;
  avg_latency_ms: number;
  error_rate: number;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(seconds / 3600);
  const remainMins = mins % 60;
  if (seconds < 86400) return `${hrs}h ${remainMins}m`;
  return `${Math.floor(seconds / 86400)}d ${hrs % 24}h`;
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return ts;
  }
}

function MetricCard({ title, value, subtitle, icon: Icon }: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
}) {
  return (
    <Card className="glass-card hover:border-primary/30 transition-colors">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{title}</p>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon className="h-5 w-5 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function GatewayPage() {
  const { data: status, isLoading, error, refetch } = useQuery<GatewayStatusResponse>({
    queryKey: ['gateway-status'],
    queryFn: () => apiGet<GatewayStatusResponse>('/api/gateway/status'),
    refetchInterval: 5000,
    retry: 2,
  });

  const { data: metrics } = useQuery<GatewayMetricsResponse>({
    queryKey: ['gateway-metrics'],
    queryFn: () => apiGet<GatewayMetricsResponse>('/api/gateway/metrics'),
    refetchInterval: 2000,
    retry: 2,
  });

  const reloadMutation = useMutation({
    mutationFn: () => apiPost('/api/gateway/reload'),
    onSuccess: () => {
      toast.success("Gateway config reloaded");
      refetch();
    },
    onError: (err: Error) => toast.error(`Reload failed: ${err.message}`),
  });

  const restartMutation = useMutation({
    mutationFn: () => apiPost('/api/gateway/restart'),
    onSuccess: () => {
      toast.success("Gateway restarting...");
      refetch();
    },
    onError: (err: Error) => toast.error(`Restart failed: ${err.message}`),
  });

  const platforms = status?.platforms ?? [];
  const connectedCount = platforms.filter(p => p.connected).length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-3 text-muted-foreground">Loading gateway status...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Gateway</h1>
          <p className="text-sm text-muted-foreground mt-1">Communication hub monitoring</p>
        </div>
        <Card className="glass-card border-destructive/50">
          <CardContent className="p-6 text-center">
            <p className="text-destructive font-medium">Failed to load gateway status</p>
            <p className="text-sm text-muted-foreground mt-1">{error.message}</p>
            <Button size="sm" variant="outline" className="mt-4" onClick={() => refetch()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" />Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Gateway</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Communication hub monitoring &middot; {status?.version ?? "—"} &middot; Uptime: {formatUptime(status?.uptime_seconds ?? 0)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => reloadMutation.mutate()}
            disabled={reloadMutation.isPending}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${reloadMutation.isPending ? 'animate-spin' : ''}`} />
            Reload
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => restartMutation.mutate()}
            disabled={restartMutation.isPending}
          >
            <Power className="h-3.5 w-3.5 mr-1" />
            Restart
          </Button>
        </div>
      </div>

      {/* Top Metrics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <MetricCard
          title="Requests/sec"
          value={metrics?.requests_per_second ?? 0}
          subtitle="Throughput"
          icon={Zap}
        />
        <MetricCard
          title="Avg Latency"
          value={`${metrics?.avg_latency_ms ?? 0}ms`}
          subtitle="Response time"
          icon={Clock}
        />
        <MetricCard
          title="Error Rate"
          value={`${metrics?.error_rate ?? 0}%`}
          subtitle="Last 5 minutes"
          icon={AlertTriangle}
        />
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MetricCard
          title="Active Sessions"
          value={status?.active_sessions ?? 0}
          subtitle={status?.model ? `Model: ${status.model}` : undefined}
          icon={MessageSquare}
        />
        <MetricCard
          title="Queued Messages"
          value={0}
          subtitle="Pending processing"
          icon={Inbox}
        />
      </div>

      {/* Service Health List */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Service Health
            <Badge variant="secondary" className="ml-2 text-xs">
              {connectedCount}/{platforms.length} connected
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {platforms.length > 0 ? platforms.map((platform) => (
            <div
              key={platform.name}
              className="flex items-center justify-between py-3 border-b border-border/30 last:border-0"
            >
              <div className="flex items-center gap-3">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    platform.connected ? 'bg-green-500' : 'bg-red-500'
                  }`}
                />
                <div>
                  <span className="text-sm font-medium capitalize">{platform.name}</span>
                  {platform.error && (
                    <p className="text-xs text-destructive mt-0.5">{platform.error}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-muted-foreground">
                  {formatTimestamp(platform.connected_since)}
                </span>
                <Badge
                  variant={platform.connected ? 'default' : 'destructive'}
                  className="text-[10px]"
                >
                  {platform.connected ? 'connected' : 'disconnected'}
                </Badge>
              </div>
            </div>
          )) : (
            <p className="text-sm text-muted-foreground text-center py-6">
              No platforms connected
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
