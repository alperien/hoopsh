/**
 * screens/career/index.js - the career chair's manifest. The shell
 * dynamic-imports this one file; importing it registers every career
 * screen (each file calls registerScreen on load) and attaches the
 * career stylesheet exactly once. Import order below is nav order.
 */
import './week.js';
import './phone.js';
import './plan.js';
import './me.js';
import './circuit.js';
import './recruiting.js';
import './stock.js';
import './money.js';
import './office.js';
import './journey.js';
import './new.js';
import './game.js';
import './draftnight.js';

const CSS_HREF = '/css/career.css';
if (!document.querySelector(`link[href="${CSS_HREF}"]`)) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = CSS_HREF;
  document.head.append(link);
}
