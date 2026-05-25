const ARCHETYPES: Record<string, string> = {
  'fastapi-api': 'Python 后端 API',
  'node-server': 'Node 后端',
  'python-library': 'Python 库',
  'python-cli': 'Python 命令行',
  'unknown': '未识别项目',
};

const STATES: Record<string, string> = {
  'RUNNING': '正在跑',
  'CLEAN': '完美交付',
  'WITH_RESIDUALS': '基本可用,有问题没修完',
  'ESCALATED': '需要人介入',
  'TIMEOUT': '试到上限还没收敛',
};

const STATE_ICONS: Record<string, string> = {
  'RUNNING': '🟢',
  'CLEAN': '✅',
  'WITH_RESIDUALS': '⚠️',
  'ESCALATED': '❌',
  'TIMEOUT': '⏱',
};

const SEVERITIES: Record<string, string> = {
  'blocker': '严重',
  'high': '比较严重',
  'medium': '一般',
  'low': '轻微',
};

const PROPOSAL_TYPES: Record<string, string> = {
  'add_check': '想新加一条规则',
  'remove_check': '想删一条没用的规则',
  'adjust_weight': '想改一条规则的严重程度',
  'reword': '想改一条规则的措辞',
};

const PROPOSAL_ICONS: Record<string, string> = {
  'add_check': '💡',
  'remove_check': '🗑',
  'adjust_weight': '⚖️',
  'reword': '✎',
};

const FINDING_CATEGORIES: Record<string, string> = {
  'missing_api_error_envelope': '接口出错时没返回标准格式',
  'readme_cmd_mismatch': 'README 写的命令跟代码对不上',
  'missing_env_example': '缺 .env.example 模板',
  'unpinned_production_deps': '生产依赖未固定版本',
  'dockerfile_uses_dev_server': 'Dockerfile 用的是开发服务器',
  'tests_run_and_pass': '测试要真能跑起来',
  'error_envelope_present': '接口要有标准错误格式',
  'cors_policy_missing': '缺少 CORS 配置',
  'cors_policy_explicit': '跨域要明确配置',
};

export const humanize = {
  archetype: (id: string | null | undefined): string =>
    id ? (ARCHETYPES[id] ?? id) : '未识别项目',
  state: (s: string | null | undefined): string =>
    s ? (STATES[s] ?? s) : '未知',
  stateIcon: (s: string | null | undefined): string =>
    s ? (STATE_ICONS[s] ?? '·') : '·',
  severity: (s: string): string =>
    SEVERITIES[s] ?? s,
  proposalType: (t: string): string =>
    PROPOSAL_TYPES[t] ?? t,
  proposalIcon: (t: string): string =>
    PROPOSAL_ICONS[t] ?? '·',
  findingCategory: (c: string): string =>
    FINDING_CATEGORIES[c] ?? c,
  hasFindingTranslation: (c: string): boolean =>
    c in FINDING_CATEGORIES,
};
