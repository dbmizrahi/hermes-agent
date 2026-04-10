// Agent types
export type AgentState = 'idle' | 'running' | 'paused' | 'completed' | 'error' | 'terminated';

export interface Agent {
  id: string;
  name: string;
  role: string;
  state: AgentState;
  parent_id?: string;
  created_at: string;
  updated_at: string;
  sessions: number;
  cpu_percent?: number;
  memory_mb?: number;
  tokens_used?: number;
  max_iterations?: number;
  current_task?: string;
  toolsets?: string[];
}

export interface SpawnRequest {
  name?: string;
  role: string;
  goal: string;
  context?: string;
  toolsets?: string[];
  max_iterations?: number;
}

// Terminal types
export interface TerminalSession {
  session_id: string;
  pid?: number;
  status: 'running' | 'completed' | 'killed';
  command?: string;
  workdir?: string;
  created_at: string;
}

export interface TerminalMessage {
  type: 'input' | 'output' | 'exit';
  data?: string;
  code?: number;
}

// File types
export interface FileEntry {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  type: 'file' | 'directory' | 'symlink';
  isBinary?: boolean;
  children?: FileEntry[];
}

export interface FileContent {
  content: string;
  totalLines: number;
  truncated: boolean;
  hint?: string;
}

export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  content: string;
  match: string;
}

// Memory types
export interface MemoryEntry {
  id: string;
  target: 'user' | 'memory';
  content: string;
  createdAt: string;
  updatedAt: string;
  accessCount: number;
  lastAccessed: string;
}

export interface MemoryStore {
  entries: MemoryEntry[];
  totalChars: number;
  maxChars: number;
  usagePercent: number;
}

// Skill types
export interface Skill {
  name: string;
  description: string;
  version: string;
  author: string;
  category: string;
  content?: string;
  files?: string[];
  createdAt: string;
  updatedAt: string;
}

// Session types
export interface SessionSummary {
  id: string;
  title: string;
  date: string;
  preview: string;
  llmSummary?: string;
  participants: ('user' | 'assistant' | 'tool')[];
  toolCallCount: number;
  duration: string;
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  timestamp: string;
  tool_name?: string;
}

// Chat types
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  clarification?: ClarificationRequest;
}

export interface ClarificationRequest {
  question: string;
  choices?: string[];
  answered?: boolean;
  answer?: string;
}

// Cron types
export interface CronJob {
  id: string;
  name?: string;
  prompt?: string;
  schedule?: string;
  skill?: string;
  skills?: string[];
  deliver?: string;
  model?: string;
  repeat?: number;
  status: 'active' | 'paused' | 'completed' | 'failed';
  lastRun?: string;
  nextRun?: string;
  history: CronExecution[];
}

export interface CronExecution {
  timestamp: string;
  status: string;
  output: string;
}

// Log types
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  session_id?: string;
  source?: string;
  details?: Record<string, unknown>;
}

// Gateway types
export interface GatewayStatus {
  service: string;
  version: string;
  uptime_seconds: number;
  services: Record<string, { status: string; latency_ms: number }>;
}

export interface GatewayMetrics {
  requests_per_sec: number;
  tokens_per_sec: number;
  avg_latency_ms: number;
  error_rate: number;
  active_sessions: number;
  queued_messages: number;
}

// Channel types
export interface Channel {
  id: string;
  platform: string;
  name: string;
  status: 'connected' | 'disconnected' | 'error';
  lastHeartbeat?: string;
  config: Record<string, unknown>;
}

// Model types
export interface ModelProvider {
  id: string;
  name: string;
  type: string;
  status: string;
  models: Model[];
}

export interface Model {
  id: string;
  name: string;
  provider: string;
  context_window: number;
  max_tokens: number;
  pricing?: { input: number; output: number };
  capabilities?: string[];
  isDefault?: boolean;
}

export interface ModelCost {
  model: string;
  total_tokens: number;
  total_cost: number;
  sessions: number;
}

// MCP types
export interface MCPServer {
  id: string;
  name: string;
  transport: 'stdio' | 'sse' | 'http';
  status: 'connected' | 'disconnected' | 'error';
  tools: MCPTool[];
  error?: string;
}

export interface MCPTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

// ACP types
export interface ACPTopology {
  agents: { id: string; name: string; role: string; state: AgentState }[];
  connections: { from: string; to: string; type: string }[];
}

export interface ACPQueue {
  pending: number;
  in_transit: number;
  dead_letter: number;
}

// Env types
export interface EnvVar {
  key: string;
  value: string; // masked
  scope: 'global' | 'agent' | 'team' | 'project';
  category: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

// Network types
export interface NetworkHost {
  id: string;
  hostname: string;
  ip: string;
  status: 'online' | 'offline' | 'unknown';
  services: string[];
  lastSeen: string;
}

export interface NetworkService {
  name: string;
  host: string;
  port: number;
  protocol: string;
  status: 'healthy' | 'degraded' | 'down';
}

// Health
export interface HealthData {
  service: string;
  version: string;
  uptime_seconds: number;
  services: Record<string, { status: string; latency_ms: number }>;
}

// Virtual Office types
export interface WorkspaceAgent {
  id: string;
  name: string;
  status: AgentState | string;
  workspace: string;
  role?: string;
}

export interface Workspace {
  id: string;
  name: string;
  agents: string[];
  createdAt: string;
}

// Task Board types
export interface TaskColumn {
  id: string;
  name: string;
  order: number;
}

export interface TaskBoard {
  id: string;
  name: string;
  description?: string;
  owner?: string;
  columns: TaskColumn[];
  createdAt: string;
}

export type TaskPriority = "low" | "medium" | "high" | "urgent";

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: TaskPriority;
  assignee?: string;
  assigneeName?: string;
  board: string;
  createdAt: string;
  dueDate?: string;
  columnOrder?: number;
}

export interface WikiPage {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

// Team Management types
export interface TeamMetrics {
  agentCount: number;
  activeAgents: number;
  successRate: number;
}

export interface Team {
  id: string;
  name: string;
  description?: string;
  agentIds: string[];
  metrics?: TeamMetrics;
  createdAt: string;
}
