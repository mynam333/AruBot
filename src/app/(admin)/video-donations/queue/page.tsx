import { AdminFeaturePage } from '@/features/admin/admin-page';
import { VideoDonationSettingsDialog } from '@/features/admin/admin-action-dialogs';
import { adminFeatureMap } from '@/shared/config/navigation';

export default function Page() {
  return (
    <AdminFeaturePage
      config={adminFeatureMap.videoDonations}
      actionSlot={<VideoDonationSettingsDialog />}
    />
  );
}
