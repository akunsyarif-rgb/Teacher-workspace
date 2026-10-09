import { StudentAuthProvider } from "@/src/context/StudentAuthContext";
import PerfOverlay from "@/src/components/ui/PerfOverlay";

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <StudentAuthProvider>
      {children}
      <PerfOverlay />
    </StudentAuthProvider>
  );
}
