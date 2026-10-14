/**
 * 운동 카테고리 탭 바: 스크롤 영역 위에 붙는(sticky) 가로 스크롤 탭 줄.
 * 선택 상태는 부모가 가지고, 이 컴포넌트는 그리기와 클릭 전달만 한다.
 */
export function CategoryTabs<T extends string>({
  categories,
  selected,
  onSelect,
}: {
  categories: readonly T[];
  selected: T | null;
  onSelect: (category: T) => void;
}) {
  return (
    <div className="sticky top-0 z-10 border-b border-border bg-background">
      <div className="flex overflow-x-auto px-4">
        {categories.map((category) => (
          <button
            key={category}
            onClick={() => onSelect(category)}
            className={`h-11 whitespace-nowrap border-b-2 px-3 text-sm ${
              selected === category
                ? "border-foreground font-bold"
                : "border-transparent text-muted-foreground"
            }`}
          >
            {category}
          </button>
        ))}
      </div>
    </div>
  );
}
