/**
 * The thirty franchises — fixed identity data for league genesis.
 *
 * Fictional franchises in real (plus two league-lore) markets; no NBA
 * names, no minor-league collisions checked beyond the obvious. Cascadia
 * and Meridian carry over from @hoopsh/data's calibration teams so the
 * league is continuous with the repo's own sample universe (teams.ts
 * documents why those two rosters are load-bearing; here only their
 * identities are reused, not their rosters). Colors are broadcast-legible
 * pairs (primary, secondary) chosen to stay distinct in a scorebug at
 * small sizes; the UI renders monograms from these, never clip art.
 */

export interface FranchiseSeed {
  id: string;          // lowercase, stable
  city: string;
  name: string;
  abbrev: string;      // 3 uppercase letters, unique
  conference: 'East' | 'West';
  division: string;
  colors: [string, string];
  arena: string;
}

export const FRANCHISES: FranchiseSeed[] = [
  // East / Atlantic
  { id: 'nye', city: 'New York', name: 'Excelsiors', abbrev: 'NYE', conference: 'East', division: 'Atlantic', colors: ['#1d3557', '#f4a261'], arena: 'Grand Concourse Garden' },
  { id: 'bka', city: 'Brooklyn', name: 'Atlantics', abbrev: 'BKA', conference: 'East', division: 'Atlantic', colors: ['#111111', '#e5e5e5'], arena: 'Flatbush Armory' },
  { id: 'bos', city: 'Boston', name: 'Beacons', abbrev: 'BOS', conference: 'East', division: 'Atlantic', colors: ['#0a6640', '#f2c14e'], arena: 'Beacon Hall' },
  { id: 'phi', city: 'Philadelphia', name: 'Founders', abbrev: 'PHI', conference: 'East', division: 'Atlantic', colors: ['#8d1f2c', '#0f2f56'], arena: 'Liberty Exchange' },
  { id: 'tor', city: 'Toronto', name: 'Northmen', abbrev: 'TOR', conference: 'East', division: 'Atlantic', colors: ['#5c1f8a', '#c0c0c0'], arena: 'Dominion Centre' },
  // East / Central
  { id: 'chi', city: 'Chicago', name: 'Condors', abbrev: 'CHI', conference: 'East', division: 'Central', colors: ['#b3121f', '#1a1a1a'], arena: 'Lakefront Pavilion' },
  { id: 'det', city: 'Detroit', name: 'Motors', abbrev: 'DET', conference: 'East', division: 'Central', colors: ['#0f4d92', '#d7d7d7'], arena: 'Assembly Hall at Woodward' },
  { id: 'cle', city: 'Cleveland', name: 'Forge', abbrev: 'CLE', conference: 'East', division: 'Central', colors: ['#3d2b1f', '#e07a1f'], arena: 'The Foundry' },
  { id: 'ind', city: 'Indianapolis', name: 'Gears', abbrev: 'IND', conference: 'East', division: 'Central', colors: ['#00265c', '#ffb81c'], arena: 'Crossroads Fieldhouse' },
  { id: 'mil', city: 'Milwaukee', name: 'Anchors', abbrev: 'MIL', conference: 'East', division: 'Central', colors: ['#00443f', '#eee1c6'], arena: 'Harborline Arena' },
  // East / Southeast
  { id: 'mia', city: 'Miami', name: 'Cyclones', abbrev: 'MIA', conference: 'East', division: 'Southeast', colors: ['#00747c', '#ff5a36'], arena: 'Biscayne Dome' },
  { id: 'atl', city: 'Atlanta', name: 'Firebirds', abbrev: 'ATL', conference: 'East', division: 'Southeast', colors: ['#c8102e', '#ffcd00'], arena: 'Peachtree Coliseum' },
  { id: 'cha', city: 'Charlotte', name: 'Aviators', abbrev: 'CHA', conference: 'East', division: 'Southeast', colors: ['#00538c', '#a2aaad'], arena: 'Piedmont Hangar' },
  { id: 'was', city: 'Washington', name: 'Statesmen', abbrev: 'WAS', conference: 'East', division: 'Southeast', colors: ['#232d4b', '#c8cbd2'], arena: 'Capitol Rotunda Arena' },
  { id: 'orl', city: 'Orlando', name: 'Tropics', abbrev: 'ORL', conference: 'East', division: 'Southeast', colors: ['#0077b6', '#90e0ef'], arena: 'Citrus Bowl Pavilion' },
  // West / Northwest
  { id: 'sea', city: 'Seattle', name: 'Emeralds', abbrev: 'SEA', conference: 'West', division: 'Northwest', colors: ['#046a38', '#ffc600'], arena: 'Puget Sound Center' },
  { id: 'por', city: 'Portland', name: 'Pioneers', abbrev: 'POR', conference: 'West', division: 'Northwest', colors: ['#5b2333', '#f7f4ea'], arena: 'Willamette Crossing' },
  { id: 'den', city: 'Denver', name: 'Summit', abbrev: 'DEN', conference: 'West', division: 'Northwest', colors: ['#12355b', '#ffd23f'], arena: 'Mile High Forum' },
  { id: 'min', city: 'Minneapolis', name: 'Voyageurs', abbrev: 'MIN', conference: 'West', division: 'Northwest', colors: ['#00385c', '#8bc8e8'], arena: 'North Star Exchange' },
  { id: 'uta', city: 'Salt Lake City', name: 'Prospectors', abbrev: 'SLC', conference: 'West', division: 'Northwest', colors: ['#6b4e16', '#f1e3c8'], arena: 'Wasatch Works' },
  // West / Pacific
  { id: 'cas', city: 'Cascadia', name: 'Breakers', abbrev: 'CAS', conference: 'West', division: 'Pacific', colors: ['#0b7a75', '#d5f2ef'], arena: 'Salish Sea Pavilion' },
  { id: 'las', city: 'Los Angeles', name: 'Stars', abbrev: 'LAS', conference: 'West', division: 'Pacific', colors: ['#101820', '#c5b358'], arena: 'The Marquee' },
  { id: 'sfo', city: 'San Francisco', name: 'Fog', abbrev: 'SFO', conference: 'West', division: 'Pacific', colors: ['#5b6770', '#f4f4f4'], arena: 'Embarcadero Hall' },
  { id: 'sac', city: 'Sacramento', name: 'Gold', abbrev: 'SAC', conference: 'West', division: 'Pacific', colors: ['#85714d', '#241f21'], arena: 'Delta Yards' },
  { id: 'lvs', city: 'Las Vegas', name: 'Scorpions', abbrev: 'LVS', conference: 'West', division: 'Pacific', colors: ['#1c1c1c', '#d81e5b'], arena: 'The Mirage Bowl' },
  // West / Southwest
  { id: 'mer', city: 'Meridian', name: 'Monarchs', abbrev: 'MER', conference: 'West', division: 'Southwest', colors: ['#3c1361', '#e0b0ff'], arena: 'Monarch Court' },
  { id: 'hou', city: 'Houston', name: 'Wildcatters', abbrev: 'HOU', conference: 'West', division: 'Southwest', colors: ['#002d62', '#eb6e1f'], arena: 'Derrick Field House' },
  { id: 'dal', city: 'Dallas', name: 'Brahmas', abbrev: 'DAL', conference: 'West', division: 'Southwest', colors: ['#00285e', '#8d9093'], arena: 'Trinity River Arena' },
  { id: 'phx', city: 'Phoenix', name: 'Roadrunners', abbrev: 'PHX', conference: 'West', division: 'Southwest', colors: ['#cb4e18', '#3b2322'], arena: 'Sonoran Bowl' },
  { id: 'nol', city: 'New Orleans', name: 'Brass', abbrev: 'NOL', conference: 'West', division: 'Southwest', colors: ['#0c2340', '#b4975a'], arena: 'Crescent City Hall' },
];
