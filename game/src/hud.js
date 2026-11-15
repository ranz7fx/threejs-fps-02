// hud.js — every DOM element the player sees: health, ammo, timer, score,
// money, killfeed, crosshair (widens with spread), hitmarker, damage
// direction, banners, the buy menu and the start / end screens.
// The HUD never simulates anything; main.js calls update() once a frame.
import { WEAPONS } from './weapons.js';
import { roundTimeLeft } from './rounds.js';

export class HUD {
  constructor(callbacks) {
    this.cb = callbacks;
    const $ = (id) => document.getElementById(id);
    this.el = {
      crosshair: $('crosshair'), hitmarker: $('hitmarker'), dmg: $('dmgind'),
      hp: $('hp-val'), armor: $('armor-val'), money: $('money-val'),
      mag: $('ammo-mag'), reserve: $('ammo-reserve'), weapon: $('weapon-name'),
      timer: $('timer-val'), score: $('score-val'), round: $('round-val'),
      bomb: $('bomb-val'), killfeed: $('killfeed'), objective: $('objective'),
      banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
      plantbar: $('plantbar'), plantfill: $('plantfill'), plantlabel: $('plantlabel'),
      overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayCopy: $('overlay-copy'),
      play: $('play'), buy: $('buy'), buyMoney: $('buy-money'), buyClose: $('buy-close'),
      matchend: $('matchend'), matchTitle: $('match-title'), matchSub: $('match-sub'),
      again: $('again'), grenades: $('grenades-val'),
    };
    this._hitT = 0;
    this._bannerT = 0;
    this._feedRendered = 0;
    this.el.play.addEventListener('click', () => this.cb.onPlay());
    this.el.again.addEventListener('click', () => this.cb.onAgain());
    this.el.buyClose.addEventListener('click', () => this.cb.onBuyClose());
    for (const btn of document.querySelectorAll('[data-buy]')) {
      btn.addEventListener('click', () => this.cb.onBuy(btn.dataset.buy));
    }
  }

  showMenu(title, copy, buttonLabel) {
    this.el.overlayTitle.textContent = title;
    this.el.overlayCopy.textContent = copy;
    this.el.play.textContent = buttonLabel;
    this.el.overlay.hidden = false;
    this.el.matchend.hidden = true;
  }
  hideMenu() { this.el.overlay.hidden = true; }
  showMatchEnd(won, scoreText) {
    this.el.matchTitle.textContent = won ? 'Victory on the salt flats' : 'Defeat at dawn';
    this.el.matchSub.textContent = scoreText;
    this.el.matchend.hidden = false;
    this.el.overlay.hidden = true;
  }
  hideMatchEnd() { this.el.matchend.hidden = true; }
  showBuy(open) {
    this.el.buy.hidden = !open;
    if (open) this.el.buyMoney.textContent = '$' + this._lastMoney;
  }
  buyOpen() { return !this.el.buy.hidden; }

  flashHitmarker(headshot) {
    this.el.hitmarker.classList.add('on');
    this.el.hitmarker.classList.toggle('headshot', !!headshot);
    this._hitT = 0.12;
  }
  showBanner(title, sub, seconds) {
    this.el.bannerTitle.textContent = title;
    this.el.bannerSub.textContent = sub || '';
    this.el.banner.hidden = false;
    this._bannerT = seconds || 3;
  }
  hideBanner() { this.el.banner.hidden = true; this._bannerT = 0; }

  update(state, player, spread, dt) {
    const p = player;
    // crosshair widens with spread: gap in px from the spread in radians
    const gap = 6 + spread * 900;
    this.el.crosshair.style.setProperty('--gap', gap.toFixed(1) + 'px');
    if (this._hitT > 0) {
      this._hitT -= dt;
      if (this._hitT <= 0) this.el.hitmarker.classList.remove('on');
    }
    if (this._bannerT > 0) {
      this._bannerT -= dt;
      if (this._bannerT <= 0) this.el.banner.hidden = true;
    }
    // damage direction: rotate the indicator so the red arc points at the shooter
    if (p.lastDamageFrom !== null && state.time - p.lastDamageAt < 1.2) {
      const rel = p.lastDamageFrom - p.yaw;
      this.el.dmg.style.transform = `translate(-50%,-50%) rotate(${(-rel * 180 / Math.PI).toFixed(0)}deg)`;
      this.el.dmg.style.opacity = '1';
    } else {
      this.el.dmg.style.opacity = '0';
    }
    this._lastMoney = p.money;
    this.el.hp.textContent = Math.max(0, Math.ceil(p.hp));
    this.el.hp.parentElement.classList.toggle('low', p.hp <= 30);
    this.el.armor.textContent = p.armor;
    this.el.money.textContent = '$' + p.money;
    const def = WEAPONS[p.weapon];
    this.el.weapon.textContent = def ? def.name : '—';
    this.el.mag.textContent = p.mag[p.weapon] ?? 0;
    this.el.reserve.textContent = '/ ' + (p.reserve[p.weapon] ?? 0);
    this.el.grenades.textContent = 'HE ' + p.grenades.he + ' · Smoke ' + p.grenades.smoke;
    const t = roundTimeLeft(state);
    this.el.timer.textContent = Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
    this.el.timer.parentElement.classList.toggle('urgent', t <= 10 && state.phase === 'live');
    this.el.score.textContent = state.score.atk + ' – ' + state.score.def;
    this.el.round.textContent = 'Round ' + state.round + ' / 15';
    const b = state.bomb;
    if (b.state === 'planted') {
      this.el.bomb.textContent = 'BOMB ' + Math.ceil(b.timer) + 's · Site ' + b.site;
      this.el.bomb.classList.add('planted');
    } else if (b.state === 'carried') {
      const carrier = state.fighters.find((f) => f.id === b.carrierId);
      this.el.bomb.textContent = carrier
        ? (carrier.isPlayer ? 'YOU carry the bomb' : carrier.name + ' carries the bomb')
        : 'Bomb dropped';
      this.el.bomb.classList.remove('planted');
    } else {
      this.el.bomb.textContent = state.phase === 'buy' ? 'Buy phase — press B' : '';
      this.el.bomb.classList.remove('planted');
    }
    // objective hint
    let obj = '';
    if (state.phase === 'buy') obj = 'Buy phase — B opens the shop, then push a site.';
    else if (state.phase === 'live') {
      if (b.state === 'planted') {
        obj = p.team === 'def' ? 'Bomb planted at ' + b.site + ' — defuse it! (hold E at the bomb)'
          : 'Bomb planted at ' + b.site + ' — guard it until it blows.';
      } else if (b.state === 'carried' && b.carrierId === p.id) {
        obj = 'You carry the bomb — reach site A or B and hold E to plant (3 s).';
      } else if (p.team === 'atk') obj = 'Attack — plant the bomb at site A or B, or eliminate the defenders.';
      else obj = 'Defend — hold sites A and B. Stop the plant.';
    } else if (state.phase === 'roundEnd') obj = state.roundReason || '';
    this.el.objective.textContent = obj;
    // plant / defuse progress bar
    const prog = Math.max(b.plantProgress, b.defuseProgress);
    if (prog > 0 && (b.state === 'carried' || b.state === 'planted')) {
      this.el.plantbar.hidden = false;
      this.el.plantfill.style.width = (prog * 100).toFixed(0) + '%';
      this.el.plantlabel.textContent = b.plantProgress > 0 ? 'PLANTING…' : 'DEFUSING…';
    } else {
      this.el.plantbar.hidden = true;
    }
    // killfeed (render only new entries)
    if (state.killfeed.length !== this._feedRendered) {
      this._feedRendered = state.killfeed.length;
      this.el.killfeed.innerHTML = '';
      for (const k of state.killfeed.slice(0, 5)) {
        const div = document.createElement('div');
        div.className = 'feed-row';
        const kc = k.killerTeam === 'atk' ? 'atk' : 'def';
        const vc = k.victimTeam === 'atk' ? 'atk' : 'def';
        div.innerHTML = '';
        const a = document.createElement('span'); a.className = kc; a.textContent = k.killer;
        const mid = document.createElement('span'); mid.className = 'feed-mid';
        mid.textContent = k.headshot ? ' ⌖ ' : ' ✕ ';
        const v = document.createElement('span'); v.className = vc; v.textContent = k.victim;
        div.append(a, mid, v);
        this.el.killfeed.appendChild(div);
      }
    }
    // buy menu prices / affordability
    if (!this.el.buy.hidden) {
      this.el.buyMoney.textContent = '$' + p.money;
      for (const btn of document.querySelectorAll('[data-buy]')) {
        const kind = btn.dataset.buy;
        let owned = false, price = 0;
        if (kind === 'rifle' || kind === 'smg') { owned = !!p.owned[kind]; price = WEAPONS[kind].price; }
        else if (kind === 'he' || kind === 'smoke') { owned = p.grenades[kind] >= 2; price = 300; }
        else if (kind === 'armor') { owned = p.armor >= 100; price = 650; }
        btn.disabled = owned || p.money < price;
        btn.classList.toggle('owned', owned);
      }
    }
  }
}
