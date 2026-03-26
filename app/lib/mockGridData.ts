import type { GridData } from "./types";

// Diamond lace pattern — 12 rows × 11 stitches
// Symbol key: "" = knit RS / purl WS, "/" = k2tog, "\\" = ssk, "○" = yo

export const MOCK_GRID_PROJECT_DATA: GridData = {
  totalRows: 12,
  totalStitches: 11,
  rows: [
    { rowNumber: 1,  type: "RS", cells: ["",  "",  "\\", "○",  "",   "",   "",   "\\", "○",  "",  ""]  },
    { rowNumber: 2,  type: "WS", cells: ["",  "",  "",   "",   "",   "",   "",   "",   "",   "",  ""]  },
    { rowNumber: 3,  type: "RS", cells: ["\\","○", "",   "○",  "/",  "",   "\\", "○",  "",   "○", "/"] },
    { rowNumber: 4,  type: "WS", cells: ["",  "",  "",   "",   "",   "",   "",   "",   "",   "",  ""]  },
    { rowNumber: 5,  type: "RS", cells: ["",  "\\","○",  "",   "",   "",   "",   "\\", "○",  "",  ""]  },
    { rowNumber: 6,  type: "WS", cells: ["",  "",  "",   "",   "",   "",   "",   "",   "",   "",  ""]  },
    { rowNumber: 7,  type: "RS", cells: ["",  "",  "",   "\\", "○",  "",   "",   "",   "",   "",  ""]  },
    { rowNumber: 8,  type: "WS", cells: ["",  "",  "",   "",   "",   "",   "",   "",   "",   "",  ""]  },
    { rowNumber: 9,  type: "RS", cells: ["",  "",  "\\", "○",  "",   "",   "○",  "/",  "",   "",  ""]  },
    { rowNumber: 10, type: "WS", cells: ["",  "",  "",   "",   "",   "",   "",   "",   "",   "",  ""]  },
    { rowNumber: 11, type: "RS", cells: ["",  "",  "",   "\\", "○",  "",   "",   "",   "",   "",  ""]  },
    { rowNumber: 12, type: "WS", cells: ["",  "",  "",   "",   "",   "",   "",   "",   "",   "",  ""]  },
  ],
  legend: {
    "":   "Knit on RS rows, purl on WS rows",
    "/":  "k2tog — knit two together",
    "\\": "ssk — slip slip knit",
    "○":  "yo — yarn over",
  },
};
