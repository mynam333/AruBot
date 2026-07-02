import { ArrowRight, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/button';
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
  const Icon = config.icon;

  return (
    <>
      <section className="relative overflow-hidden rounded-[var(--radius-panel)] border bg-[linear-gradient(135deg,hsl(var(--card)),hsl(var(--accent-lemon)/0.18))] p-[clamp(1.25rem,2.6vw,1.75rem)] shadow-subtle">
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-4 flex items-center gap-2">
              <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-primary/12 text-primary ring-1 ring-primary/25">
                <Icon className="h-5 w-5" />
              </span>
              <Badge tone="mint">{eyebrow}</Badge>
            </div>
            <h1 className="text-3xl font-semibold leading-tight tracking-normal md:text-4xl">{config.title}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">{config.description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(config.actions || []).map((action) => (
              <LinkButton key={action.href} href={action.href} variant="secondary">
                {action.label}
                <ArrowRight className="h-4 w-4" />
              </LinkButton>
            ))}
            {actionSlot}
          </div>
        </div>
      </section>

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
