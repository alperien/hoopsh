/**
 * screens/settings.js - saves and the new-league onboarding. The first
 * thing a fresh install sees, so it carries the franchise pick.
 */
import { registerScreen, store, navigate } from '../app.js';
import { api } from '../api.js';
import { el, ledger, toast } from '../ui.js';
import { seasonLabel } from '../format.js';

/**
 * Mirror of packages/franchise/src/teamdata.ts identities (id, city,
 * name), needed before any league exists server-side. Keep in sync with
 * that file; onboarding is the only consumer.
 */
const FRANCHISES = [
  ['nye', 'New York', 'Excelsiors'], ['bka', 'Brooklyn', 'Atlantics'], ['bos', 'Boston', 'Beacons'],
  ['phi', 'Philadelphia', 'Founders'], ['tor', 'Toronto', 'Northmen'],
  ['chi', 'Chicago', 'Condors'], ['det', 'Detroit', 'Motors'], ['cle', 'Cleveland', 'Forge'],
  ['ind', 'Indianapolis', 'Gears'], ['mil', 'Milwaukee', 'Anchors'],
  ['mia', 'Miami', 'Cyclones'], ['atl', 'Atlanta', 'Firebirds'], ['cha', 'Charlotte', 'Aviators'],
  ['was', 'Washington', 'Statesmen'], ['orl', 'Orlando', 'Tropics'],
  ['sea', 'Seattle', 'Emeralds'], ['por', 'Portland', 'Pioneers'], ['den', 'Denver', 'Summit'],
  ['min', 'Minneapolis', 'Voyageurs'], ['uta', 'Salt Lake City', 'Prospectors'],
  ['cas', 'Cascadia', 'Breakers'], ['las', 'Los Angeles', 'Stars'], ['sfo', 'San Francisco', 'Fog'],
  ['sac', 'Sacramento', 'Gold'], ['lvs', 'Las Vegas', 'Scorpions'],
  ['mer', 'Meridian', 'Monarchs'], ['hou', 'Houston', 'Wildcatters'], ['dal', 'Dallas', 'Brahmas'],
  ['phx', 'Phoenix', 'Roadrunners'], ['nol', 'New Orleans', 'Brass'],
];

function newLeagueForm() {
  const teamSelect = el('select', {},
    FRANCHISES.map(([id, city, name]) => el('option', { value: id }, `${city} ${name}`)));
  const nameInput = el('input', { placeholder: 'my league', value: 'my-league' });
  const seedInput = el('input', { placeholder: 'any text; same seed, same league' });
  const go = el('button', {
    onclick: async () => {
      go.disabled = true;
      try {
        await api.newLeague({
          userTeam: teamSelect.value,
          name: nameInput.value.trim() || 'my-league',
          seed: seedInput.value.trim() || undefined,
        });
        await store.refresh();
        toast('the league is yours');
        navigate('/office');
      } catch (err) {
        toast(err.message, true);
        go.disabled = false;
      }
    },
  }, 'take the job');
  return el('div', { class: 'card', style: 'max-width:520px' },
    el('label', { class: 'field' }, 'your franchise'), teamSelect,
    el('label', { class: 'field' }, 'save name'), nameInput,
    el('label', { class: 'field' }, 'seed (optional)'), seedInput,
    el('div', { style: 'margin-top:14px' }, go),
    el('p', { style: 'color:var(--ink-faint);font-size:12px;margin-top:10px' },
      'thirty fictional franchises, a full CBA, and a schedule that starts in late October. ' +
      'the games are simulated possession by possession.'),
  );
}

async function savesList(rerender) {
  const meta = await api.meta();
  if (meta.saves.length === 0) return el('div', { class: 'empty' }, 'no saved leagues on this machine');
  return el('div', {}, meta.saves.map(s =>
    el('div', { class: 'card', style: 'display:flex;align-items:center;gap:12px;margin-bottom:8px' },
      el('div', { style: 'flex:1' },
        el('b', {}, s.name),
        el('div', { class: 'sub', style: 'color:var(--ink-faint);font-size:12px' },
          `${s.userTeam.toUpperCase()} · ${seasonLabel(s.savedAtDay.season)}, day ${s.savedAtDay.day}`)),
      el('button', {
        class: 'quiet',
        onclick: async () => {
          try {
            await api.load(s.name);
            await store.refresh();
            toast(`loaded ${s.name}`);
            navigate('/office');
          } catch (err) { toast(err.message, true); }
        },
      }, 'load'),
    )));
}

registerScreen('settings', {
  title: 'Settings',
  nav: 'Saves',
  async render(root, params) {
    const onboarding = params[0] === 'new' || !store.hasLeague;
    const rerender = () => this.render(root, params);
    if (onboarding) {
      root.replaceChildren(
        el('h1', { class: 'doc' }, 'start a franchise'),
        el('div', { class: 'doc-sub' }, 'pick a chair. the other twenty-nine are taken.'),
        newLeagueForm(),
        ledger('or load a save'),
        await savesList(rerender),
      );
      return;
    }
    const saveAs = el('input', { placeholder: 'save name', value: '' });
    root.replaceChildren(
      el('h1', { class: 'doc' }, 'saves'),
      el('div', { class: 'doc-sub' }, 'plain JSON under out/saves; same seed and actions reproduce the league exactly'),
      ledger('save as'),
      el('div', { style: 'display:flex;gap:8px;align-items:center' },
        saveAs,
        el('button', {
          onclick: async () => {
            try {
              const r = await api.save(saveAs.value.trim() || undefined);
              toast(`saved: ${r.name}`);
              rerender();
            } catch (err) { toast(err.message, true); }
          },
        }, 'save'),
      ),
      ledger('load'),
      await savesList(rerender),
      ledger('start another league'),
      newLeagueForm(),
    );
  },
});
