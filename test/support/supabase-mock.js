/**
 * Chainable, awaitable stand-in for the supabase-js client.
 *
 * Toolber imports a module-level singleton (`src/lib/supabaseClient.js`) rather
 * than injecting a client, so tests swap the whole module out via the resolve
 * hook in `mock-supabase.mjs` and configure behaviour with `setSupabaseMock()`
 * from `supabase-double.js`. This file is the behaviour half of that pair.
 */

/**
 * Records every chained method call and resolves to the configured `result`
 * when awaited. Covers the subset of the query builder `src/pages/*` uses:
 * select / insert / update / delete / eq / in / order / limit / textSearch /
 * single / maybeSingle.
 */
export class MockQueryBuilder {
  constructor(result = { data: null, error: null }) {
    this.calls = [];
    this.result = result;
  }

  #record(method, args) {
    this.calls.push({ method, args });
    return this;
  }

  select = (...args) => this.#record("select", args);
  insert = (...args) => this.#record("insert", args);
  update = (...args) => this.#record("update", args);
  delete = (...args) => this.#record("delete", args);
  upsert = (...args) => this.#record("upsert", args);
  eq = (...args) => this.#record("eq", args);
  neq = (...args) => this.#record("neq", args);
  in = (...args) => this.#record("in", args);
  is = (...args) => this.#record("is", args);
  gte = (...args) => this.#record("gte", args);
  lte = (...args) => this.#record("lte", args);
  order = (...args) => this.#record("order", args);
  limit = (...args) => this.#record("limit", args);
  range = (...args) => this.#record("range", args);
  textSearch = (...args) => this.#record("textSearch", args);

  /** True if the chain ever called `method` (optionally with these args). */
  called(method) {
    return this.calls.some((c) => c.method === method);
  }

  /** Args of the first call to `method`, or undefined. */
  argsFor(method) {
    return this.calls.find((c) => c.method === method)?.args;
  }

  single() {
    this.calls.push({ method: "single", args: [] });
    return Promise.resolve(this.result);
  }

  maybeSingle() {
    this.calls.push({ method: "maybeSingle", args: [] });
    return Promise.resolve(this.result);
  }

  // biome-ignore lint/suspicious/noThenProperty: required for the chain-then-await pattern Supabase queries use
  then(onfulfilled, onrejected) {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

const EMPTY = { data: null, error: null };

/**
 * Build a stub client.
 *
 * @param {object} config
 * @param {(table: string) => MockQueryBuilder} [config.from]
 *   Per-table builder factory. Prefer `tables` unless a test needs to vary the
 *   result across repeated reads of the same table.
 * @param {Record<string, {data?: unknown, error?: unknown}>} [config.tables]
 *   Simple table -> result map.
 * @param {(name: string, args?: object) => Promise<object>} [config.rpc]
 * @param {Record<string, {data?: unknown, error?: unknown}>} [config.rpcs]
 * @param {object|null} [config.session] Session returned by auth.getSession().
 * @param {(method: string, args?: object) => Promise<object>} [config.auth]
 */
export function makeMockClient(config = {}) {
  const fromCalls = [];
  const rpcCalls = [];
  const authCalls = [];
  const authListeners = [];

  const resultFor = (table) => config.tables?.[table] ?? EMPTY;

  const client = {
    from(table) {
      const builder = config.from
        ? config.from(table)
        : new MockQueryBuilder({ data: null, error: null, ...resultFor(table) });
      fromCalls.push({ table, builder });
      return builder;
    },

    rpc(name, args) {
      rpcCalls.push({ name, args });
      if (config.rpc) return Promise.resolve(config.rpc(name, args));
      return Promise.resolve({ data: null, error: null, ...(config.rpcs?.[name] ?? {}) });
    },

    auth: {
      getSession() {
        return Promise.resolve({ data: { session: config.session ?? null }, error: null });
      },
      getUser() {
        return Promise.resolve({ data: { user: config.session?.user ?? null }, error: null });
      },
      onAuthStateChange(callback) {
        authListeners.push(callback);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      signUp(args) {
        authCalls.push({ method: "signUp", args });
        return Promise.resolve(
          config.auth?.("signUp", args) ?? { data: { session: null, user: null }, error: null }
        );
      },
      signInWithPassword(args) {
        authCalls.push({ method: "signInWithPassword", args });
        return Promise.resolve(config.auth?.("signInWithPassword", args) ?? { data: {}, error: null });
      },
      signOut() {
        authCalls.push({ method: "signOut" });
        return Promise.resolve(config.auth?.("signOut") ?? { error: null });
      },
    },

    storage: {
      from(bucket) {
        return {
          upload(path) {
            return Promise.resolve({ data: { path }, error: null });
          },
          getPublicUrl(path) {
            return { data: { publicUrl: `https://example.test/${bucket}/${path}` } };
          },
        };
      },
    },
  };

  return {
    client,
    fromCalls,
    rpcCalls,
    authCalls,
    /** Tables touched, in order. */
    tablesTouched: () => fromCalls.map((c) => c.table),
    /** The builder used for the nth read of `table` (default: first). */
    builderFor(table, index = 0) {
      return fromCalls.filter((c) => c.table === table)[index]?.builder;
    },
    /**
     * The first builder for `table` that called `method`. Use this when a screen
     * touches one table several times (read → write → re-read) and the
     * interesting call is the write.
     */
    findBuilder(table, method) {
      return fromCalls.find((c) => c.table === table && c.builder.called(method))?.builder;
    },
    /** Fire a simulated auth state change at every registered listener. */
    emitAuthChange(event, session) {
      for (const cb of authListeners) cb(event, session);
    },
  };
}
