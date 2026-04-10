import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/config/api";
import type { Agent, SpawnRequest } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Play, Pause, Square, RotateCcw, Trash2, Search, Eye } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

const stateColors: Record<string, string> = {
  idle: 'status-idle', running: 'status-running', paused: 'status-paused',
  completed: 'status-completed', error: 'status-error', terminated: 'status-completed',
};

export default function AgentsPage() {
  const [showSpawn, setShowSpawn] = useState(false);
  const [filter, setFilter] = useState('');
  const [stateFilter, setStateFilter] = useState<string>('all');
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['agents', stateFilter],
    queryFn: () => apiGet<{ items: Agent[]; total: number }>('/api/hermes/agents', { page: 1, limit: 50 }),
    refetchInterval: 3000,
  });

  const agents = (data?.items || []).filter(a =>
    (stateFilter === 'all' || a.state === stateFilter) &&
    (!filter || a.name?.toLowerCase().includes(filter.toLowerCase()) || a.role.toLowerCase().includes(filter.toLowerCase()))
  );

  const spawnMutation = useMutation({
    mutationFn: (req: SpawnRequest) => apiPost<Agent>('/api/hermes/agent/spawn', req),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['agents'] }); setShowSpawn(false); toast.success("Agent spawned"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => apiPost(`/api/hermes/agent/${id}/${action}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const [form, setForm] = useState<SpawnRequest>({ role: 'developer', goal: '' });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage agent lifecycle and monitor pool</p>
        </div>
        <Button onClick={() => setShowSpawn(true)} className="gradient-primary">
          <Plus className="h-4 w-4 mr-1" /> Spawn Agent
        </Button>
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
            <SelectItem value="idle">Idle</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="glass-card">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Task</TableHead>
                <TableHead>Tokens</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading agents...</TableCell></TableRow>
              ) : agents.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No agents found</TableCell></TableRow>
              ) : agents.map(agent => (
                <TableRow key={agent.id} className="cursor-pointer hover:bg-muted/30" onClick={() => navigate(`/agents/${agent.id}`)}>
                  <TableCell><span className={`status-dot ${stateColors[agent.state]}`} /></TableCell>
                  <TableCell className="font-medium">{agent.name || agent.id.slice(0, 8)}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{agent.role}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]">{agent.current_task || '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{agent.tokens_used?.toLocaleString() || '0'}</TableCell>
                  <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      {agent.state === 'paused' && <Button size="icon" variant="ghost" onClick={() => actionMutation.mutate({ id: agent.id, action: 'resume' })}><Play className="h-3.5 w-3.5" /></Button>}
                      {(agent.state === 'running' || agent.state === 'idle') && <Button size="icon" variant="ghost" onClick={() => actionMutation.mutate({ id: agent.id, action: 'pause' })}><Pause className="h-3.5 w-3.5" /></Button>}
                      <Button size="icon" variant="ghost" onClick={() => actionMutation.mutate({ id: agent.id, action: 'restart' })}><RotateCcw className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="text-destructive" onClick={() => actionMutation.mutate({ id: agent.id, action: 'terminate' })}><Square className="h-3.5 w-3.5" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={showSpawn} onOpenChange={setShowSpawn}>
        <DialogContent>
          <DialogHeader><DialogTitle>Spawn Agent</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Name (optional)</label>
              <Input value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="my-agent" />
            </div>
            <div>
              <label className="text-sm font-medium">Role</label>
              <Select value={form.role} onValueChange={v => setForm(f => ({ ...f, role: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="developer">Developer</SelectItem>
                  <SelectItem value="researcher">Researcher</SelectItem>
                  <SelectItem value="writer">Writer</SelectItem>
                  <SelectItem value="reviewer">Reviewer</SelectItem>
                  <SelectItem value="devops">DevOps</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Goal</label>
              <Textarea value={form.goal} onChange={e => setForm(f => ({ ...f, goal: e.target.value }))} placeholder="Describe the task..." rows={3} />
            </div>
            <div>
              <label className="text-sm font-medium">Max Iterations</label>
              <Input type="number" value={form.max_iterations || ''} onChange={e => setForm(f => ({ ...f, max_iterations: parseInt(e.target.value) || undefined }))} placeholder="25" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSpawn(false)}>Cancel</Button>
            <Button onClick={() => spawnMutation.mutate(form)} disabled={!form.goal} className="gradient-primary">Spawn</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
