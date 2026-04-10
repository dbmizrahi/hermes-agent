import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listSessions, getSession, searchSessions, type HermesSession } from "@/api/sessions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, MessageSquare, Clock, RefreshCw } from "lucide-react";

export default function SessionsPage() {
  const [query, setQuery] = useState('');
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  const { data: sessionsData, isLoading, refetch: refetchSessions } = useQuery({
    queryKey: ['sessions-list'],
    queryFn: () => listSessions({ limit: 50, offset: 0 }),
  });

  const { data: searchResults, isFetching: isSearching } = useQuery({
    queryKey: ['sessions-search', query],
    queryFn: () => searchSessions(query, { limit: 20 }),
    enabled: !!query,
  });

  const { data: sessionDetail } = useQuery({
    queryKey: ['session-detail', selectedSession],
    queryFn: () => getSession(selectedSession!),
    enabled: !!selectedSession,
  });

  const sessions = query && searchResults ? (searchResults.results || []) : (sessionsData?.items || []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sessions</h1>
          <p className="text-sm text-muted-foreground mt-1">View and search conversation history</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetchSessions()}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search sessions..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        {query && isSearching && (
          <Badge variant="outline">Searching...</Badge>
        )}
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-5 space-y-2">
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-8">Loading sessions...</p>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {query ? 'No sessions match your search' : 'No sessions found'}
            </p>
          ) : (
            sessions.map((s: HermesSession) => (
              <Card
                key={s.id}
                className={`glass-card cursor-pointer hover:border-primary/30 transition-colors ${selectedSession === s.id ? 'border-primary/50' : ''}`}
                onClick={() => setSelectedSession(s.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-1">
                    <h3 className="text-sm font-medium truncate flex-1">{s.title || s.id.slice(0, 16)}</h3>
                    <Badge variant="outline" className="text-[10px] shrink-0 ml-2">{s.source}</Badge>
                  </div>
                  {s.model && (
                    <p className="text-[10px] text-muted-foreground mb-1">Model: {s.model}</p>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    {s.started_at && (
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(s.started_at * 1000).toLocaleString()}
                      </span>
                    )}
                    {s.message_count != null && s.message_count > 0 && (
                      <Badge variant="outline" className="text-[10px]">{s.message_count} messages</Badge>
                    )}
                    {s.tool_call_count != null && s.tool_call_count > 0 && (
                      <Badge variant="outline" className="text-[10px]">{s.tool_call_count} tools</Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <div className="col-span-7">
          <Card className="glass-card h-[calc(100vh-14rem)]">
            <CardContent className="p-4 h-full">
              {selectedSession && sessionDetail ? (
                <ScrollArea className="h-full">
                  <div className="space-y-3">
                    {(sessionDetail.messages || []).map((m: { role: string; content: string }, i: number) => (
                      <div key={i} className="flex gap-2">
                        <Badge variant="outline" className="text-[10px] shrink-0 mt-0.5 w-16 justify-center">{m.role}</Badge>
                        <p className="text-sm whitespace-pre-wrap flex-1">{m.content}</p>
                      </div>
                    ))}
                    {sessionDetail.messages?.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-8">No messages in this session</p>
                    )}
                  </div>
                </ScrollArea>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  <MessageSquare className="h-5 w-5 mr-2" />Select a session to view
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
