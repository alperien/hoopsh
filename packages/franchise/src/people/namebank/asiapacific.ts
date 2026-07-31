/**
 * people/namebank/asiapacific.ts - the NBL pathway (Australia and New
 * Zealand) plus the rare-by-design East Asian pipelines.
 *
 * Australia carries two identities: the anglo mainline and the
 * Sudanese-Australian generation (Dinka families resettled in Melbourne
 * and Perth), whose names pair Dinka-to-Dinka and whose birthplaces
 * include the registered refugee corridor. New Zealand pairs anglo,
 * Maori, and Pasifika names inside one identity's pools with matched
 * frequency.
 */
import type { Identity } from './pool.js';
import { flat, pool, w } from './pool.js';

const AUSTRALIA: Identity = {
  id: 'au', kind: 'international', nationality: 'Australia', weight: 5,
  first: flat(pool(
    w(3, 'Lachlan', 'Mitchell', 'Callum', 'Angus', 'Hamish', 'Fraser', 'Declan', 'Riley', 'Flynn', 'Harrison'),
    w(1, 'Bailey', 'Cooper', 'Baxter', 'Beau', 'Taj', 'Nathan', 'Corey', 'Josh', 'Jock', 'Ben',
      'Will', 'Sam', 'Kody', 'Tai', 'Dante', 'Kai', 'Jye', 'Rhys', 'Brodie', 'Clint',
      'Archie', 'Darcy', 'Eamon', 'Ewan', 'Fletcher', 'Harley', 'Jai', 'Zac', 'Kye', 'Lawson', 'Mitch',
      'Cormac', 'Remy', 'Rory', 'Seamus'),
  )),
  last: pool(
    w(3, 'Hartley', 'Kearney', 'Broome', 'Sutherland', 'Farrant', 'McVeigh', 'Ashworth', 'Cavanagh', 'Fenwick', 'Gorman'),
    w(1, 'Harwood', 'Kirkwood', 'Maguire', 'Nettleton', "O'Brien", 'Pemberton', 'Quigley', 'Rutherford', 'Stanton', 'Tuck',
      'Winter', 'Goulding', 'Bairstow', 'Hodgson', 'Pledger', 'Sneddon', 'Talbot', 'Wallis', 'Enright', 'Kay'),
  ),
  cities: pool(
    w(3, 'Melbourne, Australia', 'Sydney, Australia', 'Brisbane, Australia', 'Perth, Australia'),
    w(1, 'Adelaide, Australia', 'Canberra, Australia', 'Hobart, Australia', 'Geelong, Australia',
      'Gold Coast, Australia', 'Newcastle, Australia', 'Cairns, Australia', 'Wollongong, Australia'),
  ),
  clubCountries: ['Australia', 'Australia', 'Australia', 'New Zealand'],
};

// REAL story: the South Sudanese resettlement generation of Melbourne and
// Perth. Names pair Dinka-to-Dinka; the birth arc spans Australian
// suburbs and the refugee corridor, both registered here.
const SUDANESE_AUSTRALIAN: Identity = {
  id: 'au-ss', kind: 'international', nationality: 'Australia', heritage: 'Sudanese-Australian', weight: 2,
  first: flat(pool(
    w(3, 'Duop', 'Thon', 'Makur', 'Kuany', 'Deng', 'Ater', 'Majok', 'Bul', 'Garang', 'Chol'),
    w(1, 'Madut', 'Mangok', 'Jok', 'Akech', 'Atem', 'Mabor', 'Dau', 'Panom', 'Kuol', 'Awer',
      'Kur', 'Buay', 'Wani'),
  )),
  last: pool(
    w(3, 'Deng', 'Kuol', 'Malith', 'Aguek', 'Ajak', 'Dau', 'Gak', 'Marial', 'Jok', 'Ring'),
    w(1, 'Akol', 'Mawien', 'Lual', 'Gai', 'Duany', 'Atem', 'Awan', 'Chuol', 'Mabil', 'Wal'),
  ),
  cities: pool(
    w(3, 'Melbourne, Australia', 'Perth, Australia'),
    w(1, 'Adelaide, Australia', 'Sydney, Australia', 'Brisbane, Australia'),
  ),
  diasporaCities: pool(
    w(2, 'Juba, South Sudan', 'Kakuma, Kenya'),
    w(1, 'Cairo, Egypt', 'Khartoum, Sudan'),
  ),
  diasporaRate: 0.3, // FEEL: the older half of the cohort was born on the corridor
  clubCountries: ['Australia', 'Australia', 'New Zealand'],
};

const NEW_ZEALAND: Identity = {
  id: 'nz', kind: 'international', nationality: 'New Zealand', weight: 1,
  first: flat(pool(
    w(2, 'Finn', 'Tom', 'Ethan', 'Rangi', 'Manaia', 'Ariki', 'Nikau', 'Tane', 'Sione', 'Tevita'),
    w(1, 'Wiremu', 'Anaru', 'Hemi', 'Mikaere', 'Tai', 'Malakai', 'Mose', 'Josh', 'Sam', 'Kahu',
      'Kauri', 'Nikora', 'Taine', 'Beauden', 'Matiu', 'Rawiri'),
  )),
  last: pool(
    w(2, 'Ngata', 'Parata', 'Waititi', 'Kereama', 'Pohatu', 'Fotu', 'Latu', 'Havili', 'Fifita', 'Delany'),
    w(1, 'Waaka', 'Herewini', 'Taufa', 'Vaka', 'Sopoaga', 'Tuilagi', 'Abercrombie', 'Webster', 'Harris', 'Le Va'),
  ),
  cities: pool(
    w(3, 'Auckland, New Zealand', 'Wellington, New Zealand'),
    w(1, 'Christchurch, New Zealand', 'Hamilton, New Zealand', 'Tauranga, New Zealand',
      'Rotorua, New Zealand', 'Porirua, New Zealand'),
  ),
  clubCountries: ['New Zealand', 'Australia', 'Australia'],
};

const JAPAN: Identity = {
  id: 'jp', kind: 'international', nationality: 'Japan', weight: 2,
  first: flat(pool(
    w(3, 'Yuta', 'Ren', 'Sota', 'Daiki', 'Haruto', 'Kenta', 'Riku', 'Yuki', 'Takumi', 'Sho'),
    w(1, 'Wataru', 'Keisuke', 'Makoto', 'Hiroki', 'Kaito', 'Yudai', 'Shota', 'Ryusei', 'Rui', 'Kohei',
      'Daichi', 'Hayato', 'Itsuki', 'Kazuki', 'Kota', 'Ryota', 'Shun', 'Sora', 'Taiga', 'Tatsuki',
      'Yusuke', 'Takeshi', 'Kenji', 'Satoshi', 'Ryoma', 'Tsubasa', 'Koki'),
  )),
  last: pool(
    w(3, 'Tanaka', 'Sato', 'Suzuki', 'Takahashi', 'Ito', 'Yamamoto', 'Nakamura', 'Kobayashi', 'Kato', 'Yoshida'),
    w(1, 'Yamada', 'Sasaki', 'Matsumoto', 'Inoue', 'Kimura', 'Hayashi', 'Shimizu', 'Watanabe', 'Fujita', 'Nakano',
      'Ogawa', 'Murakami', 'Ishikawa', 'Endo', 'Aoki', 'Okada', 'Maeda', 'Fujii', 'Morita', 'Harada',
      'Kawamura', 'Taniguchi', 'Nishida', 'Togashi', 'Hara'),
  ),
  cities: pool(
    w(3, 'Tokyo, Japan', 'Osaka, Japan', 'Yokohama, Japan'),
    w(1, 'Sendai, Japan', 'Nagoya, Japan', 'Fukuoka, Japan', 'Sapporo, Japan', 'Chiba, Japan'),
  ),
  clubCountries: ['Japan', 'Japan', 'Australia'],
};

const CHINA: Identity = {
  id: 'cn', kind: 'international', nationality: 'China', weight: 1,
  first: flat(pool(
    w(3, 'Hao', 'Wei', 'Jian', 'Cheng', 'Lei', 'Peng', 'Bo', 'Tao', 'Zhen', 'Junjie'),
    w(1, 'Haoran', 'Yuxuan', 'Zihao', 'Mingze', 'Kai', 'Rui', 'Xiang', 'Yifan', 'Zeyu', 'Qiang',
      'Bin', 'Chao', 'Hui', 'Ning', 'Sheng', 'Feng', 'Jun', 'Liang', 'Xin', 'Zhuo'),
  )),
  last: pool(
    w(3, 'Wang', 'Li', 'Zhang', 'Liu', 'Chen', 'Yang', 'Zhao', 'Zhou', 'Wu', 'Xu'),
    w(1, 'Sun', 'Ma', 'Zhu', 'Hu', 'Guo', 'Lin', 'He', 'Gao', 'Luo', 'Zheng'),
  ),
  cities: pool(
    w(3, 'Beijing, China', 'Shanghai, China', 'Guangzhou, China'),
    w(1, 'Shenyang, China', 'Dongguan, China', 'Xinjiang, China', 'Qingdao, China', 'Nanjing, China'),
  ),
  clubCountries: ['China', 'China', 'Australia'],
};

const PHILIPPINES: Identity = {
  id: 'ph', kind: 'international', nationality: 'Philippines', weight: 1,
  first: flat(pool(
    w(3, 'Paolo', 'Carlo', 'Angelo', 'Renzo', 'Francis', 'Arvin', 'Jerome', 'Marlon', 'Joshua', 'Jayson'),
    w(1, 'Jayvee', 'Miguel', 'Enzo', 'Gab', 'Rafael', 'Marco', 'Christian', 'Aljon', 'Jopet', 'Ricci',
      'Jio', 'Nino', 'Jed'),
  )),
  last: pool(
    w(3, 'Santos', 'Cruz', 'Bautista', 'Ocampo', 'Ramos', 'Aquino', 'Villanueva', 'Castro', 'Tolentino', 'Salvador'),
    w(1, 'Dizon', 'Mercado', 'Navarro', 'Pineda', 'Soriano', 'Manalo', 'Fajardo', 'Abueva', 'Reyes', 'Lim'),
  ),
  cities: pool(
    w(3, 'Manila, Philippines', 'Quezon City, Philippines'),
    w(1, 'Cebu City, Philippines', 'Davao City, Philippines', 'Cagayan de Oro, Philippines'),
  ),
  clubCountries: ['Philippines', 'Philippines', 'Japan', 'Australia'],
};

export const ASIA_PACIFIC_IDENTITIES: readonly Identity[] = [
  AUSTRALIA, SUDANESE_AUSTRALIAN, NEW_ZEALAND, JAPAN, CHINA, PHILIPPINES,
];
