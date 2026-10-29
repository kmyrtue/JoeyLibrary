# The cats

Joey's three cats live in the bookshelf room. This file collects everything known about them: who they are, what
real cats look like and do, what earlier research found, the user's corrections, and how all of that maps onto
the code in `js/cat.js`.

How the code is built, and the loop for checking a change, are in the project skill
`.claude/skills/procedural-cat-threejs/SKILL.md`.

## Joey's cats

| Name | Coat key | Who she is (from the user's photos and words) | In the model |
|---|---|---|---|
| **Kali** | `calico` | A calico: mostly white, with black and ginger patches on the back and head, a black cap with a white blaze down the face, and a ginger patch over one ear. Ringed ginger-and-black tail with a black tip. Seen in the photo lying on the pine chest. | Reference size (scale 1). Slightly plump (`plump` 1.1). Green-yellow eyes. |
| **Cisco** | `ginger` | Ginger-and-white: an orange tabby back and head with darker stripes; white chest, belly, muzzle and legs (one hind leg ginger). Seen in the photo on the windowsill. | Scale 1. Amber eyes. Striped tail. |
| **Lucifer** | `black` | "A slightly smaller, completely black cat", sleek and short-haired. Yellow-green eyes, big upright ears, a slim build, and a tail often held in a hook or question mark. She likes the top of the box room ("the square room"), where there is a rug (plain sand-coloured, "the cheapest rug you can find") and a small pink children's couch. "In general, just lying down flat on the kid's couch"; sometimes walks about up there and looks over the edge. | Scale 0.9, `slim` 0.94, ears ×1.22, wider pupils (0.5). Fur longer (`furK` 0.72) and rougher (`rough` 0.74) than at first, so the hair shows from above. A faint brown sheen pattern in the coat, so she doesn't read as a black hole. |

Only Lucifer is in the room so far, in `roomCat()`. Kali and Cisco are coats in the spike page, the **Cat Gait Spike**
artifact: https://claude.ai/artifact/JJ4Wp4pfmBw6rqSNSGzjvE. They will be placed in the room later, the calico
on the pine chest and the ginger on the windowsill, as in the photos. Their sizes can be checked against the
measured furniture: the pine chest is 820 mm high and the windowsill 290 mm deep.

## Research: who has done cats in 3D (October 2026)

- **Stray** (BlueTwelve) is the best-known game cat. Its animators filmed their own office cats for reference
  ([80.lv](https://80.lv/articles/stray-developers-talked-about-the-real-cats-that-inspired-them)). Neither the
  tools nor the animations are public.
- **AI4Animation** (Sebastian Starke) learns movement from motion capture. Its quadruped data is a dog, and both the
  code and the data are non-commercial
  ([readme](https://github.com/jsam/AI4Animation/blob/master/AI4Animation/SIGGRAPH_2018/ReadMe.md),
  [CC BY-NC data](https://github.com/paulstarke/AnimationAuthoring)). The *Artemis* paper captured real cats and
  dogs ([paper](https://arxiv.org/pdf/2202.05628)), but no released data was found.
- **SMAL, SMALify and SMALR** are a 3D animal model built partly from scans of toy animals. SMALify fits it to one
  photo ([github](https://github.com/benjiebob/SMALify)). SMALR also recovers the coat texture from a few photos
  ([project](https://ps.is.tuebingen.mpg.de/code/smalr-capturing-animal-shape-and-texture-from-images)). Both have
  research licences. They remain the best lead for getting Kali's and Cisco's real build and coat from the photos.
- **Ready-made:** Sketchfab has rigged cats with walk cycles
  ([example](https://sketchfab.com/3d-models/momo-low-poly-cat-walk-cycle-6338b1fab12b496abf8a0ae047c0bfca)). Small
  three.js toys exist, such as [Miso](https://discourse.threejs.org/t/miso-3d-cat-a-tiny-family-friendly-three-js-toy/92447),
  and there is a three.js/cannon.js gait simulator for the Nybble robot kitten
  ([report](https://compusciencing.github.io/report-web-simulator.html)). None of them does steerable walking.
- **Conclusion:** no open project gives a steerable cat for three.js, so we built our own. It uses a per-leg phase
  gait controller, IK, and a body and coat built in code. The same three.js as the room runs it, with no files to
  load.

## Real cats: anatomy and movement

These are the facts the model is built on. Use them as the checklist when you judge a pose. ✔ means the model
follows it; **(fb)** means a user correction found it.

### Build

- An adult house cat stands about 23–25 cm at the shoulder. The body is about 45 cm long without the tail, and the
  tail is 25–30 cm. The model has its chest at 0.20 m, a spine of 0.48 m from the rump to the back of the head, and
  a tail of 0.30 m. ✔
- Cats are **digitigrade**: they walk on their toes. The "backward knee" of the hind leg is the hock (the ankle); the
  real knee sits high, near the belly, and points forward. The front elbow points back. ✔ (IK poles)
- The hind legs are heavy, with big thighs: the haunch is the widest part of the cat seen from behind. A thin tube
  for a thigh reads at once as wrong. ✔ (hind haunch radius 0.043). The thighs still look a little flat-shaded.
- The neck is thick and the head joins the body smoothly, with no collar. ✔ (a single body loft into the head)
- The ears are open cones, thin at the edge, set wide and turned a little outward. Lucifer's are bigger. ✔
- The pupils are vertical slits in bright light and wider in dim light. ✔ (`pupil`)
- Whiskers fan out from the whisker pads and curve down a little. ✔
- The coat lies back along the body, down the legs and out along the tail. The roots are darker than the tips, and
  patch edges are soft, not sharp. ✔ (`furComb`, root darkening, blur and jitter). **(fb)** the first coat had
  stair-stepped patch edges.

### Gait

- The walk is a **lateral sequence**: left hind, left front, right hind, right front, about a quarter cycle apart.
  Each paw is on the ground about 60–65% of the cycle (duty factor 0.64), and two or three paws are always down. ✔
- Faster, the walk becomes a **trot**: diagonal pairs move together, with a duty factor of about 0.4–0.5. ✔
  (blended by speed, from 0.75 to 1.15 m/s)
- A planted paw does not slide. It stays put until it steps. ✔
- Cats **direct-register**: the hind paw lands in or near the print of the front paw on the same side. The model's
  neutral paw spots are 12.5 cm in front of and behind the cat's centre, which comes close to this.
- The spine bends into turns. The back bobs twice per stride, a little. ✔
- Walking content, the tail is held up with a hooked tip (the "question mark"). Standing, it hangs low with the tip
  curved up, swishing slowly. ✔
- A cat stepping onto a seat or shelf hops: it gathers and springs. The model has a 0.34 s arc; a proper crouch and
  spring is still to do.

### Resting poses

- **Sitting:** the rump is on the floor. The hind legs are folded fully, with the hocks flat on the floor and the
  hind paws right under the haunch, so the leg lies against the body all the way. The front legs are straight and
  close together, and the tail is wrapped round the paws or along the side. **(fb)** "in the seated position the back
  legs go a lot more forward than they should … everything becomes a lot more compressed, to the point where the legs
  are up against the body." ✔ (hind `feet` [0.072, 0.04], `hug`)
- **Loaf:** the paws are tucked under the chest and the body is low and wide. The head is up, often with the eyes
  half shut. The tail lies **against the body**, round the haunch and along the flank. **(fb)** "when they lie down as
  a loaf they have the tail up against their body … it's okay that it clips a tiny bit in, better than it sticking
  out." ✔ (`hug` 0.092)
- **Flat on the side:** the cat lies on its side with the legs out loose and the upper legs resting on the lower
  ones. The head lies on its side **turned the same way as the body**. **(fb)** "When flat, the head rotates the wrong
  way so that it basically looks like it has bent its spine." ✔ (head roll sign flipped)
- **Donut:** lying on its side, curled round the belly into a near-full ring. The nose is tucked at the base of the
  tail or the hind legs, the paws are tucked into the middle, and the tail wraps round the inside over the paws and
  nose. Cats bend round the **belly**, never the back. **(fb)** "it bends around its back, but cats bend around their
  belly". The body roll was already belly-in. Flipping it put the legs outside the ring, so that was reverted. What
  made it read as bent backwards was the head rolled against the body, which is now fixed. **(fb)** the tail stuck out
  of the donut; it now runs inside the ring. ✔
- **Curl (in a bed):** much the same as the donut, but sitting more upright in a round bed, after turning round in
  it first. ✔ (`circle`)
- **Eating:** a crouch: the chest drops and the elbows bend, and the neck curves down so the mouth reaches into the
  bowl. **(fb)** "when eating … the neck going down also looks really weird" (the neck dropped from a stiff chest). ✔
  The elbows still stick up a little high.
- **Peering over an edge:** a low crouch at the edge, with the chest down, the head out over the edge and pitched
  down, looking about. ✔

### Behaviour

- House cats sleep or rest for most of the day. The user wants Lucifer lying down **98–99%** of the time:
  - "If you go into the program, it seems like it's just a cat that's going to be lying down."
  - "Only after 2 to 5 minutes will it move up and move around."
  - "After going around for a bit, it will sit down or lie down in another position in another place."

  How the code does it:
  - Rests last 120–300 s (`restFor`), and half of them simply continue (`stay`).
  - When she gets up, 85% of the time she resettles where she is.
  - Otherwise she takes 1–2 roaming walks (to a spot, sometimes sitting there, or to an edge to peer over it), then
    lies down on the couch (60%) or the rug.
  - Measured over a simulated 2 hours: **98.3% lying**. An earlier tuning, with getting up more often, came to 96%
    over 20 minutes.
- A cat turns round once or twice before it curls up. ✔ (`circle`)
- She always starts lying, on the spot, heading and pose saved when the room was last open
  (`Store.saveCase('cats', {lucifer: {at, heading, kind}})`). ✔
- She never walks off the top of the box room, and she walks round the couch, not through it. ✔

## How the numbers map to the code

- Sizes are in metres in the cat's own frame. Room code is in mm: room (x, y, height) is three (x, height, −y).
- `POSES` holds one row per rest. Each row's fields are explained in the skill and in the comments above `POSES`.
- `SEG` holds the spine segment lengths. `CURL`/`RING` give the arc span (rad) and the height of each spine point.
- `KEYS` is the body cross-section along the spine. Its widest point is at u ≈ 0.33 (the ribcage), and the waist
  narrows towards the hips.
- `LEGS[].walk/.trot` are the phase offsets: LH 0, LF 0.25, RH 0.5, RF 0.75 in the walk; diagonal pairs together in
  the trot.
- The coat functions return a colour for a point. `body(u, ca, sa)`: u runs from the rump (0) to the head (1), and
  sa > 0 is the back. `head(x, y, z)` takes a point on the unit sphere, with z forward and y up. `tail(k)`: k runs
  from the root (0) to the tip (1).

## Known weak spots and open questions

- The thighs look a little flat-shaded, and the legs inside the donut look papery with the fur turned off.
- Closed eyes show as a dark bar; there are no lids.
- Getting onto the couch is a simple hop arc through the front of the seat.
- The rug, couch size and placement are guesses: a 45 × 80 cm couch with a 25 cm seat, at x 1030–1480 mm and
  y 7980–8780 mm, its back to the low side of the slope. A photo of the top of the box room would settle them.
- Kali and Cisco are not in the room yet. Their scale against Lucifer (0.9) is a guess from "slightly smaller".
