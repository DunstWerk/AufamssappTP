// Schlanker Promise-basierter IndexedDB-Wrapper, keine Library.
const DB_NAME = 'gaeb-aufmass';
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('originalFiles')) {
        db.createObjectStore('originalFiles', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('positions')) {
        db.createObjectStore('positions', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDb().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function wrapRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function put(storeName, value) {
  const store = await tx(storeName, 'readwrite');
  return wrapRequest(store.put(value));
}

export async function get(storeName, key) {
  const store = await tx(storeName, 'readonly');
  return wrapRequest(store.get(key));
}

export async function getAll(storeName) {
  const store = await tx(storeName, 'readonly');
  return wrapRequest(store.getAll());
}

export async function del(storeName, key) {
  const store = await tx(storeName, 'readwrite');
  return wrapRequest(store.delete(key));
}

export async function clearStore(storeName) {
  const store = await tx(storeName, 'readwrite');
  return wrapRequest(store.clear());
}

export async function clearAll() {
  await clearStore('originalFiles');
  await clearStore('positions');
  await clearStore('meta');
}

// --- Domänenspezifische Helfer -------------------------------------------

export async function saveOriginalFile(id, filename, arrayBuffer, encoding) {
  return put('originalFiles', {
    id,
    filename,
    importedAt: Date.now(),
    encoding: encoding || 'UTF-8',
    bytes: arrayBuffer,
  });
}

export async function loadOriginalFile(id) {
  return get('originalFiles', id);
}

export async function savePosition(record) {
  return put('positions', { ...record, updatedAt: Date.now() });
}

export async function loadAllPositions() {
  const all = await getAll('positions');
  const map = new Map();
  for (const rec of all) map.set(rec.id, rec);
  return map;
}

export async function saveMeta(meta) {
  return put('meta', { key: 'app', ...meta });
}

export async function loadMeta() {
  return get('meta', 'app');
}
