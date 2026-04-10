import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/config/api";
import type { Agent } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Play, Pause, Square, RotateCcw, Send } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";

const stateColors: Record<string, string> = {
  idle: 'status-idle', running: 'status-running', paused: 'status-paused',
  completed: 'status-completed', error: 'status-error', terminated: 'status-completed',
};

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [pollingSession, setPollingSession] = useState<string | null>(null);

  const { data: agent } = useQuery({
    queryKey: ['agent', id],
    queryFn: () => apiGet<Agent>(`/api/hermes/agent/${id}`),
    refetchInterval: 3000,
    enabled: !!id,
  });

  // Poll for response in background
  useEffect(() => {
    if (!pollingSession || !id) return;
    const pollId = setInterval(async () => {
      try {
        const resp = await fetch(`/api/hermes/agent/${id}/response/${pollingSession}`);
        const data = await resp.json();
        if (data.status === 'ok' && data.data) {
          const payload = typeof data.data === 'string' ? { response: data.data, status: 'completed' } : data.data;
          if (payload.status === 'completed') {
            setMessages(m => [...m, { role: 'assistant', content: payload.response }]);
          } else if (payload.status === 'error') {
            setMessages(m => [...m, { role: 'assistant', content: `Error: ${payload.error}` }]);
          }
          setPollingSession(null);
        }
      } catch {}
    }, 1000);
    return () => clearInterval(pollId);
  }, [pollingSession, id]);

  const actionMutation = useMutation({
    mutationFn: (action: string) => apiPost(`/api/hermes/agent/${id}/${action}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent', id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const sendMutation = useMutation({
    mutationFn: async (msg: string) => {
      const resp = await apiPost<{ sessionId: string }>(`/api/hermes/agent/${id}/send-message`, { message: msg });
      return resp;
    },
    onSuccess: (data) => {
      setMessage('');
      setPollingSession(data.sessionId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSend = () => {
    if (!message.trim() || sendMutation.isPending || pollingSession) return;
    const userMsg = message.trim();
    setMessages(m => [...m, { role: 'user', content: userMsg }]);
    sendMutation.mutate(userMsg);
  };

  if (!agent) return <div className="text-muted-foreground text-center py-12">Loading agent...</div>;

  const conversation = messages.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/agents')}><ArrowLeft className="h-4 w-4" /></Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <span className={`status-dot ${stateColors[agent.state]}`} />
            {agent.name || agent.id.slice(0, 12)}
          </h1>
          <p className="text-sm text-muted-foreground">{agent.role} · {agent.id}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {agent.state === 'paused' && <Button size="sm" onClick={() => actionMutation.mutate('resume')}><Play className="h-3.5 w-3.5 mr-1" />Resume</Button>}
        {(agent.state === 'running' || agent.state === 'idle') && <Button size="sm" variant="outline" onClick={() => actionMutation.mutate('pause')}><Pause className="h-3.5 w-3.5 mr-1" />Pause</Button>}
        <Button size="sm" variant="outline" onClick={() => actionMutation.mutate('restart')}><RotateCcw className="h-3.5 w-3.5 mr-1" />Restart</Button>
        <Button size="sm" variant="destructive" onClick={() => actionMutation.mutate('terminate')}><Square className="h-3.5 w-3.5 mr-1" />Terminate</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="glass-card">
          <CardHeader className="pb-2"><CardTitle className="text-sm">State</CardTitle></CardHeader>
          <CardContent><Badge className="text-xs">{agent.state}</Badge></CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Tokens Used</CardTitle></CardHeader>
          <CardContent><span className="text-lg font-mono font-bold">{agent.tokens_used?.toLocaleString() || '0'}</span></CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Sessions</CardTitle></CardHeader>
          <CardContent><span className="text-lg font-bold">{agent.sessions}</span></CardContent>
        </Card>
      </div>

      {/* Conversation / Send Message */}
      <Card className="glass-card flex flex-col">
        <CardHeader className="pb-2"><CardTitle className="text-sm">{conversation ? 'Conversation' : 'Send Message'}</CardTitle></CardHeader>
        <CardContent className={conversation ? 'pb-0 flex flex-col space-y-3' : 'space-y-3'}>
          {/* Message list at top */}
          {conversation && (
            <div className="flex flex-col space-y-2 max-h-[400px] overflow-y-auto pr-2">
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-primary/20 text-foreground'
                      : 'bg-muted/50 text-muted-foreground'
                  }`}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {pollingSession && (
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-lg px-3 py-2 bg-muted/50">
                    <span className="text-xs text-muted-foreground italic">Thinking...</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Input at bottom */}
          <div className="flex gap-2 pt-3 border-t">
            <Input value={message} onChange={e => setMessage(e.target.value)} placeholder="Send a message to this agent..."
              onKeyDown={e => { if (e.key === 'Enter') handleSend(); }} />
            <Button onClick={handleSend} disabled={!message.trim() || sendMutation.isPending || pollingSession !== null}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
