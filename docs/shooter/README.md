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
- Recoil, using Valorant's model: the gun climbs along a per-weapon curve while drifting to one side, picked at random each spray, and holds at the edge. The side can't change during the first "protected" bullets (Vandal 6, Phantom 8, Spectre 5). After that each shot has a chance to flip it (10% on rifles), and the sweep across takes a set time (0.6 s rifles, 0.28 s Spectre). The camera shows half the recoil, so bullets land above the crosshair, and it all settles after you stop firing.
- Reloads per weapon; the Outlaw takes 2.3 s for one barrel and 3.8 s for both.
- Fire modes: auto/semi, Classic burst, Stinger/Bulldog ADS bursts, Ares/Odin spin-up (Odin full rate when ADS), scopes with zoom levels.
- Damage: head/body/leg values with range brackets, 50 shield on top of 100 HP, wall penetration through crates and wooden panels at reduced damage.
- Tagging: 72.5% slow on hit, 30% for shotgun pellets past 10 m.
- Bots use the same guns and input as you, so they have to stop to shoot accurately. Four difficulties.

## Where the numbers come from

Tuning lives in `js/weapons.js` (per weapon) and `js/config.js` (movement, tagging, body size).

From published Valorant data: damage and falloff brackets, fire rates, magazine sizes, reload and equip times, rifle first-shot spread (e.g. Vandal 0.25 / 0.157), movement speeds, the 72.5% tag, Warden stats. Recoil structure from patch 11.08: protected bullets, yaw switch chance and switch time for the Vandal, Phantom, Bulldog and Spectre, the Stinger's front-loaded climb, and the Spectre's 1.4 total spread. Shotgun spread from patch 12.09 (Bucky 3.0, Judge 2.5).

Estimated, because Riot doesn't publish them: the per-bullet recoil angles, protected bullets and switch timing for the other guns, run/walk/air spread values, firing-error curves, recovery times, acceleration, penetration depths, and body dimensions. Body size follows community figures: all agents share one hitbox at a reported 1.96 m, with the head about 13% of that (0.255 m tall, 0.24 m wide here).

## Privacy

The game makes no network requests and stores only its own settings in localStorage. The page sets a Content-Security-Policy that blocks outside scripts and all network connections. three.js is bundled in `vendor/` (MIT, see `vendor/three.LICENSE`).
