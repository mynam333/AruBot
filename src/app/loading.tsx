export default function Loading() {
  return (
    <main className="min-h-screen px-[var(--page-gutter)] py-[clamp(1.5rem,3vw,2rem)]">
      <div className="mx-auto grid w-full max-w-6xl gap-5 md:gap-6">
        <section className="relative overflow-hidden rounded-[var(--radius-panel)] border bg-[linear-gradient(135deg,hsl(var(--card)),hsl(var(--accent-sky)/0.34),hsl(var(--accent-mint)/0.3))] p-[clamp(1.25rem,3vw,2rem)] shadow-soft">
          <div className="absolute inset-x-[8%] top-0 h-[max(0.1875rem,0.18vw)] rounded-full bg-[linear-gradient(90deg,hsl(var(--accent-mint)),hsl(var(--accent-sky)),hsl(var(--accent-coral)))] opacity-80" />
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <span className="relative grid aspect-square w-[clamp(3rem,7vw,4.25rem)] place-items-center rounded-[var(--radius-card)] border bg-card/80 shadow-subtle">
                <span className="absolute inset-[-18%] rounded-full border border-primary/20 loading-orbit" />
                <img src="/files/logo.png" alt="" aria-hidden="true" className="h-[72%] w-[72%] object-contain" draggable={false} />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-primary">AruBot</div>
                <h1 className="mt-1 break-keep text-2xl font-semibold leading-tight md:text-4xl">방송 관리 화면을 준비하고 있어요.</h1>
                <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                  방송 참여 화면을 준비하는 중입니다.
                </p>
              </div>
            </div>
            <div className="w-full max-w-[min(20rem,100%)] rounded-[var(--radius-card)] border bg-card/70 p-[clamp(0.875rem,1.6vw,1.125rem)] shadow-subtle">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="h-[0.75rem] w-[32%] rounded-full loading-skeleton" />
                <span className="h-[1.75rem] w-[1.75rem] rounded-full loading-skeleton" />
              </div>
              <div className="grid gap-2">
                <span className="h-[0.875rem] w-[86%] rounded-full loading-skeleton" />
                <span className="h-[0.875rem] w-[64%] rounded-full loading-skeleton" />
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {['채팅 명령어', '시청자 포인트', '영상 후원'].map((label, index) => (
            <div
              key={label}
              className="rounded-[var(--radius-card)] border bg-card/75 p-[clamp(1rem,2vw,1.25rem)] shadow-subtle"
              style={{ animationDelay: `${index * 90}ms` }}
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-muted text-xs font-semibold text-muted-foreground">
                  {label.slice(0, 1)}
                </span>
                <span className="h-[1.5rem] w-[28%] rounded-full loading-skeleton" />
              </div>
              <div className="grid gap-2">
                <span className="h-[0.95rem] w-[72%] rounded-full loading-skeleton" />
                <span className="h-[0.85rem] w-full rounded-full loading-skeleton" />
                <span className="h-[0.85rem] w-[58%] rounded-full loading-skeleton" />
              </div>
            </div>
          ))}
        </section>

        <section className="rounded-[var(--radius-card)] border bg-card/70 p-[clamp(1rem,2vw,1.25rem)] shadow-subtle">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <span className="h-[0.875rem] w-[min(14rem,70%)] rounded-full loading-skeleton" />
            <span className="h-[0.875rem] w-[min(22rem,90%)] rounded-full loading-skeleton" />
            <span className="h-[var(--control-height-sm)] w-[min(10rem,60%)] rounded-[var(--radius-control)] loading-skeleton md:ml-auto" />
          </div>
        </section>
      </div>
    </main>
  );
}
