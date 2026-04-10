import { useEffect, useState } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Activity } from "lucide-react";

interface VersionInfo {
  version: string;
  platform: string;
}

export function TopBar() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/version")
      .then((res) => res.json())
      .then((data: VersionInfo) => setVersion(data.version))
      .catch(() => {});
  }, []);

  return (
    <header className="h-12 flex items-center justify-between border-b border-border px-4 bg-card/50 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Activity className="h-3 w-3 text-success" />
          <span>System Online</span>
        </div>
        {version && (
          <Badge variant="outline" className="text-[10px] font-mono">
            v{version}
          </Badge>
        )}
      </div>
    </header>
  );
}
