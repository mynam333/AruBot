import type { DrawingDocument } from '../../../shared/drawing/document.js';

type Draft = { key: string; document: DrawingDocument; savedAt: number };
const TTL = 7 * 24 * 60 * 60 * 1000;

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('arubot-drawing-v2', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readDraft(key: string): Promise<Draft | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('drafts').objectStore('drafts').get(key);
      request.onsuccess = () => resolve(request.result && Date.now() - request.result.savedAt < TTL ? request.result : null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function writeDraft(key: string, document: DrawingDocument | null) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite'), store = tx.objectStore('drafts');
      if (document) store.put({ key, document, savedAt: Date.now() }); else store.delete(key);
      const cursor = store.openCursor();
      cursor.onsuccess = () => { const value = cursor.result; if (!value) return; if (Date.now() - value.value.savedAt >= TTL) value.delete(); value.continue(); };
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
