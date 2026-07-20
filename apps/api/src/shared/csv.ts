/** Minimal dependency-free CSV builder — quotes/escapes any value containing a comma, quote, or newline. */
export function toCsv<T extends object>(rows: T[], columns: (keyof T & string)[]): string {
  const escape = (value: unknown): string => {
    const str = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const header = columns.join(",");
  const lines = rows.map((row) => columns.map((col) => escape(row[col])).join(","));
  return [header, ...lines].join("\n");
}
