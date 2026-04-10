import { useEffect, useRef, useState } from "react";
import { WebSocketManager } from "@/lib/websocket";
import { apiPost, apiGet } from "@/config/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";

function TerminalTab({ sessionId, isActive }: { sessionId: string; isActive: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocketManager | null>(null);
  const termRef = useRef<any>(null);
  const fitRef = useRef<any>(null);
  const initializedRef = useRef(false);

  // Init xterm + WebSocket once when sessionId is assigned, then keep alive forever
  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;

    let term: any;
    let fitAddon: any;

    const init = async () => {
      const { Terminal } = await import('xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      const { WebLinksAddon } = await import('@xterm/addon-web-links');
      await import('xterm/css/xterm.css');

      term = new Terminal({
        theme: {
          background: '#0B0F1A',
          foreground: '#cbd5e1',
          cursor: '#6366f1',
          selectionBackground: '#6366f140',
          black: '#0B0F1A', red: '#ef4444', green: '#22c55e',
          yellow: '#eab308', blue: '#6366f1', magenta: '#8b5cf6',
          cyan: '#06b6d4', white: '#e2e8f0',
        },
        fontSize: 13,
        fontFamily: "'JetBrains Mono', monospace",
        cursorBlink: true,
        cursorStyle: 'bar',
        scrollback: 5000,
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());
      fitRef.current = fitAddon;

      term.open(containerRef.current!);
      termRef.current = term;

      const ws = new WebSocketManager(`/ws/terminal/${sessionId}`);
      wsRef.current = ws;
      ws.connect();

      ws.subscribe((data: any) => {
        if (data.type === 'output') {
          term.write(data.data);
        } else if (data.type === 'exit') {
          term.write(`\r\n\x1b[90m[Process exited with code ${data.code}]\x1b[0m\r\n`);
        }
      });

      term.onData((data: string) => {
        ws.send({ type: 'input', data });
      });
    };

    init();

    // Cleanup only when sessionId changes (i.e., tab is being removed from React tree)
    return () => {
      wsRef.current?.disconnect();
      termRef.current?.dispose();
    };
  }, [sessionId]);

  // Re-fit when tab becomes visible
  useEffect(() => {
    if (isActive && fitRef.current) {
      setTimeout(() => fitRef.current?.fit(), 50);
    }
  }, [isActive]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ minHeight: 400, display: isActive ? 'block' : 'none' }}
    />
  );
}

async function createTerminalSession(): Promise<string> {
  const result = await apiPost<{ session_id: string; status: string }>(
    '/api/hermes/terminal/session',
    {}
  );
  return result.session_id;
}

export default function TerminalPage() {
  const [sessions, setSessions] = useState<{ id: string; label: string }[]>([]);
  const [activeSession, setActiveSession] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const counterRef = useRef(0);

  useEffect(() => {
    const init = async () => {
      try {
        const sessionId = await createTerminalSession();
        setSessions([{ id: sessionId, label: 'Terminal 1' }]);
        setActiveSession(sessionId);
      } catch (e) {
        console.error('Failed to create initial terminal session:', e);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const addSession = async () => {
    try {
      const sessionId = await createTerminalSession();
      counterRef.current += 1;
      const newSession = { id: sessionId, label: `Terminal ${counterRef.current + 1}` };
      setSessions(s => [...s, newSession]);
      setActiveSession(sessionId);
    } catch (e) {
      console.error('Failed to create terminal session:', e);
    }
  };

  const removeSession = (id: string) => {
    setSessions(s => {
      const remaining = s.filter(x => x.id !== id);
      if (activeSession === id) {
        const next = remaining[0]?.id || '';
        setActiveSession(next);
      }
      return remaining;
    });
  };

  if (loading) {
    return (
      <div className="space-y-4 h-[calc(100vh-8rem)] flex items-center justify-center">
        <div className="text-muted-foreground">Starting terminal...</div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="space-y-4 h-[calc(100vh-8rem)] flex items-center justify-center">
        <Button onClick={addSession}><Plus className="h-3.5 w-3.5 mr-1" />Open Terminal</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 h-[calc(100vh-8rem)]">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Terminal</h1>
        <Button size="sm" variant="outline" onClick={addSession}><Plus className="h-3.5 w-3.5 mr-1" />New Tab</Button>
      </div>

      <div className="flex items-center gap-1 border-b border-border pb-0">
        {sessions.map(s => (
          <button key={s.id} onClick={() => setActiveSession(s.id)}
            className={`px-3 py-1.5 text-xs font-mono rounded-t-md transition-colors flex items-center gap-1.5 ${activeSession === s.id ? 'bg-card border border-b-0 border-border text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            {s.label}
            {sessions.length > 1 && (
              <X className="h-3 w-3 hover:text-destructive" onClick={e => { e.stopPropagation(); removeSession(s.id); }} />
            )}
          </button>
        ))}
      </div>

      <Card className="glass-card flex-1 overflow-hidden" style={{ height: 'calc(100% - 5rem)' }}>
        <CardContent className="p-0 h-full">
          {sessions.map(s => (
            <TerminalTab key={s.id} sessionId={s.id} isActive={activeSession === s.id} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
