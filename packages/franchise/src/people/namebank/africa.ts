/**
 * people/namebank/africa.ts - the direct African pipelines (players who
 * grew up on the continent and developed through academies and European
 * clubs, which is why club countries lean European).
 *
 * Nigeria splits into Igbo and Yoruba identities so given names and
 * surnames stay language-consistent. South Sudan pairs Dinka and Nuer
 * names properly and registers the real refugee-arc birthplaces (Kakuma,
 * Cairo) with the dignity of plain fact.
 */
import type { Identity } from './pool.js';
import { flat, pool, w } from './pool.js';

const NIGERIA_IGBO: Identity = {
  id: 'ng-ig', kind: 'international', nationality: 'Nigeria', heritage: 'Igbo Nigerian', weight: 2,
  first: flat(pool(
    w(3, 'Chukwudi', 'Emeka', 'Chidi', 'Obinna', 'Ikenna', 'Nnamdi', 'Kelechi', 'Uche', 'Chima', 'Ejike'),
    w(1, 'Kenechukwu', 'Chinedu', 'Ebuka', 'Somto', 'Ugonna', 'Ifeanyi', 'Obi', 'Nonso', 'Chibueze', 'Kamsi',
      'Chinonso', 'Ikechukwu', 'Obiora', 'Chuma', 'Onyeka', 'Chisom'),
  )),
  last: pool(
    w(3, 'Okafor', 'Okeke', 'Okonkwo', 'Eze', 'Nwosu', 'Obi', 'Nwachukwu', 'Okoro', 'Igwe', 'Chukwu'),
    w(1, 'Anyanwu', 'Okorie', 'Nwankwo', 'Udeze', 'Ogbonna', 'Uzoma', 'Ibekwe', 'Nwafor', 'Okolie', 'Ekwueme'),
  ),
  cities: pool(
    w(3, 'Enugu, Nigeria', 'Onitsha, Nigeria', 'Lagos, Nigeria'),
    w(1, 'Owerri, Nigeria', 'Aba, Nigeria', 'Awka, Nigeria', 'Port Harcourt, Nigeria'),
  ),
  clubCountries: ['Spain', 'France', 'Germany', 'Italy', 'Nigeria'],
};

const NIGERIA_YORUBA: Identity = {
  id: 'ng-yo', kind: 'international', nationality: 'Nigeria', heritage: 'Yoruba Nigerian', weight: 2,
  first: flat(pool(
    w(3, 'Ayo', 'Femi', 'Tunde', 'Kola', 'Segun', 'Bayo', 'Yemi', 'Dele', 'Wale', 'Tobi'),
    w(1, 'Seun', 'Damilola', 'Olu', 'Gbenga', 'Niyi', 'Kunle', 'Bolaji', 'Sola', 'Lekan', 'Deji',
      'Ademola', 'Kayode', 'Olamide', 'Abiodun', 'Adekunle', 'Akin', 'Ayodeji', 'Babajide', 'Oluwaseun'),
  )),
  last: pool(
    w(3, 'Adebayo', 'Adeleke', 'Adewale', 'Balogun', 'Olawale', 'Adeyemi', 'Ajayi', 'Akinola', 'Olajide', 'Adesina'),
    w(1, 'Ogunleye', 'Oladele', 'Akande', 'Bamidele', 'Adeniyi', 'Ogundipe', 'Olaniyan', 'Oyebanji', 'Fadeyi', 'Akintola'),
  ),
  cities: pool(
    w(3, 'Lagos, Nigeria', 'Ibadan, Nigeria'),
    w(1, 'Abeokuta, Nigeria', 'Osogbo, Nigeria', 'Ilorin, Nigeria', 'Akure, Nigeria'),
  ),
  clubCountries: ['Spain', 'France', 'Germany', 'Nigeria'],
};

const SENEGAL: Identity = {
  id: 'sn', kind: 'international', nationality: 'Senegal', weight: 2,
  first: flat(pool(
    w(3, 'Mouhamed', 'Pape', 'Cheikh', 'Ousmane', 'Ibrahima', 'Modou', 'Babacar', 'Alioune', 'Idrissa', 'Mamadou'),
    w(1, 'Serigne', 'El Hadji', 'Assane', 'Moustapha', 'Malick', 'Abdou', 'Khadim', 'Ismaila', 'Gora', 'Pathe',
      'Demba', 'Habib', 'Souleye', 'Waly', 'Cheikhou', 'Makhtar', 'Matar'),
  )),
  last: pool(
    w(3, 'Ndiaye', 'Diop', 'Sarr', 'Gueye', 'Fall', 'Faye', 'Mbaye', 'Diallo', 'Sy', 'Ba'),
    w(1, 'Niang', 'Sow', 'Cisse', 'Thiam', 'Mbodji', 'Samb', 'Seck', 'Dieng', 'Diouf', 'Badji'),
  ),
  cities: pool(
    w(4, 'Dakar, Senegal'),
    w(1, 'Thies, Senegal', 'Saint-Louis, Senegal', 'Kaolack, Senegal', 'Rufisque, Senegal', 'Mbour, Senegal'),
  ),
  clubCountries: ['Spain', 'France', 'Senegal', 'Germany'],
};

const MALI: Identity = {
  id: 'ml', kind: 'international', nationality: 'Mali', weight: 1,
  first: flat(pool(
    w(3, 'Amadou', 'Moussa', 'Sekou', 'Boubacar', 'Adama', 'Modibo', 'Drissa', 'Lassana', 'Mahamadou', 'Souleymane'),
    w(1, 'Oumar', 'Salif', 'Seydou', 'Hamidou', 'Fousseni', 'Cheickna', 'Bakary', 'Yacouba', 'Sory', 'Tiemoko',
      'Kassim', 'Mamoutou', 'Siaka'),
  )),
  last: pool(
    w(3, 'Coulibaly', 'Traore', 'Keita', 'Diarra', 'Doumbia', 'Sidibe', 'Samake', 'Sacko', 'Diakite', 'Konate'),
    w(1, 'Dembele', 'Bagayoko', 'Kante', 'Maiga', 'Sangare', 'Fofana', 'Kone', 'Niakate', 'Toure', 'Haidara'),
  ),
  cities: pool(
    w(4, 'Bamako, Mali'),
    w(1, 'Kayes, Mali', 'Segou, Mali', 'Sikasso, Mali', 'Mopti, Mali'),
  ),
  clubCountries: ['Spain', 'France', 'Mali', 'Turkey'],
};

const DRC: Identity = {
  id: 'cd', kind: 'international', nationality: 'DR Congo', weight: 1,
  first: flat(pool(
    w(3, 'Emmanuel', 'Christian', 'Patrick', 'Gedeon', 'Dieumerci', 'Elie', 'Josue', 'Moise', 'Chancel', 'Jonathan'),
    w(1, 'Aristote', 'Glody', 'Beni', 'Tresor', 'Divin', 'Merveil', 'Serge', 'Yannick', 'Cedric', 'Blaise',
      'Papy', 'Arsene', 'Freddy'),
  )),
  last: pool(
    w(3, 'Kasongo', 'Ilunga', 'Tshibangu', 'Mukendi', 'Kalambay', 'Mbuyi', 'Kabeya', 'Mwamba', 'Kalonji', 'Kabongo'),
    w(1, 'Ngoy', 'Tshimanga', 'Banza', 'Kazadi', 'Mutamba', 'Tshiebwe', 'Makiadi', 'Nkulu', 'Mpoyi', 'Kabengele'),
  ),
  cities: pool(
    w(3, 'Kinshasa, DR Congo', 'Lubumbashi, DR Congo'),
    w(1, 'Mbuji-Mayi, DR Congo', 'Goma, DR Congo', 'Kisangani, DR Congo'),
  ),
  clubCountries: ['Spain', 'France', 'Germany', 'Angola'],
};

const CAMEROON: Identity = {
  id: 'cm', kind: 'international', nationality: 'Cameroon', weight: 1,
  first: flat(pool(
    w(3, 'Pascal', 'Joel', 'Ulrich', 'Yves', 'Landry', 'Frank', 'Cyrille', 'Wilfried', 'Brice', 'Achille'),
    w(1, 'Rodrigue', 'Arnaud', 'Junior', 'Steve', 'Aristide', 'Herve', 'Fabrice', 'Thierry', 'Boris', 'Loic',
      'Georges', 'Martial', 'Placide'),
  )),
  last: pool(
    w(3, 'Fotso', 'Kamdem', 'Essomba', 'Mbarga', 'Njoya', 'Tsafack', 'Kemajou', 'Onana', 'Etoundi', 'Tchami'),
    w(1, 'Ndoumbe', 'Songo', 'Bidias', 'Eyenga', 'Nganou', 'Tchato', 'Moungang', 'Kuate', 'Djoum', 'Abanda'),
  ),
  cities: pool(
    w(3, 'Yaounde, Cameroon', 'Douala, Cameroon'),
    w(1, 'Bafoussam, Cameroon', 'Garoua, Cameroon', 'Bamenda, Cameroon'),
  ),
  clubCountries: ['Spain', 'France', 'Germany', 'Cameroon'],
};

const SOUTH_SUDAN: Identity = {
  id: 'ss', kind: 'international', nationality: 'South Sudan', weight: 1,
  first: flat(pool(
    w(3, 'Thon', 'Deng', 'Madut', 'Wenyen', 'Makur', 'Chol', 'Ater', 'Dut', 'Majok', 'Kuany'),
    w(1, 'Garang', 'Mangok', 'Akech', 'Bol', 'Jok', 'Atem', 'Mabor', 'Panom', 'Gatluak', 'Both',
      'Abraham', 'Sunday', 'Kuot', 'Ngor'),
  )),
  last: pool(
    w(3, 'Deng', 'Akol', 'Malith', 'Aguek', 'Mawien', 'Kuol', 'Dau', 'Gak', 'Ring', 'Jok'),
    w(1, 'Marial', 'Ajak', 'Lual', 'Gai', 'Duany', 'Awan', 'Atem', 'Chuol', 'Ruot', 'Wal'),
  ),
  cities: pool(
    w(3, 'Juba, South Sudan', 'Wau, South Sudan'),
    w(1, 'Malakal, South Sudan', 'Rumbek, South Sudan'),
  ),
  // REAL story: much of this generation was born in the refugee corridor.
  diasporaCities: pool(
    w(3, 'Kakuma, Kenya', 'Cairo, Egypt'),
    w(1, 'Khartoum, Sudan', 'Nairobi, Kenya'),
  ),
  diasporaRate: 0.45, // FEEL: near half the pipeline carries the displacement arc
  clubCountries: ['Australia', 'Spain', 'France', 'Egypt'],
};

const ANGOLA: Identity = {
  id: 'ao', kind: 'international', nationality: 'Angola', weight: 1,
  first: flat(pool(
    w(3, 'Bruno', 'Milton', 'Edson', 'Joaquim', 'Silvio', 'Gerson', 'Yanick', 'Domingos', 'Helder', 'Nelson'),
    w(1, 'Manuel', 'Antonio', 'Paulo', 'Wilson', 'Osvaldo', 'Claudio', 'Feliciano', 'Augusto', 'Adilson', 'Mario',
      'Justino', 'Amadeu'),
  )),
  last: pool(
    w(3, 'dos Santos', 'Fernandes', 'Domingos', 'Mingas', 'Moreira', 'Gomes', 'Costa', 'Neto', 'Campos', 'Morais'),
    w(1, 'Sebastiao', 'Cardoso', 'Baptista', 'Cabral', 'Paulo', 'Victorino', 'Quintas', 'Manuel', 'Andrade', 'Silva'),
  ),
  cities: pool(
    w(4, 'Luanda, Angola'),
    w(1, 'Benguela, Angola', 'Lubango, Angola', 'Huambo, Angola'),
  ),
  clubCountries: ['Angola', 'Portugal', 'Spain'],
};

const EGYPT: Identity = {
  id: 'eg', kind: 'international', nationality: 'Egypt', weight: 1,
  first: flat(pool(
    w(3, 'Ahmed', 'Youssef', 'Omar', 'Karim', 'Mostafa', 'Mahmoud', 'Amr', 'Tarek', 'Khaled', 'Ali'),
    w(1, 'Seif', 'Assem', 'Hazem', 'Sherif', 'Hossam', 'Wael', 'Ziad', 'Marwan', 'Ramy', 'Ehab',
      'Abdallah', 'Hesham', 'Mazen', 'Sameh', 'Tamer'),
  )),
  last: pool(
    w(3, 'Hassan', 'Mansour', 'Farouk', 'Abdelrahman', 'Ibrahim', 'Fahmy', 'Shalaby', 'Kandil', 'Awad', 'Zaki'),
    w(1, 'Salem', 'Hegazy', 'Amin', 'Abaza', 'Marei', 'Elgammal', 'Sabry', 'Selim', 'Nassar', 'Youssef'),
  ),
  cities: pool(
    w(3, 'Cairo, Egypt', 'Alexandria, Egypt'),
    w(1, 'Giza, Egypt', 'Mansoura, Egypt', 'Port Said, Egypt'),
  ),
  clubCountries: ['Egypt', 'Egypt', 'Spain', 'France'],
};

export const AFRICA_IDENTITIES: readonly Identity[] = [
  NIGERIA_IGBO, NIGERIA_YORUBA, SENEGAL, MALI, DRC, CAMEROON, SOUTH_SUDAN, ANGOLA, EGYPT,
];
