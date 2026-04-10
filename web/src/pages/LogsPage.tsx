import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/config/api";
import { WebSocketManager } from "@/lib/websocket";
import type { LogEntry, LogLevel } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Download, Search, Pause, Play } from "lucide-react";

const levelColors: Record<LogLevel, string> = {
  trace: 'text-muted-foreground', debug: 'text-muted-foreground',
  info: 'text-primary', warn: 'text-warning', error: 'text-destructive',
};

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [levelFilter, setLevelFilter] = useState<LogLevel | 'all'>('all');
  const [search, setSearch] = useState('');
  const [paused, setPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ws = new WebSocketManager('/ws/logs');
    ws.connect();
    ws.subscribe((data: any) => {
      if (!paused) {
        setLogs(l => [...l.slice(-500), data as LogEntry]);
      }
    });
    return () => ws.disconnect();
  }, [paused]);

  useEffect(() => {
    if (!paused) scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, paused]);

  const filtered = logs.filter(l =>
    (levelFilter === 'all' || l.level === levelFilter) &&
    (!search || l.message.toLowerCase().includes(search.toLowerCase()))
  );

  const exportLogs = () => {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'logs.json'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Logs</h1>
        <div className="flex items-center gap-2">
          <Button size="sm" variant={paused ? "default" : "outline"} onClick={() => setPaused(!paused)}>
            {paused ? <Play className="h-3.5 w-3.5 mr-1" /> : <Pause className="h-3.5 w-3.5 mr-1" />}
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button size="sm" variant="outline" onClick={exportLogs}><Download className="h-3.5 w-3.5 mr-1" />Export</Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {(['all', 'trace', 'debug', 'info', 'warn', 'error'] as const).map(level => (
          <Button key={level} size="sm" variant={levelFilter === level ? 'default' : 'outline'}
            onClick={() => setLevelFilter(level)} className="text-xs capitalize">
            {level}
          </Button>
        ))}
        <div className="relative flex-1 max-w-sm ml-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Filter logs..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
      </div>

      <Card className="glass-card flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-2 font-mono text-xs space-y-px">
            {filtered.map((log, i) => (
              <div key={log.id || i} className="flex gap-2 py-0.5 px-2 hover:bg-muted/20 rounded">
                <span className="text-muted-foreground shrink-0 w-20">{new Date(log.timestamp).toLocaleTimeString()}</span>
                <span className={`uppercase font-bold w-12 shrink-0 ${levelColors[log.level]}`}>{log.level}</span>
                {log.session_id && <Badge variant="outline" className="text-[9px] h-4 shrink-0">{log.session_id.slice(0, 8)}</Badge>}
                <span className="text-foreground/90 break-all">{log.message}</span>
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="text-muted-foreground text-center py-12">
                {logs.length === 0 ? 'Waiting for logs...' : 'No matching logs'}
              </p>
            )}
            <div ref={scrollRef} />
          </div>
        </ScrollArea>
      </Card>
    </div>
  );
}
