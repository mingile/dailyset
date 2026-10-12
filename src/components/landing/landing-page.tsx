import Link from "next/link";
import { LandingSessionDemo } from "@/components/landing/landing-session-demo";

function SectionLabel({ index }: { index: string }) {
  return (
    <div className="mb-6 flex items-center gap-3">
      <span className="text-xs font-medium tracking-[0.2em] text-muted-foreground">
        {index}
      </span>
    </div>
  );
}

export function LandingPage() {
  return (
    <div className="session-surface session-font flex min-h-screen flex-col">
      <header className="border-b border-foreground">
        <div className="mx-auto flex min-h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/"
            className="flex min-h-11 items-center gap-1.5 font-(family-name:--font-brand) text-xl font-medium tracking-[0.2em]"
          >
            <span className="size-2 rounded-full bg-(--session-accent)" />
            <span>daily</span>
            <span className="text-(--session-muted)">set</span>
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-5xl px-4 sm:px-6 py-16 sm:py-16">
          <div className="max-w-xl text-left">
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
              저번에{" "}
              <span className="box-decoration-clone bg-(--session-accent) px-1.5 py-0.5 text-zinc-900">
                몇 세트
              </span>{" "}
              했더라?
            </h1>

            <p className="mt-8 text-xl leading-relaxed text-muted-foreground sm:text-2xl">
              Daily Set는
              <br />
              다음 운동을 위한 기준을 남깁니다.
            </p>
          </div>
        </section>

        <section aria-label="Session demo">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 py-16 sm:py-12">
            <span className="mb-4 block text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Session Demo
            </span>
            <LandingSessionDemo />
          </div>
        </section>

        <section aria-label="Get started">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 py-16 sm:py-20">
            <div className="max-w-xl text-left">
              <p className="text-2xl font-bold tracking-tight sm:text-3xl">
                다음 운동을 기록하세요.
              </p>
              <Link
                href="/app"
                className="mt-8 inline-flex h-12 items-center justify-center rounded-md bg-(--session-accent) px-5 text-base font-bold text-zinc-900"
              >
                시작하기
              </Link>
            </div>
          </div>
        </section>

        <section
          aria-label="Product philosophy"
          className="border-t border-border"
        >
          <div className="mx-auto max-w-5xl px-4 sm:px-6 py-16 sm:py-20">
            <div className="max-w-xl text-left">
              <SectionLabel index="01" />
              <div className="space-y-4">
                <p className="text-2xl font-bold tracking-tight sm:text-3xl">
                  운동 기록은
                  <br />
                  복잡할 필요가 없습니다.
                </p>
                <p className="text-lg leading-relaxed text-muted-foreground">
                  필요한 것은
                  <br />
                  세트, 중량, 횟수 뿐.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section aria-label="Local-first" className="border-t border-border">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 py-16 sm:py-20">
            <div className="max-w-xl text-left">
              <SectionLabel index="02" />
              <div className="space-y-4">
                <p className="text-2xl font-bold tracking-tight sm:text-3xl">
                  기록은 먼저
                  <br />내 기기에 저장됩니다.
                </p>
                <p className="text-lg leading-relaxed text-muted-foreground">
                  인터넷 연결이나 계정 없이
                  <br />
                  운동을 계속할 수 있습니다.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section aria-label="Notion backup" className="border-t border-border">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 py-16 sm:py-20">
            <div className="max-w-xl text-left">
              <SectionLabel index="03" />
              <div className="space-y-4">
                <p className="text-2xl font-bold tracking-tight sm:text-3xl">
                  Notion 연결을 통해
                  <br />
                  기록을 백업할 수 있습니다.
                </p>
                <p className="text-lg leading-relaxed text-muted-foreground">
                  별도 Notion 데이터베이스 템플릿이 필요합니다.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-foreground">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-4 sm:px-6 py-8 text-center text-sm text-muted-foreground sm:flex-row sm:justify-between sm:text-left">
          <span>© {new Date().getFullYear()} Daily Set</span>
          <div className="flex flex-col items-center gap-2 sm:items-end">
            <div className="flex flex-row items-center gap-4">
              <Link
                href="/termsofservice"
                className="inline-flex min-h-11 items-center hover:text-foreground underline-offset-4 hover:underline"
              >
                Terms of Service
              </Link>
              <Link
                href="/privacy"
                className="inline-flex min-h-11 items-center hover:text-foreground underline-offset-4 hover:underline"
              >
                Privacy Policy
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
