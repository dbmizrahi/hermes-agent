import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/config/api";
import type { FileEntry, FileContent, SearchMatch } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FolderOpen, File, ChevronRight, ChevronDown, Search, Save } from "lucide-react";
import { toast } from "sonner";

interface TreeNode extends FileEntry {
  children?: TreeNode[];
}

/** Convert flat FileEntry[] from API into a nested tree. */
function buildTree(flat: FileEntry[]): TreeNode[] {
  const nodes: Record<string, TreeNode> = {};
  const roots: TreeNode[] = [];

  // First pass: create all nodes
  for (const e of flat) {
    nodes[e.path] = { ...e, children: [] };
  }

  // Second pass: attach each node to its parent
  for (const e of flat) {
    const parts = e.path.split("/");
    if (parts.length === 1) {
      // Root-level entry
      roots.push(nodes[e.path]);
    } else {
      // Immediate parent directory
      const parentPath = parts.slice(0, -1).join("/");
      const parent = nodes[parentPath];
      parent?.children?.push(nodes[e.path]);
    }
  }

  return roots;
}

function FileTreeNode({ entry, depth = 0, onSelect }: { entry: TreeNode; depth?: number; onSelect: (path: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const isDir = entry.type === "directory";

  return (
    <div>
      <button
        onClick={() => { if (isDir) setExpanded(!expanded); else onSelect(entry.path); }}
        className="flex items-center gap-1 py-1 px-2 w-full text-left text-sm hover:bg-muted/50 rounded transition-colors"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {isDir
          ? expanded
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          : <span className="w-3.5" />}
        {isDir
          ? <FolderOpen className="h-3.5 w-3.5 text-primary/70" />
          : <File className="h-3.5 w-3.5 text-muted-foreground" />}
        <span className="truncate">{entry.name}</span>
      </button>
      {expanded && entry.children?.map(child => (
        <FileTreeNode key={child.path} entry={child} depth={depth + 1} onSelect={onSelect} />
      ))}
    </div>
  );
}

export default function FilesPage() {
  const [selectedPath, setSelectedPath] = useState("");
  const [editContent, setEditContent] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchGlob, setSearchGlob] = useState("");

  const { data: tree } = useQuery({
    queryKey: ["file-tree"],
    queryFn: () => apiGet<FileEntry[]>("/api/files/tree"),
  });

  const { data: fileContent, isLoading: loadingFile } = useQuery({
    queryKey: ["file-content", selectedPath],
    queryFn: () => apiGet<FileContent>("/api/files/read", { path: selectedPath }),
    enabled: !!selectedPath,
  });

  const { data: searchResults, refetch: doSearch } = useQuery({
    queryKey: ["file-search", searchQuery, searchGlob],
    queryFn: () => apiPost<{ matches: SearchMatch[] }>("/api/files/search", { pattern: searchQuery, file_glob: searchGlob }),
    enabled: false,
  });

  const saveMutation = useMutation({
    mutationFn: () => apiPost("/api/files/write", { path: selectedPath, content: editContent }),
    onSuccess: () => toast.success("File saved"),
    onError: (e: Error) => toast.error(e.message),
  });

  const treeData = useMemo(() => tree ? buildTree(tree) : [], [tree]);

  return (
    <div className="space-y-4 h-[calc(100vh-8rem)]">
      <h1 className="text-2xl font-bold tracking-tight">Files</h1>

      <div className="grid grid-cols-12 gap-4 h-[calc(100%-3rem)]">
        {/* File Tree */}
        <Card className="glass-card col-span-3 overflow-hidden">
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Explorer</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[calc(100vh-14rem)]">
              {treeData.length > 0
                ? treeData.map(entry => (
                    <FileTreeNode
                      key={entry.path}
                      entry={entry}
                      onSelect={path => { setSelectedPath(path); setEditContent(""); }}
                    />
                  ))
                : <p className="text-xs text-muted-foreground p-3">Connecting...</p>}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Editor / Search */}
        <div className="col-span-9">
          <Tabs defaultValue="editor" className="h-full">
            <TabsList>
              <TabsTrigger value="editor">Editor</TabsTrigger>
              <TabsTrigger value="search">Search</TabsTrigger>
            </TabsList>

            <TabsContent value="editor" className="h-[calc(100%-2.5rem)]">
              <Card className="glass-card h-full">
                <CardContent className="p-4 h-full flex flex-col">
                  {selectedPath ? (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-mono text-muted-foreground">{selectedPath}</span>
                        <Button size="sm" onClick={() => saveMutation.mutate()} disabled={!editContent}>
                          <Save className="h-3.5 w-3.5 mr-1" />Save
                        </Button>
                      </div>
                      <Textarea
                        className="flex-1 font-mono text-sm resize-none"
                        value={editContent || fileContent?.content || ""}
                        onChange={e => setEditContent(e.target.value)}
                        placeholder={loadingFile ? "Loading..." : "File content"}
                      />
                      {fileContent?.truncated && <p className="text-xs text-warning mt-1">File truncated — {fileContent.totalLines} total lines</p>}
                    </>
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Select a file from the explorer</div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="search" className="h-[calc(100%-2.5rem)]">
              <Card className="glass-card h-full">
                <CardContent className="p-4 h-full flex flex-col">
                  <div className="flex gap-2 mb-3">
                    <Input placeholder="Search pattern (regex)" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="font-mono" />
                    <Input placeholder="*.ts" value={searchGlob} onChange={e => setSearchGlob(e.target.value)} className="w-32 font-mono" />
                    <Button onClick={() => doSearch()} disabled={!searchQuery}><Search className="h-4 w-4" /></Button>
                  </div>
                  <ScrollArea className="flex-1">
                    {searchResults?.matches?.map((m, i) => (
                      <button key={i} onClick={() => setSelectedPath(m.path)}
                        className="block w-full text-left p-2 hover:bg-muted/30 rounded text-sm border-b border-border/30">
                        <span className="font-mono text-primary text-xs">{m.path}:{m.line}</span>
                        <p className="text-muted-foreground text-xs mt-0.5 truncate">{m.content}</p>
                      </button>
                    )) || <p className="text-sm text-muted-foreground text-center py-8">Run a search to find files</p>}
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
