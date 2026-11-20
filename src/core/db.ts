// IndexedDB 薄封装（TypedArray 可结构化克隆，直接存） =======================

const DB_NAME = 'comb-inspect-db';
const DB_VERSION = 2;
export const STORES = {
  kv: 'kv',
  yards: 'yards',
  hives: 'hives',
  frames: 'frames',
  combs: 'combs',
  inspections: 'inspections',
  history: 'history',
} as const;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const ensureStore = (name: string, opts?: IDBObjectStoreParameters): IDBObjectStore => {
        if (db.objectStoreNames.contains(name)) {
          return req.transaction!.objectStore(name);
        }
        return db.createObjectStore(name, opts);
      };
      ensureStore(STORES.kv);
      ensureStore(STORES.yards, { keyPath: 'id' });
      ensureStore(STORES.hives, { keyPath: 'id' });
      const frames = ensureStore(STORES.frames, { keyPath: 'id' });
      if (!frames.indexNames.contains('hiveId')) frames.createIndex('hiveId', 'hiveId');
      const combs = ensureStore(STORES.combs, { keyPath: 'key' });
      if (!combs.indexNames.contains('frameId')) combs.createIndex('frameId', 'frameId');
      const insp = ensureStore(STORES.inspections, { keyPath: 'id' });
      if (!insp.indexNames.contains('hiveId')) insp.createIndex('hiveId', 'hiveId');
      ensureStore(STORES.history, { keyPath: 'hiveId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

export function idbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  return tx<T | undefined>(store, 'readonly', (s) => s.get(key));
}

export function idbGetAll<T>(store: string): Promise<T[]> {
  return tx<T[]>(store, 'readonly', (s) => s.getAll());
}

export function idbGetAllByIndex<T>(store: string, index: string, value: IDBValidKey): Promise<T[]> {
  return openDb().then(
    (db) =>
      new Promise<T[]>((resolve, reject) => {
        const t = db.transaction(store, 'readonly');
        const req = t.objectStore(store).index(index).getAll(value);
        req.onsuccess = () => resolve(req.result as T[]);
        req.onerror = () => reject(req.error);
      }),
  );
}

export function idbPut<T>(store: string, value: T, key?: IDBValidKey): Promise<IDBValidKey> {
  return tx<IDBValidKey>(store, 'readwrite', (s) => s.put(value as object, key));
}

export function idbBulkPut<T>(store: string, values: T[]): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(store, 'readwrite');
        const s = t.objectStore(store);
        for (const v of values) s.put(v as object);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      }),
  );
}

export function idbDelete(store: string, key: IDBValidKey): Promise<void> {
  return tx(store, 'readwrite', (s) => s.delete(key));
}

export function idbClear(store: string): Promise<void> {
  return tx(store, 'readwrite', (s) => s.clear());
}

export async function idbGetKV<T>(key: string): Promise<T | undefined> {
  return idbGet<T>(STORES.kv, key);
}

export async function idbSetKV(key: string, value: unknown): Promise<void> {
  await idbPut(STORES.kv, value, key);
}
