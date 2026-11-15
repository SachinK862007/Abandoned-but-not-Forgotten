# Launch Lab

Build a rocket from parts, pick a real launch site on a 3D Earth, and launch it to Earth orbit, the Moon or Mars.

## Run it
1. Open a terminal in this folder.
2. Start the server: `node serve.mjs` (or `npm start`).
   No Node.js? Use Python: `python3 -m http.server 8080 --directory public` (Windows: `py -m http.server 8080 --directory public`).
3. Open http://localhost:8080 in Chrome.

Do not open `public/index.html` by double-clicking: browsers block some files that way.
An internet connection is needed (3D library, fonts, NASA images near the launch site).

## Test the rules
`node --test test/sim.test.mjs` (or `npm test`)

## Files
- `public/sim.js` – the game rules (parts, missions, launch sites, rocket equation, how a launch ends)
- `public/game.js` – the 3D game (three.js)
- `public/index.html`, `public/styles.css` – the page
- `public/textures/`, `public/data/` – Earth, Moon and Mars images and height maps
- `test/sim.test.mjs` – automatic tests
- `serve.mjs` – tiny local web server

See the Student Guide (PDF) for full instructions, a demo script and exercises.
Image credits: see CREDITS.md.
