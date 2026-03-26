"use client";

import type { GridData } from "../../lib/types";

interface GridViewProps {
  projectName: string;
  data: GridData;
}

export default function GridView({ projectName, data }: GridViewProps) {
  console.log("[GridView] gridData:", data);
  return (
    <div
      className="w-full max-w-xl flex flex-col items-center gap-4 py-10 px-4"
      style={{ color: "var(--text-main)" }}
    >
      <p className="text-lg font-bold">Grid View for {projectName}</p>
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        {data.totalRows} rows × {data.totalStitches} stitches
      </p>
    </div>
  );
}
