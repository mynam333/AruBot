import { AdminFeaturePage } from '@/features/admin/admin-page';
import { MacroCreateDialog } from '@/features/admin/macro-create-dialog';
import { adminFeatureMap } from '@/shared/config/navigation';

export default function Page() {
  return (
    <AdminFeaturePage
      config={adminFeatureMap.macros}
      actionSlot={<MacroCreateDialog />}
      resourceActionSlot={<MacroCreateDialog variant="outline" />}
    />
  );
}
