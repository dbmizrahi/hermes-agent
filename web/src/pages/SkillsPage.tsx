import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listSkills, deleteSkill, installSkill, type HermesSkill } from "@/api/skills";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Eye, Trash2, BookOpen, RefreshCw, Download, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function SkillsPage() {
  const [filter, setFilter] = useState('');
  const [category, setCategory] = useState('all');
  const [viewSkill, setViewSkill] = useState<HermesSkill | null>(null);
  const [installName, setInstallName] = useState('');
  const [showInstall, setShowInstall] = useState(false);
  const queryClient = useQueryClient();

  const { data: skillsData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['skills'],
    queryFn: () => listSkills(),
  });

  const skills = skillsData?.skills || [];
  const categories = [...new Set(skills.map(s => s.category).filter(Boolean))];

  const filtered = skills.filter(s =>
    (category === 'all' || s.category === category) &&
    (!filter || s.name.toLowerCase().includes(filter.toLowerCase()) || (s.description || '').toLowerCase().includes(filter.toLowerCase()))
  );

  const installMutation = useMutation({
    mutationFn: () => installSkill(installName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      setShowInstall(false);
      setInstallName('');
      toast.success("Skill installed successfully");
    },
    onError: (err: Error) => {
      toast.error(`Failed to install skill: ${err.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => deleteSkill(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      toast.success("Skill deleted");
    },
    onError: (err: Error) => {
      toast.error(`Failed to delete skill: ${err.message}`);
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Skills</h1>
            <p className="text-sm text-muted-foreground mt-1">Reusable procedural knowledge</p>
          </div>
        </div>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Loading skills...</span>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Skills</h1>
            <p className="text-sm text-muted-foreground mt-1">Reusable procedural knowledge</p>
          </div>
        </div>
        <Card className="border-destructive/50">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
            <div>
              <p className="text-sm font-medium">Failed to load skills</p>
              <p className="text-xs text-muted-foreground mt-1">{error instanceof Error ? error.message : 'Unknown error'}</p>
            </div>
            <Button variant="outline" size="sm" className="ml-auto" onClick={() => refetch()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Skills</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {skills.length} skill{skills.length !== 1 ? 's' : ''} installed
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
          <Button onClick={() => setShowInstall(true)} className="gradient-primary">
            <Download className="h-4 w-4 mr-1" /> Install
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search skills..." value={filter} onChange={e => setFilter(e.target.value)} className="pl-9" />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(skill => (
          <Card key={skill.name} className="glass-card hover:border-primary/30 transition-colors">
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-primary" />
                  <h3 className="font-medium text-sm">{skill.name}</h3>
                </div>
                {skill.version && <Badge variant="outline" className="text-[10px]">v{skill.version}</Badge>}
              </div>
              <p className="text-xs text-muted-foreground mb-3">{skill.description || 'No description'}</p>
              <div className="flex items-center justify-between">
                <Badge variant="secondary" className="text-[10px]">{skill.category || 'uncategorized'}</Badge>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setViewSkill(skill)}><Eye className="h-3 w-3" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteMutation.mutate(skill.name)}><Trash2 className="h-3 w-3" /></Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground col-span-full text-center py-8">
            {skills.length === 0 ? 'No skills installed. Click "Install" to add skills from the hub.' : 'No skills match your search'}
          </p>
        )}
      </div>

      {/* Install dialog */}
      <Dialog open={showInstall} onOpenChange={setShowInstall}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Install Skill</DialogTitle>
            <DialogDescription>Enter the name of a skill to install from the Skills Hub.</DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Skill name (e.g. react-best-practices)"
            value={installName}
            onChange={e => setInstallName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && installName) installMutation.mutate(); }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInstall(false)}>Cancel</Button>
            <Button onClick={() => installMutation.mutate()} disabled={!installName || installMutation.isPending}>
              {installMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
              Install
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View skill dialog */}
      <Dialog open={!!viewSkill} onOpenChange={() => setViewSkill(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{viewSkill?.name}</DialogTitle>
            {viewSkill?.description && <DialogDescription>{viewSkill.description}</DialogDescription>}
          </DialogHeader>
          <div className="space-y-2">
            <div className="flex gap-2">
              {viewSkill?.category && <Badge variant="secondary">{viewSkill.category}</Badge>}
              {viewSkill?.version && <Badge variant="outline">v{viewSkill.version}</Badge>}
              {viewSkill?.author && <Badge variant="outline">{viewSkill.author}</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              Path: {viewSkill?.path || 'N/A'}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
