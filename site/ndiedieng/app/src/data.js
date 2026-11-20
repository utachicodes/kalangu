/**
 * Fictitious data for the prototype: 58 villages, their chiefs, 200
 * equipments and 499 territorial records, generated the same way every time.
 *
 * None of it is real. The village names ("Village 01") and the phone numbers
 * (+221 00 000 00 xx, a range no operator uses) are placeholders, so nothing
 * here can be mistaken for the commune's own records. Real data replaces this
 * file, not the code around it.
 */
/** The kinds of equipment, by type, as a chief picks them on a menu. */
export const NATURES = {
    eau: ["forage", "borne-fontaine"],
    sante: ["poste de sante", "case de sante"],
    ecole: ["salle de classe", "latrines"],
    energie: ["lampadaire solaire"],
    piste: ["piste"],
};
/** How many of each, 200 in all. */
const COUNTS = [
    ["eau", "forage", 58],
    ["eau", "borne-fontaine", 30],
    ["sante", "poste de sante", 8],
    ["sante", "case de sante", 14],
    ["ecole", "salle de classe", 24],
    ["ecole", "latrines", 10],
    ["energie", "lampadaire solaire", 44],
    ["piste", "piste", 12],
];
/** A small seeded generator, so the fictitious data is the same on every run. */
function random(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const pad = (n, width = 2) => String(n).padStart(width, "0");
export function villageName(id) {
    return `Village ${pad(id)}`;
}
/** A fictitious number for each chief: +221 00 000 00 xx is not used by any operator. */
export function chefPhone(villageId) {
    return `+2210000000${pad(villageId)}`;
}
export function generateTerritory(seed = 2026) {
    const rand = random(seed);
    const pick = (n) => Math.floor(rand() * n);
    const villages = Array.from({ length: 58 }, (_, i) => ({
        id: i + 1,
        nom: villageName(i + 1),
        population: 250 + pick(2200),
    }));
    const chefs = villages.map((v) => ({ telephone: chefPhone(v.id), nom: `Chef du ${v.nom}`, villageId: v.id }));
    const equipements = [];
    for (const [type, nature, count] of COUNTS) {
        for (let i = 0; i < count; i++) {
            // One forage per village; the rest spread over the villages.
            const villageId = nature === "forage" ? i + 1 : 1 + pick(villages.length);
            const sameInVillage = equipements.filter((e) => e.villageId === villageId && e.nature === nature).length;
            equipements.push({
                id: equipements.length + 1,
                villageId,
                type,
                nature,
                nom: `${nature} ${sameInVillage + 1}, ${villageName(villageId)}`,
                etat: rand() < 0.12 ? "en panne" : "fonctionnel",
            });
        }
    }
    const fiches = [];
    const visit = () => `2026-${pad(1 + pick(10))}-${pad(1 + pick(28))}`;
    for (const v of villages) {
        fiches.push({ id: fiches.length + 1, villageId: v.id, categorie: "village", intitule: v.nom, etat: "a jour", populationDesservie: v.population, derniereVisite: visit() });
    }
    for (const e of equipements) {
        fiches.push({
            id: fiches.length + 1,
            villageId: e.villageId,
            categorie: "equipement",
            intitule: e.nom,
            etat: e.etat,
            populationDesservie: 50 + pick(1500),
            derniereVisite: visit(),
        });
    }
    const others = ["association", "groupement de femmes", "marche", "perimetre maraicher", "ecole"];
    while (fiches.length < 499) {
        const categorie = others[pick(others.length)];
        const villageId = 1 + pick(villages.length);
        fiches.push({
            id: fiches.length + 1,
            villageId,
            categorie,
            intitule: `${categorie}, ${villageName(villageId)}`,
            etat: rand() < 0.2 ? "a mettre a jour" : "a jour",
            populationDesservie: 20 + pick(600),
            derniereVisite: visit(),
        });
    }
    return { villages, chefs, equipements, fiches };
}
