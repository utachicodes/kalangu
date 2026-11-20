/**
 * The commune's database: villages, chiefs, equipments, territorial records
 * and the reports that come in by USSD, SMS or voice. Plain SQL over `SqlDb`,
 * so the same code runs on Node's SQLite (nodeSql.ts) and in the browser
 * (web/sqljs.ts).
 */

import { generateTerritory, type EquipmentType, type Territory } from "./data.js";
import type { SqlDb, SqlRow } from "./sql.js";

export type Categorie = EquipmentType | "naissance" | "deces" | "autre";
export type Urgence = "haute" | "moyenne" | "basse";
export type Statut = "nouveau" | "a_verifier" | "en_cours" | "resolu";
export type Canal = "ussd" | "sms" | "vocal";

export interface Signalement {
  code: string;
  villageId: number;
  village: string;
  telephone: string;
  categorie: Categorie;
  equipementId: number | null;
  equipement: string | null;
  urgence: Urgence;
  description: string;
  canal: Canal;
  statut: Statut;
  confiance: number;
  creeLe: string;
  resoluLe: string | null;
}

export const SCHEMA = `
CREATE TABLE villages (
  id INTEGER PRIMARY KEY,
  nom TEXT NOT NULL,
  population INTEGER NOT NULL
);
CREATE TABLE chefs (
  telephone TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  village_id INTEGER NOT NULL REFERENCES villages(id)
);
CREATE TABLE equipements (
  id INTEGER PRIMARY KEY,
  village_id INTEGER NOT NULL REFERENCES villages(id),
  type TEXT NOT NULL,         -- eau, sante, ecole, energie, piste
  nature TEXT NOT NULL,       -- forage, borne-fontaine, poste de sante, ...
  nom TEXT NOT NULL,
  etat TEXT NOT NULL          -- fonctionnel, en panne
);
CREATE TABLE fiches (
  id INTEGER PRIMARY KEY,
  village_id INTEGER NOT NULL REFERENCES villages(id),
  categorie TEXT NOT NULL,    -- village, equipement, association, ecole, marche, ...
  intitule TEXT NOT NULL,
  etat TEXT NOT NULL,
  population_desservie INTEGER NOT NULL,
  derniere_visite TEXT NOT NULL -- YYYY-MM-DD
);
CREATE TABLE signalements (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,  -- S-0001
  village_id INTEGER NOT NULL REFERENCES villages(id),
  telephone TEXT NOT NULL,
  categorie TEXT NOT NULL,    -- eau, sante, ecole, energie, piste, naissance, deces, autre
  equipement_id INTEGER REFERENCES equipements(id),
  urgence TEXT NOT NULL,      -- haute, moyenne, basse
  description TEXT NOT NULL,
  canal TEXT NOT NULL,        -- ussd, sms, vocal
  statut TEXT NOT NULL,       -- nouveau, a_verifier, en_cours, resolu
  confiance REAL NOT NULL,    -- 1 for a USSD menu choice; the classifier's own for SMS
  cree_le TEXT NOT NULL,      -- ISO date and time
  resolu_le TEXT
);`;

export interface NewSignalement {
  villageId: number;
  telephone: string;
  categorie: Categorie;
  equipementId?: number | null;
  urgence: Urgence;
  description: string;
  canal: Canal;
  statut?: Statut;
  confiance?: number;
  creeLe?: string;
}

export interface CommuneOptions {
  territory?: Territory;
  now?: () => Date;
  /** A month of past reports, so the dashboard is not empty. Default true. */
  history?: boolean;
}

export interface Commune {
  /** Runs a query that cannot change anything, for the assistant. */
  readOnly(sql: string): { columns: string[]; rows: SqlRow[] };
  chefByPhone(telephone: string): { telephone: string; nom: string; villageId: number; village: string } | null;
  chefs(): Array<{ telephone: string; village: string }>;
  equipementFor(villageId: number, nature: string): { id: number; nom: string } | null;
  equipementsOf(villageId: number): Array<{ id: number; type: string; nature: string; nom: string }>;
  addSignalement(s: NewSignalement): Signalement;
  signalement(code: string): Signalement | null;
  signalements(filter?: { statut?: Statut; categorie?: Categorie }): Signalement[];
  setStatut(code: string, statut: Statut, change?: { categorie?: Categorie; urgence?: Urgence }): Signalement | null;
  counts(): Record<Statut, number> & { haute: number };
  close(): void;
}

const ROW = `SELECT s.code, s.village_id, v.nom AS village, s.telephone, s.categorie, s.equipement_id, e.nom AS equipement,
  s.urgence, s.description, s.canal, s.statut, s.confiance, s.cree_le, s.resolu_le
  FROM signalements s JOIN villages v ON v.id = s.village_id LEFT JOIN equipements e ON e.id = s.equipement_id`;

interface Row {
  code: string;
  village_id: number;
  village: string;
  telephone: string;
  categorie: Categorie;
  equipement_id: number | null;
  equipement: string | null;
  urgence: Urgence;
  description: string;
  canal: Canal;
  statut: Statut;
  confiance: number;
  cree_le: string;
  resolu_le: string | null;
}

const toSignalement = (r: Row): Signalement => ({
  code: r.code,
  villageId: r.village_id,
  village: r.village,
  telephone: r.telephone,
  categorie: r.categorie,
  equipementId: r.equipement_id,
  equipement: r.equipement,
  urgence: r.urgence,
  description: r.description,
  canal: r.canal,
  statut: r.statut,
  confiance: r.confiance,
  creeLe: r.cree_le,
  resoluLe: r.resolu_le,
});

/** Fills `db` with the fictitious territory and, by default, a month of past reports. */
export function createCommune(db: SqlDb, options: CommuneOptions = {}): Commune {
  const now = options.now ?? (() => new Date());
  db.exec(SCHEMA);
  const t = options.territory ?? generateTerritory();

  db.exec("BEGIN");
  for (const v of t.villages) db.run("INSERT INTO villages (id, nom, population) VALUES (?, ?, ?)", v.id, v.nom, v.population);
  for (const c of t.chefs) db.run("INSERT INTO chefs (telephone, nom, village_id) VALUES (?, ?, ?)", c.telephone, c.nom, c.villageId);
  for (const e of t.equipements) {
    db.run("INSERT INTO equipements (id, village_id, type, nature, nom, etat) VALUES (?, ?, ?, ?, ?, ?)", e.id, e.villageId, e.type, e.nature, e.nom, e.etat);
  }
  for (const f of t.fiches) {
    db.run(
      "INSERT INTO fiches (id, village_id, categorie, intitule, etat, population_desservie, derniere_visite) VALUES (?, ?, ?, ?, ?, ?, ?)",
      f.id, f.villageId, f.categorie, f.intitule, f.etat, f.populationDesservie, f.derniereVisite,
    );
  }
  db.exec("COMMIT");

  const commune: Commune = {
    readOnly: (sql) => db.readOnly(sql),
    chefByPhone(telephone) {
      const row = db.get(
        "SELECT c.telephone, c.nom, c.village_id AS villageId, v.nom AS village FROM chefs c JOIN villages v ON v.id = c.village_id WHERE c.telephone = ?",
        telephone,
      ) as { telephone: string; nom: string; villageId: number; village: string } | undefined;
      return row ?? null;
    },
    chefs() {
      return db.all("SELECT c.telephone, v.nom AS village FROM chefs c JOIN villages v ON v.id = c.village_id ORDER BY v.id") as Array<{
        telephone: string;
        village: string;
      }>;
    },
    equipementFor(villageId, nature) {
      const row = db.get(
        "SELECT id, nom FROM equipements WHERE village_id = ? AND nature = ? ORDER BY etat = 'en panne' DESC, id LIMIT 1",
        villageId,
        nature,
      ) as { id: number; nom: string } | undefined;
      return row ?? null;
    },
    equipementsOf(villageId) {
      return db.all("SELECT id, type, nature, nom FROM equipements WHERE village_id = ? ORDER BY id", villageId) as Array<{
        id: number;
        type: string;
        nature: string;
        nom: string;
      }>;
    },
    addSignalement(s) {
      const id = (db.get("SELECT COALESCE(MAX(id), 0) + 1 AS n FROM signalements") as { n: number }).n;
      const code = `S-${String(id).padStart(4, "0")}`;
      db.run(
        `INSERT INTO signalements
    (code, village_id, telephone, categorie, equipement_id, urgence, description, canal, statut, confiance, cree_le)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        code,
        s.villageId,
        s.telephone,
        s.categorie,
        s.equipementId ?? null,
        s.urgence,
        s.description,
        s.canal,
        s.statut ?? "nouveau",
        s.confiance ?? 1,
        s.creeLe ?? now().toISOString(),
      );
      if (s.equipementId && (s.statut ?? "nouveau") !== "resolu") {
        db.run("UPDATE equipements SET etat = 'en panne' WHERE id = ?", s.equipementId);
      }
      return commune.signalement(code)!;
    },
    signalement(code) {
      const row = db.get(`${ROW} WHERE s.code = ?`, code.trim().toUpperCase()) as Row | undefined;
      return row ? toSignalement(row) : null;
    },
    signalements(filter = {}) {
      const where: string[] = [];
      const params: string[] = [];
      if (filter.statut) {
        where.push("s.statut = ?");
        params.push(filter.statut);
      }
      if (filter.categorie) {
        where.push("s.categorie = ?");
        params.push(filter.categorie);
      }
      const sql = `${ROW} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY s.statut = 'resolu', CASE s.urgence WHEN 'haute' THEN 0 WHEN 'moyenne' THEN 1 ELSE 2 END, s.cree_le DESC`;
      return (db.all(sql, ...params) as unknown as Row[]).map(toSignalement);
    },
    setStatut(code, statut, change = {}) {
      const current = commune.signalement(code);
      if (!current) return null;
      db.run(
        "UPDATE signalements SET statut = ?, categorie = COALESCE(?, categorie), urgence = COALESCE(?, urgence), resolu_le = ? WHERE code = ?",
        statut,
        change.categorie ?? null,
        change.urgence ?? null,
        statut === "resolu" ? now().toISOString() : null,
        current.code,
      );
      if (statut === "resolu" && current.equipementId) {
        db.run("UPDATE equipements SET etat = 'fonctionnel' WHERE id = ?", current.equipementId);
      }
      return commune.signalement(current.code);
    },
    counts() {
      const rows = db.all("SELECT statut, COUNT(*) AS n FROM signalements GROUP BY statut") as Array<{ statut: Statut; n: number }>;
      const out = { nouveau: 0, a_verifier: 0, en_cours: 0, resolu: 0, haute: 0 };
      for (const r of rows) out[r.statut] = r.n;
      out.haute = (db.get("SELECT COUNT(*) AS n FROM signalements WHERE urgence = 'haute' AND statut != 'resolu'") as { n: number }).n;
      return out;
    },
    close() {
      db.close();
    },
  };

  if (options.history !== false) seedHistory(commune, t, now());
  return commune;
}

/** About a month of past reports, so the dashboard and the assistant have something to show. */
function seedHistory(commune: Commune, t: Territory, now: Date): void {
  const day = 24 * 60 * 60 * 1000;
  const past = (days: number) => new Date(now.getTime() - days * day).toISOString();
  const broken = t.equipements.filter((e) => e.etat === "en panne");
  broken.forEach((e, i) => {
    const urgence: Urgence = e.type === "eau" || e.type === "sante" ? "haute" : e.type === "piste" ? "moyenne" : "basse";
    commune.addSignalement({
      villageId: e.villageId,
      telephone: t.chefs.find((c) => c.villageId === e.villageId)!.telephone,
      categorie: e.type,
      equipementId: e.id,
      urgence,
      description: `${e.nature} en panne`,
      canal: i % 3 === 0 ? "sms" : "ussd",
      // A past SMS was sorted by the classifier, never with full certainty.
      confiance: i % 3 === 0 ? 0.82 + (i % 5) * 0.03 : 1,
      statut: i % 4 === 0 ? "en_cours" : "nouveau",
      creeLe: past(1 + ((i * 7) % 30)),
    });
  });
  for (let i = 0; i < 12; i++) {
    const v = t.villages[(i * 11) % t.villages.length]!;
    commune.addSignalement({
      villageId: v.id,
      telephone: t.chefs[v.id - 1]!.telephone,
      categorie: i % 4 === 3 ? "deces" : "naissance",
      urgence: "moyenne",
      description: i % 4 === 3 ? "Deces declare" : "Naissance declaree",
      canal: "ussd",
      statut: "en_cours",
      creeLe: past(2 + ((i * 5) % 40)),
    });
  }
}
