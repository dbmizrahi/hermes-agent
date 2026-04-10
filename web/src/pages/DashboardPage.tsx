import { useQuery } from "@tanstack/react-query";
import { getGatewayStatus } from "@/api/gateway";
import { listSessions } from "@/api/sessions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bot, Clock, Activity, Zap, Cpu, MessageSquare, Server } from "lucide-react";

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(seconds / 3600);
  const remainMins = mins % 60;
  if (seconds < 86400) return `${hrs}h ${remainMins}m`;
  return `${Math.floor(seconds / 86400)}d ${hrs % 24}h`;
}

function StatCard({ title, value, subtitle, icon: Icon }: {
  title: string; value: string | number; subtitle?: string;
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

export default function DashboardPage() {
  const { data: gatewayStatus } = useQuery({
    queryKey: ['gateway-status'],
    queryFn: getGatewayStatus,
    refetchInterval: 10000,
  });

  const { data: sessionsData } = useQuery({
    queryKey: ['sessions-summary'],
    queryFn: () => listSessions({ limit: 10, offset: 0 }),
    refetchInterval: 30000,
  });

  const totalSessions = sessionsData?.total || 0;
  const uptime = gatewayStatus?.uptime_seconds || 0;
  const activeSessions = gatewayStatus?.active_sessions || 0;
  const platforms = gatewayStatus?.platforms || [];
  const model = gatewayStatus?.model || '—';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Mission Control</h1>
        <p className="text-sm text-muted-foreground mt-1">Hermes Agent System Overview</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard title="Active Sessions" value={activeSessions} subtitle={`${totalSessions} total`} icon={Bot} />
        <StatCard title="Total Sessions" value={totalSessions} subtitle="All time" icon={MessageSquare} />
        <StatCard title="Uptime" value={formatUptime(uptime)} subtitle="Gateway uptime" icon={Activity} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="glass-card lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Gateway Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {gatewayStatus ? (
              <>
                <div className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2">
                    <span className="status-dot status-running" />
                    <span className="text-sm">Gateway</span>
                  </div>
                  <Badge variant="default" className="text-[10px]">{gatewayStatus.status}</Badge>
                </div>
                {platforms.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-medium">Platforms</p>
                    {platforms.map((p: { name: string; type: string; connected: boolean; connected_since?: string; error?: string }, i: number) => (
                      <div key={p.name || i} className="flex items-center justify-between py-1">
                        <div className="flex items-center gap-2">
                          <Server className="h-3 w-3 text-muted-foreground" />
                          <span className="text-sm capitalize">{p.name || 'Unknown'}</span>
                          <span className="text-[10px] text-muted-foreground">({p.type || 'unknown'})</span>
                        </div>
                        <Badge variant={p.connected ? "default" : "destructive"} className="text-[10px]">
                          {p.connected ? "Connected" : "Disconnected"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
                {platforms.length === 0 && (
                  <p className="text-sm text-muted-foreground py-2 text-center">No platforms connected</p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center">Connecting to gateway...</p>
            )}
          </CardContent>
        </Card>

        <Card className="glass-card lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Recent Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            {sessionsData && sessionsData.items.length > 0 ? (
              <div className="space-y-2">
                {sessionsData.items.slice(0, 6).map(session => (
                  <div key={session.id} className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="status-dot status-running" />
                      <span className="text-sm truncate">{session.title || session.id.slice(0, 12)}</span>
                    </div>
                    <Badge variant="outline" className="text-[10px] flex-shrink-0">{session.source}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center">No sessions yet</p>
            )}
          </CardContent>
        </Card>

        <Card className="glass-card lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            {[
              { label: "Sessions", icon: MessageSquare, href: "/sessions" },
              { label: "Chat", icon: Zap, href: "/chat" },
              { label: "Memory", icon: Bot, href: "/memory" },
              { label: "Cron Jobs", icon: Clock, href: "/cron" },
              { label: "Gateway", icon: Server, href: "/gateway" },
              { label: "Skills", icon: Cpu, href: "/skills" },
            ].map(({ label, icon: I, href }) => (
              <a key={href} href={href} className="glass-panel p-3 flex flex-col items-center gap-1.5 hover:bg-primary/5 transition-colors cursor-pointer">
                <I className="h-4 w-4 text-primary" />
                <span className="text-[11px] text-muted-foreground">{label}</span>
              </a>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
