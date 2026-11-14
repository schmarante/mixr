# Architektur-Spezifikation: Strudel Visual Studio

**Projekt:** Eine modulare, nicht-limitierende visuelle Benutzeroberfläche (GUI) für die Live-Coding-Umgebung "Strudel", basierend auf einem Multi-Agenten-System.
**Framework:** Astro (SSG/SSR) mit isolierte UI-Komponenten (Island Architecture).
**Zustandsverwaltung:** Nano Stores (für framework-übergreifende Reaktivität).

---

## 1. Zielsetzung & Kernkonzept

Das Ziel ist es, die steile Lernkurve von code-basierter Musik (Live-Coding) durch einen visuellen Baukasten zu senken, ohne die algorithmischen Möglichkeiten (Polyrhythmik, Generative Musik) von Strudel zu beschränken. 

Anstatt einer monolithischen Applikation nutzen wir **Astro Islands**, um die Anwendung in völlig isolierte Bereiche aufzuteilen. Mehrere spezialisierte "Agenten" (Software-Module oder KI-Agenten) kümmern sich exklusiv um ihre jeweiligen Aufgaben (UI, Kompilierung, Audio), was das System extrem performant, skalierbar und erweiterbar macht.

---

## 2. Das Multi-Agenten-Ökosystem

Das System besteht aus autonomen Agenten, die jeweils nur ihren eigenen Teilbereich (Domain) kennen und über einen zentralen Event-Bus miteinander kommunizieren.

### A. Der UI & Node Orchestrator
*   **Aufgabe:** Kümmert sich ausschließlich um das Rendering des visuellen Baukastens (Drag & Drop, Zeichnen der Nodes/Blöcke, Parameter-Eingaben).
*   **Technologie:** Läuft als interaktive Astro-Island

### B. Der Compiler (Logik-Agent)
*   **Aufgabe:** Übersetzt den visuellen Node-Baum (Abstract Syntax Tree, AST) im Hintergrund in syntaktisch korrekten Strudel-Code.
*   **Technologie:** Reines TypeScript. Läuft als Background-Worker, reagiert auf Änderungen im UI-Zustand.

### C. Die Strudel Engine (Audio-Agent)
*   **Aufgabe:** Nimmt den generierten Code-String entgegen, evaluiert ihn über die Strudel.js Core-Bibliothek und verwaltet die Web Audio API. 
*   **Technologie:** Läuft als Vanilla-JS-Island, entkoppelt vom UI-Render-Zyklus, um Latenzen oder Stottern bei der Audioausgabe zu vermeiden.

### D. Der AI-Assistant (Optionaler KI-Agent)
*   **Aufgabe:** Nimmt Text-Prompts (z.B. "Generiere einen treibenden Techno-Beat") entgegen und manipuliert direkt den Zustand der visuellen Nodes, woraufhin der Compiler und Audio-Agent automatisch reagieren.

---

## 3. Das Nervensystem: Nano Stores

Da die Astro-Inseln isoliert sind, nutzen wir **Nano Stores** als zentralen Event-Bus. Jeder Agent liest und schreibt nur die Daten, die für ihn relevant sind.

```typescript
// src/store/agentBus.ts
import { atom, map } from 'nanostores';

// 1. UI Agent speichert hier die visuelle Struktur, Compiler liest sie
export const visualAstStore = map({
  nodes: [],
  edges: []
});

// 2. Compiler Agent schreibt den fertigen Code, Audio Agent liest ihn
export const compiledStrudelCode = atom<string>('');

// 3. Audio Agent meldet Playback-Status an die UI zurück
export const playbackState = map({
  isPlaying: false,
  currentCycle: 0
});
```

---

## 4. Verzeichnisstruktur (Astro Workspace)

```text
/src
 ├── /agents                  # Geschäftslogik und Datenverarbeitung
 │    ├── CompilerAgent.ts    # Wandelt UI-Nodes in Strudel-Strings um
 │    ├── AudioAgent.ts       # Kapselt die Strudel.js Core-Bibliothek
 │    └── AIAssistantAgent.ts # LLM-Schnittstelle für Prompt-to-Node
 │
 ├── /components              # Visuelle Astro-Islands
 │    ├── /ui                 
 │    │    ├── NodeWorkspace.tsx    # React: Visueller Node-Editor
 │    │    ├── CodeMonitor.tsx      # React: Live-Code-Vorschau
 │    │    └── ParameterSidebar.vue # Vue/React: Drehregler & Inputs
 │    └── /audio
 │         └── AudioEngine.astro    # Bindet den AudioAgent ein
 │
 ├── /store
 │    └── agentBus.ts         # Nano Stores (Das Nervensystem)
 │
 ├── /layouts
 │    └── Layout.astro        # Globale HTML/CSS-Struktur
 │
 └── /pages
      └── index.astro         # Hauptseite, orchestriert die Islands
```

---

## 5. Integration im Frontend (index.astro)

Das Layout setzt die unabhängigen Agenten und Inseln zusammen. Das JavaScript wird nur geladen, wo es benötigt wird.

```astro
---
// src/pages/index.astro
import Layout from '../layouts/Layout.astro';
import NodeWorkspace from '../components/ui/NodeWorkspace.tsx';
import CodeMonitor from '../components/ui/CodeMonitor.tsx';
import AudioEngine from '../components/audio/AudioEngine.astro';
---

<Layout title="Strudel Visual Studio">
  <main class="app-grid">
    <!-- UI Agent (React Island) -->
    <section class="workspace">
      <NodeWorkspace client:only="react" />
    </section>

    <!-- Code Monitor (React Island) -->
    <aside class="sidebar">
      <CodeMonitor client:load />
    </aside>

    <!-- Audio Agent (Vanilla JS / Hidden) -->
    <AudioEngine />
  </main>
</Layout>

<style>
  .app-grid { display: grid; grid-template-columns: 3fr 1fr; height: 100vh; }
</style>
```

---

## 6. Der Datenfluss (Workflow-Beispiel)

1.  **Interaktion:** Der Nutzer zieht einen `Reverb`-Block in den Workspace (React).
2.  **UI Update:** Der `UI-Agent` aktualisiert den `visualAstStore` mit dem neuen Block. Seine Arbeit ist abgeschlossen.
3.  **Kompilierung:** Der `Compiler-Agent` registriert die Änderung im Store. Er generiert den neuen Code-Snippet (z. B. `.room(0.5)`) und schreibt den finalen String in den `compiledStrudelCode`-Store.
4.  **Ausführung:** Der `Audio-Agent` bemerkt den neuen Code-String, übergibt ihn an die Strudel-Engine via `eval()` und der Sound wird ohne Unterbrechung mit Reverb abgespielt.