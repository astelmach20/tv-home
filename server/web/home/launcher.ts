// Launcher UI: status header, hero describing the focused item, two rails, and a glass lens that follows focus.
import { api } from '../lib/api.js';
import { $, esc, KEY, keyCode, replay } from '../lib/dom.js';
import { onTheme, theme } from './theme.js';
import { describe, startWeather, weather } from './weather.js';

const LENS_PAD = 14;
/** Items kept visible to the left of focus before the rail scrolls. */
const VISIBLE_LEFT = 2;
const BURN_IN_SHIFT_MS = 10 * 60_000;

interface Item {
  el: HTMLElement;
  title: string;
  kicker: string;
  hint: string;
  run: () => void;
}

type Focus = [row: number, col: number];

const rows: Item[][] = [[], []];
let focus: Focus = [0, 0];

const launch = (id: string) => void api.launch(id).catch(() => {});

function renderHeader() {
  const d = new Date();
  $('#clock').textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/, '');
  const parts = [d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })];
  const w = weather();
  if (w) parts.push(`<b>${w.temp}°</b> ${describe(w.code)}`, `H${w.high} L${w.low}`, `Rain ${w.rain}%`);
  $('#status').innerHTML = parts.join('<span class="sep">/</span>');
}

function setHero(it: Item) {
  $('#hero-kicker').textContent = it.kicker;
  $('#hero-title').textContent = it.title;
  $('#hero-hint').textContent = it.hint;
  replay($('.hero'), 'swap');
}

function setFocus(row: number, col: number) {
  const r = Math.max(0, Math.min(rows.length - 1, row));
  const rail = rows[r] ?? [];
  if (!rail.length) return;
  const c = Math.max(0, Math.min(rail.length - 1, col));
  const it = rail[c];
  const head = rail[0];
  if (!it || !head) return;
  rows.flat().forEach((x) => x.el.classList.remove('focused'));
  document.querySelectorAll<HTMLElement>('.rail').forEach((el) => el.classList.toggle('inactive', Number(el.dataset.row) !== r));
  it.el.classList.add('focused');

  // Scroll the rail so focus stays near the left, keeping some context visible.
  // Measure untransformed layout: rect minus the track's current translation (scale is centre-preserving).
  const track = it.el.parentElement;
  if (!track) return;
  const curTx = new DOMMatrixReadOnly(getComputedStyle(track).transform).m41;
  const railsBox = $('.rails').getBoundingClientRect();
  const layoutX = (el: HTMLElement) => {
    const b = el.getBoundingClientRect();
    return b.left + b.width / 2 - curTx - railsBox.left - el.offsetWidth / 2;
  };
  const first = rail[Math.max(0, c - VISIBLE_LEFT)] ?? head;
  const tx = -(layoutX(first.el) - layoutX(head.el));
  track.style.transform = `translate3d(${tx}px, 0, 0)`;

  const changed = focus[0] !== r || focus[1] !== c || !$('#hero-title').textContent;
  focus = [r, c];
  if (changed) setHero(it);

  // Lens targets the final position directly; both animate with the same easing.
  const lens = $('#lens');
  const b = it.el.getBoundingClientRect();
  const x = layoutX(it.el) + tx;
  const y = b.top + b.height / 2 - railsBox.top - it.el.offsetHeight / 2;
  lens.style.width = `${it.el.offsetWidth + LENS_PAD * 2}px`;
  lens.style.height = `${it.el.offsetHeight + LENS_PAD * 2}px`;
  lens.style.transform = `translate3d(${x - LENS_PAD}px, ${y - LENS_PAD}px, 0)`;
}

function item(cls: string, html: string, data: Omit<Item, 'el'>): Item {
  const el = document.createElement('div');
  el.className = `item ${cls}`;
  el.innerHTML = html;
  return { el, ...data };
}

async function loadRows() {
  const [apps, inputs] = await Promise.all([api.apps().catch(() => []), api.inputs().catch(() => [])]);
  rows[0] = apps.map((a) =>
    item('app', `<img src="/icon?id=${encodeURIComponent(a.id)}" alt="">`, {
      title: a.title,
      kicker: 'App',
      hint: 'OK  to open',
      run: () => launch(a.id),
    }),
  );
  rows[1] = inputs.map((i) =>
    item('input', `<i class="dot ${i.on ? 'on' : ''}"></i><span class="name">${esc(i.label)}</span>`, {
      title: i.label,
      kicker: `${i.port}  ${i.on ? 'On' : 'Standby'}`,
      hint: `OK  to switch to ${i.port}`,
      run: () => launch(i.appId),
    }),
  );
  $('#apps').replaceChildren(...rows[0].map((x) => x.el));
  $('#inputs').replaceChildren(...rows[1].map((x) => x.el));
  $('.rail[data-row="1"]').hidden = !rows[1].length;
  setFocus(...focus);
}

function onKey(e: KeyboardEvent) {
  if (theme() !== 'classic') return;
  const [r, c] = focus;
  const rowLen = (i: number) => rows[i]?.length ?? 0;
  switch (keyCode(e)) {
    case KEY.LEFT:
      setFocus(r, c - 1);
      break;
    case KEY.RIGHT:
      setFocus(r, c + 1);
      break;
    case KEY.UP:
      setFocus(r - 1, Math.min(c, rowLen(r - 1) - 1));
      break;
    case KEY.DOWN:
      setFocus(r + 1, Math.min(c, rowLen(r + 1) - 1));
      break;
    case KEY.ENTER:
      rows[r]?.[c]?.run();
      break;
    default:
      return;
  }
  e.preventDefault();
}

export function startLauncher() {
  document.addEventListener('keydown', onKey);
  // Shift the layout a few pixels every 10 min so static text doesn't burn into the OLED.
  setInterval(() => {
    const d = () => Math.round(Math.random() * 12 - 6);
    $('#stage').style.transform = `translate3d(${d()}px, ${d()}px, 0)`;
  }, BURN_IN_SHIFT_MS);
  renderHeader();
  setInterval(renderHeader, 1000);
  const reloadWeather = startWeather(renderHeader);
  // Rails are measured for the lens, so lay them out again whenever they come back on screen.
  onTheme((t) => {
    if (t === 'classic') void loadRows();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    void loadRows();
    void reloadWeather();
  });
}
