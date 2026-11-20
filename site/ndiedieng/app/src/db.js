/**
 * The commune's database: villages, chiefs, equipments, territorial records
 * and the reports that come in by USSD, SMS or voice. Plain SQL over `SqlDb`,
 * so the same code runs on Node's SQLite (nodeSql.ts) and in the browser
 * (web/sqljs.ts).
 */
import { generateTerritory } from "./data.js";
import { SCHEMA } from "./schema.js";
export { SCHEMA };
const ROW = `SELECT s.code, s.village_id, v.nom AS village, s.telephone, s.categorie, s.equipement_id, e.nom AS equipement,
  s.urgence, s.description, s.canal, s.statut, s.confiance, s.cree_le, s.resolu_le
  FROM signalements s JOIN villages v ON v.id = s.village_id LEFT JOIN equipements e ON e.id = s.equipement_id`;
const toSignalement = (r) => ({
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
/** The schema and the fictitious territory, in one transaction. */
function seed(db, t) {
    db.exec(SCHEMA);
    db.exec("BEGIN");
    for (const v of t.villages)
        db.run("INSERT INTO villages (id, nom, population) VALUES (?, ?, ?)", v.id, v.nom, v.population);
    for (const c of t.chefs)
        db.run("INSERT INTO chefs (telephone, nom, village_id) VALUES (?, ?, ?)", c.telephone, c.nom, c.villageId);
    for (const e of t.equipements) {
        db.run("INSERT INTO equipements (id, village_id, type, nature, nom, etat) VALUES (?, ?, ?, ?, ?, ?)", e.id, e.villageId, e.type, e.nature, e.nom, e.etat);
    }
    for (const f of t.fiches) {
        db.run("INSERT INTO fiches (id, village_id, categorie, intitule, etat, population_desservie, derniere_visite) VALUES (?, ?, ?, ?, ?, ?, ?)", f.id, f.villageId, f.categorie, f.intitule, f.etat, f.populationDesservie, f.derniereVisite);
    }
    db.exec("COMMIT");
}
/** Fills `db` with the fictitious territory and, by default, a month of past reports. */
export function createCommune(db, options = {}) {
    const now = options.now ?? (() => new Date());
    const t = options.existing ? null : (options.territory ?? generateTerritory());
    if (t)
        seed(db, t);
    const commune = {
        readOnly: (sql) => db.readOnly(sql),
        chefByPhone(telephone) {
            const row = db.get("SELECT c.telephone, c.nom, c.village_id AS villageId, v.nom AS village FROM chefs c JOIN villages v ON v.id = c.village_id WHERE c.telephone = ?", telephone);
            return row ?? null;
        },
        chefs() {
            return db.all("SELECT c.telephone, v.nom AS village FROM chefs c JOIN villages v ON v.id = c.village_id ORDER BY v.id");
        },
        equipementFor(villageId, nature) {
            const row = db.get("SELECT id, nom FROM equipements WHERE village_id = ? AND nature = ? ORDER BY etat = 'en panne' DESC, id LIMIT 1", villageId, nature);
            return row ?? null;
        },
        equipementsOf(villageId) {
            return db.all("SELECT id, type, nature, nom FROM equipements WHERE village_id = ? ORDER BY id", villageId);
        },
        addSignalement(s) {
            const id = db.get("SELECT COALESCE(MAX(id), 0) + 1 AS n FROM signalements").n;
            const code = `S-${String(id).padStart(4, "0")}`;
            db.run(`INSERT INTO signalements
    (code, village_id, telephone, categorie, equipement_id, urgence, description, canal, statut, confiance, cree_le)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, code, s.villageId, s.telephone, s.categorie, s.equipementId ?? null, s.urgence, s.description, s.canal, s.statut ?? "nouveau", s.confiance ?? 1, s.creeLe ?? now().toISOString());
            if (s.equipementId && (s.statut ?? "nouveau") !== "resolu") {
                db.run("UPDATE equipements SET etat = 'en panne' WHERE id = ?", s.equipementId);
            }
            return commune.signalement(code);
        },
        signalement(code) {
            const row = db.get(`${ROW} WHERE s.code = ?`, code.trim().toUpperCase());
            return row ? toSignalement(row) : null;
        },
        signalements(filter = {}) {
            const where = [];
            const params = [];
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
            return db.all(sql, ...params).map(toSignalement);
        },
        setStatut(code, statut, change = {}) {
            return commune.updateSignalement(code, { ...change, statut });
        },
        updateSignalement(code, change) {
            const current = commune.signalement(code);
            if (!current)
                return null;
            const statut = change.statut ?? current.statut;
            const resoluLe = statut === "resolu" ? (current.statut === "resolu" ? current.resoluLe : now().toISOString()) : null;
            const equipementId = change.equipementId === undefined ? current.equipementId : change.equipementId;
            db.run("UPDATE signalements SET statut = ?, categorie = ?, urgence = ?, description = ?, equipement_id = ?, resolu_le = ? WHERE code = ?", statut, change.categorie ?? current.categorie, change.urgence ?? current.urgence, change.description ?? current.description, equipementId, resoluLe, current.code);
            for (const id of new Set([current.equipementId, equipementId]))
                if (id)
                    syncEquipment(id);
            return commune.signalement(current.code);
        },
        deleteSignalement(code) {
            const current = commune.signalement(code);
            if (!current)
                return false;
            db.run("DELETE FROM signalements WHERE code = ?", current.code);
            if (current.equipementId)
                syncEquipment(current.equipementId);
            return true;
        },
        villages() {
            return db.all("SELECT id, nom FROM villages ORDER BY id");
        },
        counts() {
            const rows = db.all("SELECT statut, COUNT(*) AS n FROM signalements GROUP BY statut");
            const out = { nouveau: 0, a_verifier: 0, en_cours: 0, resolu: 0, haute: 0 };
            for (const r of rows)
                out[r.statut] = r.n;
            out.haute = db.get("SELECT COUNT(*) AS n FROM signalements WHERE urgence = 'haute' AND statut != 'resolu'").n;
            return out;
        },
        close() {
            db.close();
        },
    };
    /** An equipment is broken while a report on it is still open, and working otherwise. */
    function syncEquipment(id) {
        const open = db.get("SELECT COUNT(*) AS n FROM signalements WHERE equipement_id = ? AND statut != 'resolu'", id).n;
        db.run("UPDATE equipements SET etat = ? WHERE id = ?", open ? "en panne" : "fonctionnel", id);
    }
    if (t && options.history !== false)
        seedHistory(commune, t, now());
    return commune;
}
/** About a month of past reports, so the dashboard and the assistant have something to show. */
function seedHistory(commune, t, now) {
    const day = 24 * 60 * 60 * 1000;
    const past = (days) => new Date(now.getTime() - days * day).toISOString();
    const broken = t.equipements.filter((e) => e.etat === "en panne");
    broken.forEach((e, i) => {
        const urgence = e.type === "eau" || e.type === "sante" ? "haute" : e.type === "piste" ? "moyenne" : "basse";
        commune.addSignalement({
            villageId: e.villageId,
            telephone: t.chefs.find((c) => c.villageId === e.villageId).telephone,
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
        const v = t.villages[(i * 11) % t.villages.length];
        commune.addSignalement({
            villageId: v.id,
            telephone: t.chefs[v.id - 1].telephone,
            categorie: i % 4 === 3 ? "deces" : "naissance",
            urgence: "moyenne",
            description: i % 4 === 3 ? "Deces declare" : "Naissance declaree",
            canal: "ussd",
            statut: "en_cours",
            creeLe: past(2 + ((i * 5) % 40)),
        });
    }
}
