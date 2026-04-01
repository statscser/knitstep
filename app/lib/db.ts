import Dexie, { type Table } from 'dexie';

/** Portable file representation stored in IndexedDB.
 *  base64 strings serialize reliably on all browsers (including iOS Safari),
 *  unlike Blob/File objects which can silently lose data on some iOS versions.
 */
export interface StoredFile {
  data: string;      // base64-encoded file content
  mimeType: string;
}

export interface DbProject {
  id: string;           // string timestamp id, matches page.tsx Project.id
  name: string;
  steps: any[];         // serialized Step[]
  rowCount: number;
  lastUpdated: number;
  originalFile?: Blob | File;                       // legacy v1 — kept for migration read only
  originalFiles?: StoredFile[] | (Blob | File)[];   // v2: Blob/File (legacy); v3+: StoredFile[]
  selectedSize?: string;
  availableSizes?: string[];
  type?: "instruction" | "grid" | "tracker";
  gridData?: any;       // serialized GridData (includes currentRow)
  trackerData?: any;    // serialized TrackerData (includes currentRow)
}

export class KnitStepDatabase extends Dexie {
  projects!: Table<DbProject>;

  constructor() {
    super('KnitStepDB');
    this.version(1).stores({ projects: 'id, name, lastUpdated' });
    this.version(2).stores({ projects: 'id, name, lastUpdated' });
    // v3: no schema change — originalFiles now stores StoredFile[] instead of Blob[]
    this.version(3).stores({ projects: 'id, name, lastUpdated' });
  }
}

export const db = new KnitStepDatabase();
