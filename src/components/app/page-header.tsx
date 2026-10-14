import type { ReactNode } from "react";

/**
 * 페이지 제목 블록: 제목 + 설명(선택) + 굵은 구분선.
 * 제목과 구분선 사이에 들어갈 내용(안내 박스 등)은 children으로 넘긴다.
 */
export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="border-b border-foreground pb-4">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {description && (
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      )}
      {children}
    </div>
  );
}
