// Browser Firebase compat stub for the Office OS local harness only.
// Reads poll the harness in-memory store; writes go through /harness/write, which
// only accepts the client writes the real Firestore rules allow. Not shipped.
(function () {
  const SERVER_TS = { __sentinel: "serverTimestamp" };
  const uidKey = "harness.uid";
  const getUid = () => { try { return localStorage.getItem(uidKey) || ""; } catch (_) { return ""; } };
  function cmp(a, b) { return a === b ? 0 : (a > b ? 1 : -1); }
  function matches(row, [field, op, value]) {
    const v = field.split(".").reduce((o, k) => (o == null ? o : o[k]), row);
    if (op === "==") return v === value;
    if (op === "!=") return v !== value;
    if (op === "in") return Array.isArray(value) && value.includes(v);
    if (op === "array-contains") return Array.isArray(v) && v.includes(value);
    if (op === ">=") return v >= value;
    if (op === "<=") return v <= value;
    if (op === ">") return v > value;
    if (op === "<") return v < value;
    return true;
  }
  function snap(path, row) {
    const id = path.split("/").pop();
    const data = row ? Object.fromEntries(Object.entries(row).filter(([k]) => k !== "id")) : null;
    return { id, exists: Boolean(row), ref: docRef(path), metadata: { hasPendingWrites: false, fromCache: false }, data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined), get: (f) => data?.[f] };
  }
  const resolve = (data) => JSON.parse(JSON.stringify(data, (k, v) => (v && v.__sentinel === "serverTimestamp" ? new Date().toISOString() : v)));
  async function write(path, data, merge) {
    const r = await fetch("/harness/write", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, data: resolve(data), merge: Boolean(merge) }) });
    if (!r.ok) throw Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
  }
  async function remove(path) {
    const r = await fetch("/harness/write", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, delete: true }) });
    if (!r.ok) throw Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
  }
  function poll(load, next) {
    let last = null; let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try { const value = await load(); const key = JSON.stringify(value.__key); if (key !== last) { last = key; next(value); } } catch (_) { /* ignore */ }
      if (!stopped) setTimeout(tick, 500);
    };
    tick();
    return () => { stopped = true; };
  }
  function docRef(path) {
    return {
      id: path.split("/").pop(), path,
      async get() { return snap(path, await (await fetch(`/store/get?path=${encodeURIComponent(path)}`)).json()); },
      collection(name) { return query(`${path}/${name}`); },
      async set(data, opts = {}) { await write(path, data, opts.merge); },
      async update(data) { await write(path, data, true); },
      async delete() { await remove(path); },
      onSnapshot(next) { return poll(async () => { const s = await this.get(); s.__key = s.data() || null; return s; }, (s) => next(s)); }
    };
  }
  function query(path, filters = [], orders = [], lim = null) {
    return {
      path,
      doc(id) { return docRef(`${path}/${id || Math.random().toString(36).slice(2, 14)}`); },
      where(f, op, v) { return query(path, [...filters, [String(f), op, v]], orders, lim); },
      orderBy(f, dir = "asc") { return query(path, filters, [...orders, [String(f), dir]], lim); },
      limit(n) { return query(path, filters, orders, n); },
      async get() {
        let rows = await (await fetch(`/store/list?path=${encodeURIComponent(path)}`)).json();
        rows = rows.filter((row) => filters.every((f) => matches(row, f)));
        for (const [f, dir] of [...orders].reverse()) rows.sort((a, b) => (dir === "desc" ? -1 : 1) * cmp(String(a[f] ?? ""), String(b[f] ?? "")));
        if (lim) rows = rows.slice(0, lim);
        const docs = rows.map((row) => snap(`${path}/${row.id}`, row));
        return { docs, empty: !docs.length, size: docs.length, forEach: (fn) => docs.forEach(fn), __key: rows };
      },
      onSnapshot(next) { return poll(() => this.get(), (s) => next(s)); }
    };
  }
  // Minimal transaction: reads go first, writes are applied in order at the end (enough for the name claim).
  async function runTransaction(fn) {
    const writes = [];
    const tx = {
      get: (ref) => ref.get(),
      set: (ref, data, opts) => { writes.push(() => ref.set(data, opts)); return tx; },
      delete: (ref) => { writes.push(() => ref.delete()); return tx; }
    };
    const result = await fn(tx);
    for (const apply of writes) await apply();
    return result;
  }
  const db = { collection: (name) => query(name), doc: (p) => docRef(p), settings() {}, enableNetwork: async () => {}, runTransaction };
  const listeners = [];
  const makeUser = (uid) => (uid ? { uid, email: `${uid}@harness.local`, getIdToken: async () => (await (await fetch(`/harness/token?uid=${encodeURIComponent(uid)}`)).text()), getIdTokenResult: async () => ({ claims: {} }) } : null);
  const auth = {
    currentUser: makeUser(getUid()),
    onAuthStateChanged(cb) { listeners.push(cb); setTimeout(() => cb(auth.currentUser), 0); return () => {}; },
    setPersistence: async () => {},
    async signOut() { try { localStorage.removeItem(uidKey); } catch (_) { /* ignore */ } auth.currentUser = null; listeners.forEach((cb) => cb(null)); },
    async signInWithEmailAndPassword(email, password) {
      const r = await fetch(`/harness/signin?email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`);
      if (!r.ok) throw Object.assign(new Error("wrong password"), { code: "auth/wrong-password" });
      const { uid } = await r.json();
      try { localStorage.setItem(uidKey, uid); } catch (_) { /* ignore */ }
      auth.currentUser = makeUser(uid);
      listeners.forEach((cb) => cb(auth.currentUser));
      return { user: auth.currentUser };
    }
  };
  const firestore = Object.assign(() => db, { FieldValue: { serverTimestamp: () => SERVER_TS } });
  const app = { name: "[DEFAULT]", options: { projectId: "demo-iaqar" } };
  window.firebase = { apps: [app], app: () => app, auth: Object.assign(() => auth, { Auth: { Persistence: { LOCAL: "local" } } }), firestore };
})();
