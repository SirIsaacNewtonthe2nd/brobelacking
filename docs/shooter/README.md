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
- Movement: run speed by weapon (knife 6.75; Classic, Frenzy, Ghost, Bandit and SMGs 5.73; Sheriff, shotguns, rifles and Marshal/Outlaw 5.4; Operator and heavies 5.13 m/s), walk 0.6×, crouch 0.5×, slower while aiming or scoped (76%; Marshal 90%, Outlaw 80%, Operator 72%), acceleration/braking, counter-strafing, limited air control, crouch-jump, step-up on stairs.
- Accuracy, laid out like the wiki's spread tables: first-shot and max spread for hip fire and ADS, a per-gun crouch multiplier (rifles ×0.85, pistols ×0.75, snipers ×0.9, heavies ×0.6), and movement penalties for crouch-walking, walking, running and being airborne that scale with speed above a deadzone. Landing adds 7° for 0.225 s. Firing error builds from first-shot to max spread over a spray; the Ares works the other way and tightens from 1.0° to 0.7° over 13 shots.
- Recoil, using Valorant's model: the gun climbs along a per-weapon curve while drifting to one side, picked at random each spray, and holds at the edge. The side can't change during the first "protected" bullets (Vandal 6, Phantom 8, Spectre 5). After that each shot has a chance to flip it (10% on rifles), and the sweep across takes a set time (0.6 s rifles, 0.28 s Spectre). The camera shows half the recoil, so bullets land above the crosshair, and it all settles after you stop firing.
- Scopes and ADS: zoom per weapon (Spectre, Stinger, Ares, Odin 1.15×; Vandal, Phantom, Bulldog 1.25×; Guardian 1.5×; Warden 2×; Marshal and Outlaw 3.5×; Operator 2.5× / 5×). The Ghost, Sheriff, Frenzy, Bandit and Shorty have no ADS. The Operator and Marshal drop out of the scope after each shot; hold right click and they scope back in as soon as the bolt has cycled. The Outlaw stays scoped, and its follow-up shot has 2.25° spread and 4° recoil (13.01).
- Fire modes: auto/semi, Classic 3-round burst with its own spread table, Stinger 4-round and Bulldog 3-round ADS bursts, Bucky tight-spread alt fire, Odin fire rate climbing 12 → 15.6/s (full rate from the start when aiming).
- Reloads per weapon; shooting with rounds left cancels a reload and so does switching weapons. The Outlaw takes 2.3 s for one barrel and 3.8 s for both.
- Damage: head/body/leg values with range brackets, wall penetration through crates and wooden panels at reduced damage.
- Shields (pick in settings): Heavy and Light take 66% of each hit until they've absorbed 50 / 25; Regen takes all of a hit into 25 and refills from a 50 pool after 3 s without damage.
- Tagging: 72.5% slow on hit, 30% for shotgun pellets past 10 m.
- Bots use the same guns and input as you, so they have to stop to shoot accurately and wait for their scope. Four difficulties.

## Where the numbers come from

Tuning lives in `js/weapons.js` (per weapon) and `js/config.js` (movement, shields, tagging, body size).

From the VALORANT wiki and patch notes:
- Damage and falloff, fire rates, magazines, reload and equip times, prices, penetration tiers, run speeds.
- Spread tables (first-shot, max, crouched, ADS, movement penalties) for the Vandal, Phantom, Bulldog, Guardian, Spectre, Classic (both fire modes), Sheriff, Marshal, Outlaw and Operator; first-shot spread for the rest; shotgun movement accuracy (12.09).
- Recoil structure (11.08): protected bullets, flip chance and sweep time for the Vandal, Phantom, Bulldog and Spectre; the Stinger's front-loaded climb; Spectre total spread 1.4.
- Ares reverse accuracy and 13/s with no spin-up, Odin ramp, heavy crouch ×0.6, 1.15× heavy zoom.
- Shield absorption, scope behaviour, scoped move speeds, landing penalty, Outlaw follow-up shot (13.01), Bandit (12.00), Warden (13.06), Bucky pellet nerf and shotgun spread (12.09).

Estimated, because there's no published number: per-bullet recoil angles; the Marshal dropping out of scope after each shot (documented for the Operator, assumed from the Marshal's bolt action); protected bullets and flip timing for guns other than the four above; max spread and movement penalties for the Frenzy, Ghost, Bandit, Stinger and Warden; how many shots firing error takes to build; recovery times; Bucky alt fire; Regen refill speed; acceleration; penetration depths; tag duration; body dimensions. Body size follows community figures: all agents share one hitbox at a reported 1.96 m, with the head about 13% of that (0.255 m tall, 0.24 m wide here).

## Privacy

The game makes no network requests and stores only its own settings in localStorage. The page sets a Content-Security-Policy that blocks outside scripts and all network connections. three.js is bundled in `vendor/` (MIT, see `vendor/three.LICENSE`).
