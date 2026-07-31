/**
 * people/namebank/americas.ts - Canada plus Latin America and the
 * Caribbean.
 *
 * Canada is a top pipeline and runs through US college ball, so its
 * identities sit on the DOMESTIC path (college bio) with nationality
 * 'Canada'. It splits three ways: anglo, franco (Quebec), and the
 * Caribbean-Canadian core of Toronto and Montreal (Jamaican and Haitian
 * family names). The Caribbean direct identities keep their own stories:
 * a Nassau kid carries an English-Caribbean name (Rolle, Strachan),
 * never a Portuguese first name.
 */
import type { Identity } from './pool.js';
import { flat, pool, w } from './pool.js';

// ---------------------------------------------------------------------------
// Canada (domestic path)

const CANADA_ANGLO: Identity = {
  id: 'ca', kind: 'domestic', nationality: 'Canada', weight: 3,
  first: flat(pool(
    w(3, 'Liam', 'Bennett', 'Graham', 'Emmett', 'Andrew', 'Tristan', 'Tanner', 'Zachary', 'Owen', 'Carter'),
    w(1, 'Brock', 'Braeden', 'Kellan', 'Cory', 'Samuel', 'Cole', 'Nate', 'Declan', 'Aidan', 'Callum',
      'Jaxson', 'Kyler', 'Torin', 'Dillon', 'Marcus', 'Elias', 'Noah', 'Ethan', 'Lucas', 'Ben',
      'Quinton', 'Beckham', 'Callan'),
  )),
  last: pool(
    w(3, 'MacDonald', 'MacKenzie', 'Sinclair', 'Fraser', 'Murray', 'Campbell', 'Stewart', 'Ross', 'Thomson', 'Ferguson'),
    w(1, 'McTavish', 'Galbraith', 'Whitehead', 'Reid', 'Craig', 'Munro', 'Sutherland', 'Baird', 'Cameron', 'Duncan',
      'Forbes', 'Grant', 'Hume', 'Kerr', 'Lamont', 'Nesbitt', 'Patton', 'Rankin', 'Selkirk', 'Watt'),
  ),
  cities: pool(
    w(3, 'Vancouver, BC', 'Calgary, AB', 'Edmonton, AB', 'Ottawa, ON', 'Hamilton, ON'),
    w(1, 'Winnipeg, MB', 'Halifax, NS', 'Victoria, BC', 'Saskatoon, SK', 'London, ON',
      'Kingston, ON', 'Kelowna, BC', 'Regina, SK', 'Oshawa, ON', 'Barrie, ON'),
  ),
};

const CANADA_FRANCO: Identity = {
  id: 'ca-qc', kind: 'domestic', nationality: 'Canada', heritage: 'Franco-Canadian', weight: 1,
  first: flat(pool(
    w(3, 'Mathieu', 'Etienne', 'Pascal', 'Olivier', 'Felix', 'Antoine', 'Guillaume', 'Philippe', 'Vincent', 'Emile'),
    w(1, 'Alexis', 'Raphael', 'Laurent', 'Cedrik', 'Samuel', 'Marc-Antoine', 'Jean-Philippe', 'Xavier', 'Thomas', 'Gabriel',
      'Dominic', 'Frederic', 'Maxence', 'Ludovic', 'Yohan', 'Rejean'),
  )),
  last: pool(
    w(3, 'Tremblay', 'Gagnon', 'Bouchard', 'Cote', 'Morin', 'Lavoie', 'Fortin', 'Ouellet', 'Pelletier', 'Roy'),
    w(1, 'Belanger', 'Levesque', 'Bergeron', 'Leblanc', 'Chartrand', 'Dube', 'Gagne', 'Girard', 'Caron', 'Nadeau',
      'Poirier', 'Thibault', 'Lachance', 'Beaulieu', 'Demers'),
  ),
  cities: pool(
    w(3, 'Montreal, QC', 'Quebec City, QC', 'Laval, QC'),
    w(1, 'Longueuil, QC', 'Gatineau, QC', 'Sherbrooke, QC', 'Trois-Rivieres, QC'),
  ),
};

const CANADA_JAMAICAN: Identity = {
  id: 'ca-jm', kind: 'domestic', nationality: 'Canada', heritage: 'Jamaican-Canadian', weight: 2,
  first: flat(pool(
    w(3, 'Jamal', 'Denzel', 'Malik', 'Marcus', 'Kadeem', 'Javon', 'Tyrese', 'Andre', 'Kevon', 'Shamar'),
    w(1, 'Akeem', 'Omari', 'Jaden', 'Elijah', 'Josiah', 'Rohan', 'Dillon', 'Kassius', 'Jahmai', 'Tyreke',
      'Amari', 'Isaiah', 'Jordan', 'Kofi', 'Shane', 'Jevon', 'Shakur'),
  )),
  last: pool(
    w(3, 'Beckford', 'Salmon', 'Whyte', 'Grandison', 'Campbell', 'Reid', 'Bailey', 'Gordon', 'Palmer', 'Henry'),
    w(1, 'Grant', 'Brown', 'Williams', 'Blake', 'Powell', 'Francis', 'Gayle', 'Hylton', 'Levy', 'McKenzie',
      'Morrison', 'Barrett', 'Anderson', 'Clarke', 'Daley'),
  ),
  cities: pool(
    w(4, 'Toronto, ON', 'Brampton, ON', 'Mississauga, ON', 'Scarborough, ON'),
    w(1, 'Ajax, ON', 'Pickering, ON', 'Hamilton, ON', 'Oshawa, ON'),
  ),
  diasporaCities: pool(w(2, 'Kingston, Jamaica'), w(1, 'Spanish Town, Jamaica')),
  diasporaRate: 0.12, // FEEL: most of this cohort is Toronto-born
  suffixRate: 0.02, initialsRate: 0.02, hyphenRate: 0.03, // hyphens run high in this pipeline
};

const CANADA_HAITIAN: Identity = {
  id: 'ca-ht', kind: 'domestic', nationality: 'Canada', heritage: 'Haitian-Canadian', weight: 1,
  first: flat(pool(
    w(3, 'Emmanuel', 'Ricardo', 'Olivier', 'Kervens', 'Jephte', 'Woodley', 'Stanley', 'Kenley', 'Dave', 'Junior'),
    w(1, 'Herby', 'Ralph', 'Wilguens', 'Schneider', 'Jameson', 'Peterson', 'Watson', 'Kenson', 'Mackenson', 'Loudy',
      'Jimmy', 'Fritz', 'Stevenson'),
  )),
  last: pool(
    w(3, 'Baptiste', 'Pierre', 'Augustin', 'Delva', 'Registre', 'Cadet', 'Dorval', 'Louis', 'Charles', 'Joseph'),
    w(1, 'Etienne', 'Saintil', 'Desir', 'Michel', 'Guerrier', 'Jean-Baptiste', 'Alexandre', 'Beauvais', 'Occean', 'Petion'),
  ),
  cities: pool(
    w(4, 'Montreal, QC', 'Laval, QC'),
    w(1, 'Longueuil, QC', 'Ottawa, ON'),
  ),
  diasporaCities: pool(w(2, 'Port-au-Prince, Haiti'), w(1, 'Cap-Haitien, Haiti')),
  diasporaRate: 0.12,
  suffixRate: 0.02, initialsRate: 0.01, hyphenRate: 0.02,
};

// ---------------------------------------------------------------------------
// Latin America and the Caribbean (international path)

const BRAZIL: Identity = {
  id: 'br', kind: 'international', nationality: 'Brazil', weight: 3,
  first: flat(pool(
    w(3, 'Joao', 'Thiago', 'Bruno', 'Caio', 'Vitor', 'Marcelo', 'Rodrigo', 'Gustavo', 'Felipe', 'Matheus'),
    w(1, 'Gui', 'Pedro', 'Lucas', 'Vinicius', 'Gabriel', 'Ruan', 'Yago', 'Raul', 'Igor', 'Rafael',
      'Andre', 'Davi', 'Enzo', 'Luan', 'Wesley', 'Breno', 'Guilherme', 'Henrique', 'Luiz', 'Murilo',
      'Otavio', 'Renan', 'Emerson', 'Everton', 'Robson', 'Maicon', 'Wellington', 'Jefferson'),
  )),
  last: pool(
    w(3, 'Silva', 'Santos', 'Oliveira', 'Souza', 'Pereira', 'Almeida', 'Ferreira', 'Ribeiro', 'Carvalho', 'Machado'),
    w(1, 'Costa', 'Lima', 'Araujo', 'Barbosa', 'Nascimento', 'Cardoso', 'Correia', 'Teixeira', 'Moura', 'Batista',
      'Freitas', 'dos Santos', 'Rocha', 'Dias', 'Cavalcanti', 'Nogueira', 'Monteiro', 'Ramos', 'Farias', 'Pinto'),
  ),
  cities: pool(
    w(3, 'Sao Paulo, Brazil', 'Rio de Janeiro, Brazil', 'Belo Horizonte, Brazil'),
    w(1, 'Brasilia, Brazil', 'Salvador, Brazil', 'Fortaleza, Brazil', 'Franca, Brazil',
      'Porto Alegre, Brazil', 'Curitiba, Brazil', 'Recife, Brazil'),
  ),
  clubCountries: ['Brazil', 'Brazil', 'Spain', 'Argentina'],
};

const ARGENTINA: Identity = {
  id: 'ar', kind: 'international', nationality: 'Argentina', weight: 2,
  first: flat(pool(
    w(3, 'Facundo', 'Leandro', 'Emanuel', 'Franco', 'Ignacio', 'Santiago', 'Agustin', 'Joaquin', 'Bautista', 'Lautaro'),
    w(1, 'Valentin', 'Maximo', 'Gonzalo', 'Ramiro', 'Benjamin', 'Tomas', 'Nicolas', 'Mateo', 'Juan Cruz', 'Bruno',
      'Marcos', 'Julian', 'Sebastian', 'Federico', 'Ezequiel', 'Alejo', 'Ciro', 'Genaro', 'Lisandro', 'Mariano',
      'Nahuel', 'Gaston', 'Luciano'),
  )),
  last: pool(
    w(3, 'Gonzalez', 'Rodriguez', 'Acosta', 'Benitez', 'Aguirre', 'Romero', 'Ledesma', 'Quiroga', 'Sosa', 'Ferreyra'),
    w(1, 'Villalba', 'Paez', 'Cabral', 'Ojeda', 'Juarez', 'Vera', 'Roldan', 'Bianchi', 'Gallardo', 'Marconi',
      'Bertoni', 'Pellegrini', 'Molina', 'Gimenez', 'Cordoba'),
  ),
  cities: pool(
    w(3, 'Buenos Aires, Argentina', 'Cordoba, Argentina', 'Rosario, Argentina'),
    w(1, 'Bahia Blanca, Argentina', 'Santa Fe, Argentina', 'Mar del Plata, Argentina', 'Mendoza, Argentina'),
  ),
  clubCountries: ['Argentina', 'Argentina', 'Spain', 'Brazil'],
};

const DOMINICAN: Identity = {
  id: 'do', kind: 'international', nationality: 'Dominican Republic', weight: 2,
  first: flat(pool(
    w(3, 'Jose', 'Juan', 'Luis', 'Rafael', 'Pedro', 'Ramon', 'Franklin', 'Robinson', 'Wilson', 'Kelvin'),
    w(1, 'Yefri', 'Yordy', 'Starling', 'Manuel', 'Francisco', 'Felix', 'Domingo', 'Julio', 'Adonis', 'Amaury',
      'Eddy', 'Elvin', 'Hansel', 'Radhames', 'Vladimir'),
  )),
  last: pool(
    w(3, 'Rodriguez', 'Martinez', 'Reyes', 'Santana', 'Guerrero', 'Rosario', 'Nunez', 'Pena', 'Ramos', 'Vasquez'),
    w(1, 'Peralta', 'Polanco', 'Feliz', 'Encarnacion', 'Marte', 'Pimentel', 'Tavarez', 'De La Cruz', 'Mercedes', 'Paulino',
      'Almonte', 'Batista', 'Beltre', 'Urena', 'Vizcaino'),
  ),
  cities: pool(
    w(3, 'Santo Domingo, Dominican Republic', 'Santiago, Dominican Republic'),
    w(1, 'La Vega, Dominican Republic', 'San Cristobal, Dominican Republic',
      'San Pedro de Macoris, Dominican Republic', 'Higuey, Dominican Republic'),
  ),
  clubCountries: ['Dominican Republic', 'Puerto Rico', 'Spain', 'Argentina'],
};

const PUERTO_RICO: Identity = {
  id: 'pr', kind: 'international', nationality: 'Puerto Rico', weight: 1,
  first: flat(pool(
    w(3, 'Jose', 'Angel', 'Luis', 'Carlos', 'Hector', 'Edwin', 'Javier', 'Joel', 'Christian', 'Emanuel'),
    w(1, 'Jomar', 'Yadiel', 'Angelo', 'Rafael', 'Ramon', 'Orlando', 'Wilfredo', 'Roberto', 'Nelson', 'Israel'),
  )),
  last: pool(
    w(3, 'Rivera', 'Santiago', 'Diaz', 'Ortiz', 'Vazquez', 'Figueroa', 'Colon', 'Vega', 'Maldonado', 'Torres'),
    w(1, 'Rosado', 'Melendez', 'Ayala', 'Camacho', 'Feliciano', 'Burgos', 'Cordero', 'Serrano', 'Nieves', 'Pagan'),
  ),
  cities: pool(
    w(3, 'San Juan, PR', 'Bayamon, PR', 'Ponce, PR'),
    w(1, 'Carolina, PR', 'Caguas, PR', 'Arecibo, PR', 'Mayaguez, PR', 'Guaynabo, PR'),
  ),
  clubCountries: ['Puerto Rico', 'Puerto Rico', 'Spain', 'Argentina'],
};

const BAHAMAS: Identity = {
  id: 'bs', kind: 'international', nationality: 'Bahamas', weight: 1,
  first: flat(pool(
    w(3, 'Delano', 'Devon', 'Andre', 'Samson', 'Kendal', 'Garvin', 'Rashad', 'Jamaal', 'Tyrek', 'Deshaun'),
    w(1, 'Michael', 'Adrian', 'Kemuel', 'Lathan', 'Shervin', 'Dominic', 'Kirkland', 'Renaldo', 'Trevon', 'Jaraun',
      'Kentwan', 'Tavario', 'Denzil'),
  )),
  last: pool(
    w(3, 'Rolle', 'Ferguson', 'Munroe', 'Bethel', 'Knowles', 'Strachan', 'Pinder', 'Cartwright', 'Deveaux', 'Sands'),
    w(1, 'Hanna', 'Moss', 'Curry', 'Rahming', 'Culmer', 'Adderley', 'Bowe', 'Gibson', 'Outten', 'Stubbs'),
  ),
  cities: pool(
    w(5, 'Nassau, Bahamas'),
    w(1, 'Freeport, Bahamas'),
  ),
  clubCountries: ['Bahamas', 'Puerto Rico', 'Spain'],
};

const JAMAICA: Identity = {
  id: 'jm', kind: 'international', nationality: 'Jamaica', weight: 2,
  first: flat(pool(
    w(3, 'Rohan', 'Delano', 'Shemar', 'Javain', 'Odane', 'Romario', 'Akeem', 'Oshane', 'Kemar', 'Andre'),
    w(1, 'Jevaughn', 'Ricardo', 'Damion', 'Rushane', 'Dwayne', 'Garfield', 'Alrick', 'Demar', 'Okeem', 'Tajay',
      'Nickoy', 'Rojay', 'Tafari', 'Jayvaughn', 'Oneil'),
  )),
  last: pool(
    w(3, 'Beckford', 'Salmon', 'Grandison', 'Whyte', 'Campbell', 'Reid', 'Bailey', 'Palmer', 'Gordon', 'Henry'),
    w(1, 'Grant', 'Blake', 'Powell', 'Francis', 'Gayle', 'Hylton', 'Levy', 'McKenzie', 'Morrison', 'Daley',
      'Sinclair', 'Barrett', 'Notice', 'Bogle', 'Chambers'),
  ),
  cities: pool(
    w(4, 'Kingston, Jamaica'),
    w(1, 'Spanish Town, Jamaica', 'Montego Bay, Jamaica', 'Portmore, Jamaica', 'May Pen, Jamaica'),
  ),
  clubCountries: ['Jamaica', 'Puerto Rico', 'Spain'],
};

export const CANADA_IDENTITIES: readonly Identity[] = [
  CANADA_ANGLO, CANADA_FRANCO, CANADA_JAMAICAN, CANADA_HAITIAN,
];

export const LATAM_IDENTITIES: readonly Identity[] = [
  BRAZIL, ARGENTINA, DOMINICAN, PUERTO_RICO, BAHAMAS, JAMAICA,
];
