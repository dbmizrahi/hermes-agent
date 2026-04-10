import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getMemory, addMemory, replaceMemory, removeMemory } from "@/api/memory";
import type { MemoryEntry, MemoryStore } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Pencil, Trash2, Save } from "lucide-react";
import { toast } from "sonner";

/** Transform the backend GET /api/memory response into the UI's MemoryStore shape. */
function toMemoryStore(raw: { entries: string[]; char_count: number; char_limit: number; usage_pct: number }): MemoryStore {
  return {
    entries: raw.entries.map((text, i) => ({
      id: String(i),
      target: "memory",
      content: text,
      createdAt: "",
      updatedAt: "",
      accessCount: 0,
      lastAccessed: "",
    })),
    totalChars: raw.char_count,
    maxChars: raw.char_limit,
    usagePercent: raw.usage_pct,
  };
}

export default function MemoryPage() {
  const [target, setTarget] = useState<'user' | 'memory'>('user');
  const [showAdd, setShowAdd] = useState(false);
  const [editEntry, setEditEntry] = useState<MemoryEntry | null>(null);
  const [newContent, setNewContent] = useState('');
  const queryClient = useQueryClient();

  // Fetch both memory and user stores; select the active tab's data
  const { data: store } = useQuery({
    queryKey: ['memory', target],
    queryFn: async () => {
      const resp = await getMemory();
      return toMemoryStore(resp[target]);
    },
  });

  const addMutation = useMutation({
    mutationFn: (content: string) => addMemory(target, content),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['memory'] }); setShowAdd(false); setNewContent(''); toast.success("Entry added"); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ old_text, content }: { old_text: string; content: string }) => replaceMemory(target, old_text, content),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['memory'] }); setEditEntry(null); toast.success("Entry updated"); },
  });

  const deleteMutation = useMutation({
    mutationFn: (old_text: string) => removeMemory(target, old_text),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['memory'] }); toast.success("Entry removed"); },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Memory</h1>
          <p className="text-sm text-muted-foreground mt-1">Persistent cross-session memory</p>
        </div>
        <Button onClick={() => setShowAdd(true)}><Plus className="h-4 w-4 mr-1" />Add Entry</Button>
      </div>

      <Tabs value={target} onValueChange={v => setTarget(v as 'user' | 'memory')}>
        <TabsList>
          <TabsTrigger value="user">User</TabsTrigger>
          <TabsTrigger value="memory">Memory</TabsTrigger>
        </TabsList>
      </Tabs>

      {store && (
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Usage</span>
              <span className="text-xs font-mono text-muted-foreground">
                {store.usagePercent}% — {store.totalChars.toLocaleString()} / {store.maxChars.toLocaleString()} chars ({store.entries.length} entries)
              </span>
            </div>
            <Progress value={store.usagePercent} className="h-2" />
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {store?.entries.map(entry => (
          <Card key={entry.id} className="glass-card">
            <CardContent className="p-4">
              {editEntry?.id === entry.id ? (
                <div className="space-y-2">
                  <Textarea value={editEntry.content} onChange={e => setEditEntry({ ...editEntry, content: e.target.value })} rows={4} />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => updateMutation.mutate({ old_text: entry.content, content: editEntry.content })}><Save className="h-3.5 w-3.5 mr-1" />Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditEntry(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm whitespace-pre-wrap">{entry.content}</p>
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-[10px] text-muted-foreground">{entry.updatedAt ? new Date(entry.updatedAt).toLocaleDateString() : '—'}</span>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditEntry(entry)}><Pencil className="h-3 w-3" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteMutation.mutate(entry.content)}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ))}
        {store?.entries.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No entries yet</p>}
      </div>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Memory Entry</DialogTitle></DialogHeader>
          <Textarea value={newContent} onChange={e => setNewContent(e.target.value)} placeholder="Enter memory content..." rows={4} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={() => addMutation.mutate(newContent)} disabled={!newContent}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
