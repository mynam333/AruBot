import { AdminFeaturePage } from '@/features/admin/admin-page';
import { DonationRuleCreateDialog, DonationSettingsDialog } from '@/features/admin/admin-action-dialogs';
import { adminFeatureMap } from '@/shared/config/navigation';

export default function Page() {
  return (
    <AdminFeaturePage
      config={adminFeatureMap.donations}
      actionSlot={
        <>
          <DonationRuleCreateDialog />
          <DonationSettingsDialog variant="outline" />
        </>
      }
      resourceActionSlot={
        <>
          <DonationRuleCreateDialog variant="outline" />
          <DonationSettingsDialog variant="outline" />
        </>
      }
    />
  );
}
