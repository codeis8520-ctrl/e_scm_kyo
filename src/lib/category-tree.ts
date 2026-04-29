// 카테고리 트리 유틸 — inventory/products 페이지 + ProductModal에서 공용 사용.
//   계층 구조의 카테고리 배열을 받아 위치 기반 코드(`[1-1-1]`), 전체 경로명,
//   정렬키, 조상 셋, 깊이를 미리 계산해 반환.

export interface CategoryRow {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
}

export interface CategoryInfo {
  id: string;
  name: string;
  parent_id: string | null;
  pathCode: string;            // "1-1-1"
  pathName: string;            // "한방식품 / 액상 제품"
  sortKey: string;             // "001/001/" 처럼 zero-pad 누적 — 사전순 비교 시 트리 순서
  ancestorIds: Set<string>;    // 자기 자신 포함
  depth: number;
}

export function buildCategoryInfo(categories: CategoryRow[]): Map<string, CategoryInfo> {
  const byParent = new Map<string | null, CategoryRow[]>();
  for (const c of categories) {
    const list = byParent.get(c.parent_id ?? null) || [];
    list.push(c);
    byParent.set(c.parent_id ?? null, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name, 'ko'));
  }
  const out = new Map<string, CategoryInfo>();
  const walk = (
    parentId: string | null,
    parentCode: string,
    parentName: string,
    parentSortKey: string,
    parentAncestors: Set<string>,
    depth: number,
  ) => {
    const list = byParent.get(parentId) || [];
    list.forEach((c, i) => {
      const pos = i + 1;
      const pathCode = parentCode ? `${parentCode}-${pos}` : String(pos);
      const pathName = parentName ? `${parentName} / ${c.name}` : c.name;
      const sortKey = parentSortKey + String(pos).padStart(3, '0') + '/';
      const ancestors = new Set(parentAncestors);
      ancestors.add(c.id);
      out.set(c.id, { id: c.id, name: c.name, parent_id: c.parent_id, pathCode, pathName, sortKey, ancestorIds: ancestors, depth });
      walk(c.id, pathCode, pathName, sortKey, ancestors, depth + 1);
    });
  };
  walk(null, '', '', '', new Set(), 0);
  return out;
}

// 트리 순서로 정렬된 옵션 배열 — select 옵션 등에 사용
export function sortedCategoryOptions(info: Map<string, CategoryInfo>): CategoryInfo[] {
  return Array.from(info.values()).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

// 셀렉트 옵션 라벨 — depth 기반 들여쓰기 + [경로코드] + 이름
//   <option> 안의 공백은 그대로 렌더되므로 NBSP를 사용해야 시각적으로 들여쓰기됨.
export function categoryOptionLabel(c: CategoryInfo): string {
  const indent = '  '.repeat(c.depth); // NBSP 2칸 × depth
  return `${indent}[${c.pathCode}] ${c.name}`;
}
