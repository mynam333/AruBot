import { AdminFeaturePage } from '@/features/admin/admin-page';
import { MacroCreateDialog } from '@/features/admin/macro-create-dialog';
import { MacrosPage } from '@/features/admin/macros-page';
import { adminFeatureMap } from '@/shared/config/navigation';

export default function Page() {
  const config = { ...adminFeatureMap.macros, endpoint: undefined };

  return (
    <AdminFeaturePage
      config={config}
      actionSlot={<MacroCreateDialog />}
    >
      <MacrosPage />
    </AdminFeaturePage>
  );
}
