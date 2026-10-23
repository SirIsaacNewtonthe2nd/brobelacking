# Tapfire

Browser FPS with Valorant-style gunplay. One map, free-for-all against bots. Placeholder art; the work is in the mechanics.

## Run it

Any static file server works, since it uses ES modules:

```
cd docs && npx http-server -p 8080
# open http://localhost:8080/shooter/
```

On GitHub Pages it lives at `<site>/shooter/` (or `<site>/docs/shooter/` if Pages serves the repo root).

## Controls

WASD move, Shift walk, C or Ctrl crouch, Space jump, left/right mouse fire and alt-fire (ADS, scope, burst), R reload, 1/2/3 or wheel to switch, Q last weapon, B loadout, Tab scores, F3 or ` debug readout, Esc pause.

Sensitivity uses the Valorant scale (0.07° per mouse count × sensitivity), with raw input when the browser supports it. Zoomed views scale by 1/zoom times the scoped multiplier.

## What's simulated

- 128 Hz fixed tick; rendering interpolates between ticks.
- Movement: run speed by weapon class (knife 6.75, sidearms/SMGs/shotguns 5.73, rifles 5.4, heavies/Operator 5.13 m/s), walk 0.6×, crouch 0.5×, ADS slow, acceleration/braking, counter-strafing, limited air control, crouch-jump, step-up on stairs.
- Accuracy: first-shot spread (hip and ADS), movement error with a speed deadzone, walk vs run error, airborne error, crouch ×0.85, firing error that builds over a spray.
- Recoil: per-weapon vertical climb, then sideways wander; the camera shows half of it so bullets land above the crosshair; recovery after you stop firing.
- Fire modes: auto/semi, Classic burst, Stinger/Bulldog ADS bursts, Ares/Odin spin-up (Odin full rate when ADS), scopes with zoom levels.
- Damage: head/body/leg values with range brackets, 50 shield on top of 100 HP, wall penetration through crates and wooden panels at reduced damage.
- Tagging: 72.5% slow on hit, 30% for shotgun pellets past 10 m.
- Bots use the same guns and input as you, so they have to stop to shoot accurately. Four difficulties.

## Where the numbers come from

Tuning lives in `js/weapons.js` (per weapon) and `js/config.js` (movement, tagging, body size).

From published Valorant data: damage and falloff brackets, fire rates, magazine sizes, reload and equip times, rifle first-shot spread (e.g. Vandal 0.25 / 0.157), movement speeds, the 72.5% tag, Warden stats.

Estimated, because Riot doesn't publish them: run/walk/air spread values, firing-error curves, recoil patterns, recovery times, acceleration, penetration depths, and body dimensions. Body size follows community figures: all agents share one hitbox at a reported 1.96 m, with the head about 13% of that (0.255 m tall, 0.24 m wide here).

## Privacy

The game makes no network requests and stores only its own settings in localStorage. The page sets a Content-Security-Policy that blocks outside scripts and all network connections. three.js is bundled in `vendor/` (MIT, see `vendor/three.LICENSE`).
