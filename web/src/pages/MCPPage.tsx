import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiDelete } from "@/api/client";
import type { MCPServer } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Play, Square, Trash2, Plug, Wrench } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

export default function MCPPage() {
  const [showAdd, setShowAdd] = useState(false);
  const [selectedServer, setSelectedServer] = useState<MCPServer | null>(null);
  const [form, setForm] = useState({ name: '', transport: 'stdio' });
  const queryClient = useQueryClient();

  const { data: servers } = useQuery({
    queryKey: ['mcp-servers'],
    queryFn: async () => {
      const res = await apiGet<{ servers: Array<Record<string, unknown>> }>('/api/mcp');
      return (res.servers || []).map((s: Record<string, unknown>) => ({
        id: s.name as string,
        name: s.name as string,
        transport: (s.type as string) || 'stdio',
        status: s.connected ? 'connected' : 'disconnected',
        tools: [],
      })) as MCPServer[];
    },
    refetchInterval: 10000,
  });

  const addMutation = useMutation({
    mutationFn: () => apiPost('/api/mcp', form),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['mcp-servers'] }); setShowAdd(false); toast.success("Server added"); },
  });

  const reloadMutation = useMutation({
    mutationFn: (name: string) => apiPost(`/api/mcp/${name}/reload`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mcp-servers'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => apiDelete(`/api/mcp/${name}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['mcp-servers'] }); toast.success("Server removed"); },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">MCP Servers</h1>
          <p className="text-sm text-muted-foreground mt-1">Model Context Protocol management</p>
        </div>
        <Button onClick={() => setShowAdd(true)} className="gradient-primary"><Plus className="h-4 w-4 mr-1" />Add Server</Button>
      </div>

      <Card className="glass-card">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Server</TableHead>
                <TableHead>Transport</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tools</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(servers || []).map(s => (
                <TableRow key={s.id} className="cursor-pointer" onClick={() => setSelectedServer(s)}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{s.transport}</Badge></TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span className={`status-dot ${s.status === 'connected' ? 'status-running' : 'status-error'}`} />
                      <span className="text-sm">{s.status}</span>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{s.tools.length}</TableCell>
                  <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={() => reloadMutation.mutate(s.name)} title="Reload server"><Play className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="text-destructive" onClick={() => deleteMutation.mutate(s.name)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {(!servers || servers.length === 0) && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No MCP servers configured</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selectedServer && (
        <Card className="glass-card">
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Wrench className="h-4 w-4" />Tools — {selectedServer.name}</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {selectedServer.tools.map(t => (
                <div key={t.name} className="glass-panel p-3">
                  <h4 className="text-sm font-medium font-mono">{t.name}</h4>
                  <p className="text-xs text-muted-foreground mt-1">{t.description}</p>
                </div>
              ))}
              {selectedServer.tools.length === 0 && <p className="text-sm text-muted-foreground col-span-2 text-center py-4">No tools discovered</p>}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add MCP Server</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Input placeholder="Server name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <Input placeholder="Transport (stdio, sse, http)" value={form.transport} onChange={e => setForm(f => ({ ...f, transport: e.target.value }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={() => addMutation.mutate()} disabled={!form.name}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
