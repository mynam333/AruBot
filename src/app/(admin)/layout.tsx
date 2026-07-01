import { AdminShell } from '@/components/app-shell/admin-shell';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
