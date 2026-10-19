# Dialogue

Every line the game shows (speech bubbles and toasts) lives in **`client/lines.js`**,
grouped by who speaks: `ped.*`, `npc.*`, `rider.*`, `dog.*`, `gaali.*`, `hand.*`,
`deliver.*`, `me.*`, `toast.*`. Each key is a list; one line is picked at random.

- **Add or change a line:** edit the list. Nothing else changes.
- **Placeholders:** `{amount}`, `{karma}`, `{who}`, `{name}`, `{line}`… are filled by the caller;
  `{Who}` capitalises `{who}`.
- **Code side:** `GameLines.say('toast.dogBite', { amount })`. `tests/lines.test.js` checks that
  every literal key used in `client/render.js` and `client/main.js` exists.
- **Voice:** Bengaluru street mix of Kannada, Hindi, Tamil and English ("what ra", "L board maga",
  "lets put one scene macha"). People book bOla/bUber/Bapido on their phones; auto drivers grumble
  about Bapido bikes. Gaalis are mostly masked with `*`. Satire targets infrastructure, not people.
