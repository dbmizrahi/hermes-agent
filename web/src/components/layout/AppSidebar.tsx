import {
  Bot, Brain, BookOpen, MessageSquare, MessagesSquare,
  Clock, Radio, Satellite, Plug, LayoutDashboard, Server
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, useSidebar,
} from "@/components/ui/sidebar";

const coreItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Sessions", url: "/sessions", icon: MessageSquare },
  { title: "Chat", url: "/chat", icon: MessagesSquare },
];

const knowledgeItems = [
  { title: "Memory", url: "/memory", icon: Brain },
  { title: "Skills", url: "/skills", icon: BookOpen },
];

const automationItems = [
  { title: "Cron Jobs", url: "/cron", icon: Clock },
];

const infraItems = [
  { title: "Gateway", url: "/gateway", icon: Radio },
  { title: "Channels", url: "/channels", icon: Satellite },
  { title: "MCP", url: "/mcp", icon: Plug },
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
        <NavGroup label="Knowledge" items={knowledgeItems} />
        <NavGroup label="Automation" items={automationItems} />
        <NavGroup label="Infrastructure" items={infraItems} />
      </SidebarContent>
    </Sidebar>
  );
}
