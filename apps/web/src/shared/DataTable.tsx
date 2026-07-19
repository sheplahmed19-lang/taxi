import { Table, type TableProps } from "antd";

interface DataTableProps<T extends object> extends Omit<TableProps<T>, "pagination"> {
  pageSize?: number;
}

/**
 * Thin AntD Table wrapper with the defaults every admin list screen wants:
 * a stable rowKey fallback, client-side pagination sized for dense ops
 * tables, and a loading spinner driven straight off react-query's isLoading.
 */
export function DataTable<T extends object>({ pageSize = 20, rowKey = "id", ...rest }: DataTableProps<T>) {
  return (
    <Table<T>
      rowKey={rowKey}
      pagination={{ pageSize, showSizeChanger: true, showTotal: (total) => `${total} total` }}
      size="middle"
      {...rest}
    />
  );
}
