/**
 * people/namebank/us.ts - United States naming identities.
 *
 * The US is the majority of the league, so it gets the deepest treatment:
 * first-name pools are ERA TABLES keyed by birth decade (a prospect born
 * 2007 draws Jayden/Jalen/Amari-era names, a coach born 1968 draws
 * Rick/Mike/Reggie-era names), and surnames come from culture-consistent
 * pools at census-like weights (Williams/Johnson/Jackson heavy in the
 * Black American pool). All weights are FEEL, shaped by hand against real
 * roster and Social Security-era naming memory, not scraped data.
 */
import type { EraPools, Identity, WeightedPool } from './pool.js';
import { byEra, flat, pool, w } from './pool.js';

// ---------------------------------------------------------------------------
// Black American first names by era

const BLACK_ERAS: EraPools = {
  // births 1955-1974: the names on 1980s-90s rosters and today's benches
  c1955: pool(
    w(6, 'Michael', 'James', 'Robert', 'David', 'Anthony', 'Kevin', 'Eric', 'Marcus', 'Charles', 'Reggie',
      'Andre', 'Derrick', 'Terry', 'Tony', 'Darryl', 'Kenny', 'Ricky', 'Eddie', 'Larry', 'Willie'),
    w(3, 'Maurice', 'Bernard', 'Earl', 'Vernon', 'Tyrone', 'Byron', 'Cedric', 'Alvin', 'Sidney', 'Otis',
      'Leon', 'Melvin', 'Curtis', 'Dennis', 'Gerald', 'Harold', 'Clarence', 'Roosevelt', 'Leroy', 'Marvin',
      'Gregory', 'Darnell', 'Rodney', 'Dwayne', 'Lamont', 'Kelvin', 'Roderick', 'Antoine', 'Horace', 'Alonzo',
      'Wendell', 'Lionel', 'Winston', 'Ronnie', 'Jerome', 'Jerry', 'Richard', 'Frank', 'Joe', 'Sam',
      'George', 'Dwight', 'Ralph', 'Stanley', 'Wayne', 'Keith', 'Barry', 'Rickey', 'Glenn', 'Donnie'),
    w(1, 'Demetrius', 'Isiah', 'Alfred', 'Arthur', 'Benny', 'Carlton', 'Cornelius', 'Darrell', 'Donnell', 'Duane',
      'Ernest', 'Freddie', 'Grady', 'Hubert', 'Irving', 'Jessie', 'Lamar', 'Lester', 'Luther', 'Nathaniel',
      'Odell', 'Percy', 'Randolph', 'Roscoe', 'Rufus', 'Theodore', 'Ulysses', 'Vince', 'Wallace', 'Wilbert',
      'Clyde', 'Walt', 'Herbert', 'Sylvester', 'Elston', 'Cleveland', 'Ervin', 'Norman', 'Amos', 'Cecil',
      'Chester', 'Claude', 'Clifton', 'Cornell', 'Dexter', 'Donald', 'Edgar', 'Edwin', 'Elbert', 'Garfield',
      'Harvey', 'Hollis', 'Ike', 'Junius', 'Lavell', 'Napoleon', 'Odis', 'Ollie', 'Rudy', 'Sammie',
      'Virgil', 'Wardell', 'Julius', 'Reuben', 'Booker', 'Alphonso', 'Bennie', 'Ossie', 'Prentice'),
  ),
  // births 1975-1989: the 90s-2000s draft classes
  c1975: pool(
    w(6, 'Chris', 'Jason', 'Marcus', 'Jamal', 'Brandon', 'Andre', 'Anthony', 'Michael', 'Corey', 'Terrell',
      'Darius', 'Malik', 'Rashad', 'Jermaine', 'Kevin', 'Derrick', 'Marquis', 'Damon', 'Josh', 'Justin'),
    w(3, 'Rasheed', 'Rashard', 'Antawn', 'Shawn', 'DeShawn', 'Jarvis', 'Quentin', 'Kenyon', 'Desmond', 'Omar',
      'Khalid', 'Stephon', 'Chauncey', 'Baron', 'Tayshaun', 'Kendrick', 'Deron', 'Jamaal', 'Jamar', 'Kareem',
      'Hakim', 'Tariq', 'Dante', 'Demetrius', 'Antonio', 'Terrence', 'Terrance', 'Lamar', 'Sean', 'Devin',
      'Tremaine', 'Marlon', 'Jerome', 'Kwame', 'Rahim', 'DeMarcus', 'DeAndre', 'Jalen', 'Javon', 'Keon'),
    w(1, 'Tyree', 'Torrey', 'Jamel', 'Antwan', 'Ahmad', 'Akeem', 'Bilal', 'Cordell', 'Damion', 'Deion',
      'Deonte', 'Donnell', 'Dorian', 'Gerald', 'Hassan', 'Ishmael', 'Jabari', 'Keshawn', 'Marquise', 'Mustafa',
      'Quincy', 'Rashaan', 'Rashawn', 'Salim', 'Solomon', 'Tyrell', 'Xavier', 'Zach', 'Emmanuel', 'Everett',
      'Jaleel', 'Donte', 'Tyron', 'Monta', 'Kelvin', 'Maurice', 'Reggie', 'Cedric', 'Cortez', 'Demario',
      'Demond', 'Dontrell', 'Kejuan', 'Keyon', 'Lamarcus', 'Marquez', 'Montrell', 'Rashan', 'Rodrick', 'Sedrick',
      'Sharif', 'Tavaris', 'Tevin', 'Torrance', 'Tramaine', 'Tyshaun', 'Darian', 'Jarrell', 'Jerrod', 'Kenyatta',
      'Marcell', 'Roshown', 'Jamario', 'DeAngelo', 'DeJuan', 'DeMarco', 'Kedrick', 'Tyrus', 'Damani', 'Hakeem',
      'Jameel', 'Kamal', 'Naeem', 'Raheem'),
  ),
  // births 1990-1999: today's veterans
  c1990: pool(
    w(6, 'Devin', 'Jalen', 'Malik', 'Isaiah', 'Jordan', 'Justin', 'Josh', 'DeAndre', 'Jaylen', 'Zach',
      'Aaron', 'Malcolm', 'Xavier', 'Cameron', 'Donovan', 'Trey', 'Darius', 'Tyler', 'Jamal', 'Marcus'),
    w(3, "D'Angelo", "De'Aaron", 'Devonte', 'Deonte', 'Kris', 'Jabari', 'Emmanuel', 'Kevon', 'Myles', 'Miles',
      'Terry', 'Tyus', 'Kadeem', 'Keldon', 'Immanuel', 'Cassius', 'Amir', 'Micah', 'Josiah', 'Jeremiah',
      'Tre', 'Trevon', 'Javonte', 'Davion', 'Denzel', 'Elijah', 'Kyle', 'Jarrett', 'Shaquille', 'Montez'),
    w(1, 'Tyrese', 'Amari', 'Wendell', 'Fred', 'Gary', 'Larry', 'Semaj', 'Tyquan', 'Tyshawn', 'Jaquan',
      'Daquan', 'Keandre', 'Deshawn', 'Jamir', 'Nasir', 'Zaire', 'Ahmad', 'Bilal', 'Omari', 'Jaren',
      'Jaylin', 'Jaylon', 'Kobe', 'Romeo', 'Lonnie', 'Terance', 'Zion', 'Jahlil', 'Kamren', 'Delon',
      'Dejounte', 'Karl', 'Frank', 'Rayshaun', 'Scottie', 'Jayson', 'Andre', 'Chris', 'Brandon', 'Kenneth',
      'Raekwon', 'Malachi', 'Damian', 'Darion', 'Deante', 'Devante', 'Diante', 'Javion', 'Keontae', 'Marquell',
      'Quenton', 'Tyjon', 'Zavion', 'Jakobe', 'Kentavious', 'Jashawn', 'Trevion', 'Tremont', 'Jaydon', 'Kyron',
      "Ja'Marcus", "Da'Sean", "De'Anthony", "D'Andre", 'Jerian', 'Marreese', 'Treveon'),
  ),
  // births 2000-2009: the current draft-class era
  c2000: pool(
    w(6, 'Jayden', 'Jalen', 'Jaylen', 'Amari', 'Tyrese', 'Elijah', 'Isaiah', 'Josiah', 'Jeremiah', 'Jaden',
      'Zion', 'Amir', 'Micah', 'Xavier', 'Jamir', 'Nasir', 'Josh', 'Jordan', 'Cam', 'Mekhi'),
    w(3, 'Jaylin', 'Jaylon', 'Jamari', 'Kamari', 'Zavier', 'Semaj', 'Keon', 'Keyonte', 'Kobe', 'Trey',
      'Tre', 'DeAndre', 'Javon', 'Javonte', 'Davion', 'Darius', 'Donovan', 'Malik', 'Zaire', 'Kameron',
      'Caleb', 'Isaac', 'Noah', 'Jaiden', 'Bryce', 'Bryson', 'Kyree', 'Omarion', 'Michael', 'Anthony',
      'Isiah', 'Jaheim', 'Makhi', 'Ahmir', 'Kylan'),
    w(1, "De'Aaron", "D'Angelo", "Ja'Quan", "La'Darius", 'Anfernee', 'Makai', 'Amare', 'Zyaire', 'Kamren', 'Tyrek',
      'Rasheed', 'Jahmir', 'Jaire', 'Jamal', 'Marcus', 'Chris', 'Ethan', 'Aiden', 'Zayden', 'Jaylan',
      'Chance', 'Sincere', 'Messiah', 'King', 'Prince', 'Kingston', 'Braylon', 'Jaxon', 'Karter', 'Zamir',
      'Zahir', 'Tyree', 'Keshawn', 'Deshawn', 'Rashad', 'Jasiah', 'Kyrie', 'Zyon', 'Kyshawn', 'Jahvon',
      'Jaquez', 'Jamarion', 'Tyrin', 'Kaleb', 'Izaiah', 'Kylin', 'Amarion', 'Damarion', 'Jamil', 'Khalif',
      'Jasir', 'Tyshon', 'Jakhi', 'Nazir', 'Khyree', "Ja'Kobe", "Ja'Mari", 'Trentyn', 'Kanon'),
  ),
  // births 2010+: the far cohort, HELD for every later birth (registered)
  c2010: pool(
    w(6, 'Kayden', 'Jayden', 'Amir', 'Zion', 'Josiah', 'Elijah', 'Isaiah', 'Micah', 'Amari', 'Aiden',
      'Kairo', 'Jalen', 'Kingston', 'Mekhi', 'Ahmir', 'Zaire', 'Jayce', 'Karter', 'Kason', 'Bryson'),
    w(3, 'Zayden', 'Kylan', 'Kyree', 'Zyaire', 'Makai', 'Sincere', 'Messiah', 'King', 'Legend', 'Braylon',
      'Zahir', 'Zamir', 'Xavier', 'Jordan', 'Michael', 'Josh', 'Noah', 'Isaac', 'Caleb', 'Jaden',
      'Omarion', 'Jamari', 'Kamari', 'Keon', 'Trey', 'Malik', 'Darius', 'Javon', 'Bryce', 'Bryson'),
    w(1, 'Prince', 'Kyrie', 'Dior', 'Osiris', 'Amiri', 'Kaison', 'Jaxson', 'Cassius', 'Denzel', 'Anthony',
      'Jayceon', 'Kyler', 'Zeke', 'Jream', 'Saint', 'Reign', 'Khai', 'Jahmir', 'Nasir', 'Jamir',
      'Tyrese', 'Jaylen', 'Jaylin', 'Jaylon', 'Semaj', 'Zavier', 'Makhi', 'Jaheim', 'Chance', 'Kameron',
      'Kaiden', 'Zaiden', 'Khamari', 'Zyair', 'Kymani', 'Jahmari', 'Samir', 'Bakari', 'Jelani'),
  ),
};

// ---------------------------------------------------------------------------
// White American first names by era

const WHITE_ERAS: EraPools = {
  c1955: pool(
    w(6, 'Mike', 'Rick', 'Steve', 'Jeff', 'Mark', 'Scott', 'Greg', 'Dave', 'Dan', 'Jim',
      'Bob', 'Bill', 'Tom', 'John', 'Paul', 'Gary', 'Larry', 'Randy', 'Craig', 'Doug'),
    w(3, 'Brad', 'Kurt', 'Kirk', 'Keith', 'Kevin', 'Brian', 'Alan', 'Glenn', 'Dale', 'Dean',
      'Don', 'Ron', 'Roger', 'Terry', 'Tim', 'Tony', 'Wayne', 'Wes', 'Chuck', 'Jerry',
      'Richard', 'Rich', 'Dennis', 'Frank', 'Jack', 'Ken', 'Norm', 'Stan', 'Ted', 'Fred',
      'Phil', 'Pete', 'Ray', 'Roy', 'Russ', 'Joel', 'Monty', 'Gregg'),
    w(1, 'Bruce', 'Barry', 'Carl', 'Clark', 'Clay', 'Cliff', 'Curt', 'Duane', 'Dwight', 'Eddie',
      'Ernie', 'Gene', 'Gordon', 'Herb', 'Howard', 'Jay', 'Jon', 'Lee', 'Lenny', 'Lou',
      'Marty', 'Matt', 'Mitch', 'Neal', 'Nick', 'Pat', 'Perry', 'Ralph', 'Rex', 'Rod',
      'Rusty', 'Vic', 'Wally', 'Walt', 'Warren', 'Stu', 'Vern', 'Hal', 'Al', 'Arnie',
      'Barney', 'Bernie', 'Burt', 'Cary', 'Conrad', 'Elmer', 'Garth', 'Gil', 'Gus', 'Herman',
      'Ira', 'Leland', 'Lowell', 'Mel', 'Royce', 'Sheldon', 'Wilbur', 'Monte', 'Blaine', 'Delbert',
      'Erwin', 'Grover', 'Willard'),
  ),
  c1975: pool(
    w(6, 'Jason', 'Ryan', 'Matt', 'Josh', 'Nick', 'Adam', 'Justin', 'Brian', 'Kyle', 'Sean',
      'Zach', 'Luke', 'Travis', 'Chad', 'Casey', 'Jared', 'Brent', 'Shane', 'Derek', 'Jeremy'),
    w(3, 'Dustin', 'Cody', 'Brendan', 'Brett', 'Blake', 'Colin', 'Cory', 'Drew', 'Dylan', 'Evan',
      'Garrett', 'Grant', 'Ian', 'Jake', 'Jesse', 'Joel', 'Jordan', 'Mitchell', 'Nathan', 'Nolan',
      'Patrick', 'Ross', 'Seth', 'Spencer', 'Tanner', 'Taylor', 'Trent', 'Trevor', 'Troy', 'Tyler',
      'Wade', 'Aaron', 'Shawn', 'Stephen', 'Steven', 'Thomas', 'Tim', 'Will', 'Kevin', 'Scott',
      'Andrew', 'Eric', 'Jeff', 'Mike', 'Chris'),
    w(1, 'Austin', 'Beau', 'Brady', 'Caleb', 'Cameron', 'Chase', 'Clay', 'Clint', 'Cole', 'Gabe',
      'Graham', 'Heath', 'Hunter', 'Jack', 'Joey', 'Johnny', 'Jonah', 'Keegan', 'Kirk', 'Kris',
      'Lance', 'Levi', 'Logan', 'Lucas', 'Marc', 'Micah', 'Morgan', 'Nate', 'Neil', 'Owen',
      'Parker', 'Paul', 'Peter', 'Phillip', 'Preston', 'Quinn', 'Reid', 'Riley', 'Robbie', 'Tate',
      'Toby', 'Todd', 'Tommy', 'Tucker', 'Ty', 'Vince', 'William', 'Zane', 'Connor', 'Landry',
      'Bart', 'Brant', 'Corbin', 'Dirk', 'Erik', 'Kasey', 'Kellen', 'Kurtis', 'Lyle', 'Mickey',
      'Scotty', 'Thad'),
  ),
  c1990: pool(
    w(6, 'Tyler', 'Austin', 'Hunter', 'Dylan', 'Connor', 'Logan', 'Cole', 'Chase', 'Blake', 'Cody',
      'Zach', 'Jake', 'Luke', 'Sam', 'Ryan', 'Josh', 'Jack', 'Ethan', 'Mason', 'Alex'),
    w(3, 'Alec', 'Brayden', 'Brennan', 'Brody', 'Bryce', 'Caleb', 'Cameron', 'Carter', 'Christian', 'Colby',
      'Colin', 'Colton', 'Dalton', 'Dawson', 'Dillon', 'Drew', 'Eli', 'Elliot', 'Evan', 'Garrett',
      'Gavin', 'Grant', 'Griffin', 'Harrison', 'Hayden', 'Ian', 'Jackson', 'Jonah', 'Jordan', 'Keaton',
      'Keegan', 'Kyle', 'Landon', 'Levi', 'Lucas', 'Max', 'Nathan', 'Nick', 'Nolan', 'Owen',
      'Parker', 'Peyton', 'Preston', 'Riley', 'Seth', 'Spencer', 'Tanner', 'Tristan', 'Tucker', 'Wyatt',
      'Cooper', 'Carson', 'Trevor', 'Zane', 'Reid', 'Andrew', 'Matt', 'Nathaniel', 'Will', 'Brandon'),
    w(1, 'Bennett', 'Bradley', 'Brock', 'Camden', 'Charlie', 'Clay', 'Clayton', 'Gage', 'Grayson', 'Holden',
      'Jaden', 'Jesse', 'Joel', 'Kade', 'Kyler', 'Lane', 'Micah', 'Mitchell', 'Payton', 'Quinn',
      'Rhett', 'Sawyer', 'Shane', 'Tate', 'Trent', 'Ty', 'Walker', 'Wesley', 'Weston', 'Gunnar',
      'Dustin', 'Brendan', 'Jarrod', 'Skyler', 'Braden', 'Kolton', 'Ashton', 'Brycen', 'Kian', 'Trace',
      'Zachariah', 'Dane', 'Reece', 'Ronan'),
  ),
  c2000: pool(
    w(6, 'Cade', 'Carson', 'Cooper', 'Braden', 'Cam', 'Bryce', 'Wyatt', 'Landon', 'Gavin', 'Brody',
      'Aiden', 'Jackson', 'Grayson', 'Easton', 'Ethan', 'Luke', 'Mason', 'Owen', 'Jaxon', 'Hudson'),
    w(3, 'Braxton', 'Brayden', 'Bryson', 'Camden', 'Cash', 'Colt', 'Colton', 'Dawson', 'Drew', 'Eli',
      'Emmett', 'Finn', 'Griffin', 'Holden', 'Jace', 'Jett', 'Jonah', 'Kade', 'Kaden', 'Kyler',
      'Levi', 'Max', 'Nolan', 'Parker', 'Peyton', 'Rhett', 'Sawyer', 'Tate', 'Tucker', 'Walker',
      'Weston', 'Zane', 'Bennett', 'Brooks', 'Asher', 'Silas', 'Micah', 'Tanner', 'Colby', 'Jameson',
      'Everett', 'Roman', 'Jaxson', 'Ryder', 'Miles'),
    w(1, 'Ayden', 'Beckett', 'Boone', 'Cruz', 'Dax', 'Gage', 'Hayes', 'Jayden', 'Jude', 'Kayden',
      'Lincoln', 'Maddox', 'Nash', 'Paxton', 'Reed', 'Rocco', 'Rowan', 'Ryker', 'Waylon', 'Grady',
      'Ezra', 'Jasper', 'Knox', 'Kash', 'Kolton', 'Lane', 'Maverick', 'Tripp', 'Chandler', 'Gunner',
      'Bowen', 'Cannon', 'Daxton', 'Kamden', 'Kyson', 'Tobias', 'Bridger', 'Cason', 'Stetson', 'Baylor',
      'Creed', 'Kase'),
  ),
  c2010: pool(
    w(6, 'Levi', 'Asher', 'Hudson', 'Lincoln', 'Jaxon', 'Owen', 'Wyatt', 'Grayson', 'Maverick', 'Ezra',
      'Mason', 'Aiden', 'Ethan', 'Silas', 'Waylon', 'Beau', 'Brooks', 'Walker', 'Weston', 'Theo'),
    w(3, 'Boone', 'Cash', 'Colt', 'Crew', 'Rhett', 'Ryker', 'Beckett', 'Bennett', 'Emmett', 'Everett',
      'Finn', 'Jude', 'Kai', 'Knox', 'Nash', 'Roman', 'Rowan', 'Sawyer', 'Jett', 'Hayes',
      'Cade', 'Cooper', 'Easton', 'Jackson', 'Landon', 'Luke', 'Bryce', 'Camden', 'Jameson', 'Miles'),
    w(1, 'Ace', 'Bo', 'Bodie', 'Briggs', 'Cal', 'Ford', 'Kash', 'Otto', 'Ridge', 'Rocco',
      'Tripp', 'Wells', 'Wilder', 'Zane', 'Zeke', 'Dax', 'Cruz', 'Gunner', 'Koa', 'Banks',
      'Colter', 'Harlan', 'Judah'),
  ),
};

// ---------------------------------------------------------------------------
// US surnames, split by culture lean

/**
 * Anglo surnames plausible in both the Black and White American pools.
 * Weight 1 base layer; the per-culture tiers below add census-like mass on
 * top (duplicate entries legally sum their weights).
 */
const LAST_SHARED = [
  'Abbott', 'Adams', 'Adkins', 'Alexander', 'Alford', 'Allen', 'Anderson', 'Andrews', 'Archer', 'Armstrong',
  'Arnett', 'Atkins', 'Austin', 'Avery', 'Ayers', 'Bailey', 'Baker', 'Baldwin', 'Banks', 'Barber',
  'Barlow', 'Barnes', 'Barnett', 'Barrett', 'Barron', 'Bass', 'Bates', 'Baxter', 'Beasley', 'Beck',
  'Bell', 'Bennett', 'Benson', 'Bentley', 'Berry', 'Bishop', 'Black', 'Blackwell', 'Blair', 'Bledsoe',
  'Bolton', 'Bond', 'Boone', 'Booth', 'Boswell', 'Bowen', 'Bowers', 'Bowman', 'Boyd', 'Bradford',
  'Bradley', 'Bradshaw', 'Brady', 'Branch', 'Brandon', 'Brantley', 'Brewer', 'Bridges', 'Briggs', 'Bright',
  'Britt', 'Brock', 'Brooks', 'Brown', 'Browning', 'Bruce', 'Bryant', 'Buchanan', 'Buckley', 'Buckner',
  'Bullock', 'Burgess', 'Burke', 'Burnett', 'Burns', 'Burton', 'Bush', 'Butler', 'Byers', 'Byrd',
  'Cain', 'Caldwell', 'Callahan', 'Campbell', 'Cannon', 'Carey', 'Carmichael', 'Carpenter', 'Carr', 'Carroll',
  'Carson', 'Carter', 'Carver', 'Case', 'Cash', 'Chambers', 'Chandler', 'Chapman', 'Charles', 'Cherry',
  'Chester', 'Christian', 'Clark', 'Clarke', 'Clay', 'Clayton', 'Cobb', 'Coffey', 'Cole', 'Coleman',
  'Collier', 'Collins', 'Combs', 'Conley', 'Conner', 'Cook', 'Cooke', 'Cooper', 'Copeland', 'Corbin',
  'Cox', 'Craft', 'Crane', 'Crawford', 'Cross', 'Cummings', 'Cunningham', 'Curry', 'Curtis', 'Dailey',
  'Dalton', 'Daniels', 'Davenport', 'Davidson', 'Davis', 'Dawson', 'Day', 'Dean', 'Delaney', 'Dennis',
  'Denton', 'Dickerson', 'Dixon', 'Donaldson', 'Douglas', 'Downs', 'Doyle', 'Drake', 'Draper', 'Drew',
  'Drummond', 'Dudley', 'Duffy', 'Duke', 'Duncan', 'Dunlap', 'Dunn', 'Durham', 'Dyer', 'Easton',
  'Eaton', 'Edmonds', 'Edwards', 'Elder', 'Elliott', 'Ellis', 'Emerson', 'England', 'English', 'Ennis',
  'Estes', 'Evans', 'Everett', 'Fair', 'Farley', 'Farmer', 'Faulkner', 'Ferguson', 'Fields', 'Finch',
  'Finley', 'Fisher', 'Fitzgerald', 'Fleming', 'Fletcher', 'Flowers', 'Floyd', 'Flynn', 'Forbes', 'Ford',
  'Foreman', 'Forrest', 'Foster', 'Fowler', 'Fox', 'Francis', 'Franklin', 'Frazier', 'Freeman', 'French',
  'Frost', 'Frye', 'Fuller', 'Fulton', 'Gallagher', 'Galloway', 'Gamble', 'Gardner', 'Garland', 'Garner',
  'Garrett', 'Garrison', 'Gates', 'Gentry', 'George', 'Gibbs', 'Gibson', 'Gilbert', 'Giles', 'Gill',
  'Gillespie', 'Gilmore', 'Glass', 'Glenn', 'Golden', 'Goodman', 'Goodwin', 'Gordon', 'Grady', 'Graham',
  'Granger', 'Grant', 'Graves', 'Gray', 'Grayson', 'Green', 'Greer', 'Gregory', 'Grier', 'Griffin',
  'Griffith', 'Grimes', 'Gross', 'Guy', 'Hackett', 'Hagan', 'Hale', 'Haley', 'Hall', 'Hamilton',
  'Hammond', 'Hancock', 'Hardin', 'Harding', 'Hardy', 'Harmon', 'Harper', 'Harrell', 'Harrington', 'Harris',
  'Harrison', 'Hart', 'Harvey', 'Hastings', 'Hatcher', 'Hawkins', 'Hayes', 'Haynes', 'Heard', 'Heath',
  'Henderson', 'Hendricks', 'Henry', 'Hensley', 'Herring', 'Hester', 'Hicks', 'Higgins', 'Hill', 'Hilliard',
  'Hilton', 'Hines', 'Hobbs', 'Hodge', 'Hodges', 'Hogan', 'Holbrook', 'Holden', 'Holiday', 'Holland',
  'Holley', 'Holmes', 'Holt', 'Hood', 'Hooper', 'Hoover', 'Hopkins', 'Horn', 'Horne', 'Horton',
  'Houston', 'Howard', 'Howell', 'Hubbard', 'Hudson', 'Huff', 'Huggins', 'Hughes', 'Hull', 'Humphrey',
  'Hunt', 'Hunter', 'Hurst', 'Hutchins', 'Hutchinson', 'Hyde', 'Ingram', 'Irving', 'Ivey', 'Jackson',
  'Jacobs', 'James', 'Jamison', 'Jarrett', 'Jeffries', 'Jenkins', 'Jennings', 'Jeter', 'Johns', 'Johnson',
  'Jones', 'Jordan', 'Joseph', 'Judd', 'Justice', 'Kane', 'Keating', 'Keller', 'Kelley', 'Kelly',
  'Kemp', 'Kendall', 'Kendrick', 'Kennedy', 'Kent', 'Kerr', 'Key', 'Keyes', 'Kidd', 'Kilgore',
  'Kimble', 'Kincaid', 'King', 'Kirby', 'Kirk', 'Kirkland', 'Knight', 'Knowles', 'Knox', 'Lacey',
  'Lamb', 'Lambert', 'Lancaster', 'Landry', 'Lane', 'Lang', 'Langford', 'Langston', 'Lanier', 'Larkin',
  'Latham', 'Lawrence', 'Lawson', 'Layton', 'Leach', 'Ledbetter', 'Lee', 'Lemon', 'Leonard', 'Lester',
  'Levy', 'Lewis', 'Lindsay', 'Lindsey', 'Little', 'Livingston', 'Lockhart', 'Logan', 'Long', 'Love',
  'Lowe', 'Lowery', 'Lucas', 'Lynch', 'Lyons', 'Maddox', 'Madison', 'Mahoney', 'Major', 'Malone',
  'Mann', 'Manning', 'Marsh', 'Marshall', 'Martin', 'Mason', 'Massey', 'Mathis', 'Matthews', 'Maxwell',
  'May', 'Mayfield', 'Maynard', 'McAdoo', 'McBride', 'McCall', 'McCann', 'McCarthy', 'McClain', 'McClendon',
  'McCloud', 'McConnell', 'McCoy', 'McCullough', 'McDaniel', 'McDowell', 'McGee', 'McGill', 'McGuire', 'McIntosh',
  'McIntyre', 'McKay', 'McKee', 'McKenzie', 'McKinney', 'McKnight', 'McLean', 'McMillan', 'McNeil', 'McQueen',
  'McRae', 'Meadows', 'Medley', 'Melton', 'Mercer', 'Merchant', 'Merrill', 'Merritt', 'Michaels', 'Miles',
  'Miller', 'Mills', 'Milton', 'Mitchell', 'Monroe', 'Montgomery', 'Moody', 'Moon', 'Mooney', 'Moore',
  'Moran', 'Morgan', 'Morris', 'Morrison', 'Morrow', 'Morton', 'Mullen', 'Murphy', 'Murray', 'Myers',
  'Nance', 'Napier', 'Nash', 'Neal', 'Nelson', 'Newman', 'Newton', 'Nichols', 'Nicholson', 'Nixon',
  'Noble', 'Nolan', 'Norris', 'North', 'Norton', 'Norwood', 'Oakley', 'Oliver', 'Osborne', 'Owens',
  'Pace', 'Page', 'Palmer', 'Parker', 'Parks', 'Parrish', 'Parsons', 'Pate', 'Patterson', 'Payne',
  'Peacock', 'Pearson', 'Peck', 'Pendleton', 'Perkins', 'Perry', 'Peters', 'Peterson', 'Phelps', 'Phillips',
  'Pierce', 'Pittman', 'Pollard', 'Poole', 'Pope', 'Porter', 'Potts', 'Powell', 'Preston', 'Price',
  'Pruitt', 'Puckett', 'Pugh', 'Ramsey', 'Randall', 'Randolph', 'Rawlings', 'Ray', 'Reed', 'Reese',
  'Reeves', 'Reid', 'Reynolds', 'Rhodes', 'Rice', 'Richards', 'Richardson', 'Richmond', 'Rider', 'Riggs',
  'Riley', 'Rivers', 'Roach', 'Robbins', 'Roberts', 'Robertson', 'Robinson', 'Rodgers', 'Rogers', 'Roland',
  'Rollins', 'Roper', 'Rose', 'Ross', 'Rowe', 'Rudolph', 'Rush', 'Russell', 'Rutledge', 'Sadler',
  'Sampson', 'Sanders', 'Satterfield', 'Saunders', 'Savage', 'Sawyer', 'Scarborough', 'Schofield', 'Scott', 'Sears',
  'Sexton', 'Shannon', 'Sharp', 'Shaw', 'Shelton', 'Shepherd', 'Sheppard', 'Sherman', 'Shields', 'Shipley',
  'Simmons', 'Simon', 'Simpson', 'Sims', 'Sinclair', 'Singleton', 'Skinner', 'Sloan', 'Small', 'Smart',
  'Smith', 'Snow', 'Snyder', 'Spencer', 'Springer', 'Stafford', 'Staley', 'Stanton', 'Stark', 'Steele',
  'Stephens', 'Stevens', 'Stevenson', 'Steward', 'Stewart', 'Stiles', 'Stone', 'Story', 'Strickland', 'Strong',
  'Stroud', 'Sullivan', 'Summers', 'Sutton', 'Sweeney', 'Swift', 'Tanner', 'Tate', 'Taylor', 'Terry',
  'Thomas', 'Thompson', 'Thornton', 'Thorpe', 'Townsend', 'Tucker', 'Turner', 'Tyler', 'Tyson', 'Underwood',
  'Vaughn', 'Wade', 'Walker', 'Wall', 'Wallace', 'Walton', 'Ward', 'Warren', 'Waters', 'Watkins',
  'Watson', 'Watts', 'Weaver', 'Webb', 'Webster', 'Welch', 'Wells', 'West', 'Whaley', 'Wharton',
  'Wheeler', 'Whitaker', 'White', 'Whitehead', 'Whitley', 'Wilcox', 'Wilder', 'Wilkins', 'Wilkinson', 'Williams',
  'Williamson', 'Willis', 'Wilson', 'Winters', 'Woods', 'Wright', 'Wyatt', 'Yates', 'York', 'Young',
];

/**
 * Distinctly Black American surnames (Southern family names, freedmen-era
 * choices, HBCU-belt names). Only the Black American pool draws these.
 */
const LAST_BLACK_LEAN = [
  'Washington', 'Jefferson', 'Booker', 'Alston', 'Bethea', 'Blackmon', 'Bolden', 'Boykins', 'Broadnax', 'Burrell',
  'Calloway', 'Chatman', 'Dillard', 'Dorsey', 'Dotson', 'Dumas', 'Dunbar', 'Dupree', 'Easley', 'Echols',
  'Epps', 'Ervin', 'Eubanks', 'Felder', 'Felton', 'Fortson', 'Gaines', 'Gaskins', 'Gilliam', 'Gipson',
  'Gladden', 'Glover', 'Guyton', 'Hairston', 'Hampton', 'Hargrove', 'Herndon', 'Hollins', 'Holloway', 'Ivory',
  'Joiner', 'Joyner', 'Leggett', 'Lett', 'Lightfoot', 'Littlejohn', 'Lockett', 'Lofton', 'Lott', 'Lovett',
  'Loyd', 'Luckett', 'Lyles', 'Mack', 'Marable', 'Mayes', 'Mays', 'McCray', 'McFadden', 'McGriff',
  'McLaurin', 'McNair', 'McNeal', 'Meriweather', 'Mims', 'Mosley', 'Moss', 'Motley', 'Nesbitt', 'Newsome',
  'Nunn', 'Odom', 'Pettway', 'Poindexter', 'Pryor', 'Purvis', 'Quarles', 'Rainey', 'Randle', 'Ransom',
  'Redd', 'Redding', 'Redmond', 'Renfro', 'Ricks', 'Riddick', 'Ridley', 'Roberson', 'Rucker', 'Ruffin',
  'Ryals', 'Salters', 'Sandifer', 'Sapp', 'Scales', 'Scruggs', 'Seals', 'Sellers', 'Settles', 'Shorter',
  'Slade', 'Slaughter', 'Smalls', 'Snead', 'Snell', 'Sparks', 'Spears', 'Speight', 'Spivey', 'Stallworth',
  'Staples', 'Starks', 'Stinson', 'Stokes', 'Stovall', 'Suggs', 'Swann', 'Sykes', 'Talbert', 'Talley',
  'Tatum', 'Thigpen', 'Tillman', 'Tinsley', 'Tolbert', 'Toliver', 'Trice', 'Upshaw', 'Vinson', 'Walls',
  'Ware', 'Whitfield', 'Whitner', 'Whitt', 'Wiggins', 'Wilburn', 'Wiley', 'Wilkerson', 'Winfield', 'Wingate',
  'Winston', 'Witherspoon', 'Woodard', 'Woodson', 'Wooten', 'Worthy', 'Yancey', 'Yarbrough', 'Younger', 'Zachery',
  'Zollicoffer', 'Battle', 'Bellamy', 'Bess', 'Blount', 'Boston', 'Braxton', 'Briscoe', 'Calhoun', 'Cargill',
  'Carrington', 'Cason', 'Chaney', 'Childs', 'Clemons', 'Coates', 'Colbert', 'Cotton', 'Covington', 'Crenshaw',
  'Crockett', 'Crowder', 'Culpepper', 'Culver', 'Dabney', 'Darden', 'Dawkins', 'Dobbins', 'Dyson', 'Ellington',
  'Ellison', 'Elmore', 'Ewell', 'Goldsmith', 'Heyward', 'Pinckney', 'Manigault', 'Middleton', 'Gadson', 'Bacote',
];

/** Census-top mass for the Black American pool (REAL-shaped ordering). */
const BLACK_TOP = w(30,
  'Williams', 'Johnson', 'Jackson', 'Jones', 'Brown', 'Davis', 'Smith', 'Thomas', 'Robinson', 'Harris',
  'Walker', 'Washington', 'Carter', 'Green', 'Lewis', 'Turner', 'Hill', 'Moore', 'White', 'Taylor');
const BLACK_HIGH = w(10,
  'Allen', 'Young', 'King', 'Wright', 'Scott', 'Mitchell', 'Anderson', 'Coleman', 'Henderson', 'Simmons',
  'Patterson', 'Jenkins', 'Butler', 'Brooks', 'Sanders', 'Bryant', 'Alexander', 'Griffin', 'Hayes', 'Watson',
  'James', 'Reed', 'Bell', 'Bailey', 'Richardson', 'Wilson', 'Evans', 'Edwards', 'Collins', 'Stewart',
  'Morris', 'Murphy', 'Cook', 'Rogers', 'Bennett', 'Wood' /* FEEL: thin but real */, 'Barnes', 'Ross', 'Powell', 'Price');

/** Euro-American surnames only the White pool draws (Irish, Italian, German, Polish, Scandinavian lines). */
const LAST_WHITE_EURO = [
  'Schmidt', 'Schneider', 'Schultz', 'Schaefer', 'Hoffman', 'Meyer', 'Mueller', 'Weber', 'Wagner', 'Zimmerman',
  'Kessler', 'Kramer', 'Klein', 'Koch', 'Kraus', 'Lang', 'Baumann', 'Berger', 'Eberhard', 'Fischer',
  'Gruber', 'Hartman', 'Keller', 'Kirchner', 'Lehman', 'Metzger', 'Reinhart', 'Ritter', 'Roth', 'Schwartz',
  'Stein', 'Vogel', 'Wolf', 'Ziegler', 'Brandt', 'Dietrich', 'Engel', 'Franke', 'Hahn', 'Seiler',
  "O'Brien", "O'Connor", "O'Neill", "O'Malley", "O'Donnell", 'Brennan', 'Donovan', 'Flanagan', 'Gallahue', 'Hennessy',
  'Keegan', 'Kelleher', 'Kennedy', 'Maguire', 'McAllister', 'McCafferty', 'McCormick', 'McCracken', 'McDermott', 'McGovern',
  'McGrath', 'McLaughlin', 'McMahon', 'McNamara', 'Nolan', 'Quinn', 'Reilly', 'Rooney', 'Ryan', 'Sheehan',
  'Costello', 'Cassidy', 'Doherty', 'Dolan', 'Duggan', 'Fitzpatrick', 'Fitzsimmons', 'Gleason', 'Hurley', 'Keane',
  'Russo', 'Romano', 'Marino', 'DeLuca', 'Ricci', 'Costa', 'Esposito', 'Ferraro', 'Gallo', 'Greco',
  'Lombardo', 'Mancini', 'Moretti', 'Pellegrino', 'Rizzo', 'Santoro', 'Caruso', 'DeSantis', 'Marchetti', 'Palumbo',
  'Kowalski', 'Nowak', 'Wisniewski', 'Kaminski', 'Zielinski', 'Szymanski', 'Wozniak', 'Kaczmarek', 'Pawlak', 'Gorski',
  'Larson', 'Olson', 'Hansen', 'Johansen', 'Lindberg', 'Lindstrom', 'Nordstrom', 'Sandberg', 'Berg', 'Dahl',
  'Erickson', 'Gustafson', 'Halvorsen', 'Iverson', 'Jorgensen', 'Knutson', 'Magnuson', 'Nyberg', 'Soderberg', 'Thorson',
  'Van Buren', 'Van Dyke', 'Vandenberg', 'Vanderbilt', 'DeVries', 'DeGroot', 'Haas', 'Hoekstra', 'Mulder', 'Prins',
  'Novak', 'Horvath', 'Kovach', 'Toth', 'Varga', 'Molnar', 'Papp', 'Szabo', 'Balogh', 'Farkas',
  'Christensen', 'Nielsen', 'Pedersen', 'Rasmussen', 'Andersen', 'Jensen', 'Madsen', 'Mortensen', 'Poulsen', 'Sorensen',
  'Albrecht', 'Bauer', 'Beckman', 'Brubaker', 'Detweiler', 'Eichelberger', 'Fenstermacher', 'Garber', 'Hostetler', 'Yoder',
  'Stoltzfus', 'Troyer', 'Wenger', 'Zook', 'Rhoads', 'Shirk', 'Weatherford', 'Culbertson', 'Pemberton', 'Whitcomb',
  'Ashworth', 'Blankenship', 'Chastain', 'Crabtree', 'Eldridge', 'Hatfield', 'Huckabee', 'Lovell', 'Meade', 'Prescott',
  'Sizemore', 'Slone', 'Stallard', 'Thacker', 'Vanover', 'Whitt', 'Sexton', 'Combs', 'Caudill', 'Compton',
];

/** Census-top mass for the White American pool. */
const WHITE_TOP = w(30,
  'Smith', 'Miller', 'Anderson', 'Wilson', 'Taylor', 'Thompson', 'Moore', 'Martin', 'White', 'Clark',
  'Hall', 'Baker', 'Nelson', 'Wright', 'Adams', 'Campbell', 'Roberts', 'Phillips', 'Mitchell', 'Walker');
const WHITE_HIGH = w(10,
  'Johnson', 'Brown', 'Davis', 'Jones', 'Williams', 'Allen', 'Young', 'King', 'Scott', 'Hill',
  'Parker', 'Collins', 'Edwards', 'Stewart', 'Morris', 'Murphy', 'Cook', 'Rogers', 'Peterson', 'Cooper',
  'Bailey', 'Reed', 'Kelly', 'Howard', 'Ward', 'Cox', 'Richardson', 'Wood', 'Watson', 'Brooks',
  'Bennett', 'Gray', 'Hughes', 'Price', 'Myers', 'Long', 'Foster', 'Ross', 'Powell', 'Sullivan');

const BLACK_LAST = pool(BLACK_TOP, BLACK_HIGH, w(3, ...LAST_BLACK_LEAN), w(1, ...LAST_SHARED));
const WHITE_LAST = pool(WHITE_TOP, WHITE_HIGH, w(3, ...LAST_WHITE_EURO), w(1, ...LAST_SHARED));

// ---------------------------------------------------------------------------
// US birthplace pools (hotbed-weighted)

const BLACK_CITIES = pool(
  w(6, 'Atlanta, GA', 'Chicago, IL', 'Houston, TX', 'Memphis, TN', 'Washington, DC', 'Los Angeles, CA',
    'Dallas, TX', 'Philadelphia, PA', 'New York, NY', 'Charlotte, NC'),
  w(3, 'Brooklyn, NY', 'Queens, NY', 'Bronx, NY', 'Detroit, MI', 'New Orleans, LA', 'Baltimore, MD',
    'Milwaukee, WI', 'St. Louis, MO', 'Birmingham, AL', 'Jackson, MS', 'Baton Rouge, LA', 'Columbia, SC',
    'Raleigh, NC', 'Durham, NC', 'Greensboro, NC', 'Winston-Salem, NC', 'Richmond, VA', 'Norfolk, VA',
    'Newark, NJ', 'Cleveland, OH', 'Columbus, OH', 'Cincinnati, OH', 'Indianapolis, IN', 'Oakland, CA',
    'Compton, CA', 'Inglewood, CA', 'Long Beach, CA', 'Miami, FL', 'Orlando, FL', 'Jacksonville, FL',
    'Nashville, TN', 'Louisville, KY', 'Kansas City, MO', 'Oklahoma City, OK', 'Little Rock, AR', 'Flint, MI',
    'Gary, IN', 'Dayton, OH', 'Akron, OH', 'Minneapolis, MN'),
  w(1, 'Mobile, AL', 'Montgomery, AL', 'Augusta, GA', 'Savannah, GA', 'Macon, GA', 'Tulsa, OK',
    'Toledo, OH', 'Buffalo, NY', 'Rochester, NY', 'Hartford, CT', 'Bridgeport, CT', 'Trenton, NJ',
    'Camden, NJ', 'Wilmington, DE', 'Seattle, WA', 'Portland, OR', 'Boston, MA', 'Sacramento, CA',
    'San Diego, CA', 'Phoenix, AZ', 'Las Vegas, NV', 'Denver, CO', 'Fayetteville, NC', 'Charleston, SC',
    'Shreveport, LA', 'Tampa, FL', 'Fort Lauderdale, FL', 'Fresno, CA'),
);

const WHITE_CITIES = pool(
  w(3, 'Indianapolis, IN', 'Louisville, KY', 'Lexington, KY', 'Nashville, TN', 'Cincinnati, OH', 'Columbus, OH',
    'Pittsburgh, PA', 'Philadelphia, PA', 'Chicago, IL', 'Minneapolis, MN', 'Salt Lake City, UT', 'Denver, CO',
    'Phoenix, AZ', 'San Diego, CA', 'Portland, OR', 'Seattle, WA', 'Dallas, TX', 'Houston, TX',
    'Atlanta, GA', 'Charlotte, NC'),
  w(1, 'Boise, ID', 'Spokane, WA', 'Omaha, NE', 'Des Moines, IA', 'Iowa City, IA', 'Madison, WI',
    'Milwaukee, WI', 'Green Bay, WI', 'Fargo, ND', 'Sioux Falls, SD', 'Wichita, KS', 'Overland Park, KS',
    'Kansas City, MO', 'Springfield, MO', 'St. Louis, MO', 'Tulsa, OK', 'Oklahoma City, OK', 'Knoxville, TN',
    'Chattanooga, TN', 'Huntsville, AL', 'Roanoke, VA', 'Virginia Beach, VA', 'Richmond, VA', 'Raleigh, NC',
    'Asheville, NC', 'Greenville, SC', 'Jacksonville, FL', 'Tampa, FL', 'Orlando, FL', 'Albany, NY',
    'Syracuse, NY', 'Rochester, NY', 'Buffalo, NY', 'Scranton, PA', 'Allentown, PA', 'Harrisburg, PA',
    'Cleveland, OH', 'Dayton, OH', 'Toledo, OH', 'Akron, OH', 'Fort Wayne, IN', 'Evansville, IN',
    'Bloomington, IN', 'Carmel, IN', 'Grand Rapids, MI', 'Ann Arbor, MI', 'Lansing, MI', 'Detroit, MI',
    'Boston, MA', 'Worcester, MA', 'Springfield, MA', 'Providence, RI', 'Manchester, NH', 'Portland, ME',
    'Burlington, VT', 'Hartford, CT', 'New York, NY', 'Staten Island, NY', 'Austin, TX', 'San Antonio, TX',
    'Fort Worth, TX', 'Plano, TX', 'Lubbock, TX', 'Albuquerque, NM', 'Colorado Springs, CO', 'Provo, UT',
    'Reno, NV', 'Las Vegas, NV', 'Sacramento, CA', 'San Jose, CA', 'Bakersfield, CA', 'Anaheim, CA',
    'Los Angeles, CA', 'San Francisco, CA', 'Honolulu, HI', 'Anchorage, AK', 'Billings, MT', 'Missoula, MT',
    'Cheyenne, WY', 'Rapid City, SD'),
);

// ---------------------------------------------------------------------------
// Latino-American lineages (flat first-name pools; matching surname pools)

const MEXICAN_FIRST = pool(
  w(4, 'Jose', 'Juan', 'Carlos', 'Luis', 'Miguel', 'Angel', 'Jesus', 'Diego', 'Adrian', 'Alejandro'),
  w(2, 'Andres', 'Ramon', 'Ruben', 'Sergio', 'Rafael', 'Armando', 'Marco', 'Emiliano', 'Santiago', 'Julian',
    'Cristian', 'Osvaldo', 'Ricardo', 'Eduardo', 'Fernando', 'Hector', 'Ivan', 'Jorge', 'Manuel', 'Mario',
    'Oscar', 'Pedro', 'Raul', 'Rene', 'Rodolfo', 'Salvador', 'Victor', 'Gilberto', 'Gustavo', 'Ernesto'),
  w(1, 'Emilio', 'Cesar', 'Alonso', 'Abel', 'Isaias', 'Joaquin', 'Lorenzo', 'Mateo', 'Matias', 'Rogelio',
    'Ramiro', 'Ulises', 'Uriel', 'Yahir', 'Alexis', 'Damian', 'Esteban', 'Felipe', 'Gerardo', 'Hugo',
    'Ismael', 'Leonel', 'Maximo', 'Noe', 'Octavio', 'Pablo', 'Rigoberto', 'Rodrigo', 'Saul', 'Tomas',
    'Brayan', 'Efrain', 'Heriberto', 'Moises', 'Nestor', 'Javier', 'Adan', 'Bernardo', 'Horacio', 'Isidro',
    'Filiberto', 'Leobardo'),
);

const MEXICAN_LAST = pool(
  w(4, 'Hernandez', 'Garcia', 'Martinez', 'Lopez', 'Gonzalez', 'Rodriguez', 'Perez', 'Sanchez', 'Ramirez', 'Torres'),
  w(2, 'Flores', 'Rivera', 'Gomez', 'Diaz', 'Reyes', 'Morales', 'Gutierrez', 'Ortiz', 'Chavez', 'Ruiz',
    'Mendoza', 'Vargas', 'Castillo', 'Jimenez', 'Moreno', 'Romero', 'Herrera', 'Medina', 'Aguilar', 'Vega',
    'Castro', 'Fernandez', 'Munoz', 'Rojas', 'Salazar', 'Contreras', 'Guerrero', 'Estrada', 'Ochoa', 'Cervantes'),
  w(1, 'Delgado', 'Fuentes', 'Zavala', 'Villanueva', 'Carrillo', 'Montes', 'Renteria', 'Solis', 'Barrera', 'Ibarra',
    'Cisneros', 'Valdez', 'Velasquez', 'Zamora', 'Trevino', 'Saldana', 'Quintero', 'Pacheco', 'Orozco', 'Nava',
    'Meza', 'Lozano', 'Leon', 'Juarez', 'Huerta', 'Galvan', 'Espinoza', 'Duran', 'Cortez', 'Cardenas',
    'Bustamante', 'Arellano', 'Alvarado', 'Acosta', 'Rosales', 'Tapia', 'Valencia', 'Zuniga', 'Sandoval', 'Cabrera'),
);

const MEXICAN_CITIES = pool(
  w(3, 'San Antonio, TX', 'El Paso, TX', 'Houston, TX', 'Dallas, TX', 'Los Angeles, CA', 'Phoenix, AZ',
    'Fresno, CA', 'San Diego, CA', 'Chicago, IL', 'Albuquerque, NM'),
  w(1, 'Laredo, TX', 'McAllen, TX', 'Brownsville, TX', 'Fort Worth, TX', 'Austin, TX', 'Tucson, AZ',
    'Las Cruces, NM', 'Bakersfield, CA', 'Santa Ana, CA', 'Riverside, CA', 'San Jose, CA', 'Denver, CO',
    'Salinas, CA', 'Oxnard, CA', 'Yuma, AZ', 'Corpus Christi, TX'),
);

const RICAN_FIRST = pool(
  w(3, 'Jose', 'Angel', 'Luis', 'Carlos', 'Hector', 'Edwin', 'Javier', 'Joel', 'Christian', 'Emanuel'),
  w(1, 'Jomar', 'Yadiel', 'Angelo', 'Rafael', 'Ramon', 'Miguel', 'Juan', 'Pedro', 'Orlando', 'Wilfredo',
    'Roberto', 'Nelson', 'Israel', 'Ismael', 'Yandel', 'Gabriel', 'Adriel', 'Jayden', 'Giovanni', 'Xander',
    'Carmelo', 'Neftali', 'Josean', 'Yamil'),
);

const RICAN_LAST = pool(
  w(3, 'Rivera', 'Santiago', 'Diaz', 'Ortiz', 'Vazquez', 'Figueroa', 'Colon', 'Vega', 'Maldonado', 'Torres'),
  w(1, 'Rosado', 'Melendez', 'Ayala', 'Camacho', 'Feliciano', 'Burgos', 'Cordero', 'Santos', 'Serrano', 'Nieves',
    'Pagan', 'Marrero', 'Rosario', 'Velez', 'Acevedo', 'Padilla', 'Quinones', 'Bonilla', 'Caraballo', 'Irizarry',
    'Berrios', 'Carrasquillo', 'Cintron', 'Collazo', 'Cotto', 'Crespo', 'De Jesus', 'Echevarria', 'Guzman', 'Lugo',
    'Matos', 'Mercado', 'Negron', 'Ocasio', 'Oquendo', 'Otero', 'Ramos', 'Rios', 'Robles', 'Sanabria',
    'Santana', 'Soto', 'Valentin', 'Cruz', 'Hernandez', 'Perez'),
);

const RICAN_CITIES = pool(
  w(3, 'New York, NY', 'Bronx, NY', 'Philadelphia, PA', 'Orlando, FL', 'San Juan, PR', 'Bayamon, PR'),
  w(1, 'Brooklyn, NY', 'Kissimmee, FL', 'Hartford, CT', 'Springfield, MA', 'Newark, NJ', 'Camden, NJ',
    'Chicago, IL', 'Tampa, FL', 'Carolina, PR', 'Ponce, PR', 'Caguas, PR', 'Arecibo, PR',
    'Mayaguez, PR', 'Guaynabo, PR', 'Trujillo Alto, PR', 'Toa Baja, PR'),
);

const DOMINICAN_FIRST = pool(
  w(3, 'Jose', 'Juan', 'Luis', 'Rafael', 'Pedro', 'Ramon', 'Franklin', 'Robinson', 'Wilson', 'Kelvin'),
  w(1, 'Yefri', 'Yordy', 'Starling', 'Jefry', 'Manuel', 'Miguel', 'Francisco', 'Felix', 'Domingo', 'Julio',
    'Cristian', 'Alexis', 'Anderson', 'Wander', 'Adonis', 'Amaury', 'Braulio', 'Eddy', 'Elvin', 'Geraldo',
    'Hansel', 'Jhonny', 'Maximo', 'Nelson', 'Osiris', 'Radhames', 'Reynaldo', 'Vladimir', 'Welington', 'Yancarlos',
    'Cristopher', 'Argenis', 'Deivi'),
);

const DOMINICAN_LAST = pool(
  w(3, 'Rodriguez', 'Martinez', 'Reyes', 'Santana', 'Guerrero', 'Rosario', 'Nunez', 'Pena', 'Ramos', 'Vasquez'),
  w(1, 'Peralta', 'Polanco', 'Castillo', 'Feliz', 'Encarnacion', 'Betances', 'Marte', 'Pimentel', 'Tavarez', 'Abreu',
    'De La Cruz', 'Mercedes', 'Paulino', 'Almonte', 'Batista', 'Beltre', 'Cabral', 'Duarte', 'Fermin', 'German',
    'Lara', 'Mota', 'Ozuna', 'Sosa', 'Suero', 'Tejada', 'Urena', 'Ventura', 'Mejia', 'Minaya',
    'Montero', 'Morillo', 'Payano', 'Perdomo', 'Reynoso', 'Taveras', 'Vizcaino', 'Disla', 'Liriano', 'Severino'),
);

const DOMINICAN_CITIES = pool(
  w(3, 'New York, NY', 'Bronx, NY', 'Paterson, NJ', 'Providence, RI', 'Lawrence, MA', 'Boston, MA'),
  w(1, 'Perth Amboy, NJ', 'Philadelphia, PA', 'Reading, PA', 'Miami, FL', 'Santo Domingo, Dominican Republic',
    'Santiago, Dominican Republic', 'San Cristobal, Dominican Republic', 'La Vega, Dominican Republic'),
);

const CUBAN_FIRST = pool(
  w(3, 'Alberto', 'Orlando', 'Lazaro', 'Jorge', 'Raul', 'Ernesto', 'Rolando', 'Ariel', 'Yunior', 'Camilo'),
  w(1, 'Yoel', 'Yordan', 'Yosvani', 'Yasmany', 'Osniel', 'Reinaldo', 'Rey', 'Danilo', 'Alexei', 'Yuniel',
    'Osvaldo', 'Rigoberto', 'Lester', 'Yandy', 'Osmany', 'Yariel', 'Randy', 'Yoan', 'Yusniel', 'Dariel',
    'Onel', 'Yuri', 'Leandro', 'Norge', 'Maikel', 'Yasser', 'Michel'),
);

const CUBAN_LAST = pool(
  w(3, 'Fernandez', 'Gonzalez', 'Alvarez', 'Hernandez', 'Perez', 'Garcia', 'Diaz', 'Morejon', 'Valdes', 'Suarez'),
  w(1, 'Machado', 'Iglesias', 'Despaigne', 'Fonseca', 'Borrego', 'Acosta', 'Arocha', 'Baro', 'Bello', 'Betancourt',
    'Calzadilla', 'Chirino', 'Estevez', 'Lezcano', 'Linares', 'Llanes', 'Mesa', 'Montalvo', 'Oliva', 'Palacios',
    'Pupo', 'Quintana', 'Rondon', 'Sotolongo', 'Tamayo', 'Varona', 'Zulueta', 'Rodriguez', 'Torriente', 'Verdecia'),
);

const CUBAN_CITIES = pool(
  w(3, 'Miami, FL', 'Hialeah, FL', 'Tampa, FL', 'Union City, NJ'),
  w(1, 'Orlando, FL', 'Key West, FL', 'West Palm Beach, FL', 'Naples, FL'),
);

const CUBAN_DIASPORA = pool(
  w(2, 'Havana, Cuba'),
  w(1, 'Santiago de Cuba, Cuba', 'Matanzas, Cuba', 'Camaguey, Cuba'),
);

// ---------------------------------------------------------------------------
// Nigerian-American (second-generation: church-register or Igbo/Yoruba
// firsts over Nigerian surnames, born in US Nigerian hubs)

// First names stay ethnically NEUTRAL (church-register English), the
// dominant real pattern for US-born Nigerians, so a draw can pair with
// either the Igbo or Yoruba surname tier without a cross-language jar.
const NIGERIAN_AM_FIRST = pool(
  w(3, 'Emmanuel', 'Daniel', 'David', 'Samuel', 'Isaac', 'Gabriel', 'Joshua', 'Victor', 'Michael', 'Anthony'),
  w(1, 'Justin', 'Jordan', 'Moses', 'Solomon', 'Elijah', 'Caleb', 'Nathan', 'Israel', 'Josiah', 'Nelson',
    'Kingsley', 'Godwin', 'Precious', 'Festus', 'Ebenezer'),
);

const NIGERIAN_AM_LAST = pool(
  w(3, 'Okafor', 'Okoro', 'Okeke', 'Adebayo', 'Balogun', 'Adeleke', 'Eze', 'Nwosu', 'Adewale', 'Ajayi'),
  w(1, 'Okonkwo', 'Nwachukwu', 'Igwe', 'Chukwu', 'Anyanwu', 'Okorie', 'Nwankwo', 'Udeze', 'Ogbonna', 'Uzoma',
    'Ibekwe', 'Adeyemi', 'Akinola', 'Olajide', 'Adesina', 'Ogunleye', 'Oladele', 'Akande', 'Bamidele', 'Olawale',
    'Azubuike', 'Nnaji', 'Okpala', 'Uzoh', 'Ekwueme'),
);

const NIGERIAN_AM_CITIES = pool(
  w(3, 'Houston, TX', 'Dallas, TX', 'Atlanta, GA', 'Washington, DC'),
  w(1, 'Silver Spring, MD', 'Newark, NJ', 'Brooklyn, NY', 'Chicago, IL', 'Indianapolis, IN', 'Phoenix, AZ'),
);

const NIGERIAN_AM_DIASPORA = pool(
  w(2, 'Lagos, Nigeria'),
  w(1, 'Benin City, Nigeria', 'Abuja, Nigeria'),
);

// ---------------------------------------------------------------------------
// identities

/**
 * US naming identities. Weights are FEEL, shaped to the modern league's
 * domestic demographic mix (Black American majority). Texture rates are
 * FEEL against real roster frequency: suffixes 3-5% of US players,
 * initial-pair firsts 2-3%, hyphenated surnames ~2%.
 */
export const US_IDENTITIES: readonly Identity[] = [
  {
    id: 'us-black', kind: 'domestic', nationality: 'USA', heritage: 'Black American',
    weight: 58, first: byEra(BLACK_ERAS), last: BLACK_LAST, cities: BLACK_CITIES,
    suffixRate: 0.045, initialsRate: 0.03, hyphenRate: 0.025,
  },
  {
    id: 'us-white', kind: 'domestic', nationality: 'USA', heritage: 'White American',
    weight: 24, first: byEra(WHITE_ERAS), last: WHITE_LAST, cities: WHITE_CITIES,
    suffixRate: 0.03, initialsRate: 0.012, hyphenRate: 0.006,
  },
  {
    id: 'us-mexican', kind: 'domestic', nationality: 'USA', heritage: 'Mexican-American',
    weight: 4, first: flat(MEXICAN_FIRST), last: MEXICAN_LAST, cities: MEXICAN_CITIES,
    suffixRate: 0.04, initialsRate: 0.004, hyphenRate: 0.003,
  },
  {
    id: 'us-rican', kind: 'domestic', nationality: 'USA', heritage: 'Puerto Rican',
    weight: 3, first: flat(RICAN_FIRST), last: RICAN_LAST, cities: RICAN_CITIES,
    suffixRate: 0.04, initialsRate: 0.004, hyphenRate: 0.003,
  },
  {
    id: 'us-dominican', kind: 'domestic', nationality: 'USA', heritage: 'Dominican-American',
    weight: 2, first: flat(DOMINICAN_FIRST), last: DOMINICAN_LAST, cities: DOMINICAN_CITIES,
    suffixRate: 0.04, initialsRate: 0.004, hyphenRate: 0.003,
  },
  {
    id: 'us-cuban', kind: 'domestic', nationality: 'USA', heritage: 'Cuban-American',
    weight: 1, first: flat(CUBAN_FIRST), last: CUBAN_LAST, cities: CUBAN_CITIES,
    diasporaCities: CUBAN_DIASPORA, diasporaRate: 0.2, // FEEL: born-Havana-moved-young arc
    suffixRate: 0.04, initialsRate: 0.004, hyphenRate: 0.003,
  },
  {
    id: 'us-nigerian', kind: 'domestic', nationality: 'USA', heritage: 'Nigerian-American',
    weight: 3, first: flat(NIGERIAN_AM_FIRST), last: NIGERIAN_AM_LAST, cities: NIGERIAN_AM_CITIES,
    diasporaCities: NIGERIAN_AM_DIASPORA, diasporaRate: 0.15, // FEEL: born-Lagos-moved-young arc
    suffixRate: 0.02, initialsRate: 0.02, hyphenRate: 0.01,
  },
];

/** Era tables exported for the era-coherence tests. */
export const US_BLACK_ERAS = BLACK_ERAS;
export const US_WHITE_ERAS = WHITE_ERAS;
