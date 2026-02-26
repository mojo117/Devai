# Drag & Drop Dokumenten-Upload im Chat-UI

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Nutzer sollen Dateien per Drag & Drop direkt auf die Chat-Oberfläche ziehen können, um sie hochzuladen und als AI-Kontext zu pinnen - ohne den Umweg über das Burger-Menü.

**Architecture:** Ein globaler Drag-Overlay wird dem ChatUI-Container hinzugefügt. Beim Loslassen werden die Dateien über die bestehende `uploadUserfile` API hochgeladen und automatisch gepinnt. Validierung (Dateitypen, Größe) wird aus UserfilesPanelContent extrahiert in eine shared Datei.

**Tech Stack:** React 18, TypeScript, TailwindCSS, bestehende uploadUserfile API

---

## Kontext

### Bestehende Upload-Infrastruktur
- **Backend:** `apps/api/src/routes/userfiles.ts` - Fastify-Route `POST /api/userfiles` (multipart via `@fastify/multipart`)
- **Frontend API:** `apps/web/src/api.ts:943` - `uploadUserfile(file: File)` → FormData POST
- **Button-Upload:** `apps/web/src/components/ChatUI/ChatUI.tsx:387` - `handleFileUpload` Funktion (iteriert Files, ruft `uploadUserfile`, auto-pinnt, zeigt System-Message)
- **Burger-Panel D&D:** `apps/web/src/components/UserfilesPanelContent.tsx:138-154` - Drag & Drop bereits implementiert, aber nur im Panel

### Erlaubte Dateitypen (aus UserfilesPanelContent.tsx:5-9)
```
.pdf, .doc, .docx, .xls, .xlsx, .ppt, .pptx, .txt, .md, .csv, .msg, .eml, .oft, .zip, .png, .jpg, .jpeg, .gif, .webp
```
Max: 10 MB

---

## Task 1: Shared Validierungs-Konstanten extrahieren

**Files:**
- Create: `apps/web/src/components/ChatUI/uploadConstants.ts`
- Modify: `apps/web/src/components/UserfilesPanelContent.tsx:5-11`

**Step 1: Erstelle die shared Konstanten-Datei**

```typescript
// apps/web/src/components/ChatUI/uploadConstants.ts
export const ALLOWED_EXTENSIONS = [
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.md', '.csv', '.msg', '.eml', '.oft', '.zip',
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
];

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export function validateFile(file: File): string | null {
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return `Dateityp nicht erlaubt: ${ext}`;
  }
  if (file.size > MAX_FILE_SIZE) {
    return 'Datei zu groß (max 10MB)';
  }
  return null;
}
```

**Step 2: UserfilesPanelContent auf shared Konstanten umstellen**

In `apps/web/src/components/UserfilesPanelContent.tsx`:
- Entferne die lokalen `ALLOWED_EXTENSIONS`, `MAX_FILE_SIZE` Konstanten (Zeilen 5-11)
- Entferne die lokale `validateFile` Methode (Zeilen 84-93)
- Importiere stattdessen: `import { ALLOWED_EXTENSIONS, MAX_FILE_SIZE, validateFile } from './ChatUI/uploadConstants';`

**Step 3: Verifiziere**

Run: Prüfe https://devai.klyde.tech - Burger-Menü öffnen, Userfiles-Panel: Upload per Klick und D&D muss weiterhin funktionieren.

**Step 4: Commit**

```bash
git add apps/web/src/components/ChatUI/uploadConstants.ts apps/web/src/components/UserfilesPanelContent.tsx
git commit -m "refactor: extract upload validation constants to shared module"
```

---

## Task 2: DropOverlay-Komponente erstellen

**Files:**
- Create: `apps/web/src/components/ChatUI/DropOverlay.tsx`

**Step 1: Erstelle die Overlay-Komponente**

```tsx
// apps/web/src/components/ChatUI/DropOverlay.tsx
interface DropOverlayProps {
  visible: boolean;
}

export function DropOverlay({ visible }: DropOverlayProps) {
  if (!visible) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-devai-bg/80 backdrop-blur-sm border-2 border-dashed border-devai-accent rounded-lg pointer-events-none">
      <div className="text-center">
        <svg
          className="mx-auto h-12 w-12 text-devai-accent mb-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
        <p className="text-lg font-medium text-devai-text">Datei hier ablegen</p>
        <p className="text-sm text-devai-text-secondary mt-1">
          PDF, Office, Bilder, Text, E-Mail, ZIP
        </p>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add apps/web/src/components/ChatUI/DropOverlay.tsx
git commit -m "feat: add DropOverlay component for drag-and-drop visual feedback"
```

---

## Task 3: Drag & Drop in ChatUI integrieren

**Files:**
- Modify: `apps/web/src/components/ChatUI/ChatUI.tsx`

Dies ist die Hauptaufgabe. Der äußere Container von ChatUI erhält Drag-Event-Handler.

**Step 1: Imports hinzufügen**

Am Anfang von `ChatUI.tsx` hinzufügen:

```tsx
import { DropOverlay } from './DropOverlay';
import { validateFile } from './uploadConstants';
```

**Step 2: State und Handler hinzufügen**

In der `ChatUI` Komponente nach dem `isTranscribing` State (Zeile ~59):

```tsx
const [isDragOver, setIsDragOver] = useState(false);
const dragCounterRef = useRef(0);
```

Dann die Drag-Handler vor dem `return` Statement hinzufügen:

```tsx
const handleDragEnter = useCallback((e: React.DragEvent) => {
  e.preventDefault();
  e.stopPropagation();
  dragCounterRef.current += 1;
  if (e.dataTransfer.types.includes('Files')) {
    setIsDragOver(true);
  }
}, []);

const handleDragLeave = useCallback((e: React.DragEvent) => {
  e.preventDefault();
  e.stopPropagation();
  dragCounterRef.current -= 1;
  if (dragCounterRef.current <= 0) {
    dragCounterRef.current = 0;
    setIsDragOver(false);
  }
}, []);

const handleDragOver = useCallback((e: React.DragEvent) => {
  e.preventDefault();
  e.stopPropagation();
}, []);

const handleDrop = useCallback(async (e: React.DragEvent) => {
  e.preventDefault();
  e.stopPropagation();
  dragCounterRef.current = 0;
  setIsDragOver(false);

  const files = Array.from(e.dataTransfer.files);
  if (files.length === 0) return;

  setIsFileUploading(true);
  const uploadedIds: string[] = [];
  for (const file of files) {
    const validationError = validateFile(file);
    if (validationError) {
      persistSystemMessage({
        id: `err-${Date.now()}-${file.name}`,
        role: 'system',
        content: `Upload abgelehnt (${file.name}): ${validationError}`,
        timestamp: new Date().toISOString(),
      });
      continue;
    }
    try {
      const result = await uploadUserfile(file);
      if (result.file?.id) {
        uploadedIds.push(result.file.id);
        if (onPinUserfile) {
          onPinUserfile(result.file.id);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      persistSystemMessage({
        id: `err-${Date.now()}-${file.name}`,
        role: 'system',
        content: `Upload fehlgeschlagen (${file.name}): ${msg}`,
        timestamp: new Date().toISOString(),
      });
    }
  }
  setIsFileUploading(false);
  const count = uploadedIds.length;
  if (count > 0) {
    persistSystemMessage({
      id: `upload-${Date.now()}`,
      role: 'system',
      content: `${count} Datei${count > 1 ? 'en' : ''} hochgeladen und als AI-Kontext gepinnt`,
      timestamp: new Date().toISOString(),
    });
  }
}, [onPinUserfile, persistSystemMessage]);
```

**Step 3: JSX-Container anpassen**

Den äußeren Container im return-Statement ändern von:

```tsx
<div className="flex flex-col h-full overflow-hidden">
```

zu:

```tsx
<div
  className="flex flex-col h-full overflow-hidden relative"
  onDragEnter={handleDragEnter}
  onDragLeave={handleDragLeave}
  onDragOver={handleDragOver}
  onDrop={handleDrop}
>
  <DropOverlay visible={isDragOver} />
```

**Wichtig:** `relative` wird zur className hinzugefügt, damit der absolute DropOverlay korrekt positioniert wird.

**Step 4: Verifiziere**

1. Öffne https://devai.klyde.tech
2. Ziehe eine PDF-Datei auf das Chat-Fenster → Overlay erscheint
3. Lasse die Datei los → Upload startet, System-Message erscheint
4. Prüfe dass die Datei im Burger-Menü unter Userfiles sichtbar ist
5. Prüfe dass der bisherige Button-Upload weiterhin funktioniert
6. Teste mit einer nicht erlaubten Datei (z.B. `.exe`) → Fehlermeldung
7. Teste mit einer zu großen Datei (>10MB) → Fehlermeldung

**Step 5: Commit**

```bash
git add apps/web/src/components/ChatUI/ChatUI.tsx
git commit -m "feat: add drag-and-drop file upload to main chat UI"
```

---

## Task 4: InputArea Drag-Feedback verbessern (optional)

**Files:**
- Modify: `apps/web/src/components/ChatUI/InputArea.tsx`

**Step 1: Visual Feedback auf InputArea**

Optional: Die InputArea kann zusätzlich visuelles Feedback geben, wenn Dateien über sie gezogen werden. Die `isFileUploading` prop reicht dafür bereits — während des Uploads zeigt der Plus-Button einen Spinner.

Prüfe ob der bestehende `isFileUploading` State ausreicht. Falls ja, ist keine Änderung nötig.

**Step 2: Verifiziere**

Teste ob der Plus-Button während eines Drag & Drop Uploads korrekt den Spinner zeigt.

---

## Zusammenfassung der Änderungen

| Datei | Aktion | Beschreibung |
|-------|--------|--------------|
| `apps/web/src/components/ChatUI/uploadConstants.ts` | Neu | Shared Validierung |
| `apps/web/src/components/ChatUI/DropOverlay.tsx` | Neu | Visuelles Overlay |
| `apps/web/src/components/ChatUI/ChatUI.tsx` | Ändern | Drag & Drop Handler + Overlay |
| `apps/web/src/components/UserfilesPanelContent.tsx` | Ändern | Nutzt shared Konstanten |

**Backend:** Keine Änderungen nötig — `POST /api/userfiles` und `uploadUserfile` API funktionieren bereits.

**Risiken:**
- Drag & Drop Events können auf Mobile anders/gar nicht funktionieren — aber DevAI ist primär Desktop
- Der `dragenter`/`dragleave` Counter-Pattern ist nötig weil Child-Elemente eigene Events feuern
