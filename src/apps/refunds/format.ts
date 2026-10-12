export function utcDateTime(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

export function shortId(id: string): string {
  return id.slice(-8).toUpperCase();
}
