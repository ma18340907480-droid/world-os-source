// WORLD OS Alpha 0.3 · 中文建造指令解析（纯本地规则，无外部 API）
// 例："建一座房子" / "种十棵树" / "盖3个商店" / "删除最后一个" / "撤销" / "恢复"

export type CommandAction = 'build' | 'demolish_last' | 'undo' | 'redo' | 'unknown';

export interface ParsedCommand {
  action: CommandAction;
  /** 建筑类型（build 时） */
  type?: string;
  count: number;
  raw: string;
}

const CN_DIGIT: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

/** 中文数字 → 数值（支持一~九十九） */
export function parseChineseNum(s: string): number | null {
  s = s.trim();
  if (!s) return null;
  if (CN_DIGIT[s] !== undefined) return CN_DIGIT[s];
  if (s === '十') return 10;
  const m = s.match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/);
  if (m) {
    const tens = m[1] ? CN_DIGIT[m[1]] : 1;
    const ones = m[2] ? CN_DIGIT[m[2]] : 0;
    return tens * 10 + ones;
  }
  return null;
}

/** 建筑关键词 → 类型（长的优先，避免"树"吞掉"苹果树"） */
const TYPE_KEYWORDS: { kw: string[]; type: string }[] = [
  { kw: ['苹果树', '果树'], type: 'tree' },
  { kw: ['小木屋', '木屋'], type: 'hut' },
  { kw: ['小商店', '商店', '小店', '店铺', '店'], type: 'shop' },
  { kw: ['石头屋', '石屋'], type: 'stonehouse' },
  { kw: ['工坊', '作坊', '加工坊'], type: 'workshop' },
  { kw: ['仓库'], type: 'warehouse' },
  { kw: ['高楼', '大楼'], type: 'tower' },
  { kw: ['草屋', '茅草屋', '茅屋'], type: 'thatch' },
  { kw: ['路灯', '灯'], type: 'lamp' },
  { kw: ['围栏', '栅栏', '篱笆'], type: 'fence' },
  { kw: ['花坛', '花'], type: 'flower' },
  { kw: ['房子', '小屋', '屋'], type: 'hut' },
  { kw: ['树'], type: 'tree' },
];

const BUILD_VERBS = ['建造', '建', '盖', '造', '种', '栽', '放置', '放'];

export function parseCommand(raw: string): ParsedCommand {
  const text = raw.trim().replace(/\s+/g, '');
  const base: ParsedCommand = { action: 'unknown', count: 1, raw };

  if (!text) return base;

  // 撤销 / 恢复
  if (/^(撤销|撤回|undo)$/i.test(text)) return { ...base, action: 'undo' };
  if (/^(恢复|重做|redo)$/i.test(text)) return { ...base, action: 'redo' };

  // 删除最后一个
  if(/(删除|删掉|移除).*(最后|上.?个)/.test(text) || /^(删除|删)$/.test(text)) {
    return { ...base, action: 'demolish_last' };
  }

  // 必须有建造动词
  const hasVerb = BUILD_VERBS.some((v) => text.includes(v));
  if (!hasVerb) return base;

  // 找建筑类型
  let type: string | undefined;
  let typeKw = '';
  for (const t of TYPE_KEYWORDS) {
    for (const kw of t.kw) {
      if (text.includes(kw) && kw.length > typeKw.length) {
        type = t.type;
        typeKw = kw;
      }
    }
  }
  if (!type) return base;

  // 找数量：阿拉伯数字 或 中文数字（可带量词）
  let count = 1;
  const arabic = text.match(/(\d+)\s*[座棵颗个栋盏株只]?/);
  const cnNum = text.match(/([一二两三四五六七八九十]+)\s*[座棵颗个栋盏株只]?/);
  if (arabic) {
    count = Math.max(1, parseInt(arabic[1], 10));
  } else if (cnNum) {
    const n = parseChineseNum(cnNum[1]);
    if (n) count = n;
  }
  count = Math.min(count, 30); // 单次上限

  return { action: 'build', type, count, raw };
}

/** 验收用的示例 */
export const COMMAND_EXAMPLES = ['建一座草屋', '种十棵树', '盖3个商店', '删除最后一个', '撤销', '恢复'];
