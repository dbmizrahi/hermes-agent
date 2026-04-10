import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/config/api";
import type { NetworkHost, NetworkService } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Globe, Server, Wifi } from "lucide-react";

export default function NetworkPage() {
  const { data: hosts } = useQuery({
    queryKey: ['network-hosts'],
    queryFn: () => apiGet<NetworkHost[]>('/api/network/hosts'),
  });

  const { data: services } = useQuery({
    queryKey: ['network-services'],
    queryFn: () => apiGet<NetworkService[]>('/api/network/services'),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Network</h1>
        <p className="text-sm text-muted-foreground mt-1">Distributed infrastructure management</p>
      </div>

      <Card className="glass-card">
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Server className="h-4 w-4" />Host Inventory</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Hostname</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Services</TableHead>
                <TableHead>Last Seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(hosts || []).map(h => (
                <TableRow key={h.id}>
                  <TableCell className="font-medium">{h.hostname}</TableCell>
                  <TableCell className="font-mono text-xs">{h.ip}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span className={`status-dot ${h.status === 'online' ? 'status-running' : h.status === 'offline' ? 'status-error' : 'status-idle'}`} />
                      <span className="text-sm">{h.status}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {h.services.map(s => <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>)}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(h.lastSeen).toLocaleString()}</TableCell>
                </TableRow>
              ))}
              {(!hosts || hosts.length === 0) && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No hosts registered</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Wifi className="h-4 w-4" />Service Registry</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Host</TableHead>
                <TableHead>Port</TableHead>
                <TableHead>Protocol</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(services || []).map(s => (
                <TableRow key={`${s.name}-${s.host}`}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="font-mono text-xs">{s.host}</TableCell>
                  <TableCell className="font-mono text-xs">{s.port}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{s.protocol}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={s.status === 'healthy' ? 'default' : s.status === 'degraded' ? 'secondary' : 'destructive'} className="text-[10px]">
                      {s.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {(!services || services.length === 0) && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No services registered</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
