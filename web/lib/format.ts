export function formatRelativeTime(value: string, now = Date.now()): string {
  const then = Date.parse(value);
  if (Number.isNaN(then)) {
    return value;
  }

  const diffSeconds = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSeconds < 10) return "刚刚";
  if (diffSeconds < 60) return `${diffSeconds} 秒前`;

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} 小时前`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} 天前`;
}

export function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}
