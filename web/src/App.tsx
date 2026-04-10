import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/layout/AppLayout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import SessionsPage from "./pages/SessionsPage";
import ChatPage from "./pages/ChatPage";
import MemoryPage from "./pages/MemoryPage";
import SkillsPage from "./pages/SkillsPage";
import CronPage from "./pages/CronPage";
import GatewayPage from "./pages/GatewayPage";
import ChannelsPage from "./pages/ChannelsPage";
import MCPPage from "./pages/MCPPage";
import AgentsPage from "./pages/AgentsPage";
import TerminalPage from "./pages/TerminalPage";
import FilesPage from "./pages/FilesPage";
import ModelsPage from "./pages/ModelsPage";
import ACPPage from "./pages/ACPPage";
import EnvPage from "./pages/EnvPage";
import NetworkPage from "./pages/NetworkPage";
import VirtualOfficePage from "./pages/VirtualOfficePage";
import TaskBoardPage from "./pages/TaskBoardPage";
import TeamsPage from "./pages/TeamsPage";
import LogsPage from "./pages/LogsPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

// Auth guard: redirects to /login if not authenticated
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthLoading } = useAuth();
  if (isAuthLoading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout>
              <DashboardPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/sessions"
        element={
          <ProtectedRoute>
            <AppLayout>
              <SessionsPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/chat"
        element={
          <ProtectedRoute>
            <AppLayout>
              <ChatPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/memory"
        element={
          <ProtectedRoute>
            <AppLayout>
              <MemoryPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/skills"
        element={
          <ProtectedRoute>
            <AppLayout>
              <SkillsPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/cron"
        element={
          <ProtectedRoute>
            <AppLayout>
              <CronPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/gateway"
        element={
          <ProtectedRoute>
            <AppLayout>
              <GatewayPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/channels"
        element={
          <ProtectedRoute>
            <AppLayout>
              <ChannelsPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/mcp"
        element={
          <ProtectedRoute>
            <AppLayout>
              <MCPPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/agents"
        element={
          <ProtectedRoute>
            <AppLayout>
              <AgentsPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/terminal"
        element={
          <ProtectedRoute>
            <AppLayout>
              <TerminalPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/files"
        element={
          <ProtectedRoute>
            <AppLayout>
              <FilesPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/models"
        element={
          <ProtectedRoute>
            <AppLayout>
              <ModelsPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/acp"
        element={
          <ProtectedRoute>
            <AppLayout>
              <ACPPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/env"
        element={
          <ProtectedRoute>
            <AppLayout>
              <EnvPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/network"
        element={
          <ProtectedRoute>
            <AppLayout>
              <NetworkPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/virtual-office"
        element={
          <ProtectedRoute>
            <AppLayout>
              <VirtualOfficePage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/task-board"
        element={
          <ProtectedRoute>
            <AppLayout>
              <TaskBoardPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/teams"
        element={
          <ProtectedRoute>
            <AppLayout>
              <TeamsPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/logs"
        element={
          <ProtectedRoute>
            <AppLayout>
              <LogsPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
