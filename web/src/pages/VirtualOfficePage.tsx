import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiGet } from "@/config/api";
import { WebSocketManager } from "@/lib/websocket";
import type { AgentState } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Users, Building2, Search, TreePine, LayoutGrid, ArrowLeft, ArrowRight, RefreshCw
} from "lucide-react";
import { toast } from "sonner";

// ---------- Types ----------

interface WorkspaceAgent {
  id: string;
  name: string;
  status: AgentState | string;
  workspace: string;
  role?: string;
}

interface Workspace {
  id: string;
  name: string;
  agents: string[];
  createdAt: string;
}

// ---------- Colour map ----------

const stateColors: Record<string, string> = {
  idle: 'bg-gray-400',
  running: 'bg-green-500',
  paused: 'bg-yellow-500',
  completed: 'bg-blue-500',
  error: 'bg-red-500',
  terminated: 'bg-gray-600',
};

const variantColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  idle: 'outline',
  running: 'default',
  paused: 'secondary',
  completed: 'outline',
  error: 'destructive',
  terminated: 'outline',
};

// ---------- Org Tree Node ----------

function OrgNode({ label, children, expanded, onToggle }: {
  label: string;
  children?: React.ReactNode;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const hasChildren = !!children;
  return (
    <div className="ml-4 border-l border-border pl-3">
      <div className="flex items-center gap-1.5 py-1 cursor-pointer hover:text-primary" onClick={hasChildren ? onToggle : undefined}>
        {hasChildren ? (
          <span className="text-muted-foreground text-xs">{expanded ? "▼" : "▶"}</span>
        ) : <span className="w-3" />}
        <span className="text-sm font-medium">{label}</span>
      </div>
      {expanded && children}
    </div>
  );
}

// ---------- Agent Card ----------

function AgentCard({ agent, onClick }: { agent: WorkspaceAgent; onClick: () => void }) {
  const dot = stateColors[agent.status] || 'bg-gray-400';
  const variant = variantColors[agent.status] || 'outline';
  return (
    <Card
      className="glass-card cursor-pointer hover:ring-1 hover:ring-primary/40 transition-all duration-150"
      onClick={onClick}
    >
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium truncate flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${dot} animate-pulse`} />
          {agent.name || agent.id.slice(0, 8)}
        </CardTitle>
        <Badge variant={variant}>{agent.status}</Badge>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{agent.role || "No role assigned"}</p>
        <p className="text-[10px] text-muted-foreground/60 mt-1">ID: {agent.id.slice(0, 12)}</p>
      </CardContent>
    </Card>
  );
}

// ---------- Main Page ----------

export default function VirtualOfficePage() {
  const navigate = useNavigate();
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>("");
  const [search, setSearch] = useState("");
  const [agents, setAgents] = useState<WorkspaceAgent[]>([]);
  const [viewMode, setViewMode] = useState<"grid" | "tree">("grid");
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});

  // Fetch workspaces
  const { data: workspacesData } = useQuery({
    queryKey: ['virtual-office', 'workspaces'],
    queryFn: () => apiGet<{ items: Workspace[]; total: number }>('/api/virtual-office/workspaces'),
    refetchInterval: 10000,
  });

  const workspaces = workspacesData?.items || [];

  // Auto-select first workspace
  useEffect(() => {
    if (!selectedWorkspace && workspaces.length > 0) {
      setSelectedWorkspace(workspaces[0].id);
    }
  }, [workspaces, selectedWorkspace]);

  // Fetch agents in workspace
  const { data: agentsData, refetch } = useQuery({
    queryKey: ['virtual-office', 'agents', selectedWorkspace],
    queryFn: () => apiGet<{ agents: WorkspaceAgent[] }>(`/api/virtual-office/${selectedWorkspace}/agents`),
    enabled: !!selectedWorkspace,
    refetchInterval: 5000,
  });

  // Merge server agents with live WebSocket updates
  useEffect(() => {
    if (agentsData?.agents) {
      setAgents(prev => {
        const updated = [...agentsData.agents];
        // merge previous for agents not returned (preserves WebSocket-enriched state)
        prev.forEach(a => {
          if (!updated.find(u => u.id === a.id)) updated.push(a);
        });
        return updated;
      });
    }
  }, [agentsData]);

  // WebSocket for real-time updates
  useEffect(() => {
    if (!selectedWorkspace) return;

    const ws = new WebSocketManager(`/ws/virtual-office/${selectedWorkspace}`);
    ws.connect();

    const unsub = ws.subscribe((data: unknown) => {
      const msg = data as { type: string; agent?: WorkspaceAgent; agents?: WorkspaceAgent[] };
      if (msg.type === "state_change" && msg.agent) {
        setAgents(prev => prev.map(a => a.id === msg.agent!.id ? { ...a, ...msg.agent } : a));
      } else if (msg.type === "state_snapshot" && msg.agents) {
        setAgents(msg.agents);
      } else if (msg.type === "agent_join" && msg.agent) {
        setAgents(prev => [...prev, msg.agent as WorkspaceAgent]);
      } else if (msg.type === "agent_leave" && msg.agent) {
        setAgents(prev => prev.filter(a => a.id !== msg.agent!.id));
      }
    });

    return () => {
      unsub();
      ws.disconnect();
    };
  }, [selectedWorkspace]);

  const filteredAgents = agents.filter(a =>
    !search || a.name?.toLowerCase().includes(search.toLowerCase()) ||
    a.role?.toLowerCase().includes(search.toLowerCase()) ||
    a.id.toLowerCase().includes(search.toLowerCase())
  );

  // Group agents by status for tree view
  const groupedByStatus: Record<string, WorkspaceAgent[]> = {};
  filteredAgents.forEach(a => {
    const key = a.status;
    if (!groupedByStatus[key]) groupedByStatus[key] = [];
    groupedByStatus[key].push(a);
  });

  const handleToggleNode = (key: string) => {
    setExpandedNodes(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const workspaceName = workspaces.find(w => w.id === selectedWorkspace)?.name || selectedWorkspace;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Virtual Office</h1>
          <p className="text-sm text-muted-foreground mt-1">Live workspace view and agent organisational tree</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
        </div>
      </div>

      {/* Controls bar */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Workspace selector */}
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <Select value={selectedWorkspace} onValueChange={setSelectedWorkspace}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Select workspace" /></SelectTrigger>
            <SelectContent>
              {workspaces.map(w => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search agents..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* View toggle */}
        <div className="flex items-center gap-1 ml-auto">
          <Button variant={viewMode === "grid" ? "default" : "outline"} size="sm" onClick={() => setViewMode("grid")}>
            <LayoutGrid className="h-3.5 w-3.5 mr-1" /> Grid
          </Button>
          <Button variant={viewMode === "tree" ? "default" : "outline"} size="sm" onClick={() => setViewMode("tree")}>
            <TreePine className="h-3.5 w-3.5 mr-1" /> Tree
          </Button>
        </div>
      </div>

      {workspaces.length === 0 && (
        <Card className="glass-card">
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Users className="h-10 w-10 mb-3 opacity-40" />
            <p className="text-lg font-medium">No Workspaces</p>
            <p className="text-sm">Create a workspace from the backend to get started.</p>
          </CardContent>
        </Card>
      )}

      {workspaces.length > 0 && selectedWorkspace && (
        <>
          {viewMode === "grid" && (
            <>
              {/* Agent count summary */}
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span><span className="font-semibold text-foreground">{agents.length}</span> agents total</span>
                <span><span className="font-semibold text-green-500">{agents.filter(a => a.status === "running").length}</span> running</span>
                <span><span className="font-semibold text-yellow-500">{agents.filter(a => a.status === "idle").length}</span> idle</span>
                <span><span className="font-semibold text-red-500">{agents.filter(a => a.status === "error").length}</span> error</span>
              </div>

              {/* Agent Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {filteredAgents.length === 0 ? (
                  <Card className="glass-card col-span-full">
                    <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <Users className="h-8 w-8 mb-2 opacity-40" />
                      <p>No agents in this workspace matching your search.</p>
                    </CardContent>
                  </Card>
                ) : (
                  filteredAgents.map(agent => (
                    <AgentCard key={agent.id} agent={agent} onClick={() => navigate(`/agents/${agent.id}`)} />
                  ))
                )}
              </div>
            </>
          )}

          {viewMode === "tree" && (
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <TreePine className="h-4 w-4" /> Org Tree — {workspaceName}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {Object.keys(groupedByStatus).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No agents to display.</p>
                ) : (
                  <div className="space-y-0.5">
                    <OrgNode label={workspaceName} expanded={true}>
                      {Object.entries(groupedByStatus).map(([status, statusAgents]) => (
                        <OrgNode
                          key={status}
                          label={`${status} (${statusAgents.length})`}
                          expanded={expandedNodes[status]}
                          onToggle={() => handleToggleNode(status)}
                        >
                          {expandedNodes[status] && statusAgents.map(agent => (
                            <div key={agent.id} className="ml-6 flex items-center gap-2 py-1 cursor-pointer hover:text-primary" onClick={() => navigate(`/agents/${agent.id}`)}>
                              <span className={`h-1.5 w-1.5 rounded-full ${stateColors[agent.status] || 'bg-gray-400'}`} />
                              <span className="text-xs">{agent.name || agent.id.slice(0, 8)}</span>
                              {agent.role && <span className="text-[10px] text-muted-foreground">— {agent.role}</span>}
                            </div>
                          ))}
                        </OrgNode>
                      ))}
                    </OrgNode>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
