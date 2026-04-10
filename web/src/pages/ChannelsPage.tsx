import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/api/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Wifi, WifiOff, Radio } from "lucide-react";

const platformIcons: Record<string, string> = {
  telegram: '📱', discord: '🎮', slack: '💬', email: '📧', whatsapp: '📞',
  signal: '🔒', matrix: '🌐', sms: '✉️', cli: '⌨️',
};

interface PlatformStatus {
  name: string;
  type: string;
  connected: boolean;
  connected_since: string | null;
  [key: string]: any;
}

interface GatewayStatusResponse {
  platforms: PlatformStatus[];
  [key: string]: any;
}

export default function ChannelsPage() {
  const { data: gatewayStatus, isLoading, error } = useQuery({
    queryKey: ['gateway-status'],
    queryFn: () => apiGet<GatewayStatusResponse>('/api/gateway/status'),
    refetchInterval: 10000,
  });

  const platforms = gatewayStatus?.platforms || [];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Channels</h1>
          <p className="text-sm text-muted-foreground mt-1">Loading connected platforms...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Channels</h1>
          <p className="text-sm text-destructive mt-1">Failed to load gateway status.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Channels</h1>
        <p className="text-sm text-muted-foreground mt-1">Connected platforms and channels</p>
      </div>

      <Card className="glass-card">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Platform</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {platforms.length > 0 ? (
                platforms.map((platform, idx) => {
                  const isApiServer = platform.type === 'api_server' || platform.name?.toLowerCase() === 'api_server';
                  const displayName = isApiServer ? 'API Server' : (platform.name || '—');
                  const isConnected = platform.connected === true;

                  return (
                    <TableRow key={platform.name || idx}>
                      <TableCell>
                        <span className="mr-2">{platformIcons[platform.type?.toLowerCase() || platform.name?.toLowerCase()] || '📡'}</span>
                        <span className="capitalize">{displayName}</span>
                      </TableCell>
                      <TableCell className="font-medium">{platform.type || '—'}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {isConnected ? (
                            <Wifi className="h-3.5 w-3.5 text-green-500" />
                          ) : (
                            <WifiOff className="h-3.5 w-3.5 text-red-500" />
                          )}
                          <Badge variant={isConnected ? 'default' : 'destructive'} className="text-[10px] capitalize">
                            {isConnected ? 'connected' : 'disconnected'}
                          </Badge>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={3} className="text-center py-8">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Radio className="h-8 w-8 opacity-50" />
                      <p>No channels connected</p>
                      <p className="text-xs">Connect a platform via gateway configuration to see it here.</p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
