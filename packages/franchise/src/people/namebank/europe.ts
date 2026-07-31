/**
 * people/namebank/europe.ts - the non-Balkan, non-French European
 * pipelines. Each country is an identity; Germany, Italy, and Greece
 * additionally carry their real second-generation stories (Turkish-German,
 * Ghanaian-German, Italo-African, Greek-Nigerian) as separate identities
 * so the pairings stay honest.
 */
import type { Identity } from './pool.js';
import { flat, pool, w } from './pool.js';

const SPAIN: Identity = {
  id: 'es', kind: 'international', nationality: 'Spain', weight: 4,
  first: flat(pool(
    w(3, 'Pablo', 'Alvaro', 'Sergio', 'Jordi', 'Marc', 'Hugo', 'Izan', 'Ruben', 'Adria', 'Gonzalo'),
    w(1, 'Unai', 'Santi', 'Oriol', 'Aleix', 'Ferran', 'Alberto', 'Fran', 'Pol', 'Nacho', 'Jaime',
      'Iker', 'Xavier', 'Dario', 'Joel', 'Eloy', 'Guillem', 'Biel', 'Asier', 'Mikel', 'Aitor',
      'Ander', 'Arnau', 'Bernat', 'Eneko', 'Gerard', 'Ignasi', 'Imanol', 'Joan', 'Josep', 'Manel',
      'Marti', 'Quim', 'Xabi', 'Julen', 'Gorka'),
  )),
  last: pool(
    w(3, 'Garcia', 'Fernandez', 'Lopez', 'Martinez', 'Sanchez', 'Perez', 'Gomez', 'Jimenez', 'Ruiz', 'Diaz'),
    w(1, 'Moreno', 'Alvarez', 'Navarro', 'Torres', 'Vidal', 'Serra', 'Vives', 'Ferrer', 'Costa', 'Reyes',
      'Ortega', 'Salgado', 'Miralles', 'Bosch', 'Vilar', 'Soler', 'Aguado', 'Pastor', 'Iglesias', 'Marin',
      'Prieto', 'Redondo', 'Molina', 'Segura', 'Colom'),
  ),
  cities: pool(
    w(3, 'Madrid, Spain', 'Barcelona, Spain', 'Valencia, Spain'),
    w(1, 'Malaga, Spain', 'Seville, Spain', 'Badalona, Spain', 'Zaragoza, Spain', 'Bilbao, Spain',
      'Vitoria, Spain', 'Las Palmas, Spain', 'Murcia, Spain', 'Girona, Spain'),
  ),
  clubCountries: ['Spain', 'Spain', 'Spain', 'France'],
};

const ITALY: Identity = {
  id: 'it', kind: 'international', nationality: 'Italy', weight: 3,
  first: flat(pool(
    w(3, 'Matteo', 'Marco', 'Simone', 'Alessandro', 'Davide', 'Gabriele', 'Nicolo', 'Lorenzo', 'Federico', 'Riccardo'),
    w(1, 'Achille', 'Stefano', 'Tommaso', 'Giacomo', 'Andrea', 'Luca', 'Pietro', 'Edoardo', 'Filippo', 'Leonardo',
      'Giulio', 'Giordano', 'Massimo', 'Dario', 'Fabio', 'Alessio', 'Cristiano', 'Daniele', 'Emanuele', 'Enrico',
      'Flavio', 'Francesco', 'Jacopo', 'Luigi', 'Mattia', 'Michele', 'Nicola', 'Samuele', 'Valerio', 'Ettore',
      'Gianluca', 'Vittorio'),
  )),
  last: pool(
    w(3, 'Rossi', 'Esposito', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Gallo', 'Conti', 'Mancini'),
    w(1, 'Costa', 'De Luca', 'Bianchi', 'Moretti', 'Barbieri', 'Fontana', 'Santoro', 'Caruso', 'Ferri', 'Gentile',
      'Vitali', 'Baldi', 'Pagani', 'Lombardi', 'Marchetti', 'Rinaldi', 'Villa', 'Sartori', 'Bellini', 'Ferrari'),
  ),
  cities: pool(
    w(3, 'Milan, Italy', 'Rome, Italy', 'Bologna, Italy'),
    w(1, 'Turin, Italy', 'Naples, Italy', 'Varese, Italy', 'Treviso, Italy', 'Pesaro, Italy',
      'Reggio Emilia, Italy', 'Brescia, Italy', 'Cantu, Italy'),
  ),
  clubCountries: ['Italy', 'Italy', 'Spain', 'Germany'],
};

// REAL story: the Italo-African generation (Senegalese and Nigerian
// families in the northern industrial cities) reached the senior national
// team in the 2010s.
const ITALO_AFRICAN: Identity = {
  id: 'it-af', kind: 'international', nationality: 'Italy', heritage: 'Italo-African', weight: 1,
  first: flat(pool(
    w(3, 'Davide', 'Paolo', 'Daniel', 'David', 'Ousmane', 'Awudu', 'Abdel', 'Saliou', 'Momo', 'Amath'),
    w(1, 'Gabriele', 'Samuel', 'Emmanuel', 'Idris', 'Sekou', 'Mamadou', 'Michael', 'Joshua', 'Moussa', 'Tidiane'),
  )),
  last: pool(
    w(3, 'Diop', 'Ndour', 'Niang', 'Gueye', 'Abass', 'Thioune', 'Okeke', 'Adeola', 'Sarr', 'Fall'),
    w(1, 'Diallo', 'Toure', 'Mbaye', 'Okafor', 'Balogun', 'Sylla', 'Cisse', 'Kone', 'Seck', 'Thiam'),
  ),
  cities: pool(
    w(3, 'Milan, Italy', 'Turin, Italy', 'Brescia, Italy'),
    w(1, 'Bergamo, Italy', 'Padua, Italy', 'Verona, Italy', 'Rome, Italy'),
  ),
  diasporaCities: pool(w(2, 'Dakar, Senegal'), w(1, 'Lagos, Nigeria')),
  diasporaRate: 0.2,
  clubCountries: ['Italy', 'Italy', 'Spain'],
};

const GERMANY: Identity = {
  id: 'de', kind: 'international', nationality: 'Germany', weight: 4,
  first: flat(pool(
    w(3, 'Franz', 'Moritz', 'Maximilian', 'Johannes', 'Lukas', 'Elias', 'Leon', 'Niels', 'Finn', 'Felix'),
    w(1, 'Jan', 'Niklas', 'Justus', 'Till', 'Oskar', 'Paul', 'Jannik', 'Tibor', 'Nils', 'Lennart',
      'Julius', 'Henrik', 'Timo', 'Sven', 'Mathias', 'Bastian', 'Constantin', 'Fabian', 'Hannes', 'Jakob',
      'Kilian', 'Linus', 'Magnus', 'Malte', 'Mika', 'Nico', 'Ole', 'Philipp', 'Simon', 'Henning',
      'Rasmus', 'Torben', 'Lasse'),
  )),
  last: pool(
    w(3, 'Becker', 'Hoffmann', 'Fischer', 'Weber', 'Meyer', 'Schulz', 'Braun', 'Kruger', 'Vogel', 'Richter'),
    w(1, 'Neumann', 'Schwarz', 'Zimmermann', 'Hartmann', 'Lehmann', 'Koch', 'Bauer', 'Wolf', 'Keller', 'Huber',
      'Lang', 'Berger', 'Fuchs', 'Voigt', 'Brandt', 'Seidel', 'Kaiser', 'Frank', 'Winkler', 'Thiemann'),
  ),
  cities: pool(
    w(3, 'Berlin, Germany', 'Munich, Germany', 'Cologne, Germany'),
    w(1, 'Hamburg, Germany', 'Frankfurt, Germany', 'Bamberg, Germany', 'Ulm, Germany', 'Braunschweig, Germany',
      'Wurzburg, Germany', 'Bonn, Germany', 'Leipzig, Germany'),
  ),
  clubCountries: ['Germany', 'Germany', 'Spain', 'France'],
};

const TURKISH_GERMAN: Identity = {
  id: 'de-tr', kind: 'international', nationality: 'Germany', heritage: 'Turkish-German', weight: 1,
  first: flat(pool(
    w(3, 'Emre', 'Mert', 'Can', 'Deniz', 'Kaan', 'Efe', 'Berkay', 'Baris', 'Tolga', 'Burak'),
    w(1, 'Onur', 'Serkan', 'Volkan', 'Umut', 'Arda', 'Cem', 'Furkan', 'Kerem', 'Mehmet', 'Yasin',
      'Alp', 'Ege', 'Eren', 'Hakan', 'Sinan', 'Taner', 'Yusuf', 'Ilkay'),
  )),
  last: pool(
    w(3, 'Yilmaz', 'Demir', 'Kaya', 'Sahin', 'Celik', 'Aydin', 'Ozturk', 'Arslan', 'Dogan', 'Kilic'),
    w(1, 'Aslan', 'Cetin', 'Kurt', 'Koc', 'Erdem', 'Aksoy', 'Polat', 'Sen', 'Tas', 'Yildiz'),
  ),
  cities: pool(
    w(3, 'Berlin, Germany', 'Cologne, Germany', 'Frankfurt, Germany'),
    w(1, 'Duisburg, Germany', 'Mannheim, Germany', 'Stuttgart, Germany', 'Hamburg, Germany'),
  ),
  clubCountries: ['Germany', 'Turkey'],
};

// REAL story: Ghanaian and Congolese families in the west German cities;
// the Schroder-generation Afro-German guard line.
const AFRO_GERMAN: Identity = {
  id: 'de-af', kind: 'international', nationality: 'Germany', heritage: 'Afro-German', weight: 1,
  first: flat(pool(
    w(3, 'Isaiah', 'Joshua', 'Nelson', 'Kevin', 'Prince', 'Karim', 'Ismail', 'Malik', 'Noel', 'Tyrese'),
    w(1, 'Emmanuel', 'Samuel', 'David', 'Jayden', 'Levi', 'Elias', 'Jerome', 'Marvin', 'Dennis', 'Maurice',
      'Yannic'),
  )),
  last: pool(
    w(3, 'Boateng', 'Mensah', 'Owusu', 'Addo', 'Asamoah', 'Bonga', 'Lo', 'Diallo', 'Appiah', 'Agyemang'),
    w(1, 'Sylla', 'Kabongo', 'Ilunga', 'Danso', 'Osei', 'Amoako', 'Gyasi', 'Quaye', 'Tetteh', 'Sanogo'),
  ),
  cities: pool(
    w(3, 'Braunschweig, Germany', 'Berlin, Germany', 'Hagen, Germany'),
    w(1, 'Dortmund, Germany', 'Essen, Germany', 'Hamburg, Germany', 'Giessen, Germany'),
  ),
  clubCountries: ['Germany', 'Germany', 'Spain'],
};

const GREECE: Identity = {
  id: 'gr', kind: 'international', nationality: 'Greece', weight: 2,
  first: flat(pool(
    w(3, 'Kostas', 'Giorgos', 'Vassilis', 'Nikos', 'Dimitris', 'Panagiotis', 'Ioannis', 'Andreas', 'Christos', 'Michalis'),
    w(1, 'Stavros', 'Alexandros', 'Spyros', 'Vangelis', 'Leonidas', 'Lefteris', 'Manolis', 'Giannis', 'Petros', 'Thodoris',
      'Achilleas', 'Antonis', 'Aris', 'Fotis', 'Ilias', 'Marios', 'Sotiris', 'Kyriakos', 'Pantelis'),
  )),
  last: pool(
    w(3, 'Papadopoulos', 'Papadakis', 'Economou', 'Vlahos', 'Antoniou', 'Georgiou', 'Nikolaidis', 'Karagiannis', 'Athanasiou', 'Konstantinou'),
    w(1, 'Dimitriou', 'Panagiotou', 'Christodoulou', 'Anagnostopoulos', 'Papanikolaou', 'Stamatopoulos', 'Alexopoulos', 'Kalaitzakis', 'Tsakalidis', 'Mitoglou'),
  ),
  cities: pool(
    w(3, 'Athens, Greece', 'Thessaloniki, Greece'),
    w(1, 'Patras, Greece', 'Piraeus, Greece', 'Larissa, Greece', 'Heraklion, Greece'),
  ),
  clubCountries: ['Greece', 'Greece', 'Spain', 'Turkey'],
};

// REAL story: the Sepolia arc. Nigerian families in Athens; Greek first
// names over Yoruba and Igbo surnames.
const GREEK_NIGERIAN: Identity = {
  id: 'gr-ng', kind: 'international', nationality: 'Greece', heritage: 'Greek-Nigerian', weight: 1,
  first: flat(pool(
    w(3, 'Giannis', 'Kostas', 'Giorgos', 'Alexandros', 'Emmanouil', 'Michalis', 'Nikos', 'Panagiotis', 'Stefanos', 'Dimitris'),
    w(1, 'Andreas', 'Christos', 'Ioannis', 'Vassilis', 'Thanasis', 'Spyros', 'Petros', 'Leonidas', 'Manolis', 'Stavros'),
  )),
  last: pool(
    w(3, 'Adeyemi', 'Adebayo', 'Okonkwo', 'Balogun', 'Okafor', 'Adewale', 'Eze', 'Olawale', 'Nwosu', 'Ajayi'),
    w(1, 'Okoro', 'Okeke', 'Adeleke', 'Akinola', 'Chukwu', 'Igwe', 'Adesina', 'Akande', 'Ogbonna', 'Uzoma'),
  ),
  cities: pool(
    w(4, 'Athens, Greece'),
    w(1, 'Thessaloniki, Greece', 'Piraeus, Greece'),
  ),
  diasporaCities: pool(w(2, 'Lagos, Nigeria'), w(1, 'Ibadan, Nigeria')),
  diasporaRate: 0.15,
  clubCountries: ['Greece', 'Greece', 'Spain'],
};

const TURKEY: Identity = {
  id: 'tr', kind: 'international', nationality: 'Turkey', weight: 2,
  first: flat(pool(
    w(3, 'Alperen', 'Cedi', 'Furkan', 'Omer', 'Ersan', 'Sertac', 'Semih', 'Dogus', 'Kerem', 'Berk'),
    w(1, 'Emir', 'Mehmet', 'Ahmet', 'Burak', 'Kaan', 'Efe', 'Yigit', 'Enes', 'Baran', 'Tarik',
      'Batuhan', 'Gokhan', 'Halil', 'Metin', 'Sarp', 'Umit', 'Yunus', 'Altay', 'Cenk'),
  )),
  last: pool(
    w(3, 'Yilmaz', 'Demir', 'Kaya', 'Aydin', 'Ozturk', 'Sahin', 'Celik', 'Arslan', 'Dogan', 'Kilic'),
    w(1, 'Erdem', 'Aksoy', 'Yildiz', 'Yildirim', 'Avci', 'Polat', 'Erden', 'Sen', 'Tas', 'Koc',
      'Aslan', 'Cetin', 'Kurt', 'Guler', 'Bulut'),
  ),
  cities: pool(
    w(3, 'Istanbul, Turkey', 'Ankara, Turkey'),
    w(1, 'Izmir, Turkey', 'Bursa, Turkey', 'Bandirma, Turkey', 'Antalya, Turkey'),
  ),
  clubCountries: ['Turkey', 'Turkey', 'Spain', 'Greece'],
};

const LITHUANIA: Identity = {
  id: 'lt', kind: 'international', nationality: 'Lithuania', weight: 3,
  first: flat(pool(
    w(3, 'Jonas', 'Domantas', 'Mindaugas', 'Rokas', 'Deividas', 'Ignas', 'Arnas', 'Tadas', 'Marius', 'Matas'),
    w(1, 'Azuolas', 'Dovydas', 'Paulius', 'Edgaras', 'Gytis', 'Kasparas', 'Eimantas', 'Simas', 'Vaidas', 'Lukas',
      'Martynas', 'Tomas', 'Donatas', 'Vytautas', 'Zygimantas', 'Aivaras', 'Benas', 'Dziugas', 'Gabrielius', 'Karolis',
      'Nojus', 'Pijus', 'Titas', 'Augustas', 'Herkus'),
  )),
  last: pool(
    w(3, 'Petrauskas', 'Kazlauskas', 'Jasaitis', 'Urbonas', 'Zukauskas', 'Balciunas', 'Norkus', 'Kairys', 'Butkus', 'Jankunas'),
    w(1, 'Grigonis', 'Adomaitis', 'Stankevicius', 'Petkevicius', 'Ramanauskas', 'Kavaliauskas', 'Mockus', 'Maciulis', 'Seibutis', 'Lekavicius',
      'Sirvydis', 'Gudaitis', 'Juskevicius', 'Vasiliauskas', 'Budrys'),
  ),
  cities: pool(
    w(3, 'Vilnius, Lithuania', 'Kaunas, Lithuania'),
    w(1, 'Klaipeda, Lithuania', 'Siauliai, Lithuania', 'Panevezys, Lithuania', 'Utena, Lithuania'),
  ),
  clubCountries: ['Lithuania', 'Lithuania', 'Spain', 'Germany'],
};

const LATVIA: Identity = {
  id: 'lv', kind: 'international', nationality: 'Latvia', weight: 1,
  first: flat(pool(
    w(3, 'Kristaps', 'Davis', 'Rodions', 'Janis', 'Arturs', 'Kaspars', 'Martins', 'Rihards', 'Andrejs', 'Klavs'),
    w(1, 'Toms', 'Roberts', 'Dairis', 'Edgars', 'Kristers', 'Maris', 'Ainars', 'Gatis', 'Uvis', 'Zigmars',
      'Emils', 'Gustavs', 'Kristofers', 'Niks', 'Renars', 'Haralds'),
  )),
  last: pool(
    w(3, 'Berzins', 'Ozolins', 'Kalnins', 'Liepins', 'Zarins', 'Krumins', 'Balodis', 'Eglitis', 'Vitols', 'Priede'),
    w(1, 'Lacis', 'Vanags', 'Strautins', 'Grins', 'Skuja', 'Auzins', 'Dukurs', 'Jansons', 'Purins', 'Smits'),
  ),
  cities: pool(
    w(4, 'Riga, Latvia'),
    w(1, 'Liepaja, Latvia', 'Ventspils, Latvia', 'Valmiera, Latvia', 'Daugavpils, Latvia'),
  ),
  clubCountries: ['Latvia', 'Spain', 'Germany'],
};

const GEORGIA_ID: Identity = {
  id: 'ge', kind: 'international', nationality: 'Georgia', weight: 1,
  first: flat(pool(
    w(3, 'Sandro', 'Tornike', 'Giorgi', 'Goga', 'Beka', 'Zurab', 'Levan', 'Irakli', 'Nika', 'Davit'),
    w(1, 'Saba', 'Vakhtang', 'Lasha', 'Tengiz', 'Otar', 'Revaz', 'Guram', 'Nodar', 'Temur', 'Zaza',
      'Aleksandre', 'Archil', 'Gia', 'Shota', 'Vazha', 'Lado'),
  )),
  last: pool(
    w(3, 'Beridze', 'Giorgadze', 'Lomidze', 'Kapanadze', 'Japaridze', 'Gelashvili', 'Abashidze', 'Chkheidze', 'Metreveli', 'Kiknadze'),
    w(1, 'Tsereteli', 'Okriashvili', 'Gogoladze', 'Kvitatiani', 'Maisuradze', 'Nozadze', 'Tabidze', 'Khurtsidze', 'Dolidze', 'Machavariani'),
  ),
  cities: pool(
    w(4, 'Tbilisi, Georgia'),
    w(1, 'Kutaisi, Georgia', 'Batumi, Georgia', 'Rustavi, Georgia'),
  ),
  clubCountries: ['Georgia', 'Spain', 'Turkey', 'Greece'],
};

const UKRAINE: Identity = {
  id: 'ua', kind: 'international', nationality: 'Ukraine', weight: 1,
  first: flat(pool(
    w(3, 'Oleksandr', 'Artem', 'Dmytro', 'Andriy', 'Serhiy', 'Bohdan', 'Vitaliy', 'Maksym', 'Ihor', 'Yaroslav'),
    w(1, 'Denys', 'Oleh', 'Vladyslav', 'Mykola', 'Pavlo', 'Roman', 'Taras', 'Yevhen', 'Illia', 'Danylo',
      'Anton', 'Kyrylo', 'Nazar', 'Ostap', 'Sviatoslav', 'Stanislav'),
  )),
  last: pool(
    w(3, 'Kovalenko', 'Bondarenko', 'Melnyk', 'Boiko', 'Tkachenko', 'Kravchenko', 'Koval', 'Lysenko', 'Savchenko', 'Rudenko'),
    w(1, 'Moroz', 'Marchenko', 'Polishchuk', 'Kharchenko', 'Lytvynenko', 'Petrenko', 'Pavlenko', 'Symonenko', 'Havrylyuk', 'Zinchenko'),
  ),
  cities: pool(
    w(3, 'Kyiv, Ukraine', 'Kharkiv, Ukraine'),
    w(1, 'Dnipro, Ukraine', 'Lviv, Ukraine', 'Odesa, Ukraine', 'Zaporizhzhia, Ukraine'),
  ),
  clubCountries: ['Ukraine', 'Spain', 'Germany', 'Lithuania'],
};

const ISRAEL: Identity = {
  id: 'il', kind: 'international', nationality: 'Israel', weight: 1,
  first: flat(pool(
    w(3, 'Gal', 'Tomer', 'Yonatan', 'Itay', 'Noam', 'Amit', 'Ori', 'Roi', 'Eitan', 'Nadav'),
    w(1, 'Guy', 'Oz', 'Idan', 'Lior', 'Omri', 'Yam', 'Daniel', 'Ben', 'Shai', 'Tal',
      'Aviv', 'Dor', 'Ido', 'Matan', 'Nir', 'Yotam', 'Alon', 'Yoav'),
  )),
  last: pool(
    w(3, 'Cohen', 'Levi', 'Mizrahi', 'Peretz', 'Biton', 'Dahan', 'Avraham', 'Friedman', 'Katz', 'Shapira'),
    w(1, 'Azoulay', 'Malka', 'Ohayon', 'Gabay', 'Amar', 'Edri', 'Hazan', 'Sasson', 'Baruch', 'Alon'),
  ),
  cities: pool(
    w(3, 'Tel Aviv, Israel', 'Jerusalem, Israel'),
    w(1, 'Haifa, Israel', 'Holon, Israel', 'Rishon LeZion, Israel', 'Beer Sheva, Israel'),
  ),
  clubCountries: ['Israel', 'Israel', 'Spain'],
};

const FINLAND: Identity = {
  id: 'fi', kind: 'international', nationality: 'Finland', weight: 1,
  first: flat(pool(
    w(3, 'Lauri', 'Mikael', 'Eero', 'Olli', 'Emil', 'Onni', 'Aleksi', 'Miro', 'Ville', 'Joonas'),
    w(1, 'Sasu', 'Topias', 'Miikka', 'Elias', 'Eetu', 'Arttu', 'Jesse', 'Santeri', 'Veeti', 'Akseli',
      'Anssi', 'Eemeli', 'Juho', 'Konsta', 'Paavo', 'Roope', 'Niilo', 'Oskari'),
  )),
  last: pool(
    w(3, 'Virtanen', 'Korhonen', 'Nieminen', 'Makinen', 'Laine', 'Jantunen', 'Lehtinen', 'Heikkinen', 'Jarvinen', 'Koponen'),
    w(1, 'Lampinen', 'Rantanen', 'Koivisto', 'Salin', 'Hakanen', 'Toivonen', 'Kinnunen', 'Salonen', 'Turunen', 'Laakso'),
  ),
  cities: pool(
    w(3, 'Helsinki, Finland', 'Tampere, Finland'),
    w(1, 'Espoo, Finland', 'Turku, Finland', 'Oulu, Finland', 'Lahti, Finland'),
  ),
  clubCountries: ['Finland', 'Germany', 'Spain', 'France'],
};

export const EUROPE_IDENTITIES: readonly Identity[] = [
  SPAIN, ITALY, ITALO_AFRICAN, GERMANY, TURKISH_GERMAN, AFRO_GERMAN,
  GREECE, GREEK_NIGERIAN, TURKEY, LITHUANIA, LATVIA, GEORGIA_ID,
  UKRAINE, ISRAEL, FINLAND,
];
