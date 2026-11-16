// Fails fast with an actionable message when the runtime is too old.
//
// The app targets Node 22.5+ locally and runs on Vercel's Node 26.x runtime
// (see README → "Node version"). Both are supported; nothing here needs
// `node:sqlite` any more, that module is only used by the one-off legacy export
// script.
const MIN = [22, 5, 0]

const current = process.versions.node.split('.').map(Number)
const [needMajor, needMinor] = MIN
const [major, minor] = current

const ok = major > needMajor || (major === needMajor && minor >= needMinor)

if (!ok) {
  console.error(`
  Space Relics needs Node.js ${MIN.join('.')} or newer (found ${process.versions.node}).

  .nvmrc pins Node 24 for local development, and the Vercel project runs 26.x.

  Fix:
    nvm install 24 && nvm use 24      # or: nvm use   (reads .nvmrc)
    npm install
`)
  process.exit(1)
}
