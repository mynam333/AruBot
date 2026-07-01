import { AdminFeaturePage } from '@/features/admin/admin-page';
import { adminFeatureMap } from '@/shared/config/navigation';

export default function Page() {
  return <AdminFeaturePage config={adminFeatureMap.variables} />;
}
