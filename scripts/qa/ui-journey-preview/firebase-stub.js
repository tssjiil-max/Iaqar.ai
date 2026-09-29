// Browser-side Firebase compat stub for local UI preview only.
// Reads/writes go to the local preview server's in-memory store. Nothing leaves the machine.
(function () {
  const SIGNED_IN = window.__PREVIEW_SIGNED_IN__ !== false;
  const UID = "broker-e2e";
  const SERVER_TS = { __sentinel: "serverTimestamp" };
  function cmp(a, b) { return a === b ? 0 : (a > b ? 1 : -1); }
  function matches(row, [field, op, value]) {
    const v = field.split(".").reduce((o, k) => (o == null ? o : o[k]), row);
    if (op === "==") return v === value;
    if (op === "!=") return v !== value;
    if (op === "in") return Array.isArray(value) && value.includes(v);
    if (op === "not-in") return Array.isArray(value) && !value.includes(v);
    if (op === "array-contains") return Array.isArray(v) && v.includes(value);
    if (op === "array-contains-any") return Array.isArray(v) && v.some((x) => value.includes(x));
    if (op === ">=") return v >= value;
    if (op === "<=") return v <= value;
    if (op === ">") return v > value;
    if (op === "<") return v < value;
    return true;
  }
  function tsWrap(value) { return value; }
  function snap(path, row) {
    const id = path.split("/").pop();
    const data = row ? Object.fromEntries(Object.entries(row).filter(([k]) => k !== "id")) : null;
    return { id, exists: Boolean(row), ref: docRef(path), metadata: { hasPendingWrites: false, fromCache: false },
      data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined), get: (f) => data?.[f] };
  }
  const resolve = (data) => JSON.parse(JSON.stringify(data, (k, v) => (v && v.__sentinel === "serverTimestamp" ? new Date().toISOString() : v)));
  async function write(path, data, merge) {
    await fetch("/__preview/write", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, data: resolve(data), merge: Boolean(merge) }) });
  }
  function poll(load, next) {
    let last = null; let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try { const value = await load(); const key = JSON.stringify(value.__key); if (key !== last) { last = key; next(value); } } catch (e) { /* ignore */ }
      if (!stopped) setTimeout(tick, 800);
    };
    tick();
    return () => { stopped = true; };
  }
  function docRef(path) {
    return {
      id: path.split("/").pop(), path,
      parent: { path: path.split("/").slice(0, -1).join("/") },
      async get() { return snap(path, await (await fetch(`/store/get?path=${encodeURIComponent(path)}`)).json()); },
      collection(name) { return query(`${path}/${name}`); },
      async set(data, opts = {}) { await write(path, data, opts.merge); },
      async update(data) { await write(path, data, true); },
      async delete() { await fetch(`/__preview/delete?path=${encodeURIComponent(path)}`, { method: "POST" }); },
      onSnapshot(next, err) {
        const cb = typeof next === "function" ? next : next?.next;
        return poll(async () => { const s = await this.get(); s.__key = s.data() || null; return s; }, (s) => cb && cb(s));
      }
    };
  }
  function query(path, filters = [], orders = [], lim = null, after = null) {
    return {
      path, id: path.split("/").pop(),
      doc(id) { return docRef(`${path}/${id || Math.random().toString(36).slice(2, 12)}`); },
      async add(data) { const ref = this.doc(); await ref.set(data); return ref; },
      where(f, op, v) { return query(path, [...filters, [String(f), op, v]], orders, lim, after); },
      orderBy(f, dir = "asc") { return query(path, filters, [...orders, [String(f), dir]], lim, after); },
      limit(n) { return query(path, filters, orders, n, after); },
      limitToLast(n) { return query(path, filters, orders, n, after); },
      select() { return query(path, filters, orders, lim, after); },
      startAfter(s) { return query(path, filters, orders, lim, s); },
      async get() {
        let rows = await (await fetch(`/store/list?path=${encodeURIComponent(path)}`)).json();
        rows = rows.filter((row) => filters.every((f) => matches(row, f)));
        for (const [f, dir] of [...orders].reverse()) rows.sort((a, b) => (dir === "desc" ? -1 : 1) * cmp(String(a[f] ?? ""), String(b[f] ?? "")));
        if (after && after.id) { const i = rows.findIndex((r) => r.id === after.id); rows = rows.slice(i + 1); }
        if (lim) rows = rows.slice(0, lim);
        const docs = rows.map((row) => snap(`${path}/${row.id}`, row));
        return { docs, empty: !docs.length, size: docs.length, forEach: (fn) => docs.forEach(fn),
          docChanges: () => docs.map((doc) => ({ type: "added", doc })), metadata: { hasPendingWrites: false, fromCache: false }, __key: rows };
      },
      onSnapshot(next, err) {
        const cb = typeof next === "function" ? next : next?.next;
        return poll(() => this.get(), (s) => cb && cb(s));
      }
    };
  }
  const db = {
    collection: (name) => query(name),
    doc: (p) => docRef(p),
    settings() {}, enableNetwork: async () => {}, disableNetwork: async () => {},
    batch() { const ops = []; return { set(r, d, o) { ops.push(() => r.set(d, o)); return this; }, update(r, d) { ops.push(() => r.update(d)); return this; }, delete(r) { ops.push(() => r.delete()); return this; }, async commit() { for (const op of ops) await op(); } }; },
    async runTransaction(fn) { return fn({ get: (r) => r.get(), set: (r, d, o) => r.set(d, o), update: (r, d) => r.update(d), delete: (r) => r.delete() }); }
  };
  const listeners = [];
  const user = SIGNED_IN ? { uid: UID, email: "broker@preview.local", getIdToken: async () => (await (await fetch("/token")).text()), getIdTokenResult: async () => ({ claims: {} }) } : null;
  const auth = {
    currentUser: user,
    onAuthStateChanged(cb) { listeners.push(cb); setTimeout(() => cb(user), 0); return () => {}; },
    setPersistence: async () => {}, signOut: async () => {},
    signInWithEmailAndPassword: async () => { throw Object.assign(new Error("preview"), { code: "auth/preview" }); }
  };
  const firestore = Object.assign(() => db, {
    FieldValue: { serverTimestamp: () => SERVER_TS, arrayUnion: (...v) => v, arrayRemove: () => [], increment: (n) => n, delete: () => null },
    Timestamp: { now: () => ({ toDate: () => new Date(), toMillis: () => Date.now(), seconds: Math.floor(Date.now() / 1000) }), fromDate: (d) => ({ toDate: () => d, toMillis: () => d.getTime(), seconds: Math.floor(d.getTime() / 1000) }) }
  });
  const app = { name: "[DEFAULT]", options: { projectId: "iaqar-ai-staging" } };
  window.firebase = {
    apps: [app], app: () => app, initializeApp: () => app,
    auth: Object.assign(() => auth, { Auth: { Persistence: { LOCAL: "local", SESSION: "session" } } }),
    firestore
  };
})();
