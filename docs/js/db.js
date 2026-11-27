// IndexedDB com migrações versionadas. Para mudar o formato: aumente DB_VERSION e
// acrescente MIGRATIONS[n]. Migrações só ADICIONAM/transformam; nunca apagam dados do usuário.
export const DB_NAME = 'gastos-viagem';
export const DB_VERSION = 2;

const MIGRATIONS = {
  1(db) {
    db.createObjectStore('meta', { keyPath: 'key' });
    db.createObjectStore('entries', { keyPath: 'id' }).createIndex('date', 'date');
    db.createObjectStore('expenses', { keyPath: 'id' }).createIndex('date', 'date');
  },
  2(db) { // Fase 2: cronograma. Só ADICIONA um store; gastos e entradas continuam como estão.
    db.createObjectStore('activities', { keyPath: 'id' }).createIndex('date', 'date');
  },
};

let dbPromise = null;

export function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        for (let v = e.oldVersion + 1; v <= e.newVersion; v++) MIGRATIONS[v](req.result, req.transaction);
      };
      req.onsuccess = () => {
        const d = req.result;
        d.onversionchange = () => d.close();
        resolve(d);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Banco bloqueado por outra aba/janela do app.'));
    }).catch((err) => { dbPromise = null; throw err; });
  }
  return dbPromise;
}

async function write(stores, fn) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(stores, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transação cancelada.'));
    fn(tx);
  });
}

export async function loadAll() {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(['meta', 'entries', 'expenses', 'activities'], 'readonly');
    const r = {};
    for (const s of ['meta', 'entries', 'expenses', 'activities']) {
      tx.objectStore(s).getAll().onsuccess = (e) => { r[s] = e.target.result; };
    }
    tx.oncomplete = () => {
      const m = Object.fromEntries(r.meta.map((x) => [x.key, x.value]));
      resolve({ trip: m.trip ?? null, people: m.people ?? [], entries: r.entries, expenses: r.expenses, activities: r.activities });
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Leitura cancelada.'));
  });
}

export const saveTrip = (trip, people) => write(['meta'], (tx) => {
  const s = tx.objectStore('meta');
  s.put({ key: 'trip', value: trip });
  s.put({ key: 'people', value: people });
});

export const putEntry = (e) => write(['entries'], (tx) => tx.objectStore('entries').put(e));
export const deleteEntry = (id) => write(['entries'], (tx) => tx.objectStore('entries').delete(id));
export const putExpense = (x) => write(['expenses'], (tx) => tx.objectStore('expenses').put(x));
export const deleteExpense = (id) => write(['expenses'], (tx) => tx.objectStore('expenses').delete(id));

/** Grava várias atividades de uma vez (importação), numa única transação. */
export const putActivities = (list) => write(['activities'], (tx) => list.forEach((a) => tx.objectStore('activities').put(a)));
export const putActivity = (a) => write(['activities'], (tx) => tx.objectStore('activities').put(a));
/** Exclui a atividade e, na mesma transação, remove o vínculo dos gastos (que continuam lançados). */
export const deleteActivity = (id, unlinkedExpenses) => write(['activities', 'expenses'], (tx) => {
  tx.objectStore('activities').delete(id);
  const ex = tx.objectStore('expenses');
  unlinkedExpenses.forEach((x) => ex.put(x));
});

/** Substitui TUDO numa única transação: se algo falhar, nada muda. */
export const replaceAll = ({ trip, people, entries, expenses, activities }) =>
  write(['meta', 'entries', 'expenses', 'activities'], (tx) => {
    const meta = tx.objectStore('meta');
    const en = tx.objectStore('entries');
    const ex = tx.objectStore('expenses');
    const ac = tx.objectStore('activities');
    meta.clear(); en.clear(); ex.clear(); ac.clear();
    meta.put({ key: 'trip', value: trip });
    meta.put({ key: 'people', value: people });
    entries.forEach((e) => en.put(e));
    expenses.forEach((x) => ex.put(x));
    activities.forEach((a) => ac.put(a));
  });
