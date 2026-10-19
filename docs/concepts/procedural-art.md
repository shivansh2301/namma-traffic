# Concept: procedural art and tone

No image or audio files (SPEC §1): everything is drawn and synthesised in code.

## Palette (shared by both views)
| Thing | Colours |
|---|---|
| Asphalt | `#474b52` / `#43474e` (dry, alternating strips), `#33383f` wet |
| Footpath slabs / dirt shoulder | `#b9b09e` / `#8a7253` |
| Kerb stones | alternating `#202020` / `#e8c547` per metre |
| Lane paint | `#ece6d6`, alpha 0.3–0.9, some dashes missing |
| Median | `#5b8a3c` with shrubs `#3d6a29` / `#4e7e32` |
| Metro barricade | `#1f6fc4` panels with `#eef2f5` stripes, blinking orange lamps |
| Autos | green `#2e7d32` body, yellow `#f4c20d` canopy, yellow plate |
| Cars | white, silver, red, blue, black, grey, maroon, beige; cabs white with yellow plate and roof sign |
| BMTeaCee-style buses | red `#b8312f`, blue `#1f5fa8`, green `#2e7d32`, orange LED board |
| Water tankers | blue or ochre cab, white tank with bands and a drip |
| The player's Yolo | teal `#1fb5c4` / `#13808c`, wire basket, orange delivery sleeves |
| Sky | `#7fb2d9` to `#e6dfcb` haze (rain `#5e6b77` to `#a7aeb2`) |
| HUD | dark bar `rgba(14,17,22,0.8)`, condition `#4fc3f7`, karma green/amber/red, money `#ffd166` |

## Silhouette rules
Each vehicle type must read at a glance by shape: autos have the rounded
canopy, buses are wide and tall with an LED board, tankers show a round tank
end, bikes are narrow with a rider and mirrors, cars have a trapezoid cabin.
The player's vehicle always has the cyan accent (`#22e5ff`) in the top-down
view and the teal cockpit in first person.

## Streets
Shopfronts in 6 m cells chosen by `hash01(cell, side)`: 62% shops (1–3
storeys, pastel walls, dark shutters or goods, signboards, striped
awnings, black water tanks on roofs in the top-down view), 23% compound
walls with a rain tree, 15% empty plots. Poles with sagging cable bundles
about every 33 m. Street trees on footpaths.

## Tone
Affectionate satire of Bengaluru's **infrastructure**, never its people.
Speech bubbles use everyday Kannada/English ("Swalpa adjust maadi", "Oota
aayta?", "Banni, kootkoli", "Ayyo!"); pedestrians are victims of puddles,
not punchlines. Result summaries tease the commute ("Are you sure this was
Bengaluru?"). Keep new lines short (bubbles are ≥ 14 px and must fit the screen).
