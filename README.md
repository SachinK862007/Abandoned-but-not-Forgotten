    # 🪐 Space Relics — Abandoned But Not Forgotten

An interactive 3D planetary web application developed for the **NASA Space Apps Challenge 2026**. **Space Relics** acts as a digital space museum that brings NASA's historic, discarded equipment on the Moon and Mars back to life through interactive 3D exploration and storytelling.

---

## 🚀 Challenge Overview
**Challenge:** *Abandoned but not Forgotten: Storytelling about NASA's Discarded Equipment on the Moon and Mars*

Thousands of pounds of historic hardware—from Apollo lunar descent stages to retired Martian rovers—rest silently across extraterrestrial surfaces. Our goal is to transform dense mission archives into an engaging, visual, and accessible experience for school-age youth, students, and space enthusiasts.

---

## ✨ Key Features

* **Interactive 3D Planetary Globes:** Rotate, zoom, and explore 3D surfaces of both **The Moon** and **Mars** powered by CesiumJS.
* **Geolocated Hardware Pins:** Clickable markers placed at the exact landing coordinates of iconic NASA equipment (e.g., *Apollo 11 Eagle Descent Stage*, *Opportunity Rover*, *Viking 1 Lander*).
* **Dual Storytelling Modes:**
  * **Junior Explorer Mode:** Fun, simplified, and engaging narratives tailored for school-age kids and general audiences.
  * **Mission Analyst Mode:** Detailed engineering accomplishments, launch data, and scientific discoveries.
* **Relic Story Modals:** Slide-out information cards featuring archival imagery, mission timelines, scientific breakthroughs, and each artifact's current physical state on the surface.

---

## 🛠️ Tech Stack

* **Frontend:** HTML5, Vanilla JavaScript (ES6+)
* **3D Rendering Engine:** [CesiumJS](https://cesium.com/platform/cesiumjs/)
* **Styling:** [Tailwind CSS](https://tailwindcss.com/)
* **Data Layer:** Structured JSON (`relics.json`)

---

## 📂 Project Structure

```text
space-relics/
├── index.html       # Main UI layout, Tailwind CSS & CesiumJS integration
├── app.js           # 3D globe rendering, pin plotting, and interactive modal logic
├── relics.json      # Curated NASA hardware dataset (coordinates, stories, imagery)
├── assets/          # Planetary surface textures & local media assets
└── README.md        # Project documentation