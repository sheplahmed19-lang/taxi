import { Empty } from "antd";

/** Placeholder for an admin sub-section whose real content lands in a later Phase 4 sub-phase. */
export function ComingSoon({ phase }: { phase: string }) {
  return (
    <Empty
      description={`Built out in ${phase}`}
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      style={{ marginTop: 80 }}
    />
  );
}
