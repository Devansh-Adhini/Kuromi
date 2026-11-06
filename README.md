# Kuromi Desktop

A personal Windows desktop companion using your downloaded Sketchfab Kuromi model. Click her for local AI conversation, to-dos, Kuromi Note, and Google search.

## Start

Double-click `Launch Kuromi.lnk` in this project folder, or run `release/Kuromi Desktop-win32-x64/Kuromi Desktop.exe` after building. Keep the executable with the rest of that folder. Kuromi is portable; conversation also needs the local Ollama runtime and model described below.

For development, install Node.js 24 or newer and run:

```powershell
npm install
npm start
```

## Docker desktop preview

Run the Linux desktop in your browser with Docker Desktop in Linux container mode:

```powershell
docker run --rm --init -p 127.0.0.1:6080:6080 -v kuromi-data:/data devanshadhini/kuromi:latest
```

Open [the local desktop](http://localhost:6080/vnc.html?autoconnect=true). The named volume saves your notes and tasks. This build uses a virtual Linux display and software 3D rendering. It runs Electron without Chromium's sandbox. Keep the browser desktop port bound to loopback because the viewer has no password. Local chat requires Ollama reachable on loopback inside the container, so the default container runs with offline tools.

To build from source, run `docker build -t kuromi:latest .` and substitute `kuromi:latest` in the run command.

## Local conversation

Kuromi uses [Ollama](https://docs.ollama.com/windows) on this PC, with `llama3.2:3b` as the default. This [2 GB dialogue model](https://ollama.com/library/llama3.2:3b) leaves GPU headroom on the target PC's 4 GB GTX 1650. There is no API key or subscription.

If setting up another PC, install Ollama and download the model once:

```powershell
winget install --id Ollama.Ollama --exact --source winget
ollama pull llama3.2:3b
```

Open Kuromi. She detects installed local models; choose another in Settings if desired. **Refresh** checks the connection again. When no server is running, she can start Ollama from `runtime/ollama/ollama.exe` in this project, or its standard Windows installation location. The project runtime uses `runtime/models` for model data. Keep `runtime` beside the `release` folder when using this portable setup. There is no Windows service or startup registration added by Kuromi.

The chat connection is fixed to `127.0.0.1:11434`. Cloud model tags are excluded. Kuromi's own server startup disables Ollama cloud use and binds to loopback. Model downloads require an internet connection; conversation runs locally after setup. Your browser still uses Google when you explicitly use Search.

## Her little habits

- **Click Kuromi** to open or close her corner. Clicking elsewhere or switching applications collapses the panel. Unsent drafts remain when it closes. The interface uses black, purple, white and pink, without a pet name tag or status footer.
- **New Chat:** starts a fresh conversation context. The previous conversation is archived in `%APPDATA%/kuromi-desktop/conversations/`; notes and tasks are preserved. The button is disabled while a reply is streaming.
- **Chat:** conversational, playful Kuromi, with a soft sentimental side. She listens and banters; the prompt asks her to give advice when requested. Enter sends; Shift+Enter adds a line. Replies stream as they arrive; **Stop** cancels a reply and restores your message for editing. Failed or canceled exchanges aren't saved.
- **Daily motivation:** when unfinished to-dos exist, Kuromi picks one and gives a varied, sassy work nudge. These task-specific lines are assembled locally; task titles never go to the model. Finished or deleted tasks are replaced in the greeting. With an empty list, she gives a model-generated hello, or a labeled offline fallback. Greetings are cached for the local calendar day across restarts. The app must be open or launched that day; it doesn't create an OS reminder or start at login.
- **To-dos:** add a task, then hover over her to see unfinished plans above her. Click a checkbox to finish one. Use “Show finished” to reopen tasks.
- **Kuromi Note:** write a thought, choose your mood, and keep it in a dated log. Export your notes as text or JSON. Deleting a diary entry requires a second click on “Delete?”.
- **Search:** enter a query to open Google in your default browser. Only the search query is sent; to-dos and diary entries stay local.
- **Drag Kuromi** to move her. Her window stays within the available desktop work area.
- **Settings:** always on top, optional idle wandering, reduced motion, and pet size. Hide her to the system tray; click her tray icon to bring her back. Quit from Settings or the tray menu.
- **Automatic reactions:** her gestures respond to conversation, tasks, diary moods, cursor direction, dragging, and idle time. The menu contains Chat, To-dos, Kuromi Note, Search, and Settings, without a duplicate home page or animation buttons.

Animation uses the supplied GLB and 25 behavior modes, including listening, talking, reading her notebook, head tilts, stretching, ear twitches, giggling, pouting, and looking around. The static download has no skeleton or animation clips, so the app adds a nine-bone rig to its original meshes. Head, ears, arms and legs move through joints; attachment areas blend into the body. The model is uniformly normalized once for display, with fixed bone lengths and no pose-dependent body scaling or replacement anatomy. Head turns follow the cursor continuously within natural yaw and pitch limits. Turning and bending can change the visible silhouette while her underlying proportions stay consistent.

The handmade character has been replaced with **Kuromi by [jiayingc](https://sketchfab.com/jiayingc)** from [Sketchfab](https://sketchfab.com/3d-models/kuromi-a9a4883cbc2a40e89722001aa6288ba8), licensed in its embedded metadata under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The original geometry is retained; the app adds a skeleton, movement controls and an optional notebook prop. A runtime palette makes the source's grey hood, ears, collar and tail black, with a pink skull and accents. White body parts and eyes keep their source colors. See [model attribution](assets/ATTRIBUTION.md). `assets/kuromi.glb` is a byte-identical copy of the download, and the original GLB and OBJ ZIP remain untouched in the project root.

The pet's mouse hit area follows her visible silhouette, including animations and size changes. Transparent padding and the ground shadow do not open her tools or start dragging, and pass clicks to the desktop. Keyboard activation and the explicit tools button remain available.

Soft lighting and a ground shadow give the model volume. Three.js renders locally with no CDN or remote assets. Rendering follows the display refresh, including high refresh displays; actual FPS depends on hardware and load. If WebGL is unavailable, a single original standing illustration is used with simple movement, preserving its proportions. Reduced motion holds a still pose; hiding to the tray pauses drawing.

Conversation uses a sassy, bratty Kuromi voice with role-separated dialogue examples, theatrical complaints, rivalry and a softer response to genuine distress. These examples are instructions, not saved user memories. The local model can still vary in character adherence. This is prompt and inference tuning, not model-weight fine-tuning. Your existing conversation is preserved; the new voice applies to subsequent replies.

The model's character prompt draws on Kuromi's mischievous pride, My Melody rivalry, fondness for Baku, diary keeping, and romance novels, consistent with [Sanrio's character profile](https://corporate.sanrio.co.jp/en/business-info/brands/kuromi/). The dialogue is generated and can vary; it isn't official anime dialogue. Input is typed, with no microphone or spoken audio. Chat cannot change your tasks or diary; use those tools' buttons for actions.

## Your data

Tasks, thoughts, settings, and window position are stored in `%APPDATA%/kuromi-desktop/journal.json`. Conversation history (up to 40 messages), model selection, and recent daily greetings are stored separately in `companion.json`. Both files are local plaintext. The model receives a bounded recent chat context, with no automatic access to diary entries, tasks, files, or your browser. Saves use temporary files and atomic rename; unreadable files are preserved as `.corrupt-*` for recovery.

There is no analytics, remote web content, account, or automatic startup in Kuromi. Her original ChatGPT pet artwork is preserved locally for reference, the app icon and the compatibility fallback; the ChatGPT pet isn't modified.

## Check and build

```powershell
npm test
npm run test:ui
node scripts/ui-features.cjs
npm run package
```

The unit suite checks storage, damaged-file recovery, streaming/cancellation, local model validation, daily greeting caching, unchanged 3D anatomy across every action, continuous head angles and animation state transitions. The real Electron UI suite uses an isolated profile and simulated Ollama transport. It checks all tools, streaming chat, cancellation, privacy boundaries, restart persistence, native window controls, real 3D rendering and clipping across all gestures; it reports observed refresh timing. Browser opening and export dialogs are intercepted. Screenshots go in `test-results/`. The simulated transport does not establish that a particular model is installed or working; actual local inference must also be checked during setup.

Packaging produces a portable Windows x64 folder in `release/`. The build is unsigned. It is a personal unofficial project. Kuromi is a Sanrio character; this is not an official Sanrio product.
