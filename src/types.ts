export type Kind =
  | "note"
  | "topic"
  | "entity"
  | "relation"
  | "event"
  | "thesis"
  | "cycle"
  | "series"
  | "watch"
  | "source"
  | "lesson"
  | "word"
  | "review"
  | "session"
  | "annotation"
  | "table"
  | "job"
  | "article"
  | "feed";
export interface Entry<T = { [key: string]: any }> {
  id: string;
  kind: Kind;
  title: string;
  data: T;
  revision: number;
  updated_at: string;
  deleted: boolean;
  conflict_of: string | null;
}
export interface Asset {
  hash: string;
  name: string;
  mime: string;
  size: number;
  path?: string;
}
export interface Segment {
  id: string;
  start: number;
  end: number;
  text: string;
  translation?: string;
}
export type Screen =
  "today" | "notes" | "research" | "english" | "settings" | "feeds";
export const kindNames: Record<Kind, string> = {
  note: "笔记",
  topic: "专题",
  entity: "公司与环节",
  relation: "产业关系",
  event: "事件",
  thesis: "研究判断",
  cycle: "周期",
  series: "指标",
  watch: "关注标的",
  source: "数据源",
  lesson: "英语课程",
  word: "生词",
  review: "复习记录",
  session: "学习记录",
  annotation: "批注",
  table: "数据表",
  job: "采集任务",
  article: "收藏文章",
  feed: "RSS 订阅",
};
