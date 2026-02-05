# Perplexity Integration & UI-Vereinfachung

> **Datum:** 2026-02-05
> **Status:** Genehmigt

## Ziel

1. Perplexity API als Web-Such-Tool für Scout-Agent integrieren
2. Provider-Selector aus UI entfernen (Agents haben feste Modelle)

---

## Architektur

```
User: "Wie wird das Wetter morgen in Berlin?"
        ↓
    CHAPO (claude-opus-4-5)
        ↓ delegiert Recherche
    SCOUT (claude-sonnet-4)
        ↓ erkennt: Web-Suche nötig
    Perplexity API (sonar)
        ↓
    Antwort mit Quellen-Links
```

### Perplexity als Such-Tool

- **Trigger:** Hybrid - Scout entscheidet automatisch ODER User fordert explizit an
- **Modelle:** Alle verfügbar (sonar, sonar-pro, sonar-reasoning)
- **Ergebnisse:** Kompakte Antworten mit klickbaren Quellen-Links
- **Scope:** Ergänzend zu bestehenden Tools (nicht ersetzend)

### UI-Vereinfachung

- Provider-Selector wird entfernt
- Jeder Agent nutzt sein fest konfiguriertes Modell
- Schlanker Header

---

## Backend Implementation

### Neue Dateien

```
apps/api/src/
├── llm/
│   └── perplexity.ts        # Perplexity API Client
├── tools/
│   └── webSearch.ts         # web_search Tool Definition
```

### `perplexity.ts` - API Client

```typescript
interface PerplexityRequest {
  model: 'sonar' | 'sonar-pro' | 'sonar-reasoning';
  query: string;
  search_recency_filter?: 'day' | 'week' | 'month';
}

interface PerplexityResponse {
  answer: string;
  citations: { url: string; title: string }[];
}

export class PerplexityClient {
  private apiKey: string;
  private baseUrl = 'https://api.perplexity.ai';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(request: PerplexityRequest): Promise<PerplexityResponse> {
    // Implementation
  }
}
```

### `webSearch.ts` - Tool Definition

```typescript
export const webSearchTool = {
  name: 'web_search',
  description: 'Suche im Web nach aktuellen Informationen. Nutze dies für Wetter, News, externe Dokumentation, Best Practices.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Suchanfrage'
      },
      complexity: {
        type: 'string',
        enum: ['simple', 'detailed', 'deep'],
        description: 'simple=Fakten, detailed=Erklärungen, deep=Analysen'
      }
    },
    required: ['query']
  }
};
```

### Modell-Mapping

| Complexity | Perplexity Model | Use Case |
|------------|------------------|----------|
| `simple` | `sonar` | Wetter, Fakten, Definitionen |
| `detailed` | `sonar-pro` | Tutorials, Best Practices |
| `deep` | `sonar-reasoning` | Architektur, Vergleiche |

### Konfiguration

`.env`:
```
PERPLEXITY_API_KEY=pplx-xxx
```

---

## Scout Agent Anpassung

### Tools erweitern

```typescript
// apps/api/src/agents/scout.ts
tools: [
  // Bestehende Tools
  'fs_listFiles',
  'fs_readFile',
  'fs_glob',
  'fs_grep',
  'git_status',

  // NEU
  'web_search',
],
```

### System-Prompt erweitern

```
## WEB-SUCHE

Du hast Zugriff auf web_search für aktuelle Informationen.

WANN NUTZEN:
- Aktuelle Daten (Wetter, News, Preise)
- Externe Dokumentation (npm packages, APIs)
- Best Practices und Tutorials
- Wenn Codebase-Suche nicht ausreicht

KOMPLEXITÄT WÄHLEN:
- simple: Einzelne Fakten ("Wetter Berlin", "aktuelle Node Version")
- detailed: Erklärungen ("Wie funktioniert React Server Components")
- deep: Analysen ("Vergleich Prisma vs Drizzle 2026")

NICHT NUTZEN für:
- Projekt-interner Code → fs_grep verwenden
- Git-Historie → git_status verwenden
```

### Antwort-Format

```
Die aktuelle Node.js LTS Version ist 22.x (Stand Februar 2026).

Quellen:
- [Node.js Releases](https://nodejs.org/en/about/releases/)
- [Node.js Blog](https://nodejs.org/en/blog/)
```

---

## UI-Änderungen

### Entfernen

- `apps/web/src/components/ProviderSelector.tsx` - LÖSCHEN
- Provider-Selector aus Header in `App.tsx`
- `selectedProvider` State und zugehörige Effects

### App.tsx Änderungen

```diff
- import { ProviderSelector } from './components/ProviderSelector';
- const [selectedProvider, setSelectedProvider] = useState<LLMProvider>('anthropic');

  // Header:
- <ProviderSelector ... />

  // ChatUI:
- provider={selectedProvider}
```

### Health-Response

```json
{
  "status": "ok",
  "apis": {
    "anthropic": true,
    "perplexity": true
  },
  "mcp": [...]
}
```

---

## Änderungsübersicht

| Datei | Aktion |
|-------|--------|
| `apps/api/src/llm/perplexity.ts` | NEU |
| `apps/api/src/tools/webSearch.ts` | NEU |
| `apps/api/src/agents/scout.ts` | ÄNDERN - Tool + Prompt |
| `apps/api/src/routes/health.ts` | ÄNDERN - Perplexity-Status |
| `apps/web/src/App.tsx` | ÄNDERN - Provider-Selector entfernen |
| `apps/web/src/components/ProviderSelector.tsx` | LÖSCHEN |
| `apps/web/src/components/ChatUI.tsx` | ÄNDERN - provider prop entfernen |
| `.env.example` | ÄNDERN - PERPLEXITY_API_KEY |

---

## Verifizierung

1. **Web-Suche testen:**
   - "Wie ist das Wetter in Berlin?" → sonar
   - "Vergleiche Prisma und Drizzle" → sonar-reasoning

2. **Quellen-Links prüfen:**
   - Antworten enthalten klickbare URLs

3. **Fallback testen:**
   - Ohne API-Key: Scout meldet "Web-Suche nicht verfügbar"

4. **UI prüfen:**
   - Kein Provider-Selector im Header
   - Chat funktioniert weiterhin
