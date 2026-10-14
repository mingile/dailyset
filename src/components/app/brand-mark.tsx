/**
 * `● daily set` 로고. 링크가 필요하면(랜딩) 바깥에서 `Link`로 감싼다.
 */
export function BrandMark() {
  return (
    <span className="flex items-center gap-1.5 font-(family-name:--font-brand) text-xl font-medium tracking-[0.2em]">
      <span className="size-2 rounded-full bg-(--session-accent)" />
      <span>daily</span>
      <span className="text-(--session-muted)">set</span>
    </span>
  );
}
