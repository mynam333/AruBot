import { AdminFeaturePage } from '@/features/admin/admin-page';
import { RouletteCreateDialog } from '@/features/admin/admin-action-dialogs';
import { adminFeatureMap } from '@/shared/config/navigation';

export default function Page() {
  return (
    <AdminFeaturePage
      config={adminFeatureMap.roulette}
      actionSlot={<RouletteCreateDialog />}
      resourceActionSlot={<RouletteCreateDialog variant="outline" />}
    />
  );
}
