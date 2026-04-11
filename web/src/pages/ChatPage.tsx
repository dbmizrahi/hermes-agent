import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Send,
  Bot,
  User,
  Plus,
  MessageSquare,
  Loader2,
  Sparkles,
  Trash2,
  Copy,
  Check,
  StopCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getToken, buildUrl, clearTokens } from "@/api/client";
import { useNavigate } from "react-router-dom";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
}

interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Storage helpers (persist sessions in localStorage)
// ---------------------------------------------------------------------------

const STORAGE_KEY = "hermes-web-chats";

function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions: ChatSession[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // quota exceeded — silently ignore
  }
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---------------------------------------------------------------------------
// Chat Session Sidebar
// ---------------------------------------------------------------------------

function SessionSidebar({
  sessions,
  activeId,
  onSelect,
  onCreate,
  onDelete,
}: {
  sessions: ChatSession[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
}) {
  const sorted = [...sessions].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  return (
    <div className="w-64 border-r border-border flex flex-col h-full bg-card/50">
      <div className="p-3 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-1.5">
          <MessageSquare className="h-4 w-4 text-primary" /> Chats
        </h2>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={onCreate}
          title="New Chat"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        {sorted.length === 0 ? (
          <p className="text-xs text-muted-foreground p-3 text-center">
            No chats yet
          </p>
        ) : (
          <div className="p-1 space-y-0.5">
            {sorted.map((s) => (
              <button
                key={s.id}
                onClick={() => onSelect(s.id)}
                className={cn(
                  "w-full text-left px-2.5 py-2 rounded-md text-sm transition-colors flex items-start gap-2 group",
                  activeId === s.id
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                )}
              >
                <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary/60" />
                <span className="truncate flex-1">{s.title || "New Chat"}</span>
                <Trash2
                  className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity cursor-pointer mt-0.5"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(s.id);
                  }}
                />
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message Bubble
// ---------------------------------------------------------------------------

function MessageBubble({
  msg,
  isStreaming,
}: {
  msg: ChatMessage;
  isStreaming?: boolean;
}) {
  const isUser = msg.role === "user";
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [msg.content]);

  return (
    <div className={cn("flex gap-3", isUser && "justify-end")}>
      {!isUser && (
        <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-1">
          {isStreaming ? (
            <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
          ) : (
            <Bot className="h-3.5 w-3.5 text-primary" />
          )}
        </div>
      )}
      <div
        className={cn(
          "max-w-[75%] rounded-lg p-3 relative group",
          isUser
            ? "bg-primary/20 text-foreground"
            : "bg-muted/30 text-foreground"
        )}
      >
        <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[10px] text-muted-foreground">
            {new Date(msg.timestamp).toLocaleTimeString()}
          </span>
          {!isUser && (
            <button
              onClick={handleCopy}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted/50"
              title="Copy"
            >
              {copied ? (
                <Check className="h-3 w-3 text-green-500" />
              ) : (
                <Copy className="h-3 w-3 text-muted-foreground" />
              )}
            </button>
          )}
        </div>
      </div>
      {isUser && (
        <div className="h-7 w-7 rounded-full bg-secondary flex items-center justify-center shrink-0 mt-1">
          <User className="h-3.5 w-3.5" />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty State
// ---------------------------------------------------------------------------

function EmptyState({ onNewChat }: { onNewChat: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center text-muted-foreground">
      <div className="text-center space-y-4 max-w-sm">
        <div className="h-16 w-16 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
          <Sparkles className="h-8 w-8 text-primary" />
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-semibold text-foreground">
            Start a conversation
          </h3>
          <p className="text-sm">
            Ask Hermes Agent anything. It can help with code, analysis,
            creative tasks, and more.
          </p>
        </div>
        <Button onClick={onNewChat} size="sm">
          <Plus className="h-3.5 w-3.5 mr-1" />
          New Chat
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ChatPage() {
  const navigate = useNavigate();
  // Sessions stored in local state + persisted to localStorage
  const [sessions, setSessions] = useState<ChatSession[]>(loadSessions);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");

  // Redirect to login if no token
  useEffect(() => {
    if (!getToken()) {
      navigate("/login", { replace: true });
    }
  }, [navigate]);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  // Persist sessions whenever they change
  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  // Auto-scroll on new messages or streaming updates
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeSession?.messages.length, streamingContent, isStreaming]);

  // Focus textarea when switching sessions
  useEffect(() => {
    if (activeSessionId) {
      textareaRef.current?.focus();
    }
  }, [activeSessionId]);

  // ---- Session CRUD ----

  const createSession = useCallback(() => {
    const id = uid();
    const now = new Date().toISOString();
    const newSession: ChatSession = {
      id,
      title: "New Chat",
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    setSessions((prev) => [...prev, newSession]);
    setActiveSessionId(id);
  }, []);

  const deleteSession = useCallback((id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    setActiveSessionId((prev) => (prev === id ? "" : prev));
  }, []);

  const updateSessionMessages = useCallback(
    (sessionId: string, messages: ChatMessage[], title?: string) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                messages,
                title: title || s.title,
                updatedAt: new Date().toISOString(),
              }
            : s
        )
      );
    },
    []
  );

  // ---- Send message via /v1/chat/completions (SSE streaming) ----

  const abortStreaming = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);

    // Commit whatever we have streamed so far
    if (streamingContent.trim() && activeSessionId) {
      const finalMsg: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: streamingContent.trim(),
        timestamp: new Date().toISOString(),
      };
      updateSessionMessages(activeSessionId, [
        ...activeSession!.messages,
        finalMsg,
      ]);
      setStreamingContent("");
    }
  }, [
    streamingContent,
    activeSessionId,
    activeSession,
    updateSessionMessages,
  ]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || !activeSessionId || isStreaming) return;

    const session = sessions.find((s) => s.id === activeSessionId);
    if (!session) return;

    // Build user message
    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };

    // Auto-title from first message
    const title =
      session.messages.length === 0
        ? text.slice(0, 50) + (text.length > 50 ? "..." : "")
        : undefined;

    const updatedMessages = [...session.messages, userMsg];
    updateSessionMessages(activeSessionId, updatedMessages, title);
    setInput("");
    setIsStreaming(true);
    setStreamingContent("");

    // Build conversation history for the API
    const conversationHistory = updatedMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const token = getToken();
      const url = buildUrl("/v1/chat/completions");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          messages: conversationHistory,
          stream: true,
        }),
        signal: abortController.signal,
      });

      if (response.status === 401) {
        clearTokens();
        navigate("/login", { replace: true });
        return;
      }

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw new Error(
          `API error ${response.status}: ${errorBody || response.statusText}`
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        // Fallback: non-streaming JSON response
        const data = await response.json();
        const content =
          data.choices?.[0]?.message?.content ??
          data.content ??
          data.response ??
          "(empty response)";
        const assistantMsg: ChatMessage = {
          id: uid(),
          role: "assistant",
          content,
          timestamp: new Date().toISOString(),
        };
        updateSessionMessages(activeSessionId, [
          ...updatedMessages,
          assistantMsg,
        ]);
        setIsStreaming(false);
        return;
      }

      // Streaming SSE response
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;
          if (!trimmed.startsWith("data: ")) continue;

          try {
            const json = JSON.parse(trimmed.slice(6));
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) {
              accumulatedContent += delta;
              setStreamingContent(accumulatedContent);
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }

      // Commit final assistant message
      const assistantMsg: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: accumulatedContent || "(empty response)",
        timestamp: new Date().toISOString(),
      };
      updateSessionMessages(activeSessionId, [
        ...updatedMessages,
        assistantMsg,
      ]);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // User cancelled — handled by abortStreaming
        return;
      }
      const message =
        err instanceof Error ? err.message : "Failed to get response";
      toast.error(message);

      // Add error message to chat
      const errorMsg: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: `Error: ${message}`,
        timestamp: new Date().toISOString(),
      };
      updateSessionMessages(activeSessionId, [
        ...updatedMessages,
        errorMsg,
      ]);
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
      abortRef.current = null;
    }
  }, [input, activeSessionId, isStreaming, sessions, updateSessionMessages]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      <h1 className="text-2xl font-bold tracking-tight mb-4 shrink-0">Chat</h1>
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Sidebar */}
        <SessionSidebar
          sessions={sessions}
          activeId={activeSessionId}
          onSelect={setActiveSessionId}
          onCreate={createSession}
          onDelete={deleteSession}
        />

        {/* Main chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          {!activeSession ? (
            <EmptyState onNewChat={createSession} />
          ) : (
            <div className="glass-card flex flex-col overflow-hidden h-full rounded-lg border border-border">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono text-xs">
                    {activeSession.title}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px]">
                    {activeSession.messages.length} messages
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  Web Channel
                </span>
              </div>

              {/* Messages */}
              <ScrollArea className="flex-1">
                <div className="space-y-4 p-4">
                  {activeSession.messages.map((msg) => (
                    <MessageBubble key={msg.id} msg={msg} />
                  ))}

                  {/* Streaming bubble */}
                  {isStreaming && streamingContent && (
                    <MessageBubble
                      msg={{
                        id: "streaming",
                        role: "assistant",
                        content: streamingContent,
                        timestamp: new Date().toISOString(),
                      }}
                      isStreaming
                    />
                  )}

                  {/* Thinking indicator (no content yet) */}
                  {isStreaming && !streamingContent && (
                    <div className="flex gap-3">
                      <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                        <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
                      </div>
                      <div className="max-w-[70%] rounded-lg p-3 bg-muted/30 text-muted-foreground text-sm">
                        Thinking...
                      </div>
                    </div>
                  )}

                  <div ref={scrollRef} />
                </div>
              </ScrollArea>

              {/* Input area */}
              <div className="p-4 border-t border-border shrink-0">
                <div className="flex gap-2 items-end">
                  <div className="flex-1 relative">
                    <Textarea
                      ref={textareaRef}
                      value={input}
                      onChange={handleInputChange}
                      onKeyDown={handleKeyDown}
                      placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
                      rows={1}
                      className="resize-none pr-10 min-h-[40px] max-h-[160px]"
                      disabled={isStreaming}
                    />
                  </div>
                  {isStreaming ? (
                    <Button
                      onClick={abortStreaming}
                      variant="destructive"
                      size="icon"
                      className="shrink-0 h-10 w-10"
                      title="Stop generating"
                    >
                      <StopCircle className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button
                      onClick={sendMessage}
                      disabled={!input.trim()}
                      size="icon"
                      className="shrink-0 h-10 w-10"
                      title="Send"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
                  Hermes Agent may make mistakes. Verify important information.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
