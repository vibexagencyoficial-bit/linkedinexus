import { Sidebar } from "@/components/layout/Sidebar";
import { ContextualHeader } from "@/components/layout/ContextualHeader";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#090a0c]">
      {/* Sidebar Navigation */}
      <Sidebar />

      {/* Main Container */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <ContextualHeader />
        <main className="flex-1 overflow-y-auto bg-[#090a0c] p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
