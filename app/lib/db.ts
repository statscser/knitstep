import Dexie, { type Table } from 'dexie';

export interface DbProject {
  id: string;           // string timestamp id, matches page.tsx Project.id
  name: string;
  steps: any[];         // serialized Step[]
  rowCount: number;
  lastUpdated: number;
  originalFile?: Blob | File;
  selectedSize?: string;       // user's last-chosen size filter for this project
  availableSizes?: string[];   // cached list of size labels detected in the steps
}

export class KnitStepDatabase extends Dexie {
  projects!: Table<DbProject>;

  constructor() {
    super('KnitStepDB');
    // id is the primary key; name and lastUpdated are indexed for future queries
    this.version(1).stores({ projects: 'id, name, lastUpdated' });
  }
}

export const db = new KnitStepDatabase();
