import {
  Bot, Brain, BookOpen, MessageSquare, MessagesSquare,
  Clock, Radio, Satellite, Plug, LayoutDashboard, Server,
  Terminal, FileText, Cpu, Cable, Settings2, Network, Monitor,
  KanbanSquare, Users, ScrollText
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, useSidebar,
} from "@/components/ui/sidebar";

const coreItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Agents", url: "/agents", icon: Bot },
  { title: "Sessions", url: "/sessions", icon: MessageSquare },
  { title: "Chat", url: "/chat", icon: MessagesSquare },
];

const toolsItems = [
  { title: "Terminal", url: "/terminal", icon: Terminal },
  { title: "Files", url: "/files", icon: FileText },
];

const modelsItems = [
  { title: "Models", url: "/models", icon: Cpu },
];

const integrationItems = [
  { title: "ACP", url: "/acp", icon: Cable },
  { title: "MCP", url: "/mcp", icon: Plug },
];

const infraItems = [
  { title: "Env", url: "/env", icon: Settings2 },
  { title: "Network", url: "/network", icon: Network },
  { title: "Gateway", url: "/gateway", icon: Radio },
  { title: "Channels", url: "/channels", icon: Satellite },
];

const collaborationItems = [
  { title: "Virtual Office", url: "/virtual-office", icon: Monitor },
  { title: "Task Board", url: "/task-board", icon: KanbanSquare },
  { title: "Teams", url: "/teams", icon: Users },
];

const automationItems = [
  { title: "Cron Jobs", url: "/cron", icon: Clock },
  { title: "Logs", url: "/logs", icon: ScrollText },
];

const knowledgeItems = [
  { title: "Memory", url: "/memory", icon: Brain },
  { title: "Skills", url: "/skills", icon: BookOpen },
];

function NavGroup({ label, items }: { label: string; items: typeof coreItems }) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();

  return (
    <SidebarGroup>
      {!collapsed && <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold">{label}</SidebarGroupLabel>}
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild isActive={location.pathname === item.url || (item.url !== '/' && location.pathname.startsWith(item.url))}>
                <NavLink to={item.url} end={item.url === '/'} className="hover:bg-sidebar-accent/50 transition-colors" activeClassName="bg-sidebar-accent text-primary font-medium">
                  <item.icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="truncate">{item.title}</span>}
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg gradient-primary flex items-center justify-center shrink-0">
            <Bot className="h-4 w-4 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="text-sm font-semibold tracking-tight">Hermes MCC</span>
              <span className="text-[10px] text-muted-foreground">Mission Control</span>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup label="Core" items={coreItems} />
        <NavGroup label="Tools" items={toolsItems} />
        <NavGroup label="Models" items={modelsItems} />
        <NavGroup label="Integration" items={integrationItems} />
        <NavGroup label="Knowledge" items={knowledgeItems} />
        <NavGroup label="Infrastructure" items={infraItems} />
        <NavGroup label="Collaboration" items={collaborationItems} />
        <NavGroup label="Automation" items={automationItems} />
      </SidebarContent>
    </Sidebar>
  );
}
