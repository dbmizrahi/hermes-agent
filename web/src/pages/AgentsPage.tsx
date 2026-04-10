import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/api/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Copy, Check } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

interface MappedAgent {
  id: string;
  name: string;
  role: string;
  last_seen: number | undefined;
  status: "Active" | "Idle";
  message_count?: number;
}

export default function AgentsPage() {
  const [filter, setFilter] = useState('');
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const navigate = useNavigate();

  // Fix: Changed from /api/hermes/agents (404) to /api/sessions
  const { data, isLoading, error } = useQuery({
    queryKey: ['agents', stateFilter],
    queryFn: () => apiGet<{ sessions: any[]; total: number }>('/api/sessions', { limit: 50, offset: 0 }),
    refetchInterval: 5000,
  });

  if (error) {
    toast.error(`Failed to load sessions: ${error.message}`);
  }

  // Map session fields to agent UI structure
  const agents: MappedAgent[] = (data?.sessions || []).map((s: any) => ({
    id: s.id,
    // Try to get Name from title, else fallback to Source or ID
    name: s.title || (s.source ? `${s.source.replace('_', ' ')}` : `Session ${s.id.slice(0, 8)}`),
    // Role maps to Model
    role: s.model || '—',
    last_seen: s.started_at,
    status: s.ended_at ? 'Idle' : 'Active',
    message_count: s.message_count,
  })).filter(a => 
    (stateFilter === 'all' || a.status.toLowerCase() === stateFilter) &&
    (!filter || a.name.toLowerCase().includes(filter.toLowerCase()) || a.role.toLowerCase().includes(filter.toLowerCase()))
  );

  const formatTime = (ts?: number) => {
    if (!ts) return '—';
    return new Date(ts * 1000).toLocaleString();
  };

  const copyToClipboard = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
          <p className="text-sm text-muted-foreground mt-1">Active sessions tracked as agents</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search agents..." value={filter} onChange={e => setFilter(e.target.value)} className="pl-9" />
        </div>
        <Select value={stateFilter} onValueChange={setStateFilter}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All States</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="idle">Idle</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="glass-card">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Id</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Messages</TableHead>
                <TableHead>Last Seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading agents...</TableCell></TableRow>
              ) : agents.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No active sessions found</TableCell></TableRow>
              ) : agents.map(agent => (
                <TableRow key={agent.id} className="cursor-pointer hover:bg-muted/30" onClick={() => navigate(`/sessions/${agent.id}`)}>
                  <TableCell className="font-medium">
                    {agent.name}
                  </TableCell>
                  <TableCell className="flex items-center gap-2">
                    <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{agent.id}</code>
                    <button 
                      onClick={(e) => { e.stopPropagation(); copyToClipboard(agent.id); }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {copiedId === agent.id ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                    </button>
                  </TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{agent.role}</Badge></TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      agent.status === 'Active' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
                    }`}>
                      {agent.status}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{agent.message_count || '0'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatTime(agent.last_seen)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
