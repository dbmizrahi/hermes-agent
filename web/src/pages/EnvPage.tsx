import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiDelete } from "@/config/api";
import type { EnvVar } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, RefreshCw, Eye, EyeOff, Shield } from "lucide-react";
import { toast } from "sonner";

export default function EnvPage() {
  const [showAdd, setShowAdd] = useState(false);
  const [showValues, setShowValues] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({ key: '', value: '', scope: 'global', category: '' });
  const queryClient = useQueryClient();

  const { data: vars } = useQuery({
    queryKey: ['env-vars'],
    queryFn: () => apiGet<EnvVar[]>('/api/env'),
  });

  const addMutation = useMutation({
    mutationFn: () => apiPost('/api/env', form),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['env-vars'] }); setShowAdd(false); toast.success("Variable added"); },
  });

  const deleteMutation = useMutation({
    mutationFn: (key: string) => apiDelete(`/api/env/${key}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['env-vars'] }); toast.success("Variable deleted"); },
  });

  const rotateMutation = useMutation({
    mutationFn: (key: string) => apiPost(`/api/env/${key}/rotate`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['env-vars'] }); toast.success("Secret rotated"); },
  });

  const toggleShow = (key: string) => {
    setShowValues(s => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Shield className="h-6 w-6" />Environment & Secrets</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage environment variables and credentials</p>
        </div>
        <Button onClick={() => setShowAdd(true)} className="gradient-primary"><Plus className="h-4 w-4 mr-1" />Add Variable</Button>
      </div>

      <Card className="glass-card">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(vars || []).map(v => (
                <TableRow key={v.key}>
                  <TableCell className="font-mono text-xs font-medium">{v.key}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {showValues.has(v.key) ? v.value : '••••••••••••'}
                  </TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{v.scope}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{v.category || '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(v.updatedAt).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={() => toggleShow(v.key)}>
                        {showValues.has(v.key) ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => rotateMutation.mutate(v.key)}><RefreshCw className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="text-destructive" onClick={() => deleteMutation.mutate(v.key)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {(!vars || vars.length === 0) && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No environment variables</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Environment Variable</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Input placeholder="KEY_NAME" value={form.key} onChange={e => setForm(f => ({ ...f, key: e.target.value }))} className="font-mono" />
            <Input placeholder="Value" type="password" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} />
            <Input placeholder="Scope (global, agent, team, project)" value={form.scope} onChange={e => setForm(f => ({ ...f, scope: e.target.value }))} />
            <Input placeholder="Category (optional)" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={() => addMutation.mutate()} disabled={!form.key || !form.value}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
