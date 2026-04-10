import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/config/api";
import type { ACPTopology, ACPQueue } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Network, ArrowRight, Inbox, Send, AlertTriangle } from "lucide-react";

export default function ACPPage() {
  const { data: topology } = useQuery({
    queryKey: ['acp-topology'],
    queryFn: () => apiGet<ACPTopology>('/api/acp/topology'),
    refetchInterval: 5000,
  });

  const { data: queues } = useQuery({
    queryKey: ['acp-queues'],
    queryFn: () => apiGet<ACPQueue>('/api/acp/queues'),
    refetchInterval: 5000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">ACP</h1>
        <p className="text-sm text-muted-foreground mt-1">Agent Communication Protocol</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="glass-card">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-1">
              <Send className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">In Transit</span>
            </div>
            <p className="text-2xl font-bold">{queues?.in_transit ?? '—'}</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-1">
              <Inbox className="h-4 w-4 text-warning" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Pending</span>
            </div>
            <p className="text-2xl font-bold">{queues?.pending ?? '—'}</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Dead Letter</span>
            </div>
            <p className="text-2xl font-bold">{queues?.dead_letter ?? '—'}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-card">
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Network className="h-4 w-4" />Agent Topology</CardTitle></CardHeader>
        <CardContent>
          {topology ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-3">
                {topology.agents.map(agent => (
                  <div key={agent.id} className="glass-panel p-3 min-w-[140px]">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`status-dot status-${agent.state}`} />
                      <span className="text-sm font-medium truncate">{agent.name}</span>
                    </div>
                    <Badge variant="outline" className="text-[10px]">{agent.role}</Badge>
                  </div>
                ))}
              </div>
              {topology.connections.length > 0 && (
                <div className="space-y-2 mt-4">
                  <h4 className="text-xs text-muted-foreground uppercase tracking-wider">Connections</h4>
                  {topology.connections.map((c, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className="font-mono text-xs">{c.from.slice(0, 8)}</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      <span className="font-mono text-xs">{c.to.slice(0, 8)}</span>
                      <Badge variant="secondary" className="text-[10px] ml-2">{c.type}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">Connecting...</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
