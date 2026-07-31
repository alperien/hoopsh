/**
 * people/namebank/france.ts - the French development system, the league's
 * biggest single foreign feeder.
 *
 * France is not one pool: the pipeline's heart is the West African
 * diaspora of the Paris suburbs. Each heritage is its own identity with
 * matched first names, surnames, and birthplaces. Franco-Malian kids named
 * Moussa Coulibaly come from Bondy; metropolitan kids named Antoine
 * Fournier come from Lyon; a Bamako-born arc is a registered diaspora
 * birthplace inside the Franco-Malian identity, never a pool accident.
 */
import type { Identity, WeightedPool } from './pool.js';
import { flat, pool, w } from './pool.js';

/** Metropolitan and banlieue birthplaces shared by the French identities. */
const FRENCH_CITIES: WeightedPool = pool(
  w(4, 'Paris, France', 'Bondy, France', 'Cergy, France', 'Lyon, France'),
  w(2, 'Strasbourg, France', 'Toulouse, France', 'Marseille, France', 'Bordeaux, France', 'Nanterre, France',
    'Evry, France', 'Creteil, France', 'Villeurbanne, France', 'Le Mans, France', 'Cholet, France'),
  w(1, 'Nantes, France', 'Montpellier, France', 'Lille, France', 'Roubaix, France', 'Mulhouse, France',
    'Dijon, France', 'Orleans, France', 'Rouen, France', 'Pau, France', 'Gravelines, France'),
);

const FRENCH_CLUBS: readonly string[] = ['France', 'France', 'France', 'Spain', 'Germany'];

const FRANCE_METRO: Identity = {
  id: 'fr', kind: 'international', nationality: 'France', weight: 6,
  first: flat(pool(
    w(3, 'Victor', 'Mathis', 'Timothe', 'Hugo', 'Antoine', 'Jules', 'Leo', 'Enzo', 'Nolan', 'Killian'),
    w(1, 'Theo', 'Maxime', 'Baptiste', 'Clement', 'Romain', 'Alexandre', 'Nicolas', 'Olivier', 'Vincent', 'Adrien',
      'Lucas', 'Evan', 'Axel', 'Yann', 'Florian', 'Quentin', 'Thibault', 'Mael', 'Titouan', 'Elliot',
      'Zaccharie', 'Matheo', 'Rayan', 'Ilan', 'Noa', 'Sacha', 'Yanis', 'Melvyn', 'Bastien', 'Corentin',
      'Damien', 'Florent', 'Gaetan', 'Loris', 'Remi', 'Teo', 'Marceau', 'Aurelien'),
  )),
  last: pool(
    w(3, 'Fournier', 'Moreau', 'Lefebvre', 'Girard', 'Rousseau', 'Mercier', 'Blanchard', 'Gauthier', 'Chevalier', 'Marchand'),
    w(1, 'Dupont', 'Bernard', 'Petit', 'Durand', 'Leroy', 'Roux', 'Lemoine', 'Fontaine', 'Perrin', 'Morel',
      'Garnier', 'Faure', 'Vidal', 'Renard', 'Bonnet', 'Lambert', 'Marechal', 'Colin', 'Delorme', 'Pichon',
      'Lessort', 'Batum', 'Cornelie', 'Poirier', 'Maledon'),
  ),
  cities: FRENCH_CITIES,
  clubCountries: FRENCH_CLUBS,
};

const FRANCO_MALIAN: Identity = {
  id: 'fr-ml', kind: 'international', nationality: 'France', heritage: 'Franco-Malian', weight: 5,
  first: flat(pool(
    w(3, 'Bilal', 'Moussa', 'Ousmane', 'Mamadou', 'Ibrahima', 'Sekou', 'Amadou', 'Boubacar', 'Adama', 'Souleymane'),
    w(1, 'Lassana', 'Youssouf', 'Salif', 'Drissa', 'Seydou', 'Modibo', 'Mahamadou', 'Cheick', 'Oumar', 'Hamidou',
      'Almamy', 'Birama', 'Daouda', 'Fousseyni', 'Kalifa', 'Siriman', 'Bourama'),
  )),
  last: pool(
    w(3, 'Coulibaly', 'Traore', 'Keita', 'Diarra', 'Doumbia', 'Sissoko', 'Kone', 'Dembele', 'Fofana', 'Diakite'),
    w(1, 'Sacko', 'Samake', 'Sidibe', 'Toure', 'Kante', 'Bagayoko', 'Konate', 'Niakate', 'Maiga', 'Sangare'),
  ),
  cities: FRENCH_CITIES,
  // born-Bamako-moved-young arc, registered as part of the identity
  diasporaCities: pool(w(3, 'Bamako, Mali'), w(1, 'Kayes, Mali', 'Segou, Mali')),
  diasporaRate: 0.15, // FEEL: most of this cohort is French-born
  clubCountries: FRENCH_CLUBS,
};

const FRANCO_SENEGALESE: Identity = {
  id: 'fr-sn', kind: 'international', nationality: 'France', heritage: 'Franco-Senegalese', weight: 4,
  first: flat(pool(
    w(3, 'Ousmane', 'Mamadou', 'Ibou', 'Cheikh', 'Abdoulaye', 'Moussa', 'Pape', 'Mouhamed', 'Lamine', 'Idrissa'),
    w(1, 'Serigne', 'Alioune', 'Babacar', 'Modou', 'Ismaila', 'El Hadji', 'Tidiane', 'Aliou', 'Sidy', 'Assane',
      'Falilou', 'Khalifa', 'Mactar', 'Ndongo', 'Samba', 'Thierno'),
  )),
  last: pool(
    w(3, 'Diallo', 'Ndiaye', 'Diop', 'Sarr', 'Gueye', 'Sy', 'Ba', 'Fall', 'Faye', 'Mbaye'),
    w(1, 'Niang', 'Sow', 'Cisse', 'Thiam', 'Mbodji', 'Samb', 'Seck', 'Dieng', 'Diouf', 'Badji'),
  ),
  cities: FRENCH_CITIES,
  diasporaCities: pool(w(3, 'Dakar, Senegal'), w(1, 'Thies, Senegal', 'Rufisque, Senegal')),
  diasporaRate: 0.2, // FEEL: the SEED Academy arc lands a share of Dakar births
  clubCountries: FRENCH_CLUBS,
};

const FRANCO_CONGOLESE: Identity = {
  id: 'fr-cd', kind: 'international', nationality: 'France', heritage: 'Franco-Congolese', weight: 3,
  first: flat(pool(
    w(3, 'Emmanuel', 'Christian', 'Patrick', 'Yannick', 'Cedric', 'Serge', 'Jonathan', 'Elie', 'Josue', 'Moise'),
    w(1, 'Gedeon', 'Dieumerci', 'Aristote', 'Chancel', 'Glody', 'Beni', 'Divin', 'Exauce', 'Merveil', 'Prince',
      'Fiston', 'Delphin', 'Dady', 'Bienvenu'),
  )),
  last: pool(
    w(3, 'Kasongo', 'Ilunga', 'Mukendi', 'Tshibangu', 'Kalambay', 'Mbuyi', 'Kabeya', 'Mwamba', 'Kalonji', 'Kabongo'),
    w(1, 'Ngoy', 'Tshimanga', 'Banza', 'Kazadi', 'Mutamba', 'Kabengele', 'Makiadi', 'Nkulu', 'Mpoyi', 'Tshiebwe'),
  ),
  cities: FRENCH_CITIES,
  diasporaCities: pool(w(3, 'Kinshasa, DR Congo'), w(1, 'Lubumbashi, DR Congo', 'Brussels, Belgium')),
  diasporaRate: 0.2,
  clubCountries: FRENCH_CLUBS,
};

const FRANCO_CAMEROONIAN: Identity = {
  id: 'fr-cm', kind: 'international', nationality: 'France', heritage: 'Franco-Cameroonian', weight: 2,
  first: flat(pool(
    w(3, 'Pascal', 'Joel', 'Ulrich', 'Yves', 'Landry', 'Frank', 'Cyrille', 'Wilfried', 'Brice', 'Achille'),
    w(1, 'Rodrigue', 'Arnaud', 'Junior', 'Steve', 'Aristide', 'Herve', 'Loic', 'Fabrice', 'Thierry', 'Boris',
      'Parfait', 'Alain', 'Constant', 'Ghislain', 'Idriss'),
  )),
  last: pool(
    w(3, 'Fotso', 'Kamdem', 'Essomba', 'Mbarga', 'Njoya', 'Tsafack', 'Kemajou', 'Onana', 'Etoundi', 'Tchami'),
    w(1, 'Ndoumbe', 'Songo', 'Bidias', 'Eyenga', 'Nganou', 'Tchato', 'Moungang', 'Kuate', 'Djoum', 'Abanda'),
  ),
  cities: FRENCH_CITIES,
  diasporaCities: pool(w(3, 'Yaounde, Cameroon'), w(2, 'Douala, Cameroon'), w(1, 'Bafoussam, Cameroon')),
  diasporaRate: 0.35, // FEEL: a larger share of this pipeline arrives in its teens
  clubCountries: FRENCH_CLUBS,
};

const FRANCO_GUINEAN: Identity = {
  id: 'fr-gn', kind: 'international', nationality: 'France', heritage: 'Franco-Guinean', weight: 2,
  first: flat(pool(
    w(3, 'Sekou', 'Mamadi', 'Alseny', 'Ibrahima', 'Mohamed', 'Amara', 'Fode', 'Lansana', 'Aboubacar', 'Facinet'),
    w(1, 'Ansoumane', 'Karifa', 'Momo', 'Naby', 'Salifou', 'Kaba', 'Fassou', 'Petit', 'Sory', 'Bangaly',
      'Djibril', 'Elhadj', 'Mory', 'Sekouba'),
  )),
  last: pool(
    w(3, 'Sylla', 'Camara', 'Conde', 'Bangoura', 'Diallo', 'Barry', 'Keita', 'Soumah', 'Fofana', 'Balde'),
    w(1, 'Cisse', 'Toure', 'Kourouma', 'Yattara', 'Doukoure', 'Sano', 'Kallo', 'Beavogui', 'Haidara', 'Sacko'),
  ),
  cities: FRENCH_CITIES,
  diasporaCities: pool(w(3, 'Conakry, Guinea'), w(1, 'Kindia, Guinea')),
  diasporaRate: 0.2,
  clubCountries: FRENCH_CLUBS,
};

export const FRANCE_IDENTITIES: readonly Identity[] = [
  FRANCE_METRO, FRANCO_MALIAN, FRANCO_SENEGALESE, FRANCO_CONGOLESE, FRANCO_CAMEROONIAN, FRANCO_GUINEAN,
];
