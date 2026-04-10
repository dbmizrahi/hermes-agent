import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut, apiPost } from "@/config/api";
import type { Model, ModelProvider, ModelCost } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Star, DollarSign, Cpu } from "lucide-react";
import { toast } from "sonner";

export default function ModelsPage() {
  const queryClient = useQueryClient();

  const { data: providers } = useQuery({
    queryKey: ['model-providers'],
    queryFn: () => apiGet<ModelProvider[]>('/api/models/providers'),
  });

  const { data: models } = useQuery({
    queryKey: ['models'],
    queryFn: () => apiGet<Model[]>('/api/models'),
  });

  const { data: costs } = useQuery({
    queryKey: ['model-costs'],
    queryFn: () => apiGet<ModelCost[]>('/api/models/cost'),
  });

  const setDefaultMutation = useMutation({
    mutationFn: (modelId: string) => apiPut('/api/models/default', { model_id: modelId }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['models'] }); toast.success("Default model updated"); },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Models</h1>
        <p className="text-sm text-muted-foreground mt-1">LLM provider and model management</p>
      </div>

      {/* Providers */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(providers || []).map(p => (
          <Card key={p.id} className="glass-card">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-medium text-sm">{p.name}</h3>
                <Badge variant={p.status === 'connected' ? 'default' : 'destructive'} className="text-[10px]">{p.status}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{p.type} · {p.models.length} models</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Model Catalog */}
      <Card className="glass-card">
        <CardHeader><CardTitle className="text-sm">Model Catalog</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Context</TableHead>
                <TableHead>Max Tokens</TableHead>
                <TableHead>Pricing</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(models || []).map(m => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-1.5">
                      {m.isDefault && <Star className="h-3.5 w-3.5 text-warning fill-warning" />}
                      {m.name}
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{m.provider}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{(m.context_window / 1000).toFixed(0)}K</TableCell>
                  <TableCell className="font-mono text-xs">{(m.max_tokens / 1000).toFixed(0)}K</TableCell>
                  <TableCell className="text-xs">
                    {m.pricing ? `$${m.pricing.input}/M in · $${m.pricing.output}/M out` : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    {!m.isDefault && (
                      <Button size="sm" variant="ghost" onClick={() => setDefaultMutation.mutate(m.id)}>
                        <Star className="h-3 w-3 mr-1" />Set Default
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(!models || models.length === 0) && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No models available</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Cost Tracking */}
      {costs && costs.length > 0 && (
        <Card className="glass-card">
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><DollarSign className="h-4 w-4" />Cost Tracking</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {costs.map(c => (
                <div key={c.model} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                  <span className="text-sm">{c.model}</span>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-muted-foreground">{c.total_tokens.toLocaleString()} tokens</span>
                    <span className="text-xs text-muted-foreground">{c.sessions} sessions</span>
                    <span className="text-sm font-mono font-bold">${c.total_cost.toFixed(4)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
