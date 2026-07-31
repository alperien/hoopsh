/**
 * people/namebank/balkans.ts - ex-Yugoslav pipeline identities.
 *
 * Each country is its own identity so first names, surname endings, and
 * birthplaces stay paired: Serbian -ic families in Belgrade, Bosniak
 * families (Hodzic, Begic) in Sarajevo or the registered German diaspora,
 * Macedonian -ski families in Skopje. Surnames use ASCII transliterations
 * (Jokic, not Jokić), consistent with the codebase's ASCII name doctrine.
 */
import type { Identity } from './pool.js';
import { flat, pool, w } from './pool.js';

const SERBIA: Identity = {
  id: 'rs', kind: 'international', nationality: 'Serbia', weight: 6,
  first: flat(pool(
    w(3, 'Nikola', 'Bogdan', 'Vasilije', 'Nemanja', 'Dusan', 'Uros', 'Marko', 'Milos', 'Stefan', 'Aleksa'),
    w(1, 'Vanja', 'Filip', 'Petar', 'Lazar', 'Ognjen', 'Dejan', 'Strahinja', 'Andrija', 'Vladan', 'Predrag',
      'Boban', 'Zoran', 'Goran', 'Aleksej', 'Vuk', 'Mihailo', 'Djordje', 'Sasa', 'Milan', 'Branko',
      'Veljko', 'Vukasin', 'Mateja', 'Pavle', 'Relja', 'Dimitrije', 'Milovan', 'Zeljko'),
  )),
  last: pool(
    w(3, 'Jovanovic', 'Petrovic', 'Nikolic', 'Markovic', 'Stojanovic', 'Pavlovic', 'Milosevic', 'Djordjevic', 'Stankovic', 'Ilic'),
    w(1, 'Ristic', 'Zivkovic', 'Lazic', 'Vukovic', 'Milanovic', 'Simonovic', 'Todorovic', 'Radulovic', 'Vasiljevic', 'Kovacevic',
      'Popovic', 'Mitrovic', 'Savic', 'Jankovic', 'Djuric', 'Antic', 'Blagojevic', 'Radovanovic', 'Obradovic', 'Krstic',
      'Terzic', 'Zdravkovic', 'Cvetkovic', 'Nedovic', 'Avramovic', 'Micic', 'Guduric', 'Jovic', 'Marjanovic', 'Jokic'),
  ),
  cities: pool(
    w(3, 'Belgrade, Serbia', 'Novi Sad, Serbia', 'Nis, Serbia'),
    w(1, 'Kragujevac, Serbia', 'Subotica, Serbia', 'Cacak, Serbia', 'Uzice, Serbia', 'Sombor, Serbia', 'Zrenjanin, Serbia'),
  ),
  clubCountries: ['Serbia', 'Serbia', 'Spain', 'Turkey', 'Germany'],
};

const CROATIA: Identity = {
  id: 'hr', kind: 'international', nationality: 'Croatia', weight: 3,
  first: flat(pool(
    w(3, 'Dario', 'Ante', 'Toni', 'Ivica', 'Mario', 'Luka', 'Karlo', 'Niko', 'Lovro', 'Roko'),
    w(1, 'Kruno', 'Mate', 'Duje', 'Sime', 'Hrvoje', 'Domagoj', 'Josip', 'Stipe', 'Marin', 'Borna',
      'Jakov', 'Tin', 'Petar', 'Ivan', 'Zvonimir', 'Frane', 'Tomislav', 'Vedran', 'Slaven', 'Matej'),
  )),
  last: pool(
    w(3, 'Horvat', 'Kovac', 'Maric', 'Juric', 'Simic', 'Babic', 'Novak', 'Pavic', 'Tomic', 'Radic'),
    w(1, 'Klaric', 'Blazevic', 'Bilic', 'Grgic', 'Kovacic', 'Brkic', 'Zoric', 'Perkovic', 'Matkovic', 'Vidovic',
      'Lovric', 'Petkovic', 'Bogdanovic', 'Perica', 'Skara'),
  ),
  cities: pool(
    w(3, 'Zagreb, Croatia', 'Split, Croatia'),
    w(1, 'Zadar, Croatia', 'Sibenik, Croatia', 'Rijeka, Croatia', 'Osijek, Croatia', 'Dubrovnik, Croatia'),
  ),
  clubCountries: ['Croatia', 'Spain', 'Italy', 'Germany'],
};

const BOSNIA: Identity = {
  id: 'ba', kind: 'international', nationality: 'Bosnia', weight: 2,
  first: flat(pool(
    w(3, 'Jusuf', 'Edin', 'Emir', 'Mirza', 'Kenan', 'Amar', 'Tarik', 'Haris', 'Adin', 'Damir'),
    w(1, 'Dzanan', 'Nedim', 'Elmedin', 'Amel', 'Nihad', 'Semir', 'Adnan', 'Armin', 'Eldin', 'Sanjin',
      'Almir', 'Elvir', 'Ermin', 'Faruk', 'Vedad', 'Alen', 'Denis'),
  )),
  last: pool(
    w(3, 'Hodzic', 'Begic', 'Hadzic', 'Kulenovic', 'Delic', 'Zukic', 'Softic', 'Imamovic', 'Osmanovic', 'Salihovic'),
    w(1, 'Ferhatovic', 'Mahmutovic', 'Suljic', 'Halilovic', 'Omeragic', 'Alibegovic', 'Mehmedovic', 'Dedic', 'Kadric', 'Muminovic'),
  ),
  cities: pool(
    w(3, 'Sarajevo, Bosnia', 'Tuzla, Bosnia'),
    w(1, 'Zenica, Bosnia', 'Mostar, Bosnia', 'Bihac, Bosnia', 'Banja Luka, Bosnia'),
  ),
  // REAL story: the 90s refugee diaspora raised a generation of Bosnian
  // players in Germany, Austria, and Scandinavia. Registered here, never
  // a cross-pool accident.
  diasporaCities: pool(
    w(2, 'Stuttgart, Germany', 'Vienna, Austria'),
    w(1, 'Munich, Germany', 'Malmo, Sweden', 'Zurich, Switzerland'),
  ),
  diasporaRate: 0.3, // FEEL: a large share of the pipeline is diaspora-born
  clubCountries: ['Bosnia', 'Germany', 'Turkey', 'Spain'],
};

const SLOVENIA: Identity = {
  id: 'si', kind: 'international', nationality: 'Slovenia', weight: 2,
  first: flat(pool(
    w(3, 'Luka', 'Goran', 'Klemen', 'Jaka', 'Ziga', 'Gregor', 'Rok', 'Matic', 'Aljaz', 'Miha'),
    w(1, 'Vlatko', 'Edo', 'Beno', 'Tine', 'Nejc', 'Blaz', 'Urban', 'Anze', 'Tilen', 'Domen',
      'Gasper', 'Jure', 'Zan', 'Andrej'),
  )),
  last: pool(
    w(3, 'Novak', 'Horvat', 'Zupancic', 'Kranjc', 'Potocnik', 'Zagar', 'Vidmar', 'Blazic', 'Krajnc', 'Zajc'),
    w(1, 'Petek', 'Turk', 'Golob', 'Kos', 'Hribar', 'Bregar', 'Kolar', 'Lah', 'Rupnik', 'Cebasek'),
  ),
  cities: pool(
    w(3, 'Ljubljana, Slovenia', 'Maribor, Slovenia'),
    w(1, 'Celje, Slovenia', 'Kranj, Slovenia', 'Koper, Slovenia'),
  ),
  clubCountries: ['Slovenia', 'Spain', 'Italy', 'Germany'],
};

const MONTENEGRO: Identity = {
  id: 'me', kind: 'international', nationality: 'Montenegro', weight: 2,
  first: flat(pool(
    w(3, 'Nikola', 'Marko', 'Balsa', 'Danilo', 'Vuk', 'Zarko', 'Milutin', 'Vasilije', 'Igor', 'Petar'),
    w(1, 'Bojan', 'Radovan', 'Slavko', 'Milo', 'Luka', 'Andrija', 'Filip', 'Djuro', 'Novica', 'Rajko',
      'Momir', 'Stevan', 'Veselin', 'Dusko'),
  )),
  last: pool(
    w(3, 'Ivanovic', 'Radonjic', 'Vukcevic', 'Bulatovic', 'Djurisic', 'Perovic', 'Vujosevic', 'Popovic', 'Kalezic', 'Radulovic'),
    w(1, 'Bogavac', 'Drobnjak', 'Savicevic', 'Vlahovic', 'Boskovic', 'Lekic', 'Scepanovic', 'Vukotic', 'Klikovac', 'Rakocevic'),
  ),
  cities: pool(
    w(3, 'Podgorica, Montenegro'),
    w(1, 'Niksic, Montenegro', 'Bar, Montenegro', 'Bijelo Polje, Montenegro', 'Herceg Novi, Montenegro'),
  ),
  clubCountries: ['Montenegro', 'Serbia', 'Spain', 'Turkey'],
};

const N_MACEDONIA: Identity = {
  id: 'mk', kind: 'international', nationality: 'North Macedonia', weight: 1,
  first: flat(pool(
    w(3, 'Pero', 'Vlado', 'Kiril', 'Stojan', 'Aleksandar', 'Nenad', 'Darko', 'Goce', 'Riste', 'Zlatko'),
    w(1, 'Metodija', 'Bojan', 'Damjan', 'Igor', 'Kire', 'Marjan', 'Naum', 'Ognen', 'Trajce', 'Vane',
      'Blagoj', 'Dime', 'Sasko'),
  )),
  last: pool(
    w(3, 'Trajkovski', 'Stojanovski', 'Angelov', 'Ristevski', 'Georgievski', 'Dimitrievski', 'Nikolovski', 'Ilievski', 'Jovanovski', 'Mitrevski'),
    w(1, 'Petrov', 'Stankovski', 'Kostovski', 'Bogdanovski', 'Miloshevski', 'Todorovski', 'Naumovski', 'Atanasovski', 'Velkovski', 'Spirovski'),
  ),
  cities: pool(
    w(3, 'Skopje, North Macedonia'),
    w(1, 'Bitola, North Macedonia', 'Kumanovo, North Macedonia', 'Prilep, North Macedonia', 'Tetovo, North Macedonia'),
  ),
  clubCountries: ['North Macedonia', 'Serbia', 'Greece', 'Turkey'],
};

export const BALKAN_IDENTITIES: readonly Identity[] = [
  SERBIA, CROATIA, BOSNIA, SLOVENIA, MONTENEGRO, N_MACEDONIA,
];
