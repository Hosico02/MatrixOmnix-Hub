import { describe, it, expect } from 'vitest';
import { hasTrouble } from '../../site/src/lib/trouble';

describe('hasTrouble', () => {
  it('flags executor failure text', () => {
    expect(hasTrouble('完成 1/2 个特性任务；失败：Login retry（SEARCH 未匹配）')).toBe(true);
  });
  it('flags unresolved QA bugs', () => {
    expect(hasTrouble('新增 2 个 bug；顺带修好 0 个；fix 任务 0 成 1 败；仍有 2 个未解决')).toBe(true);
  });
  it('does not flag all-clear QA', () => {
    expect(hasTrouble('新增 0 个 bug；顺带修好 1 个；fix 任务 1 成 0 败；全部清零')).toBe(false);
  });
  it('does not confuse fix 败 with executor 失败', () => {
    expect(hasTrouble('fix 任务 0 成 1 败；全部清零')).toBe(false);
  });
  it('handles null/empty', () => {
    expect(hasTrouble(null)).toBe(false);
    expect(hasTrouble('')).toBe(false);
  });
});
