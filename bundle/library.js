let database;

function openLibrary() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("briefdeck-library", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("decks", { keyPath: "id" });
    request.onsuccess = () => {
      const connection = request.result;
      connection.onversionchange = () => {
        connection.close();
        database = undefined;
      };
      resolve(connection);
    };
    request.onerror = () => reject(request.error);
  }).catch(error => {
    database = undefined;
    throw error;
  });
  return database;
}

async function transact(mode, operation) {
  const connection = await openLibrary();
  return new Promise((resolve, reject) => {
    const transaction = connection.transaction("decks", mode);
    const request = operation(transaction.objectStore("decks"));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error);
  });
}

export const browserLibrary = {
  list: () => transact("readonly", store => store.getAll()),
  save: record => transact("readwrite", store => store.put(record)),
  remove: id => transact("readwrite", store => store.delete(id))
};

export function annaLibrary(getRuntime) {
  const prefix = "briefdeck/drafts/";
  const versions = new Map();
  return {
    async list() {
      const { storage } = await getRuntime();
      const records = [];
      let cursor;
      do {
        const result = await storage.list({ prefix, ...(cursor ? { cursor } : {}) });
        for (const item of result.items) {
          if (!item.metadata || item.metadata.schema !== 1) continue;
          const id = item.key.slice(prefix.length);
          versions.set(id, item.etag);
          records.push({ id, ...item.metadata });
        }
        cursor = result.next_cursor;
      } while (cursor);
      return records;
    },
    async get(id) {
      const { storage } = await getRuntime();
      const result = await storage.get({ key: prefix + id });
      if (!result.exists || !result.value?.deck?.slides?.length) throw new Error("稿件不存在");
      versions.set(id, result.etag);
      return result.value;
    },
    async save(record) {
      const { storage } = await getRuntime();
      const version = versions.get(record.id);
      const result = await storage.set({
        key: prefix + record.id,
        value: record,
        metadata: { schema: 1, title: record.title, pageCount: record.pageCount, updatedAt: record.updatedAt },
        ...(version ? { if_match: version } : {})
      });
      versions.set(record.id, result.etag);
    },
    async remove(id) {
      const { storage } = await getRuntime();
      const version = versions.get(id);
      try {
        await storage.delete({ key: prefix + id, ...(version ? { if_match: version } : {}) });
      } catch (error) {
        if (![error?.code, error?.data?.code, error?.data?.errorCode].includes("not_found")) throw error;
      }
      versions.delete(id);
    }
  };
}

export function snapshotDraft(id, deck, style) {
  const slides = deck.slides.map(slide => ({
    ...slide,
    ...(slide.pictures ? {
      pictures: slide.pictures.map(({ name, width, height, data, frame }) => ({ name, width, height, data, frame }))
    } : {})
  }));
  return structuredClone({
    id, deck: { slides }, style, updatedAt: Date.now(),
    title: slides[0].title, pageCount: slides.length
  });
}

async function restorePicture(picture) {
  const [header, encoded] = picture.data.split(",");
  const type = header.match(/^data:(image\/(?:png|jpeg));base64$/)?.[1];
  if (!type || !encoded) throw new Error("图片数据无法读取");
  const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type }));
  try {
    const preview = document.createElement("canvas");
    preview.width = bitmap.width;
    preview.height = bitmap.height;
    preview.getContext("2d").drawImage(bitmap, 0, 0);
    return { ...picture, preview };
  } finally {
    bitmap.close();
  }
}

export async function restoreDraft(record) {
  const deck = structuredClone(record.deck);
  for (const slide of deck.slides) {
    if (slide.pictures) slide.pictures = await Promise.all(slide.pictures.map(restorePicture));
  }
  return deck;
}
