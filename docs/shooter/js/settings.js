// Player settings, saved in localStorage.

const KEY = 'tapfire-settings-v1';

export const DEFAULTS = {
  sensitivity: 0.4, // same scale as Valorant (0.07 degrees per count per 1.0)
  zoomSensMult: 1.0, // scoped/ADS multiplier, applied on top of zoom-ratio scaling
  invertY: false,
  adsMode: 'hold', // 'hold' | 'toggle'
  walkMode: 'hold',
  crouchMode: 'hold',
  wheel: 'weapons', // 'weapons' | 'jump'
  volume: 0.6,
  showImpacts: true,
  impactSeconds: 6,
  damageNumbers: true,
  debug: false,
  shadows: true,
  renderScale: 1,
  // crosshair
  chColor: '#00ff9c',
  chOutline: true,
  chDot: false,
  chLength: 5,
  chThickness: 2,
  chGap: 3,
  chError: 'off', // 'off' | 'firing' (lines spread with movement and firing error)
  // match
  botCount: 6,
  difficulty: 'normal',
  botMode: 'fight',
  botWeapons: 'rifles',
  shields: 'heavy',
  killLimit: 40,
  timeMinutes: 6,
  loadout: { primary: 'vandal', secondary: 'classic' },
};

export function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULTS, ...s, loadout: { ...DEFAULTS.loadout, ...(s.loadout || {}) } };
  } catch {
    return { ...DEFAULTS, loadout: { ...DEFAULTS.loadout } };
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}
