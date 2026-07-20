import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Statistic, Tag } from "antd";
import { apiClient } from "../../shared/apiClient";
import { DataTable } from "../../shared/DataTable";
import { formatMoney } from "../../shared/format";

interface LedgerEntry {
  id: string;
  type: string;
  debit: number;
  credit: number;
  balanceAfter: number;
  createdAt: string;
}

export function WalletPage() {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [pages, setPages] = useState<LedgerEntry[][]>([]);

  const { data: balance, isLoading: balanceLoading } = useQuery({
    queryKey: ["wallet-balance"],
    queryFn: async () => (await apiClient.get<{ data: { balance: number; currency: string } }>("/wallet/balance")).data.data,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["wallet-transactions", cursor],
    queryFn: async () =>
      (await apiClient.get<{ data: { transactions: LedgerEntry[] } }>("/wallet/transactions", { params: { cursor } })).data
        .data.transactions,
  });

  const transactions = data ?? pages[pages.length - 1] ?? [];

  function handleNextPage() {
    if (!data || data.length === 0) return;
    setPages((prev) => [...prev, data]);
    setCursor(data[data.length - 1]!.id);
  }

  return (
    <>
      <Card style={{ marginBottom: 16 }} loading={balanceLoading}>
        <Statistic title="Wallet balance" value={balance ? formatMoney(balance.balance) : "—"} suffix={balance?.currency} />
      </Card>
      <Card title="Transactions">
        <DataTable<LedgerEntry>
          loading={isLoading}
          dataSource={transactions}
          columns={[
            { title: "Date", dataIndex: "createdAt", render: (v: string) => new Date(v).toLocaleString() },
            { title: "Type", dataIndex: "type", render: (v: string) => <Tag>{v}</Tag> },
            { title: "Debit", dataIndex: "debit", render: (v: number) => (v > 0 ? formatMoney(v) : "—") },
            { title: "Credit", dataIndex: "credit", render: (v: number) => (v > 0 ? formatMoney(v) : "—") },
            { title: "Balance after", dataIndex: "balanceAfter", render: (v: number) => formatMoney(v) },
          ]}
        />
        {data && data.length > 0 && (
          <Button block onClick={handleNextPage} style={{ marginTop: 12 }}>
            Load more
          </Button>
        )}
      </Card>
    </>
  );
}
