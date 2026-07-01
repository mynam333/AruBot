import { AdminFeaturePage } from '@/features/admin/admin-page';
import { CommandCreateDialog } from '@/features/admin/admin-action-dialogs';
import { adminFeatureMap } from '@/shared/config/navigation';

export default function Page() {
  return (
    <AdminFeaturePage
      config={adminFeatureMap.commands}
      actionSlot={<CommandCreateDialog />}
      resourceActionSlot={<CommandCreateDialog variant="outline" />}
    />
  );
}
