import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiDelete } from "@/config/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  Users, Plus, Search, UserMinus, UserPlus, TrendingUp, Activity, CheckCircle
} from "lucide-react";
import { toast } from "sonner";

// ---------- Types ----------

interface TeamMetrics {
  agentCount: number;
  activeAgents: number;
  successRate: number;
}

interface Team {
  id: string;
  name: string;
  description?: string;
  agentIds: string[];
  metrics?: TeamMetrics;
  createdAt: string;
}

interface AgentBasic {
  id: string;
  name: string;
  state: string;
  role?: string;
}

// ---------- Main Page ----------

export default function TeamsPage() {
  const queryClient = useQueryClient();
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [showAssignAgent, setShowAssignAgent] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamDesc, setNewTeamDesc] = useState("");
  const [assignAgentId, setAssignAgentId] = useState("");
  const [search, setSearch] = useState("");

  // Fetch teams
  const { data: teamsData, isLoading: loadingTeams } = useQuery({
    queryKey: ['teams'],
    queryFn: () => apiGet<{ items: Team[]; total: number }>('/api/teams'),
    refetchInterval: 5000,
  });

  const teams = teamsData?.items || [];

  // Fetch available agents for assignment
  const { data: agentsData } = useQuery({
    queryKey: ['agents'],
    queryFn: () => apiGet<{ items: AgentBasic[]; total: number }>('/api/hermes/agents', { page: 1, limit: 100 }),
    refetchInterval: 10000,
  });

  const allAgents = agentsData?.items || [];

  // Fetch team metrics for selected team
  const { data: teamMetrics } = useQuery({
    queryKey: ['team', selectedTeamId, 'metrics'],
    queryFn: () => apiGet<TeamMetrics>(`/api/teams/${selectedTeamId}/metrics`),
    enabled: !!selectedTeamId,
    refetchInterval: 5000,
  });

  const selectedTeam = teams.find(t => t.id === selectedTeamId);

  // Filtered teams
  const filteredTeams = teams.filter(t =>
    !search || t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.description?.toLowerCase().includes(search.toLowerCase())
  );

  // Create team mutation
  const createTeamMutation = useMutation({
    mutationFn: () => apiPost<Team>('/api/teams', { name: newTeamName, description: newTeamDesc }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      setShowCreateTeam(false);
      setNewTeamName("");
      setNewTeamDesc("");
      toast.success("Team created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Assign agent mutation
  const assignAgentMutation = useMutation({
    mutationFn: () => apiPost(`/api/teams/${selectedTeamId}/assign`, { agent_id: assignAgentId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      queryClient.invalidateQueries({ queryKey: ['team', selectedTeamId, 'metrics'] });
      setShowAssignAgent(false);
      setAssignAgentId("");
      toast.success("Agent assigned to team");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Remove agent mutation
  const removeAgentMutation = useMutation({
    mutationFn: (agentId: string) => apiDelete(`/api/teams/${selectedTeamId}/assign/${agentId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      queryClient.invalidateQueries({ queryKey: ['team', selectedTeamId, 'metrics'] });
      toast.success("Agent removed from team");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Available agents (not already in team)
  const availableAgents = allAgents.filter(a =>
    !selectedTeam?.agentIds.includes(a.id)
  );

  // Metrics display
  const metrics = teamMetrics || selectedTeam?.metrics || { agentCount: 0, activeAgents: 0, successRate: 0 };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Teams</h1>
          <p className="text-sm text-muted-foreground mt-1">Organise agents into teams and track performance</p>
        </div>
        <Button onClick={() => setShowCreateTeam(true)} className="gradient-primary">
          <Plus className="h-4 w-4 mr-1" /> Create Team
        </Button>
      </div>

      {/* Team Detail View */}
      {selectedTeam && (
        <Card className="glass-card">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-4 w-4" /> {selectedTeam.name}
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setSelectedTeamId(null)}>
                Back to list
              </Button>
            </div>
            {selectedTeam.description && (
              <p className="text-sm text-muted-foreground mt-1">{selectedTeam.description}</p>
            )}
          </CardHeader>
          <CardContent>
            {/* Metrics Panel */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <Card className="bg-muted/30 border">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-2 rounded-full bg-blue-500/10">
                    <Users className="h-5 w-5 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{metrics.agentCount || selectedTeam.agentIds.length}</p>
                    <p className="text-xs text-muted-foreground">Total Agents</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-muted/30 border">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-2 rounded-full bg-green-500/10">
                    <Activity className="h-5 w-5 text-green-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{metrics.activeAgents}</p>
                    <p className="text-xs text-muted-foreground">Active Agents</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-muted/30 border">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-2 rounded-full bg-emerald-500/10">
                    <TrendingUp className="h-5 w-5 text-emerald-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{typeof metrics.successRate === 'number' ? `${metrics.successRate}%` : 'N/A'}</p>
                    <p className="text-xs text-muted-foreground">Success Rate</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Assigned Agents */}
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-sm">Assigned Agents</h3>
              <Button size="sm" variant="outline" onClick={() => setShowAssignAgent(true)} disabled={availableAgents.length === 0}>
                <UserPlus className="h-3.5 w-3.5 mr-1" /> Assign Agent
              </Button>
            </div>

            <Card className="bg-muted/20 border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedTeam.agentIds.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                        No agents assigned to this team
                      </TableCell>
                    </TableRow>
                  ) : (
                    selectedTeam.agentIds.map(agentId => {
                      const agent = allAgents.find(a => a.id === agentId);
                      return (
                        <TableRow key={agentId}>
                          <TableCell className="font-medium">
                            {agent?.name || agentId.slice(0, 8)}
                          </TableCell>
                          <TableCell>
                            {agent?.role ? (
                              <Badge variant="outline" className="text-[10px]">{agent.role}</Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{agent?.state || 'unknown'}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                              onClick={() => removeAgentMutation.mutate(agentId)}
                              title="Remove from team"
                            >
                              <UserMinus className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </Card>
          </CardContent>
        </Card>
      )}

      {/* Team List View (shown when no team selected or always for overview) */}
      {!selectedTeam && (
        <Card className="glass-card">
          <CardContent className="p-0">
            <div className="p-4 border-b flex items-center gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search teams..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Agents</TableHead>
                  <TableHead>Success Rate</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingTeams ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading teams...</TableCell></TableRow>
                ) : filteredTeams.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No teams found</TableCell></TableRow>
                ) : (
                  filteredTeams.map(team => (
                    <TableRow key={team.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setSelectedTeamId(team.id)}>
                      <TableCell className="font-medium">{team.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[250px] truncate">{team.description || '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{team.agentIds.length} agents</Badge>
                      </TableCell>
                      <TableCell>
                        {team.metrics?.successRate ? (
                          <span className="text-sm text-green-500 font-medium">{team.metrics.successRate}%</span>
                        ) : (
                          <span className="text-muted-foreground text-xs">N/A</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                        <Button
                          size="sm" variant="ghost"
                          onClick={() => setSelectedTeamId(team.id)}
                        >
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ==================== CREATE TEAM DIALOG ==================== */}
      <Dialog open={showCreateTeam} onOpenChange={setShowCreateTeam}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Team</DialogTitle><DialogDescription>Create a new team to organise your agents</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Name</label>
              <Input value={newTeamName} onChange={e => setNewTeamName(e.target.value)} placeholder="e.g. Development Team" />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <Textarea value={newTeamDesc} onChange={e => setNewTeamDesc(e.target.value)} placeholder="Describe the team's purpose..." rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateTeam(false)}>Cancel</Button>
            <Button onClick={() => createTeamMutation.mutate()} disabled={!newTeamName} className="gradient-primary">Create Team</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== ASSIGN AGENT DIALOG ==================== */}
      <Dialog open={showAssignAgent} onOpenChange={setShowAssignAgent}>
        <DialogContent>
          <DialogHeader><DialogTitle>Assign Agent</DialogTitle><DialogDescription>Add an agent to {selectedTeam?.name}</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Select Agent</label>
              <Select value={assignAgentId} onValueChange={setAssignAgentId}>
                <SelectTrigger><SelectValue placeholder="Choose an agent..." /></SelectTrigger>
                <SelectContent>
                  {availableAgents.length === 0 ? (
                    <SelectItem value="_none" disabled>No agents available</SelectItem>
                  ) : (
                    availableAgents.map(a => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name || a.id.slice(0, 8)} — {a.role || 'No role'}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssignAgent(false)}>Cancel</Button>
            <Button onClick={() => assignAgentMutation.mutate()} disabled={!assignAgentId || assignAgentId === '_none'} className="gradient-primary">Assign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
