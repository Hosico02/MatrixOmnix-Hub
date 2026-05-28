// Does a Forge narrative summary describe a failure / unresolved state?
// Drives a warning highlight in the Overview tab. Markers match the strings
// build_iter_narrative emits (d2p/narrative.py): "失败" (executor failed
// task) and "未解决" (qa still-open bugs). The no-trouble paths deliberately
// avoid these substrings (e.g. "全部清零", "fix 任务 N 成 M 败").
const TROUBLE_MARKERS = ['失败', '未解决'];

export function hasTrouble(text: string | null | undefined): boolean {
  if (!text) return false;
  return TROUBLE_MARKERS.some((m) => text.includes(m));
}
