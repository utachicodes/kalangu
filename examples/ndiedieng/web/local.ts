/**
 * The website's demo: the whole prototype in the visitor's browser. Kalangu's
 * agent, the commune's SQLite database and the API run here; the pages talk
 * to them through `api`, exactly as they talk to server.ts over HTTP.
 *
 * The demo is kept in this browser (IndexedDB) after every change, so the
 * dashboard and the assistant's page see the same reports, and a reload
 * changes nothing. Nothing leaves the browser; `reset` starts over.
 */

import { silentLogger } from "@kalangu/core";
import { createNdiediengAgent } from "../src/agent.js";
import { createApp } from "../src/app.js";
import { geminiAssistant, ruleAssistant } from "../src/assistant.js";
import { geminiClassifier, keywordClassifier } from "../src/classify.js";
import { remoteGemini } from "../src/gemini.js";
import { createCommune } from "../src/db.js";
import { loadSqlJs, sqlJsDb } from "./sqljs.js";

export type Api = (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>;

type Inbox = Array<{ from: string; text: string; at: Date }>;
interface Saved {
  version: number;
  savedAt: number;
  db: Uint8Array;
  inboxes: Array<[string, Array<{ from: string; text: string; at: string }>]>;
}

/** Bumped when the schema or the generated territory changes: older copies are dropped. */
const VERSION = 2;
/** A copy older than this starts over, so the demo's dates stay current. */
const MAX_AGE = 3 * 24 * 60 * 60 * 1000;
const STORE = "demo";
const KEY = "state";

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("ndiedieng", 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const idb = await openStore();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = idb.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    idb.close();
  }
}
async function load(): Promise<Saved | null> {
  try {
    const saved = (await withStore("readonly", (s) => s.get(KEY))) as Saved | undefined;
    if (!saved || saved.version !== VERSION || Date.now() - saved.savedAt > MAX_AGE) return null;
    return saved;
  } catch {
    return null; // private browsing, storage blocked: the demo still runs, just not kept
  }
}

/** The website's serverless function, which holds the Gemini key. */
const GEMINI_URL = "/api/ndiedieng/gemini";

/** True when the function answers and has a key; never waits long. */
async function geminiAvailable(): Promise<boolean> {
  try {
    const res = await fetch(GEMINI_URL, { signal: AbortSignal.timeout(2500) });
    const body = (await res.json()) as { available?: boolean };
    return res.ok && body.available === true;
  } catch {
    return false; // no function here (a copy of the page, a local server): the rules
  }
}

/** Forgets this browser's copy of the demo; the next page load starts fresh. */
export async function reset(): Promise<void> {
  try {
    await withStore("readwrite", (s) => s.delete(KEY));
  } catch {
    // nothing kept, nothing to forget
  }
}

export async function boot(): Promise<{ api: Api; restored: boolean }> {
  const [SQL, saved] = await Promise.all([loadSqlJs(), load()]);
  let db = sqlJsDb(SQL, saved?.db);
  let commune;
  try {
    commune = createCommune(db, { existing: Boolean(saved) });
    if (saved) commune.counts(); // a copy that does not read is replaced, not trusted
  } catch {
    db = sqlJsDb(SQL);
    commune = createCommune(db);
  }
  const inboxes = new Map<string, Inbox>(
    (saved?.inboxes ?? []).map(([tel, msgs]) => [tel, msgs.map((m) => ({ ...m, at: new Date(m.at) }))]),
  );
  // Gemini when the website's function has a key; the rules otherwise, and
  // whenever a call fails.
  const gemini = await geminiAvailable();
  const call = gemini ? remoteGemini(GEMINI_URL) : null;
  const classifier = call ? geminiClassifier({ call, warn: () => {} }) : keywordClassifier();
  const agent = createNdiediengAgent({ commune, classifier, channels: [], logger: silentLogger });
  const app = createApp({
    commune,
    agent,
    classifier,
    inboxes,
    assistant: call ? geminiAssistant(commune, { call }) : ruleAssistant(commune),
    mode: call
      ? "dans votre navigateur · classement et assistant par Gemini"
      : "dans votre navigateur · classement par mots-clés · assistant par règles",
  });

  const save = async () => {
    const copy: Saved = {
      version: VERSION,
      savedAt: Date.now(),
      db: db.bytes(),
      inboxes: [...inboxes].map(([tel, msgs]) => [tel, msgs.map((m) => ({ from: m.from, text: m.text, at: m.at.toISOString() }))]),
    };
    try {
      await withStore("readwrite", (s) => s.put(copy, KEY));
    } catch {
      // not kept in this browser; the demo goes on
    }
  };

  const api: Api = async (method, path, body) => {
    const res = await app(
      new Request(new URL(path, "https://ndiedieng.local/"), {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
      }),
    );
    // Saved before answering, so a page opened next sees the change.
    if (method !== "GET" && path !== "/api/ask" && res.status < 400) await save();
    return { status: res.status, body: await res.json() };
  };
  return { api, restored: Boolean(saved) };
}
