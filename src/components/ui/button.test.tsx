import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

// 컴포넌트 테스트 환경(jsdom + RTL + user-event + jest-dom, @/ alias) 점검용 최소 케이스
describe("Button (환경 점검)", () => {
  it("클릭하면 onClick이 호출된다", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>운동 완료</Button>);

    await userEvent.click(screen.getByRole("button", { name: "운동 완료" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disabled면 클릭해도 onClick이 호출되지 않는다", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        처리중...
      </Button>,
    );

    const button = screen.getByRole("button", { name: "처리중..." });
    await userEvent.click(button);

    expect(button).toBeDisabled();
    expect(onClick).not.toHaveBeenCalled();
  });
});
