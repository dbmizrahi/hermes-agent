import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/config/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  Plus, ChevronLeft, ChevronRight, Calendar, FileText, ListFilter,
  Search, BookOpen, GitBranch, Clock, CheckCircle2, Circle, AlertCircle
} from "lucide-react";
import { toast } from "sonner";

// ---------- Types ----------

interface Task {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: "low" | "medium" | "high" | "urgent";
  assignee?: string;
  assigneeName?: string;
  board: string;
  createdAt: string;
  dueDate?: string;
  columnOrder?: number;
}

interface TaskColumn {
  id: string;
  name: string;
  order: number;
}

interface TaskBoard {
  id: string;
  name: string;
  description?: string;
  owner?: string;
  columns: TaskColumn[];
  createdAt: string;
}

interface WikiPage {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

// ---------- Helpers ----------

const priorityColors: Record<string, string> = {
  low: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  urgent: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

const priorityIcons: Record<string, React.ReactNode> = {
  low: <Circle className="h-3 w-3" />,
  medium: <AlertCircle className="h-3 w-3" />,
  high: <ChevronRight className="h-3 w-3" />,
  urgent: <AlertCircle className="h-3 w-3 text-red-500" />,
};

function getWeekKey(date: string): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const oneJan = new Date(year, 0, 1);
  const weekNum = Math.ceil(((d.getTime() - oneJan.getTime()) / 86400000 + oneJan.getDay() + 1) / 7);
  return `Week ${weekNum} ${year}`;
}

function formatWeekRange(weekKey: string): string {
  return weekKey;
}

// ---------- Simple Markdown Renderer ----------

function SimpleMarkdown({ content }: { content: string }) {
  const lines = content.split("\n");
  const rendered: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];

  lines.forEach((line, i) => {
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        rendered.push(
          <pre key={i} className="bg-muted p-3 rounded-md text-xs font-mono overflow-x-auto my-2">
            <code>{codeLines.join("\n")}</code>
          </pre>
        );
        codeLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      return;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      return;
    }
    if (line.startsWith("# ")) {
      rendered.push(<h1 key={i} className="text-xl font-bold mt-4 mb-2">{line.slice(2)}</h1>);
    } else if (line.startsWith("## ")) {
      rendered.push(<h2 key={i} className="text-lg font-semibold mt-3 mb-1">{line.slice(3)}</h2>);
    } else if (line.startsWith("### ")) {
      rendered.push(<h3 key={i} className="text-base font-semibold mt-2 mb-1">{line.slice(4)}</h3>);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      rendered.push(
        <li key={i} className="ml-4 list-disc text-sm">{line.slice(2)}</li>
      );
    } else if (line.trim() === "") {
      rendered.push(<div key={i} className="h-2" />);
    } else if (line.startsWith("> ")) {
      rendered.push(<blockquote key={i} className="border-l-2 border-primary/50 pl-3 text-sm text-muted-foreground italic">{line.slice(2)}</blockquote>);
    } else {
      rendered.push(<p key={i} className="text-sm leading-relaxed">{line}</p>);
    }
  });

  return <div className="text-sm space-y-1">{rendered}</div>;
}

// ---------- Main Page ----------

export default function TaskBoardPage() {
  const queryClient = useQueryClient();
  const [selectedBoardId, setSelectedBoardId] = useState<string>("");
  const [searchFilter, setSearchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [showCreateBoard, setShowCreateBoard] = useState(false);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showCreateWiki, setShowCreateWiki] = useState(false);
  const [newBoardName, setNewBoardName] = useState("");
  const [newBoardDesc, setNewBoardDesc] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDesc, setNewTaskDesc] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState<Task["priority"]>("medium");
  const [newTaskAssignee, setNewTaskAssignee] = useState("");
  const [newTaskDueDate, setNewTaskDueDate] = useState("");
  const [newWikiTitle, setNewWikiTitle] = useState("");
  const [newWikiContent, setNewWikiContent] = useState("");

  // Fetch boards
  const { data: boardsData } = useQuery({
    queryKey: ['task-boards'],
    queryFn: () => apiGet<TaskBoard[]>('/api/tasks/boards'),
  });

  const boards = boardsData || [];

  useEffect(() => {
    if (!selectedBoardId && boards.length > 0) {
      setSelectedBoardId(boards[0].id);
    }
  }, [boards, selectedBoardId]);

  const currentBoard = boards.find(b => b.id === selectedBoardId);

  // Fetch tasks
  const { data: tasksData, refetch: refetchTasks } = useQuery({
    queryKey: ['tasks', selectedBoardId],
    queryFn: () => apiGet<Task[]>(`/api/tasks/boards/${selectedBoardId}/tasks`),
    enabled: !!selectedBoardId,
    refetchInterval: 5000,
  });

  const allTasks = tasksData || [];

  // Create board mutation
  const createBoardMutation = useMutation({
    mutationFn: () => apiPost<TaskBoard>('/api/tasks/boards', { name: newBoardName, description: newBoardDesc }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-boards'] });
      setShowCreateBoard(false);
      setNewBoardName("");
      setNewBoardDesc("");
      toast.success("Board created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Create task mutation
  const createTaskMutation = useMutation({
    mutationFn: () => apiPost<Task>(`/api/tasks/boards/${selectedBoardId}/tasks`, {
      title: newTaskTitle,
      description: newTaskDesc,
      priority: newTaskPriority,
      assignee: newTaskAssignee,
      dueDate: newTaskDueDate,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', selectedBoardId] });
      setShowCreateTask(false);
      setNewTaskTitle("");
      setNewTaskDesc("");
      setNewTaskPriority("medium");
      setNewTaskAssignee("");
      setNewTaskDueDate("");
      toast.success("Task created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Move task mutation
  const moveTaskMutation = useMutation({
    mutationFn: ({ taskId, direction }: { taskId: string; direction: "left" | "right" }) =>
      apiPost<Task>(`/api/tasks/boards/${selectedBoardId}/tasks/${taskId}/move`, { direction }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', selectedBoardId] });
      toast.success("Task moved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Filtered tasks
  const filteredTasks = allTasks.filter(t => {
    if (searchFilter && !t.title.toLowerCase().includes(searchFilter.toLowerCase())) return false;
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
    if (assigneeFilter !== "all" && t.assigneeName !== assigneeFilter) return false;
    return true;
  });

  // Extract unique assignees
  const assignees = [...new Set(allTasks.map(t => t.assigneeName).filter(Boolean))];

  // Get tasks for a column
  const getTasksForColumn = (columnId: string) =>
    filteredTasks.filter(t => t.status === columnId);

  // Move task left/right
  const handleMoveTask = (task: Task, direction: "left" | "right") => {
    moveTaskMutation.mutate({ taskId: task.id, direction });
  };

  // Group tasks by week for roadmap
  const tasksByWeek: Record<string, Task[]> = {};
  allTasks.forEach(t => {
    const dateKey = t.dueDate || t.createdAt;
    const week = getWeekKey(dateKey);
    if (!tasksByWeek[week]) tasksByWeek[week] = [];
    tasksByWeek[week].push(t);
  });

  // Placeholder wiki data
  const wikiPages: WikiPage[] = [
    { id: "1", title: "Getting Started", content: "# Getting Started\n\nWelcome to the task board wiki. Here you can find helpful documentation.\n\n## Quick Links\n- Board overview\n- Task management guide", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Task Board</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage tasks across boards with backlog, kanban, and roadmap views</p>
        </div>
      </div>

      {/* Board Selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
          <Select value={selectedBoardId} onValueChange={setSelectedBoardId}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Select a board" /></SelectTrigger>
            <SelectContent>
              {boards.map(b => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
              {boards.length === 0 && <SelectItem value="_empty">No boards available</SelectItem>}
              <div className="border-t p-1">
                <Button variant="ghost" size="sm" className="w-full justify-start text-xs" onClick={() => setShowCreateBoard(true)}>
                  <Plus className="h-3 w-3 mr-1" /> Create Board
                </Button>
              </div>
            </SelectContent>
          </Select>
        </div>
        {currentBoard && (
          <span className="text-xs text-muted-foreground">{currentBoard.description}</span>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="backlog" className="w-full">
        <TabsList>
          <TabsTrigger value="backlog" className="gap-1"><ListFilter className="h-3.5 w-3.5" /> Backlog</TabsTrigger>
          <TabsTrigger value="kanban" className="gap-1"><GitBranch className="h-3.5 w-3.5" /> Kanban</TabsTrigger>
          <TabsTrigger value="roadmap" className="gap-1"><Calendar className="h-3.5 w-3.5" /> Roadmap</TabsTrigger>
          <TabsTrigger value="wiki" className="gap-1"><BookOpen className="h-3.5 w-3.5" /> Wiki</TabsTrigger>
        </TabsList>

        {/* ==================== BACKLOG TAB ==================== */}
        <TabsContent value="backlog" className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search tasks..." value={searchFilter} onChange={e => setSearchFilter(e.target.value)} className="pl-9" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {currentBoard?.columns.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Priority" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
            <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Assignee" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Assignees</SelectItem>
                {assignees.map(a => (
                  <SelectItem key={a as string} value={a as string}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="ml-auto">
              <Button size="sm" onClick={() => setShowCreateTask(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> New Task
              </Button>
            </div>
          </div>

          <Card className="glass-card">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Priority</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Assignee</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Due Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTasks.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No tasks found</TableCell></TableRow>
                  ) : (
                    filteredTasks
                      .sort((a, b) => {
                        const prioOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
                        return (prioOrder[a.priority] || 2) - (prioOrder[b.priority] || 2);
                      })
                      .map(task => (
                        <TableRow key={task.id}>
                          <TableCell>
                            <Badge className={`${priorityColors[task.priority]} border-0 gap-1`}>
                              {priorityIcons[task.priority]} {task.priority}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-medium max-w-[300px] truncate">{task.title}</TableCell>
                          <TableCell>
                            {task.assigneeName ? (
                              <Badge variant="outline">{task.assigneeName}</Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">Unassigned</span>
                            )}
                          </TableCell>
                          <TableCell><Badge variant="outline">{task.status}</Badge></TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "—"}
                          </TableCell>
                        </TableRow>
                      ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== KANBAN TAB ==================== */}
        <TabsContent value="kanban" className="space-y-4">
          <div className="flex items-center gap-2 justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Search className="h-4 w-4" />
              <Input placeholder="Filter tasks..." value={searchFilter} onChange={e => setSearchFilter(e.target.value)} className="w-52" />
            </div>
            <Button size="sm" onClick={() => setShowCreateTask(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> New Task
            </Button>
          </div>

          {!currentBoard?.columns || currentBoard.columns.length === 0 ? (
            <Card className="glass-card"><CardContent className="py-12 text-center text-muted-foreground"><GitBranch className="h-8 w-8 mx-auto mb-2 opacity-40" /><p>No columns defined for this board</p></CardContent></Card>
          ) : (
            <div className="flex gap-4 overflow-x-auto pb-4">
              {currentBoard.columns.sort((a, b) => a.order - b.order).map((col, colIdx) => {
                const colTasks = getTasksForColumn(col.id);
                return (
                  <div key={col.id} className="min-w-[280px] max-w-[300px] flex-shrink-0">
                    <div className="flex items-center justify-between mb-3 px-1">
                      <h3 className="font-semibold text-sm">{col.name}</h3>
                      <Badge variant="outline" className="text-xs">{colTasks.length}</Badge>
                    </div>
                    <div className="space-y-2">
                      {colTasks.length === 0 && (
                        <div className="text-center py-8 text-xs text-muted-foreground/50 border-2 border-dashed rounded-lg">No tasks</div>
                      )}
                      {colTasks.map(task => (
                        <Card key={task.id} className="glass-card hover:ring-1 hover:ring-primary/30 transition-all">
                          <CardContent className="p-3 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-sm font-medium line-clamp-2 flex-1">{task.title}</span>
                              <Badge className={`${priorityColors[task.priority]} border-0 text-[10px] gap-1 flex-shrink-0`}>
                                {priorityIcons[task.priority]} {task.priority}
                              </Badge>
                            </div>
                            {task.assigneeName && (
                              <Badge variant="secondary" className="text-[10px]">{task.assigneeName}</Badge>
                            )}
                            {/* Move buttons */}
                            <div className="flex items-center justify-between pt-1">
                              <Button
                                size="sm" variant="ghost" className="h-6 px-2 text-xs"
                                disabled={colIdx === 0 || moveTaskMutation.isPending}
                                onClick={() => handleMoveTask(task, "left")}
                              >
                                <ChevronLeft className="h-3 w-3 mr-0.5" /> Back
                              </Button>
                              <Button
                                size="sm" variant="ghost" className="h-6 px-2 text-xs"
                                disabled={colIdx === currentBoard.columns.length - 1 || moveTaskMutation.isPending}
                                onClick={() => handleMoveTask(task, "right")}
                              >
                                Next <ChevronRight className="h-3 w-3 ml-0.5" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ==================== ROADMAP TAB ==================== */}
        <TabsContent value="roadmap" className="space-y-4">
          <div className="space-y-6">
            {Object.keys(tasksByWeek).length === 0 ? (
              <Card className="glass-card"><CardContent className="py-12 text-center text-muted-foreground"><Calendar className="h-8 w-8 mx-auto mb-2 opacity-40" /><p>No tasks with dates to display</p></CardContent></Card>
            ) : (
              Object.entries(tasksByWeek)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([week, weekTasks]) => (
                  <div key={week}>
                    <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5" /> {formatWeekRange(week)}
                      <Badge variant="outline" className="text-xs">{weekTasks.length} tasks</Badge>
                    </h3>
                    <div className="space-y-1.5">
                      {weekTasks
                        .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""))
                        .map(task => (
                          <div key={task.id} className="flex items-center gap-3 bg-card border rounded-lg px-4 py-2.5 hover:bg-muted/30 transition-colors">
                            <Badge className={`${priorityColors[task.priority]} border-0 text-[10px] gap-1`}>
                              {priorityIcons[task.priority]}
                            </Badge>
                            <span className="text-sm font-medium flex-1 truncate">{task.title}</span>
                            {task.assigneeName && <Badge variant="outline" className="text-[10px]">{task.assigneeName}</Badge>}
                            <Badge variant="outline" className="text-[10px]">{task.status}</Badge>
                            {task.dueDate && (
                              <span className="text-xs text-muted-foreground">{new Date(task.dueDate).toLocaleDateString()}</span>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                ))
            )}
          </div>
        </TabsContent>

        {/* ==================== WIKI TAB ==================== */}
        <TabsContent value="wiki" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Documentation</h3>
            <Button size="sm" onClick={() => setShowCreateWiki(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> New Page
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {wikiPages.map(page => (
              <Card key={page.id} className="glass-card hover:ring-1 hover:ring-primary/30 transition-all cursor-pointer">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" /> {page.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-xs text-muted-foreground line-clamp-3 mb-3">
                    {page.content.slice(0, 150)}...
                  </div>
                  <div className="border-t pt-2">
                    <SimpleMarkdown content={page.content.slice(0, 300)} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* ==================== CREATE BOARD DIALOG ==================== */}
      <Dialog open={showCreateBoard} onOpenChange={setShowCreateBoard}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Board</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Name</label>
              <Input value={newBoardName} onChange={e => setNewBoardName(e.target.value)} placeholder="e.g. Sprint 1" />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <Textarea value={newBoardDesc} onChange={e => setNewBoardDesc(e.target.value)} placeholder="Board description..." rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateBoard(false)}>Cancel</Button>
            <Button onClick={() => createBoardMutation.mutate()} disabled={!newBoardName} className="gradient-primary">Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== CREATE TASK DIALOG ==================== */}
      <Dialog open={showCreateTask} onOpenChange={setShowCreateTask}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Task</DialogTitle><DialogDescription>Add a new task to the current board</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Title</label>
              <Input value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)} placeholder="Task title" />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <Textarea value={newTaskDesc} onChange={e => setNewTaskDesc(e.target.value)} placeholder="Task details..." rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Priority</label>
                <Select value={newTaskPriority} onValueChange={v => setNewTaskPriority(v as Task["priority"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Due Date</label>
                <Input type="date" value={newTaskDueDate} onChange={e => setNewTaskDueDate(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Assignee</label>
              <Input value={newTaskAssignee} onChange={e => setNewTaskAssignee(e.target.value)} placeholder="Assignee name" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateTask(false)}>Cancel</Button>
            <Button onClick={() => createTaskMutation.mutate()} disabled={!newTaskTitle} className="gradient-primary">Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== CREATE WIKI DIALOG ==================== */}
      <Dialog open={showCreateWiki} onOpenChange={setShowCreateWiki}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Create Wiki Page</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Title</label>
              <Input value={newWikiTitle} onChange={e => setNewWikiTitle(e.target.value)} placeholder="Page title" />
            </div>
            <div>
              <label className="text-sm font-medium">Content (Markdown)</label>
              <Textarea value={newWikiContent} onChange={e => setNewWikiContent(e.target.value)} placeholder="Write in markdown..." rows={8} className="font-mono text-xs" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateWiki(false)}>Cancel</Button>
            <Button onClick={() => { setShowCreateWiki(false); setNewWikiTitle(""); setNewWikiContent(""); toast.success("Wiki page created"); }} disabled={!newWikiTitle} className="gradient-primary">Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
