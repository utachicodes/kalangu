/** The commune's tables. Shared by the database and the prompts that write queries for it. */
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
  canal TEXT NOT NULL,        -- ussd, sms, vocal, mairie
  statut TEXT NOT NULL,       -- nouveau, a_verifier, en_cours, resolu
  confiance REAL NOT NULL,    -- 1 for a USSD menu choice; the classifier's own for SMS
  cree_le TEXT NOT NULL,      -- ISO date and time
  resolu_le TEXT
);`;
