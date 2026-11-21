# Yoga Practice Journal

Scribble a stick figure, pick the asana it matches, and string asanas into a
sequence you can replay for home practice. It works like the handwriting
keyboard for Japanese: draw in the box, tap a candidate, and it joins the line.

- 80 built-in Iyengar asanas, each with a drawn figure and its Sanskrit name
- Teach the app your own scribble for any asana; add your own asanas
- Sequences: new, rename, duplicate, delete, reorder, sorted by name or last edit
- Three ways to replay: whole sequence on one page with arrows, step by step,
  or timed with a bell
- Runs offline once installed; all data stays on the phone

## Put it on an iPhone

1. On GitHub, open **Settings → Pages**. Under *Build and deployment* choose
   **Deploy from a branch**, pick the branch that holds these files and the
   **/ (root)** folder, then save. (On a free plan the repository must be public.)
2. After a minute the app is live at
   `https://<your-user>.github.io/YogaPracticeJournal/`.
3. Open that address in **Safari** on the iPhone, tap **Share → Add to Home
   Screen**.
4. Open it once from the Home Screen while online. From then on it works with
   no connection.

## Your data

Sequences and scribbles are saved in the app's storage on the phone only.
Nothing is uploaded. Removing the Home Screen app or clearing Safari's website
data erases them, so use **Settings → Export backup** now and then. The backup
is a single file you can import again on any phone.

## How to use it

- **Sequences** – tap *New sequence*, give it a title, and draw in the box at
  the bottom. Matches appear above the box; tap one to add it. If the right
  asana is not offered, tap *Browse* and pick it — the app remembers that
  scribble for next time.
- Tap an asana in the sequence to set a hold time, sides, a note for props, or
  to move, duplicate or remove it. Press and hold, then drag, to reorder.
- **Asanas** – browse the library, rename an asana, and draw sample scribbles
  for it. *My own* adds an asana that is not in the library.
- **Practice** – open a sequence to see it on one page. *Practice* steps
  through it by tap or swipe; *Timed* counts down each hold and rings a bell.

## For developers

Plain HTML, CSS and JavaScript modules; no build step and no dependencies.

| File | Purpose |
| --- | --- |
| `js/asanas.js` | The asana library: names and pose angles |
| `js/figure.js` | Turns pose angles into the drawn figure and into outline strokes |
| `js/recognizer.js` | Point-cloud matcher for scribbles |
| `js/pad.js` | Drawing pad |
| `js/store.js` | Saving, loading and backup |
| `js/app.js` | Screens |
| `sw.js` | Offline cache — change `VERSION` whenever any file changes |

To run locally: `python3 -m http.server` in this folder, then open
`http://localhost:8000`.
