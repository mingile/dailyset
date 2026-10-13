import { useQueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createQueryWrapper } from "@/test-utils/query";
import { QueryProvider } from "./query-provider";

function ClientProbe({ onClient }: { onClient: (client: unknown) => void }) {
  onClient(useQueryClient());
  return <p>child</p>;
}

describe("QueryProvider", () => {
  it("children을 렌더하고 QueryClient를 제공한다", () => {
    let received: unknown;
    render(
      <QueryProvider>
        <ClientProbe
          onClient={(client) => {
            received = client;
          }}
        />
      </QueryProvider>,
    );

    expect(screen.getByText("child")).toBeInTheDocument();
    expect(received).toBeDefined();
  });

  it("리렌더해도 같은 QueryClient를 유지한다 (캐시가 사라지지 않는다)", () => {
    const clients: unknown[] = [];
    // 같은 element를 재사용하면 React가 리렌더를 건너뛰므로 매번 새로 만든다
    const probe = () => (
      <ClientProbe onClient={(client) => clients.push(client)} />
    );

    const { rerender } = render(<QueryProvider>{probe()}</QueryProvider>);
    rerender(<QueryProvider>{probe()}</QueryProvider>);

    expect(clients.length).toBeGreaterThanOrEqual(2);
    expect(new Set(clients).size).toBe(1);
  });
});

describe("createQueryWrapper (테스트 helper)", () => {
  it("호출마다 새 QueryClient를 만든다 (테스트 간 캐시 격리)", () => {
    const a = createQueryWrapper();
    const b = createQueryWrapper();

    a.queryClient.setQueryData(["k"], "a");

    expect(a.queryClient).not.toBe(b.queryClient);
    expect(b.queryClient.getQueryData(["k"])).toBeUndefined();
  });
});
