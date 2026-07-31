/**
 * people/names.ts - name pools and the deterministic name generator.
 * OWNER: genesis task. STATUS: implemented (build wave A).
 *
 * Design (docs/FRANCHISE.md par 5): era-neutral pools with an international
 * share matching the modern league; names must read like real basketball
 * rosters. Domestic players carry a college (or, rarely, a prep academy)
 * bio line; international players carry a club country. Generated full
 * names are re-rolled against a blocklist of famous real players so the
 * fictional league never prints "Michael Jordan" on a box score. The
 * caller owns cross-league uniqueness (this module only guarantees a
 * single draw is famous-free).
 *
 * Determinism: every draw flows through the passed Rng and the draw ORDER
 * inside each helper is fixed. Reordering draws (or resizing a pool) will
 * reshuffle every generated name for a given seed. That is allowed by the
 * repo's rng doctrine (AGENTS.md par 1.2) but invalidates any pinned test
 * expectations, so treat pool edits as behavioral changes.
 */
import type { Rng } from '@hoopsh/engine';

export interface GeneratedName { first: string; last: string; origin: 'college' | 'international' | 'prep'; birthplace: string; originDetail: string; }

/** Which side of the domestic/international split a draw comes from. */
export type NameKind = 'domestic' | 'international';

// ---------------------------------------------------------------------------
// domestic pools (United States + the Canadian college pipeline)

/** 400 era-neutral US first names (design floor is 350). */
export const US_FIRST: readonly string[] = [
  'Aaron', 'Adrian', 'Akeem', 'Alan', 'Albert', 'Alex', 'Alonzo', 'Alvin', 'Amari', 'Amir',
  'Andre', 'Andrew', 'Anthony', 'Antoine', 'Antonio', 'Antwan', 'Arthur', 'Ashton', 'Austin', 'Avery',
  'Bilal', 'Blake', 'Bobby', 'Brad', 'Braden', 'Brandon', 'Braxton', 'Brendan', 'Brent', 'Brett',
  'Brian', 'Bruce', 'Bryan', 'Bryce', 'Bryson', 'Byron', 'Caleb', 'Calvin', 'Cam', 'Camden',
  'Cameron', 'Carl', 'Carlos', 'Carlton', 'Carson', 'Carter', 'Cedric', 'Chad', 'Chandler', 'Charles',
  'Chase', 'Chauncey', 'Chris', 'Christian', 'Clarence', 'Clark', 'Clay', 'Clifford', 'Clinton', 'Cody',
  'Colby', 'Cole', 'Colin', 'Corey', 'Craig', 'Curtis', 'Dakari', 'Dallas', 'Dalton', 'Damian',
  'Damion', 'Damon', 'Dante', 'Darius', 'Darnell', 'Darrell', 'Darren', 'Darryl', 'Daryl', 'David',
  'Davion', 'Dawson', 'DeAndre', 'DeAngelo', 'Deion', 'DeMarcus', 'Demetrius', 'Denzel', 'Deon', 'Derek',
  'Derrick', 'Deshawn', 'Desmond', 'Devin', 'Devon', 'Devonte', 'Dexter', 'Dillon', 'Dominic', 'Donnell',
  'Donovan', 'Dontae', 'Dorian', 'Douglas', 'Drew', 'Duane', 'Dustin', 'Dwayne', 'Dwight', 'Dylan',
  'Earl', 'Eddie', 'Edward', 'Elgin', 'Eli', 'Elijah', 'Elliot', 'Emmanuel', 'Eric', 'Ethan',
  'Evan', 'Everett', 'Ezekiel', 'Felix', 'Frank', 'Franklin', 'Fred', 'Gabriel', 'Garrett', 'Gary',
  'George', 'Gerald', 'Glen', 'Grant', 'Greg', 'Gregory', 'Hakim', 'Harold', 'Harrison', 'Hassan',
  'Hayden', 'Henry', 'Herbert', 'Horace', 'Hunter', 'Ibrahim', 'Isaac', 'Isaiah', 'Ivan', 'Jabari',
  'Jace', 'Jack', 'Jackson', 'Jacoby', 'Jaden', 'Jahlil', 'Jake', 'Jakobe', 'Jalen', 'Jamaal',
  'Jamal', 'Jamar', 'Jamel', 'James', 'Jamie', 'Jamir', 'Jared', 'Jarrett', 'Jarvis', 'Jason',
  'Javon', 'Jaxon', 'Jay', 'Jaylen', 'Jayson', 'Jeff', 'Jeffrey', 'Jeremiah', 'Jeremy', 'Jermaine',
  'Jerome', 'Jerry', 'Jesse', 'Jimmy', 'Joel', 'John', 'Johnny', 'Jon', 'Jonah', 'Jonas',
  'Jonathan', 'Jordan', 'Joseph', 'Josh', 'Joshua', 'Josiah', 'Juan', 'Julian', 'Julius', 'Justin',
  'Kadeem', 'Kaden', 'Kai', 'Kaleb', 'Kareem', 'Karl', 'Keandre', 'Keaton', 'Keegan', 'Keenan',
  'Keith', 'Kelvin', 'Kendall', 'Kendrick', 'Kenneth', 'Kenny', 'Keon', 'Keshawn', 'Kevin', 'Khalil',
  'Kobe', 'Kyle', 'Kylan', 'Kyler', 'Lamar', 'Lamont', 'Lance', 'Landon', 'Larry', 'Lawrence',
  'Lee', 'Leon', 'Leonard', 'Levi', 'Lewis', 'Logan', 'Lonnie', 'Louis', 'Lucas', 'Luke',
  'Malachi', 'Malcolm', 'Malik', 'Marcus', 'Mario', 'Mark', 'Marlon', 'Marquis', 'Marshall', 'Martin',
  'Marvin', 'Mason', 'Matt', 'Matthew', 'Maurice', 'Max', 'Maxwell', 'Melvin', 'Micah', 'Michael',
  'Miles', 'Mitchell', 'Mohamed', 'Monte', 'Morgan', 'Moses', 'Myles', 'Nasir', 'Nate', 'Nathan',
  'Nathaniel', 'Neil', 'Nicholas', 'Nick', 'Nigel', 'Noah', 'Nolan', 'Norman', 'Omar', 'Orlando',
  'Oscar', 'Otis', 'Owen', 'Parker', 'Patrick', 'Paul', 'Percy', 'Perry', 'Peyton', 'Phil',
  'Philip', 'Preston', 'Quentin', 'Quincy', 'Quinn', 'Rakeem', 'Ralph', 'Randall', 'Randy', 'Rashad',
  'Rashawn', 'Ray', 'Raymond', 'Reggie', 'Reginald', 'Ricardo', 'Richard', 'Rickey', 'Ricky', 'Riley',
  'Robert', 'Roderick', 'Rodney', 'Roger', 'Roman', 'Ron', 'Ronald', 'Ronnie', 'Roosevelt', 'Ross',
  'Roy', 'Russell', 'Ryan', 'Sam', 'Samuel', 'Scott', 'Sean', 'Sebastian', 'Semaj', 'Seth',
  'Shamar', 'Shane', 'Shannon', 'Shaun', 'Shawn', 'Sidney', 'Silas', 'Simeon', 'Solomon', 'Spencer',
  'Stanley', 'Stefan', 'Stephen', 'Sterling', 'Steve', 'Steven', 'Sylvester', 'Tanner', 'Tariq', 'Tate',
  'Taylor', 'Terence', 'Terrance', 'Terrell', 'Terry', 'Theo', 'Theodore', 'Thomas', 'Tim', 'Timothy',
  'Todd', 'Tommy', 'Tony', 'Torrey', 'Travis', 'Tre', 'Tremaine', 'Trent', 'Trenton', 'Trevon',
  'Trevor', 'Trey', 'Tristan', 'Troy', 'Tucker', 'Ty', 'Tyler', 'Tyquan', 'Tyree', 'Tyrell',
  'Tyrese', 'Tyrone', 'Tyson', 'Vernon', 'Victor', 'Vince', 'Vincent', 'Wade', 'Walter', 'Warren',
  'Wayne', 'Wendell', 'Wesley', 'Will', 'William', 'Willie', 'Wyatt', 'Xavier', 'Zachary', 'Zaire',
];

/** 660 era-neutral US surnames (design floor is 450). */
export const US_LAST: readonly string[] = [
  'Abbott', 'Abernathy', 'Acker', 'Adams', 'Adkins', 'Alexander', 'Alford', 'Allen', 'Alston', 'Ambrose',
  'Anderson', 'Andrews', 'Archer', 'Archie', 'Armstead', 'Armstrong', 'Arnett', 'Ashford', 'Atkins', 'Atwater',
  'Austin', 'Avery', 'Ayers', 'Bailey', 'Baker', 'Baldwin', 'Banks', 'Barber', 'Barlow', 'Barnes',
  'Barnett', 'Barrett', 'Barron', 'Bass', 'Bates', 'Battle', 'Baxter', 'Beasley', 'Beck', 'Bell',
  'Bellamy', 'Bennett', 'Benson', 'Bentley', 'Berry', 'Bess', 'Bethea', 'Bishop', 'Black', 'Blackmon',
  'Blackwell', 'Blair', 'Blakely', 'Bledsoe', 'Blount', 'Bolden', 'Bolton', 'Bond', 'Booker', 'Boone',
  'Booth', 'Boston', 'Boswell', 'Bowen', 'Bowers', 'Bowman', 'Boyd', 'Boykins', 'Bradford', 'Bradley',
  'Bradshaw', 'Brady', 'Branch', 'Brandon', 'Brantley', 'Braxton', 'Brewer', 'Bridges', 'Briggs', 'Bright',
  'Briscoe', 'Britt', 'Broadnax', 'Brock', 'Brooks', 'Broussard', 'Brown', 'Browning', 'Bruce', 'Bryant',
  'Buchanan', 'Buckley', 'Buckner', 'Bullock', 'Burgess', 'Burke', 'Burnett', 'Burns', 'Burrell', 'Burton',
  'Bush', 'Butler', 'Byers', 'Byrd', 'Cain', 'Caldwell', 'Calhoun', 'Callahan', 'Calloway', 'Campbell',
  'Cannon', 'Carey', 'Cargill', 'Carlton', 'Carmichael', 'Carpenter', 'Carr', 'Carrington', 'Carroll', 'Carson',
  'Carter', 'Carver', 'Case', 'Cash', 'Cason', 'Chambers', 'Chandler', 'Chaney', 'Chapman', 'Charles',
  'Chatman', 'Cherry', 'Chester', 'Childs', 'Christian', 'Clark', 'Clarke', 'Clay', 'Clayton', 'Clemons',
  'Cleveland', 'Coates', 'Cobb', 'Coffey', 'Colbert', 'Cole', 'Coleman', 'Collier', 'Collins', 'Combs',
  'Conley', 'Conner', 'Cook', 'Cooke', 'Cooper', 'Copeland', 'Corbin', 'Cotton', 'Covington', 'Cox',
  'Craft', 'Crane', 'Crawford', 'Crenshaw', 'Crockett', 'Cross', 'Crowder', 'Culpepper', 'Culver', 'Cummings',
  'Cunningham', 'Curry', 'Curtis', 'Dabney', 'Dailey', 'Dalton', 'Daniels', 'Darden', 'Davenport', 'Davidson',
  'Davis', 'Dawkins', 'Dawson', 'Day', 'Dean', 'Delaney', 'Dennis', 'Denton', 'Dickerson', 'Dillard',
  'Dixon', 'Dobbins', 'Donaldson', 'Dorsey', 'Dotson', 'Douglas', 'Dowell', 'Downs', 'Doyle', 'Drake',
  'Draper', 'Drew', 'Driscoll', 'Drummond', 'Dudley', 'Duffy', 'Dugan', 'Duke', 'Dumas', 'Dunbar',
  'Duncan', 'Dunlap', 'Dunn', 'Dupree', 'Durham', 'Duval', 'Dyer', 'Dyson', 'Easley', 'Easton',
  'Eaton', 'Echols', 'Edmonds', 'Edwards', 'Elder', 'Ellington', 'Elliott', 'Ellis', 'Ellison', 'Elmore',
  'Emerson', 'England', 'English', 'Ennis', 'Epps', 'Ervin', 'Estes', 'Eubanks', 'Evans', 'Everett',
  'Ewell', 'Fair', 'Fairchild', 'Farley', 'Farmer', 'Faulkner', 'Felder', 'Felton', 'Ferguson', 'Fields',
  'Finch', 'Finley', 'Fisher', 'Fitzgerald', 'Fleming', 'Fletcher', 'Flowers', 'Floyd', 'Flynn', 'Forbes',
  'Ford', 'Foreman', 'Forrest', 'Fortson', 'Foster', 'Fowler', 'Fox', 'Francis', 'Franklin', 'Frazier',
  'Freeman', 'French', 'Frost', 'Frye', 'Fuller', 'Fulton', 'Gaines', 'Gallagher', 'Galloway', 'Gamble',
  'Gardner', 'Garland', 'Garner', 'Garrett', 'Garrison', 'Garvin', 'Gaskins', 'Gates', 'Gentry', 'George',
  'Gibbs', 'Gibson', 'Gilbert', 'Giles', 'Gill', 'Gillespie', 'Gilliam', 'Gilmore', 'Gipson', 'Gladden',
  'Glass', 'Glenn', 'Glover', 'Golden', 'Goldsmith', 'Goodman', 'Goodwin', 'Gordon', 'Grady', 'Graham',
  'Granger', 'Grant', 'Graves', 'Gray', 'Grayson', 'Green', 'Greer', 'Gregory', 'Grier', 'Griffin',
  'Griffith', 'Grimes', 'Gross', 'Guy', 'Guyton', 'Hackett', 'Hagan', 'Hailey', 'Hairston', 'Hale',
  'Haley', 'Hall', 'Hamilton', 'Hammond', 'Hampton', 'Hancock', 'Hardin', 'Harding', 'Hardy', 'Hargrove',
  'Harmon', 'Harper', 'Harrell', 'Harrington', 'Harris', 'Harrison', 'Hart', 'Harvey', 'Hastings', 'Hatcher',
  'Hawkins', 'Hayes', 'Haynes', 'Heard', 'Heath', 'Henderson', 'Hendricks', 'Henry', 'Hensley', 'Herndon',
  'Herring', 'Hester', 'Hicks', 'Higgins', 'Hill', 'Hilliard', 'Hilton', 'Hines', 'Hobbs', 'Hodge',
  'Hodges', 'Hogan', 'Holbrook', 'Holden', 'Holiday', 'Holland', 'Holley', 'Hollins', 'Holloway', 'Holmes',
  'Holt', 'Hood', 'Hooper', 'Hoover', 'Hopkins', 'Hopson', 'Horn', 'Horne', 'Horton', 'Houston',
  'Howard', 'Howell', 'Hubbard', 'Hudson', 'Huff', 'Huggins', 'Hughes', 'Hull', 'Humphrey', 'Hunt',
  'Hunter', 'Hurst', 'Hutchins', 'Hutchinson', 'Hyde', 'Ingram', 'Irving', 'Isley', 'Ivey', 'Ivory',
  'Jackson', 'Jacobs', 'James', 'Jamison', 'Jarrett', 'Jefferson', 'Jeffries', 'Jenkins', 'Jennings', 'Jensen',
  'Jeter', 'Johns', 'Johnson', 'Joiner', 'Jones', 'Jordan', 'Joseph', 'Joyner', 'Judd', 'Justice',
  'Kane', 'Keating', 'Keller', 'Kelley', 'Kelly', 'Kemp', 'Kendall', 'Kendrick', 'Kennedy', 'Kent',
  'Kerr', 'Key', 'Keyes', 'Kidd', 'Kilgore', 'Kimble', 'Kincaid', 'King', 'Kirby', 'Kirk',
  'Kirkland', 'Knight', 'Knowles', 'Knox', 'Lacey', 'Lamb', 'Lambert', 'Lancaster', 'Landry', 'Lane',
  'Lang', 'Langford', 'Langston', 'Lanier', 'Larkin', 'Latham', 'Lawrence', 'Lawson', 'Layton', 'Leach',
  'Ledbetter', 'Lee', 'Leggett', 'Lemon', 'Leonard', 'Lester', 'Lett', 'Levy', 'Lewis', 'Lightfoot',
  'Lindsay', 'Lindsey', 'Little', 'Littlejohn', 'Livingston', 'Lockett', 'Lockhart', 'Lofton', 'Logan', 'Long',
  'Lott', 'Love', 'Lovett', 'Lowe', 'Lowery', 'Loyd', 'Lucas', 'Luckett', 'Lyles', 'Lynch',
  'Lyons', 'Mack', 'Maddox', 'Madison', 'Mahoney', 'Major', 'Malone', 'Mann', 'Manning', 'Marable',
  'Marsh', 'Marshall', 'Martin', 'Mason', 'Massey', 'Mathis', 'Matthews', 'Maxwell', 'May', 'Mayes',
  'Mayfield', 'Maynard', 'Mays', 'McAdoo', 'McBride', 'McCall', 'McCann', 'McCarthy', 'McClain', 'McClendon',
  'McCloud', 'McConnell', 'McCoy', 'McCray', 'McCullough', 'McDaniel', 'McDowell', 'McFadden', 'McGee', 'McGill',
  'McGriff', 'McGuire', 'McIntosh', 'McIntyre', 'McKay', 'McKee', 'McKenzie', 'McKinney', 'McKnight', 'McLaurin',
  'McLean', 'McMillan', 'McNair', 'McNeal', 'McNeil', 'McQueen', 'McRae', 'Meadows', 'Medley', 'Melton',
  'Mercer', 'Merchant', 'Meriweather', 'Merrill', 'Merritt', 'Michaels', 'Miles', 'Miller', 'Mills', 'Milton',
  'Mims', 'Mitchell', 'Monroe', 'Montgomery', 'Moody', 'Moon', 'Mooney', 'Moore', 'Moran', 'Morgan',
  'Morris', 'Morrison', 'Morrow', 'Morton', 'Mosley', 'Moss', 'Motley', 'Mullen', 'Murphy', 'Murray',
  'Myers', 'Nance', 'Napier', 'Nash', 'Neal', 'Nelson', 'Nesbitt', 'Newman', 'Newsome', 'Newton',
  'Nichols', 'Nicholson', 'Nixon', 'Noble', 'Nolan', 'Norris', 'North', 'Norton', 'Norwood', 'Nunn',
  'Oakley', 'Odom', 'Oliver', 'Olsen', 'Osborne', 'Otis', 'Owens', 'Pace', 'Page', 'Palmer',
  'Parker', 'Parks', 'Parrish', 'Parsons', 'Pate', 'Patterson', 'Payne', 'Peacock', 'Pearson', 'Peck',
  'Pendleton', 'Perkins', 'Perry', 'Peters', 'Peterson', 'Pettway', 'Phelps', 'Phillips', 'Pierce', 'Pittman',
  'Poindexter', 'Pollard', 'Poole', 'Pope', 'Porter', 'Potts', 'Powell', 'Preston', 'Price', 'Pruitt',
  'Pryor', 'Puckett', 'Pugh', 'Purvis', 'Quarles', 'Rainey', 'Ramsey', 'Randall', 'Randle', 'Randolph',
  'Ransom', 'Ratliff', 'Rawlings', 'Ray', 'Redd', 'Redding', 'Redmond', 'Reed', 'Reese', 'Reeves',
  'Reid', 'Renfro', 'Reynolds', 'Rhodes', 'Rice', 'Richards', 'Richardson', 'Richmond', 'Ricks', 'Riddick',
  'Rider', 'Ridley', 'Riggs', 'Riley', 'Rivers', 'Roach', 'Robbins', 'Roberson', 'Roberts', 'Robertson',
  'Robinson', 'Rodgers', 'Rogers', 'Roland', 'Rollins', 'Roper', 'Rose', 'Ross', 'Rowe', 'Rucker',
  'Rudolph', 'Ruffin', 'Rush', 'Russell', 'Rutledge', 'Ryals', 'Sadler', 'Salters', 'Sampson', 'Sanders',
  'Sandifer', 'Sapp', 'Satterfield', 'Saunders', 'Savage', 'Sawyer', 'Scales', 'Scarborough', 'Schofield', 'Scott',
  'Scruggs', 'Seals', 'Sears', 'Sellers', 'Settles', 'Sexton', 'Shannon', 'Sharp', 'Shaw', 'Shelton',
  'Shepherd', 'Sheppard', 'Sherman', 'Shields', 'Shipley', 'Shorter', 'Simmons', 'Simon', 'Simpson', 'Sims',
  'Sinclair', 'Singleton', 'Skinner', 'Slade', 'Slaughter', 'Sloan', 'Small', 'Smalls', 'Smart', 'Smith',
  'Snead', 'Snell', 'Snow', 'Snyder', 'Sparks', 'Spears', 'Speight', 'Spencer', 'Spivey', 'Springer',
  'Stafford', 'Staley', 'Stallworth', 'Stanton', 'Staples', 'Stark', 'Starks', 'Steele', 'Stephens', 'Stevens',
  'Stevenson', 'Steward', 'Stewart', 'Stiles', 'Stinson', 'Stokes', 'Stone', 'Story', 'Stovall', 'Strickland',
  'Strong', 'Stroud', 'Suggs', 'Sullivan', 'Summers', 'Sutton', 'Swann', 'Sweeney', 'Swift', 'Sykes',
  'Talbert', 'Talley', 'Tanner', 'Tate', 'Tatum', 'Terry', 'Thigpen', 'Thomas', 'Thompson', 'Thornton',
  'Thorpe', 'Tillman', 'Tinsley', 'Tolbert', 'Toliver', 'Townsend', 'Trice', 'Tucker', 'Turner', 'Tyler',
  'Tyson', 'Underwood', 'Upshaw', 'Vance', 'Vaughn', 'Vinson', 'Wade', 'Walker', 'Wall', 'Wallace',
  'Walls', 'Walton', 'Ward', 'Ware', 'Warren', 'Washington', 'Waters', 'Watkins', 'Watson', 'Watts',
  'Weaver', 'Webb', 'Webster', 'Welch', 'Wells', 'West', 'Whaley', 'Wharton', 'Wheeler', 'Whitaker',
  'White', 'Whitehead', 'Whitfield', 'Whitley', 'Whitner', 'Whitt', 'Wiggins', 'Wilburn', 'Wilcox', 'Wilder',
  'Wiley', 'Wilkerson', 'Wilkins', 'Wilkinson', 'Williams', 'Williamson', 'Willis', 'Wilson', 'Winfield', 'Wingate',
  'Winston', 'Winters', 'Witherspoon', 'Woodard', 'Woods', 'Woodson', 'Wooten', 'Worthy', 'Wright', 'Wyatt',
  'Yancey', 'Yarbrough', 'Yates', 'York', 'Young', 'Younger', 'Zachery', 'Zeigler', 'Zimmerman', 'Zollicoffer',
];

/** US birthplace cities, 'City, ST' format for the bio line. */
const US_CITIES: readonly string[] = [
  'Akron, OH', 'Chicago, IL', 'Atlanta, GA', 'Houston, TX', 'Dallas, TX', 'Memphis, TN', 'Nashville, TN',
  'New Orleans, LA', 'Baton Rouge, LA', 'Jackson, MS', 'Birmingham, AL', 'Mobile, AL', 'Charlotte, NC',
  'Raleigh, NC', 'Greensboro, NC', 'Columbia, SC', 'Charleston, SC', 'Richmond, VA', 'Norfolk, VA',
  'Baltimore, MD', 'Washington, DC', 'Philadelphia, PA', 'Pittsburgh, PA', 'Newark, NJ', 'Trenton, NJ',
  'New York, NY', 'Brooklyn, NY', 'Queens, NY', 'Buffalo, NY', 'Rochester, NY', 'Boston, MA',
  'Springfield, MA', 'Hartford, CT', 'Providence, RI', 'Cleveland, OH', 'Columbus, OH', 'Cincinnati, OH',
  'Dayton, OH', 'Toledo, OH', 'Detroit, MI', 'Flint, MI', 'Grand Rapids, MI', 'Saginaw, MI',
  'Indianapolis, IN', 'Fort Wayne, IN', 'Gary, IN', 'Milwaukee, WI', 'Madison, WI', 'Minneapolis, MN',
  'St. Paul, MN', 'St. Louis, MO', 'Kansas City, MO', 'Wichita, KS', 'Oklahoma City, OK', 'Tulsa, OK',
  'Little Rock, AR', 'Louisville, KY', 'Lexington, KY', 'Denver, CO', 'Salt Lake City, UT', 'Phoenix, AZ',
  'Tucson, AZ', 'Albuquerque, NM', 'Las Vegas, NV', 'Los Angeles, CA', 'Oakland, CA', 'Sacramento, CA',
  'San Diego, CA', 'Fresno, CA', 'San Francisco, CA', 'Compton, CA', 'Long Beach, CA', 'Inglewood, CA',
  'Seattle, WA', 'Tacoma, WA', 'Spokane, WA', 'Portland, OR', 'Miami, FL', 'Orlando, FL', 'Tampa, FL',
  'Jacksonville, FL', 'Tallahassee, FL', 'Fort Lauderdale, FL', 'Austin, TX', 'San Antonio, TX',
  'El Paso, TX', 'Fort Worth, TX', 'Lubbock, TX', 'Honolulu, HI', 'Boise, ID', 'Omaha, NE',
  'Des Moines, IA', 'Fargo, ND', 'Charleston, WV', 'Wilmington, DE',
];

/**
 * Fictional but real-sounding colleges (state-school register per the task
 * brief). Shared by US and Canadian players: the Canadian pipeline runs
 * through US college ball, which is why Canada sits on the domestic path.
 */
const COLLEGES: readonly string[] = [
  'Alcorn Ridge State', 'Arlington Tech', 'Bayfront State', 'Blue Ridge State', 'Brockton College',
  'Calloway State', 'Cambria State', 'Cape Fear A&M', 'Carverton', 'Cedar Grove', 'Chesapeake State',
  'Claymore College', 'Copperfield', 'Crestwood State', 'Cumberland Tech', 'Delmarva State', 'Dorchester',
  'East Plains State', 'Eastport', 'Fairhaven State', 'Falls City', 'Flint Hills State', 'Fort Landis State',
  'Gulf Coast A&M', 'Granger Tech', 'Great Lakes State', 'Greenbrier', 'Harmon College', 'High Desert State',
  'Holloway', 'Huron State', 'Ironwood Tech', 'Kingsbridge', 'Lakemont', 'Maple Valley State',
  'Meridian State', 'Midland A&M', 'North Fork State', 'Northgate', 'Oak City State', 'Ozark Tech',
  'Palisade State', 'Pinecrest', 'Port Royal State', 'Prairie Ridge State', 'Redwood State',
  'Ridgeline Tech', 'Riverbend', 'Rockdale State', 'Saltgrass State', 'Sandhill State', 'Silver Lake',
  'Southport A&M', 'Stonebrook', 'Summit Ridge', 'Tidewater Tech', 'Twin Forks State', 'Vandermeer',
  'Westgate State', 'Whitfield College', 'Willowbrook', 'Wolf Creek State',
];

/** Prep academies for the rare preps-to-pros bio line. */
const PREP_ACADEMIES: readonly string[] = [
  'Beacon Ridge Academy', 'Crestview Prep', 'Lakeshore Academy', 'Summit Prep',
  'Riverside Academy', 'Oakmont Prep', 'Harborview Academy', 'Windward Prep',
];

// ---------------------------------------------------------------------------
// international region pools

interface RegionPool {
  region: string;
  /** relative draw weight within the international share (FEEL, shaped to the modern league's pipeline mix) */
  weight: number;
  first: readonly string[];
  last: readonly string[];
  cities: readonly string[];
  /** club countries for the originDetail bio line ('international' origin) */
  clubCountries: readonly string[];
}

const REGIONS: readonly RegionPool[] = [
  {
    region: 'Balkans/Eastern Europe',
    weight: 30, // FEEL: the largest European pipeline in the modern league
    first: [
      'Nikola', 'Luka', 'Dusan', 'Marko', 'Milos', 'Stefan', 'Bogdan', 'Goran', 'Zoran', 'Dario',
      'Ante', 'Ivica', 'Toni', 'Jusuf', 'Edin', 'Vasilije', 'Aleksej', 'Filip', 'Nemanja', 'Vladan',
      'Ognjen', 'Petar', 'Uros', 'Lazar', 'Boban', 'Dejan', 'Sasha', 'Domantas', 'Jonas', 'Mindaugas',
      'Rokas', 'Deividas', 'Ignas', 'Kristaps', 'Davis', 'Rodions', 'Dainius', 'Andrei', 'Sergei', 'Alexey',
      'Timofey', 'Kirill', 'Oleksandr', 'Artem', 'Jan', 'Tomas', 'Vit', 'Ondrej', 'Alperen', 'Cedi',
      'Furkan', 'Omer', 'Ersan', 'Kostas', 'Giorgos', 'Vassilis', 'Nikos', 'Dimitris', 'Sandro', 'Tornike',
    ],
    last: [
      'Petrovic', 'Jovanovic', 'Nikolic', 'Stojanovic', 'Markovic', 'Djordjevic', 'Kovacevic', 'Popovic',
      'Radulovic', 'Vasiljevic', 'Milanovic', 'Simonovic', 'Todorovic', 'Pavlovic', 'Ristic', 'Zivkovic',
      'Lazic', 'Vukovic', 'Babic', 'Horvat', 'Kovac', 'Novak', 'Maric', 'Juric', 'Klaric', 'Simic',
      'Blazevic', 'Bilic', 'Hodzic', 'Begic', 'Hadzic', 'Kulenovic', 'Kairys', 'Butkus', 'Petrauskas',
      'Kazlauskas', 'Jasaitis', 'Urbonas', 'Zukauskas', 'Balciunas', 'Norkus', 'Berzins', 'Ozolins',
      'Kalnins', 'Beridze', 'Giorgadze', 'Lomidze', 'Yilmaz', 'Demir', 'Kaya', 'Aydin', 'Ozturk',
      'Papadakis', 'Economou', 'Vlahos', 'Ivanov', 'Petrov', 'Volkov', 'Smirnov', 'Kuznetsov',
      'Kovalenko', 'Bondarenko', 'Shevchenko', 'Melnyk', 'Novotny', 'Dvorak', 'Svoboda', 'Kowalski',
      'Nowak', 'Wozniak', 'Zielinski', 'Kaminski',
    ],
    cities: [
      'Belgrade, Serbia', 'Novi Sad, Serbia', 'Nis, Serbia', 'Zagreb, Croatia', 'Split, Croatia',
      'Ljubljana, Slovenia', 'Sarajevo, Bosnia', 'Podgorica, Montenegro', 'Skopje, North Macedonia',
      'Vilnius, Lithuania', 'Kaunas, Lithuania', 'Riga, Latvia', 'Athens, Greece', 'Thessaloniki, Greece',
      'Istanbul, Turkey', 'Ankara, Turkey', 'Moscow, Russia', 'Kyiv, Ukraine', 'Prague, Czechia',
      'Warsaw, Poland', 'Tbilisi, Georgia',
    ],
    clubCountries: ['Serbia', 'Croatia', 'Slovenia', 'Lithuania', 'Greece', 'Turkey', 'Spain'],
  },
  {
    region: 'Western Europe',
    weight: 22, // FEEL: Germany/Spain/Italy/Nordics pipeline share
    first: [
      'Franz', 'Moritz', 'Maximilian', 'Dennis', 'Tibor', 'Johannes', 'Lukas', 'Elias', 'Leon', 'Niels',
      'Rik', 'Matteo', 'Marco', 'Simone', 'Alessandro', 'Davide', 'Achille', 'Gabriele', 'Nicolo', 'Sergio',
      'Pablo', 'Alvaro', 'Iker', 'Unai', 'Xavi', 'Santi', 'Willy', 'Juancho', 'Lauri', 'Mikael',
      'Eero', 'Olli', 'Emil', 'Anton', 'Viktor', 'Magnus', 'Henrik', 'Jesper', 'Sander', 'Ruben',
      'Sven', 'Timo', 'Kasper', 'Mathias',
    ],
    last: [
      'Becker', 'Hoffmann', 'Fischer', 'Weber', 'Meyer', 'Schulz', 'Braun', 'Kruger', 'Vogel', 'Richter',
      'Neumann', 'Schwarz', 'Zimmermann', 'Hartmann', 'Lehmann', 'Rossi', 'Ferrari', 'Esposito', 'Romano',
      'Colombo', 'Ricci', 'Marino', 'Greco', 'Gallo', 'Conti', 'Mancini', 'Costa', 'Garcia', 'Fernandez',
      'Lopez', 'Martinez', 'Sanchez', 'Perez', 'Gomez', 'Jimenez', 'Ruiz', 'Hernandez', 'Diaz', 'Moreno',
      'Alvarez', 'Navarro', 'Torres', 'Virtanen', 'Korhonen', 'Nieminen', 'Makinen', 'Laine', 'Lindgren',
      'Johansson', 'Andersson', 'Karlsson', 'Nilsson', 'Eriksson', 'Larsson', 'Olsen', 'Hansen',
      'Pedersen', 'Nielsen', 'de Vries', 'van Dijk', 'Janssen', 'Visser', 'Bakker', 'Vermeulen',
      'Peeters', 'Claes',
    ],
    cities: [
      'Berlin, Germany', 'Munich, Germany', 'Cologne, Germany', 'Vienna, Austria', 'Zurich, Switzerland',
      'Milan, Italy', 'Rome, Italy', 'Bologna, Italy', 'Madrid, Spain', 'Barcelona, Spain', 'Valencia, Spain',
      'Malaga, Spain', 'Helsinki, Finland', 'Tampere, Finland', 'Stockholm, Sweden', 'Copenhagen, Denmark',
      'Oslo, Norway', 'Amsterdam, Netherlands', 'Antwerp, Belgium', 'Lisbon, Portugal',
    ],
    clubCountries: ['Spain', 'Germany', 'Italy', 'France', 'Greece'],
  },
  {
    region: 'France/West Africa',
    weight: 18, // FEEL: the French development system is the league's biggest single foreign feeder
    first: [
      'Victor', 'Rudy', 'Evan', 'Bilal', 'Killian', 'Theo', 'Mathias', 'Yannick', 'Olivier', 'Axel',
      'Hugo', 'Nicolas', 'Antoine', 'Jules', 'Leo', 'Enzo', 'Nolan', 'Timothe', 'Sekou', 'Moussa',
      'Mamadou', 'Ousmane', 'Ibou', 'Cheick', 'Amadou', 'Boubacar', 'Ibrahima', 'Souleymane', 'Abdoulaye',
      'Lamine', 'Youssouf', 'Tidiane', 'Aliou', 'Sidy',
    ],
    last: [
      'Lefebvre', 'Moreau', 'Fontaine', 'Girard', 'Rousseau', 'Mercier', 'Blanchard', 'Gauthier',
      'Chevalier', 'Marchand', 'Dupont', 'Bernard', 'Petit', 'Durand', 'Leroy', 'Roux', 'Lemoine',
      'Diallo', 'Traore', 'Kone', 'Coulibaly', 'Keita', 'Cisse', 'Toure', 'Diop', 'Ndiaye', 'Sarr',
      'Gueye', 'Sy', 'Ba', 'Fall', 'Faye', 'Mbaye', 'Niang', 'Sow', 'Kanoute', 'Doumbia', 'Fofana',
      'Sissoko', 'Dembele', 'Kamara', 'Bathily',
    ],
    cities: [
      'Paris, France', 'Lyon, France', 'Marseille, France', 'Toulouse, France', 'Bordeaux, France',
      'Strasbourg, France', 'Cholet, France', 'Dakar, Senegal', 'Bamako, Mali', 'Abidjan, Ivory Coast',
      'Conakry, Guinea', 'Ouagadougou, Burkina Faso',
    ],
    clubCountries: ['France', 'France', 'France', 'France', 'Spain', 'Germany'],
  },
  {
    region: 'Africa',
    weight: 12, // FEEL: Nigeria/Ghana/South Sudan/Cameroon pipelines, mostly via European clubs
    first: [
      'Chukwudi', 'Emeka', 'Chidi', 'Obinna', 'Ikenna', 'Nnamdi', 'Kelechi', 'Uche', 'Chima', 'Ejike',
      'Godwin', 'Efe', 'Osas', 'Precious', 'Udoka', 'Kofi', 'Kwame', 'Yaw', 'Kojo', 'Thon', 'Deng',
      'Madut', 'Wenyen', 'Makur', 'Chol', 'Ater', 'Dut', 'Majok', 'Salah', 'Youssef', 'Ahmed', 'Karim',
      'Tarik', 'Amara', 'Tendai', 'Thabo', 'Sipho', 'Kagiso',
    ],
    last: [
      'Okafor', 'Okeke', 'Okonkwo', 'Eze', 'Nwosu', 'Obi', 'Nwachukwu', 'Adebayo', 'Adeleke', 'Adewale',
      'Balogun', 'Olawale', 'Okoro', 'Igwe', 'Chukwu', 'Onyeka', 'Mensah', 'Boateng', 'Appiah', 'Asante',
      'Owusu', 'Annan', 'Deng', 'Akol', 'Malith', 'Aguek', 'Mawien', 'Hassan', 'Farouk', 'Mansour',
      'Abdelrahman', 'Ndlovu', 'Dlamini', 'Khumalo', 'Moloi', 'Mokoena',
    ],
    cities: [
      'Lagos, Nigeria', 'Abuja, Nigeria', 'Enugu, Nigeria', 'Accra, Ghana', 'Kumasi, Ghana',
      'Juba, South Sudan', 'Khartoum, Sudan', 'Cairo, Egypt', 'Alexandria, Egypt', 'Yaounde, Cameroon',
      'Douala, Cameroon', 'Kinshasa, DR Congo', 'Luanda, Angola', 'Johannesburg, South Africa',
      'Cape Town, South Africa', 'Nairobi, Kenya', 'Dar es Salaam, Tanzania',
    ],
    clubCountries: ['Spain', 'France', 'Germany', 'Italy', 'Turkey', 'Angola', 'Egypt'],
  },
  {
    region: 'Australia/NZ',
    weight: 11, // FEEL: the NBL pathway
    first: [
      'Lachlan', 'Mitchell', 'Callum', 'Angus', 'Hamish', 'Fraser', 'Declan', 'Riley', 'Flynn', 'Harrison',
      'Bailey', 'Jackson', 'Cooper', 'Hunter', 'Tyler', 'Baxter', 'Ashton', 'Beau', 'Taj', 'Nathan',
      'Aron', 'Corey', 'Duop', 'Steven', 'Tai', 'Rangi', 'Manaia', 'Ariki', 'Nikau',
    ],
    last: [
      'Hartley', 'Kearney', 'Broome', 'Sutherland', 'Farrant', 'McVeigh', 'Ashworth', 'Cavanagh',
      'Fenwick', 'Gorman', 'Harwood', 'Kirkwood', 'Maguire', 'Nettleton', "O'Brien", 'Pemberton',
      'Quigley', 'Rutherford', 'Stanton', 'Tuck', 'Whitfield', 'Winter', 'Maara', 'Ngata', 'Parata',
      'Waititi', 'Havili',
    ],
    cities: [
      'Melbourne, Australia', 'Sydney, Australia', 'Brisbane, Australia', 'Perth, Australia',
      'Adelaide, Australia', 'Canberra, Australia', 'Hobart, Australia', 'Auckland, New Zealand',
      'Wellington, New Zealand', 'Christchurch, New Zealand',
    ],
    clubCountries: ['Australia', 'Australia', 'Australia', 'New Zealand'],
  },
  {
    region: 'Latin America/Caribbean',
    weight: 13, // FEEL: Argentina/Brazil club systems plus the Caribbean athletic pipeline
    first: [
      'Jose', 'Luis', 'Miguel', 'Andres', 'Felipe', 'Santiago', 'Mateo', 'Diego', 'Alejandro', 'Eduardo',
      'Fernando', 'Gustavo', 'Rafael', 'Thiago', 'Joao', 'Gui', 'Bruno', 'Caio', 'Vitor', 'Marcelo',
      'Rodrigo', 'Facundo', 'Leandro', 'Emanuel', 'Franco', 'Ignacio', 'Delano', 'Shemar', 'Romario',
      'Javain', 'Odane',
    ],
    last: [
      'Rodriguez', 'Gonzalez', 'Vasquez', 'Mejia', 'Vargas', 'Rojas', 'Herrera', 'Medina', 'Castillo',
      'Ortiz', 'Nunez', 'Guzman', 'Paredes', 'Rios', 'Salazar', 'Cabrera', 'Delgado', 'Duarte', 'Silva',
      'Santos', 'Oliveira', 'Souza', 'Pereira', 'Almeida', 'Ferreira', 'Ribeiro', 'Carvalho', 'Machado',
      'Baptiste', 'Pierre', 'Jean', 'Augustin', 'Registre', 'Delva', 'Beckford', 'Salmon', 'Whyte',
      'Grandison',
    ],
    cities: [
      'Buenos Aires, Argentina', 'Cordoba, Argentina', 'Sao Paulo, Brazil', 'Rio de Janeiro, Brazil',
      'Belo Horizonte, Brazil', 'Santo Domingo, Dominican Republic', 'San Juan, Puerto Rico',
      'Kingston, Jamaica', 'Port-au-Prince, Haiti', 'Nassau, Bahamas', 'Caracas, Venezuela',
      'Mexico City, Mexico', 'Monterrey, Mexico', 'Bogota, Colombia', 'Montevideo, Uruguay',
    ],
    clubCountries: ['Spain', 'Argentina', 'Brazil', 'Puerto Rico', 'Mexico'],
  },
  {
    region: 'East Asia',
    weight: 4, // FEEL: rare by design, matching the real league's East Asian representation
    first: [
      'Yuta', 'Rui', 'Ren', 'Sota', 'Daiki', 'Haruto', 'Kenta', 'Riku', 'Yuki', 'Takumi', 'Sho',
      'Wataru', 'Jian', 'Wei', 'Ming', 'Hao', 'Cheng', 'Zhi', 'Seung', 'Min-Jae', 'Ji-Hoon',
      'Dong-Hyun', 'Tae-Yang',
    ],
    last: [
      'Tanaka', 'Sato', 'Suzuki', 'Takahashi', 'Ito', 'Yamamoto', 'Nakamura', 'Kobayashi', 'Kato',
      'Yoshida', 'Yamada', 'Sasaki', 'Matsumoto', 'Inoue', 'Kimura', 'Hayashi', 'Shimizu', 'Wang',
      'Li', 'Zhang', 'Liu', 'Chen', 'Yang', 'Zhao', 'Zhou', 'Kim', 'Park', 'Choi', 'Jung', 'Kang',
    ],
    cities: [
      'Tokyo, Japan', 'Osaka, Japan', 'Yokohama, Japan', 'Sendai, Japan', 'Shanghai, China',
      'Beijing, China', 'Guangzhou, China', 'Seoul, South Korea', 'Busan, South Korea',
      'Taipei, Taiwan', 'Manila, Philippines',
    ],
    clubCountries: ['Japan', 'China', 'South Korea', 'Philippines', 'Australia'],
  },
];

/** Canadian pool: domestic development path (US college), Canadian birthplaces. */
const CANADA = {
  first: [
    'Liam', 'Bennett', 'Graham', 'Brock', 'Denzel', 'Jaxson', 'Emmett', 'Mathieu', 'Etienne',
    'Jean-Luc', 'Pascal', 'Rene', 'Braeden', 'Kellan', 'Torin', 'Cory', 'Kelly', 'Nickeil', 'Dillon',
    'Andrew', 'Tristan', 'Olivier', 'Marcus', 'Malik', 'Elias', 'Tanner', 'Felix', 'Zachary', 'Samuel',
  ] as readonly string[],
  last: [
    'Tremblay', 'Gagnon', 'Bouchard', 'Cote', 'Morin', 'Lavoie', 'Fortin', 'Ouellet', 'Pelletier',
    'Belanger', 'Levesque', 'Bergeron', 'Leblanc', 'Chartrand', 'Dube', 'MacDonald', 'MacKenzie',
    'Sinclair', 'Fraser', 'McTavish', 'Galbraith', 'Whitehead', 'Braithwaite', 'Springer', 'Murray',
    'Barrett', 'Powell', 'Brooks', 'Clarke', 'Joseph',
  ] as readonly string[],
  cities: [
    'Toronto, ON', 'Mississauga, ON', 'Brampton, ON', 'Hamilton, ON', 'Ottawa, ON', 'Montreal, QC',
    'Laval, QC', 'Vancouver, BC', 'Calgary, AB', 'Edmonton, AB', 'Winnipeg, MB', 'Halifax, NS',
  ] as readonly string[],
};

// ---------------------------------------------------------------------------
// famous-name blocklist

/**
 * Exact full-name matches rejected at generation. Curated two ways: iconic
 * all-timers (defense in depth even when a token is missing from the pools)
 * and every modern star whose first AND last name both appear in the pools
 * above, where a collision is a real possibility, not a hypothetical.
 */
export const FAMOUS_BLOCKLIST: readonly string[] = [
  // all-time icons
  'Michael Jordan', 'LeBron James', 'Kobe Bryant', 'Kareem Abdul-Jabbar', 'Magic Johnson',
  'Larry Bird', 'Bill Russell', 'Wilt Chamberlain', 'Oscar Robertson', 'Jerry West',
  'Julius Erving', 'Moses Malone', 'Karl Malone', 'John Stockton', 'Hakeem Olajuwon',
  "Shaquille O'Neal", 'Tim Duncan', 'Kevin Garnett', 'Dirk Nowitzki', 'Allen Iverson',
  'Steve Nash', 'Jason Kidd', 'Vince Carter', 'Tracy McGrady', 'Ray Allen', 'Reggie Miller',
  'Scottie Pippen', 'Charles Barkley', 'Patrick Ewing', 'Dominique Wilkins', 'Isiah Thomas',
  'Isaiah Thomas', 'Dwyane Wade', 'Grant Hill', 'Shawn Kemp', 'Gary Payton', 'Tony Parker',
  'Manu Ginobili', 'Pau Gasol', 'Yao Ming', 'David Robinson', 'James Worthy', 'Earl Monroe',
  'Walter Frazier', 'Elgin Baylor', 'Paul Pierce', 'Glen Rice', 'Byron Scott', 'Reggie Jackson',
  // modern stars, prioritized where both tokens exist in the pools
  'Stephen Curry', 'Kevin Durant', 'James Harden', 'Russell Westbrook', 'Chris Paul',
  'Anthony Davis', 'Kawhi Leonard', 'Damian Lillard', 'Paul George', 'Jimmy Butler',
  'Kyrie Irving', 'Klay Thompson', 'Draymond Green', 'Joel Embiid', 'Nikola Jokic',
  'Giannis Antetokounmpo', 'Luka Doncic', 'Jayson Tatum', 'Jaylen Brown', 'Devin Booker',
  'Donovan Mitchell', 'Trae Young', 'Ja Morant', 'Zion Williamson', 'Anthony Edwards',
  'Victor Wembanyama', 'Evan Mobley', 'Tyrese Maxey', 'Jalen Green', 'Jalen Williams',
  'Jalen Johnson', 'Jalen Suggs', 'Jalen Rose', 'Jamal Murray', 'Jamal Crawford',
  'Andrew Wiggins', 'Blake Griffin', 'Derrick Rose', 'Dwight Howard', 'John Wall',
  'Kevin Love', 'Kemba Walker', 'Bradley Beal', 'Zach LaVine', 'Jrue Holiday',
  'Kristaps Porzingis', 'Rudy Gobert', 'Bilal Coulibaly', 'Jahlil Okafor', 'Franz Wagner',
  'Dennis Schroder', 'Lauri Markkanen', 'Ben Simmons', 'Marcus Smart', 'Julius Randle',
  'Dillon Brooks', 'Miles Bridges', 'Michael Porter',
];

const FAMOUS = new Set(FAMOUS_BLOCKLIST);

/** True when a generated full name exactly matches a famous real player. */
export function isFamousName(fullName: string): boolean {
  return FAMOUS.has(fullName);
}

// ---------------------------------------------------------------------------
// generation

// FEEL 0.25: standalone-draw international share, mirroring the default
// params.gen.intlShare (REAL ~25% of the modern league is international).
// Callers that must hit an exact share (draft-class quota) force the kind
// through generateNameOfKind instead of relying on this roll.
const DEFAULT_INTL_SHARE = 0.25;
// FEEL 0.08: Canadian share of the domestic draw. Canada is the largest
// non-US pipeline but its players develop through US college ball, which
// is why it sits on the domestic (college-origin) path.
const CANADA_SHARE = 0.08;
// FEEL 0.03: preps-to-pros share of US players. Era-neutral pools keep a
// small tail of prep-academy bios without dating the league to one era.
const PREP_SHARE = 0.03;
// FEEL 64: re-roll bound against the blocklist. Blocklist density over the
// pool cross-product is under 1e-4, so hitting the bound is unreachable in
// practice; the throw is a fail-loud guard, not an expected path.
const MAX_REROLLS = 64;

const REGION_WEIGHTS = REGIONS.map((r) => r.weight);

/** One domestic draw: US or Canada name + city, college (or prep) bio. Draw order is fixed. */
function drawDomestic(rng: Rng): GeneratedName {
  const canadian = rng.chance(CANADA_SHARE);
  if (canadian) {
    return {
      first: rng.pick(CANADA.first),
      last: rng.pick(CANADA.last),
      origin: 'college',
      birthplace: rng.pick(CANADA.cities),
      originDetail: rng.pick(COLLEGES),
    };
  }
  const first = rng.pick(US_FIRST);
  const last = rng.pick(US_LAST);
  const prep = rng.chance(PREP_SHARE);
  return {
    first,
    last,
    origin: prep ? 'prep' : 'college',
    birthplace: rng.pick(US_CITIES),
    originDetail: prep ? rng.pick(PREP_ACADEMIES) : rng.pick(COLLEGES),
  };
}

/** One international draw: weighted region, club-country bio. Draw order is fixed. */
function drawInternational(rng: Rng): GeneratedName {
  const region = REGIONS[rng.weighted(REGION_WEIGHTS)]!;
  return {
    first: rng.pick(region.first),
    last: rng.pick(region.last),
    origin: 'international',
    birthplace: rng.pick(region.cities),
    originDetail: rng.pick(region.clubCountries),
  };
}

/**
 * Draw a name of a forced kind, re-rolling famous collisions. Used by the
 * generators when a caller controls the domestic/international mix exactly
 * (draft-class international quota) and for collision re-rolls that must
 * keep a player's origin side stable.
 */
export function generateNameOfKind(rng: Rng, kind: NameKind): GeneratedName {
  for (let i = 0; i < MAX_REROLLS; i++) {
    const n = kind === 'international' ? drawInternational(rng) : drawDomestic(rng);
    if (!FAMOUS.has(`${n.first} ${n.last}`)) return n;
  }
  throw new Error('names: exhausted famous-name re-rolls (pool/blocklist misconfiguration)');
}

/**
 * Deterministic name generation: rolls the international share, then
 * delegates. Uniqueness across a league is the caller's job (genesis and
 * draft-class generation keep a used-name set and re-roll collisions).
 */
export function generateName(rng: Rng): GeneratedName {
  return generateNameOfKind(rng, rng.chance(DEFAULT_INTL_SHARE) ? 'international' : 'domestic');
}
