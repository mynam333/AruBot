import { ArrowRight, type LucideIcon } from 'lucide-react';
import { LinkButton } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page';
import { ResourceDashboard } from './resource-dashboard';

export type AdminPageConfig = {
  title: string;
  description: string;
  endpoint?: string;
  icon: LucideIcon;
  actions?: { href: string; label: string }[];
  tips?: string[];
};

export function AdminFeaturePage({
  config,
  eyebrow = '관리',
  actionSlot,
  resourceActionSlot,
  children,
}: {
  config: AdminPageConfig;
  eyebrow?: string;
  actionSlot?: React.ReactNode;
  resourceActionSlot?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <>
      <PageHeader
        eyebrow={eyebrow}
        title={config.title}
        description={config.description}
        actions={
          <>
            {(config.actions || []).map((action) => (
              <LinkButton key={action.href} href={action.href} variant="outline">
                {action.label}
                <ArrowRight className="h-4 w-4" />
              </LinkButton>
            ))}
            {actionSlot}
          </>
        }
      />

      {children}

      <div className="grid gap-5">
        {config.endpoint ? (
          <ResourceDashboard
            endpoint={config.endpoint}
            title="등록된 항목"
            description="내 채널에 저장된 항목을 확인하고 필요한 화면으로 바로 이동해요."
            actions={config.actions}
            actionSlot={resourceActionSlot}
          />
        ) : null}
      </div>
    </>
  );
}
