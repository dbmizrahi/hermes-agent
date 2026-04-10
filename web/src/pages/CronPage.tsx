import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listJobs, createJob, deleteJob, pauseJob, resumeJob, runJob, type HermesJob } from "@/api/jobs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Play, Pause, Trash2 } from "lucide-react";
import { toast } from "sonner";

const statusColors: Record<string, string> = {
  active: 'bg-success', paused: 'bg-warning', completed: 'bg-muted-foreground/50', failed: 'bg-destructive',
};

/** Map HermesJob (enabled boolean) to a display status string */
function jobStatus(job: HermesJob): string {
  if (job.enabled === false) return 'paused';
  if (job.enabled === true) return 'active';
  return 'active';
}

export default function CronPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', prompt: '', schedule: '', deliver: 'origin', model: '' });
  const queryClient = useQueryClient();

  const { data: jobsResponse } = useQuery({
    queryKey: ['cron'],
    queryFn: () => listJobs(true),
    refetchInterval: 10000,
  });

  const jobs = jobsResponse?.jobs ?? [];

  const createMutation = useMutation({
    mutationFn: () => createJob(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cron'] });
      queryClient.refetchQueries({ queryKey: ['cron'] });
      setShowCreate(false);
      setForm({ name: '', prompt: '', schedule: '', deliver: 'origin', model: '' });
      toast.success("Job created");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const pauseMutation = useMutation({
    mutationFn: (id: string) => pauseJob(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cron'] }),
  });

  const resumeMutation = useMutation({
    mutationFn: (id: string) => resumeJob(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cron'] }),
  });

  const runMutation = useMutation({
    mutationFn: (id: string) => runJob(id),
    onSuccess: () => { toast.success("Job triggered"); queryClient.invalidateQueries({ queryKey: ['cron'] }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteJob(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['cron'] }); toast.success("Job deleted"); },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cron Jobs</h1>
          <p className="text-sm text-muted-foreground mt-1">Scheduled background jobs</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gradient-primary"><Plus className="h-4 w-4 mr-1" />New Job</Button>
      </div>

      <Card className="glass-card">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Delivery</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map(job => (
                <TableRow key={job.id}>
                  <TableCell className="font-medium">{job.name || job.id.slice(0, 8)}</TableCell>
                  <TableCell className="font-mono text-xs">{typeof job.schedule === 'object' ? (job.schedule.display || job.schedule.expr) : (job.schedule || 'one-shot')}</TableCell>
                  <TableCell>
                    <Badge className={`text-[10px] ${statusColors[jobStatus(job)]}`}>{jobStatus(job)}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">{job.deliver || 'local'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{job.created_at ? new Date(job.created_at).toLocaleString() : '—'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {job.enabled === false && <Button size="icon" variant="ghost" onClick={() => resumeMutation.mutate(job.id)}><Play className="h-3.5 w-3.5" /></Button>}
                      {job.enabled === true && <Button size="icon" variant="ghost" onClick={() => pauseMutation.mutate(job.id)}><Pause className="h-3.5 w-3.5" /></Button>}
                      <Button size="icon" variant="ghost" onClick={() => runMutation.mutate(job.id)}><Play className="h-3.5 w-3.5 text-success" /></Button>
                      <Button size="icon" variant="ghost" className="text-destructive" onClick={() => deleteMutation.mutate(job.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {jobs.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No cron jobs</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Cron Job</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Input placeholder="Job name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <Textarea placeholder="Prompt (self-contained instruction)" value={form.prompt} onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))} rows={3} />
            <Input placeholder="Schedule (e.g. 0 9 * * *, every 2h, 30m)" value={form.schedule} onChange={e => setForm(f => ({ ...f, schedule: e.target.value }))} className="font-mono" />
            <Input placeholder="Delivery target (origin, telegram, email...)" value={form.deliver} onChange={e => setForm(f => ({ ...f, deliver: e.target.value }))} />
            <Input placeholder="Model override (optional)" value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={!form.name || !form.schedule || !form.prompt}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
