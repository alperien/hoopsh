/**
 * boot.js - imports every screen module (each registers itself against
 * the shell contract in app.js) and starts the app. A new screen ships by
 * adding its import here; the rail builds itself from registrations.
 */
import { boot } from './app.js';

import './screens/office.js';
import './screens/roster.js';
import './screens/league.js';
import './screens/schedule.js';
import './screens/team.js';
import './screens/player.js';
import './screens/game.js';
import './screens/trade.js';
import './screens/fa.js';
import './screens/draft.js';
import './screens/news.js';
import './screens/almanac.js';
import './screens/settings.js';

boot();
