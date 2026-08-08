import { StudentAuthProvider } from "@/src/context/StudentAuthContext";

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return <StudentAuthProvider>{children}</StudentAuthProvider>;
}
