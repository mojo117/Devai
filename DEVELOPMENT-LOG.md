# Bill-Buddy: Development Log & Technical Documentation

**Last Updated**: 2026-01-07

## Project Overview

**Project Name**: Bill-Buddy
**Purpose**: AI-powered expense tracking application with automated data extraction
**Core Value Proposition**: Automatically extract expense data from PDF bills and email files (.msg) using Claude 3.5 Sonnet AI
**Target Users**: Individuals and small businesses tracking expenses with German accounting compliance
**Repository**: https://github.com/mojo117/bill-buddy

---

## Technology Stack

### Frontend
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **UI Components**: shadcn/ui (Radix UI)
- **Styling**: Tailwind CSS
- **State Management**: React Query (TanStack Query v5)
- **Form Management**: React Hook Form with Zod validation
- **Date Handling**: date-fns
- **Charts**: Recharts
- **Icons**: Lucide React

### Backend & Infrastructure
- **Database**: Supabase PostgreSQL
- **File Storage**: Supabase Storage
- **AI Integration**: Claude 3.5 Sonnet (Anthropic API)
- **Edge Functions**: Supabase Edge Functions (Deno runtime)
- **Authentication**: Planned (Supabase Auth)

---

## Architecture

### Frontend Architecture

```
src/
├── pages/               # Application pages
│   ├── Index.tsx       # Main dashboard page
│   ├── Auth.tsx        # Authentication page
│   ├── Profile.tsx     # User profile page
│   └── NotFound.tsx    # 404 page
├── components/          # Feature components
│   ├── Header.tsx
│   ├── ExpenseList.tsx
│   ├── ExpenseRow.tsx
│   ├── ExpenseChart.tsx
│   ├── ExpenseFilters.tsx
│   ├── CategoryBreakdown.tsx
│   ├── AddExpenseDialog.tsx
│   ├── EditExpenseDialog.tsx
│   ├── FileUploadDialog.tsx
│   ├── DocumentPreview.tsx      # PDF/MSG preview
│   ├── MassUploadDialog.tsx     # Batch upload interface
│   ├── MassUploadReviewDialog.tsx
│   ├── NotificationBell.tsx     # Header notification icon
│   ├── NotificationItem.tsx     # Notification display
│   ├── ReviewCenterDialog.tsx   # Review pending items
│   ├── ReviewWizard.tsx         # Step-by-step review
│   ├── VendorAutocomplete.tsx   # Vendor name autocomplete
│   └── ui/             # shadcn/ui components
├── contexts/           # React contexts
│   ├── MassUploadContext.tsx    # Mass upload state
│   └── ReviewCenterContext.tsx  # Review center state
├── hooks/              # Custom React hooks
│   ├── useExpenses.ts  # React Query hooks for expenses
│   ├── useFileUpload.ts # File upload state management
│   ├── useNotifications.ts # Notification management
│   └── useAuth.ts      # Authentication hook
├── services/           # Business logic layer
│   ├── expenseService.ts
│   ├── fileUploadService.ts
│   ├── claudeService.ts
│   ├── documentProcessingService.ts
│   ├── exchangeRateService.ts
│   ├── massUploadService.ts     # Batch processing
│   ├── notificationService.ts   # Notifications CRUD
│   └── reviewItemService.ts     # Review items CRUD
├── types/              # TypeScript type definitions
│   ├── expense.ts
│   ├── database.ts
│   └── notification.ts
├── constants/          # Application constants
│   └── categories.ts   # Category definitions
├── utils/              # Utility functions
│   ├── auth.ts         # Auth helpers
│   └── expenseMapper.ts # Data mapping
└── lib/                # Core utilities and clients
    ├── supabase.ts     # Supabase client
    ├── utils.ts
    ├── errors.ts       # Error handling utilities
    ├── logger.ts       # Structured logging
    └── result.ts       # Result pattern utilities
```

### Backend Architecture

**Supabase PostgreSQL Database**:
- Tables: `expenses`, `uploaded_files`, `notifications`, `review_items`
- Row Level Security (RLS) enabled (permissive during development)
- Automatic timestamp triggers
- Foreign key relationships
- Indexes on frequently queried fields (date, category, source)
- Real-time subscriptions for notifications

**Supabase Storage**:
- Bucket: `expense-files`
- Organized path structure: `{year}/{month}/{timestamp}_{uuid}_{filename}`
- Signed URLs for secure file access

**Supabase Edge Functions**:
- `analyze-document`: Processes PDF/MSG files with Claude API
- Prevents CORS issues
- Protects API key from client-side exposure
- Returns structured expense data with confidence scores

### Data Flow

```
Manual Entry Flow:
User → AddExpenseDialog → useCreateExpense → expenseService → Supabase DB → React Query Cache → UI Update

File Upload Flow:
User → FileUploadDialog → useFileUpload → fileUploadService → Supabase Storage
  → uploaded_files record (status: uploading)
  → documentProcessingService
  → Claude Edge Function (analyze-document)
  → Extract expense data (amount, vendor, date, category, tax info)
  → Create expense record
  → Update uploaded_files (status: processed)
  → React Query cache invalidation
  → UI Update with new expense
```

---

## Key Features

### Implemented Features

#### 1. Manual Expense Entry
- Form-based input with React Hook Form validation
- Category selection: food, transport, utilities, entertainment, shopping, health, other
- Vendor and description fields
- Multi-currency support (EUR, USD)
- Exchange rate tracking
- **German Tax/Invoice Fields**:
  - Invoice number tracking
  - Invoice date
  - Tax rate selection: 0%, 7% (reduced), 19% (standard)
  - Net amount (before tax)
  - VAT amount
  - Gross amount (total including tax)
  - Notes field for additional information

#### 2. PDF Upload with AI Extraction
- Drag & drop or click to upload
- File validation (type and size limits: max 10MB)
- Real-time upload progress tracking
- Claude 3.5 Sonnet AI extracts:
  - Amount and currency
  - Vendor name
  - Description
  - Date
  - Category
  - Invoice details (number, tax rates, net/vat/gross amounts)
- Confidence scoring for extracted data
- Automatic expense record creation with file attachment

#### 3. Email File Upload (.msg)
- Same workflow as PDF upload
- Processes Microsoft Outlook .msg files
- Extracts bill information from email body and attachments

#### 4. Expense Dashboard
- Monthly/yearly expense overview
- **Statistics Cards**:
  - Total Spending (with month-over-month change %)
  - Daily Average
  - Transaction Count
  - Total Bills Tracked
- Month selector for filtering
- Loading states with spinner
- Real-time data from Supabase

#### 5. Visual Analytics
- **Line Chart**: Spending trends over time (Recharts)
- **Category Breakdown**: Pie chart with percentages
- Color-coded categories
- Interactive hover states
- Responsive design

#### 6. Expense List Management
- Sortable and filterable expense list
- Month-based filtering
- Edit and delete capabilities
- File attachment indicators
- Currency display
- Category badges

---

## File Structure Documentation

### Services Layer (`src/services/`)

#### `fileUploadService.ts` (164 lines)
**Purpose**: Handles all file upload operations to Supabase Storage

**Key Functions**:
- `validateFile()`: Validates file type (PDF, MSG) and size (max 10MB)
- `uploadToStorage()`: Uploads file to Supabase Storage with organized path
- `generateFilePath()`: Creates path structure: `{year}/{month}/{timestamp}_{uuid}_{filename}`
- `getSignedUrl()`: Generates signed URLs for secure file access
- `deleteFile()`: Cleanup functionality

#### `claudeService.ts` (158 lines)
**Purpose**: Claude 3.5 Sonnet AI integration

**Key Functions**:
- `analyzeDocument()`: Main entry point for document analysis
- `createAnalysisPrompt()`: Structured prompt engineering for expense extraction
- `validateCategory()`: Ensures extracted category matches app schema
- `parseClaudeResponse()`: Parses AI response into structured data
- Extracts: amount, vendor, description, date, category, invoice details, tax info
- Returns confidence scores

#### `documentProcessingService.ts` (103 lines)
**Purpose**: Orchestrates complete upload → analysis → database workflow

**Key Functions**:
- `processUploadedFile()`: Main orchestration function
- Downloads file from storage via signed URL
- Sends to Claude Edge Function for analysis
- Creates expense records with extracted data
- Updates processing status
- Comprehensive error handling with rollback capability

#### `expenseService.ts` (98 lines)
**Purpose**: Database CRUD operations for expenses

**Key Functions**:
- `getExpenses()`: Fetch all expenses
- `getExpensesByDateRange()`: Filter by date range
- `createExpense()`: Create new expense record
- `updateExpense()`: Update existing expense
- `deleteExpense()`: Delete expense
- Type-safe operations with TypeScript
- Error handling and logging

#### `exchangeRateService.ts`
**Purpose**: Multi-currency support

**Key Functions**:
- Exchange rate conversion
- Currency handling for EUR and USD

### Hooks (`src/hooks/`)

#### `useExpenses.ts` (54 lines)
**Purpose**: React Query integration for expense data management

**Exports**:
- `useExpenses`: Fetch all expenses with caching
- `useCreateExpense`: Create expense with automatic cache invalidation
- `useUpdateExpense`: Update expense with optimistic updates
- `useDeleteExpense`: Delete expense with cache management

**Features**:
- Automatic cache invalidation on mutations
- Loading and error states
- Optimistic UI updates

#### `useFileUpload.ts` (81 lines)
**Purpose**: File upload state management

**Features**:
- Per-file upload progress tracking
- Status management: pending → uploading → processing → complete/error
- Upload queue management
- Progress percentage calculation

### Components (`src/components/`)

#### `FileUploadDialog.tsx` (183 lines)
**Purpose**: Modal dialog for file uploads

**Features**:
- Drag & drop zone with click-to-upload fallback
- Real-time progress indicators
- Status icons (uploading, success, error)
- AI processing feedback
- Toast notifications for user feedback
- Separate instances for PDF and MSG files
- File size validation display

#### `AddExpenseDialog.tsx` (modified)
**Purpose**: Main expense entry dialog

**Features**:
- Manual entry form with all fields including German tax fields
- PDF upload button → opens FileUploadDialog
- Email upload button → opens FileUploadDialog
- Integrated validation
- Help text and user guidance

#### `ExpenseList.tsx` (modified)
**Purpose**: Display and manage expense list

**Features**:
- Table view with sorting
- Edit/delete actions
- Category badges
- File attachment indicators
- Currency display

### Database Layer

#### `supabase/migrations/supabase-migration.sql` (77 lines)
**Tables Created**:

**expenses**:
- Core fields: id, amount, description, category, date, vendor, source
- File reference: file_id (FK to uploaded_files)
- Currency: currency, original_amount, exchange_rate
- German accounting: invoice_number, invoice_date, tax_rate, net_amount, vat_amount, gross_amount, notes
- Timestamps: created_at, updated_at

**uploaded_files**:
- File metadata: id, file_name, file_path, file_type, file_size, mime_type, storage_bucket
- Processing: upload_status, processing_error, processed_at
- AI results: claude_analysis (JSONB)
- Timestamps: created_at, updated_at

**Features**:
- Indexes on date, category, source for performance
- RLS enabled (permissive policies for development)
- Automatic updated_at trigger

#### `supabase/functions/analyze-document/index.ts`
**Purpose**: Edge Function for secure Claude API calls

**Features**:
- Receives base64-encoded file content
- Calls Claude 3.5 Sonnet API
- Extracts structured expense data
- Returns JSON with extracted fields
- Error handling and logging
- CORS configuration

---

## Development History

### Initial Setup (Template)
- Started from Lovable.dev Vite + React + shadcn/ui template
- TypeScript configuration
- Tailwind CSS setup
- ESLint and Vite configuration
- Basic component structure from template

### Phase 1: UI Design
**Commit**: `636e97c Switch to light UI`
- Implemented dashboard layout
- Added stat cards with animations (delay-based reveal)
- Created expense chart component (Recharts)
- Category breakdown component
- Month selector component
- Light UI theme (switched from dark)
- Responsive grid layout

### Phase 2: Database Integration
**Commits**: `c4764c3 Changes`, `3237131 Update env for Supabase`
- Set up Supabase client (`src/lib/supabase.ts`)
- Created database schema with migration SQL
- Migrated from mock data to real database
- Implemented React Query hooks (`useExpenses.ts`)
- Added loading states with Loader2 spinner
- Environment variable configuration

### Phase 3: File Upload & AI Integration
**Recent Changes**
- Created `FileUploadService` for Supabase Storage integration
- Integrated Claude 3.5 Sonnet API
- Built `DocumentProcessingService` for orchestration
- Created `FileUploadDialog` component with drag & drop
- Enabled PDF and Email upload buttons in `AddExpenseDialog`
- Implemented real-time progress tracking
- Toast notifications for user feedback

### Phase 4: Edge Function Deployment
**Documentation**: `EDGE-FUNCTION-SETUP.md`
- Created Supabase Edge Function `analyze-document`
- Moved Claude API key to secure server-side environment (Supabase secrets)
- Resolved CORS issues
- Deployed to Supabase: `https://tlmbvgtvazpcshzjcopm.supabase.co/functions/v1/analyze-document`
- Updated frontend to call Edge Function instead of direct API

### Phase 5: German Accounting Features
**Type Updates**: `src/types/expense.ts`, `src/types/database.ts`
- Added invoice tracking fields to expenses table
- Implemented German VAT rate support:
  - 0% (no VAT)
  - 7% (reduced rate - ermäßigt)
  - 19% (standard rate - regulär)
- Added net/vat/gross amount calculations
- Invoice number and invoice date tracking
- Notes field for additional expense information
- Updated TypeScript interfaces to include all tax fields

### Phase 6: Document Preview & Form Pre-fill (2026-01-06)
**Commit**: `241ed4d Add document preview in expense dialog with form pre-fill`

**New Components**:
- `DocumentPreview.tsx`: PDF/MSG file preview component
- `MassUploadDialog.tsx`: Batch file upload interface
- `MassUploadContext.tsx`: State management for mass uploads

**Key Changes**:
- Added `analyzeFileOnly()` method to process documents without auto-creating expense
- Extended `FileUploadDialog` with `onAnalysisComplete` callback for analysis-only mode
- Redesigned `AddExpenseDialog` with two-column layout (form + document preview)
- Pre-fill form fields with AI-extracted data from uploaded documents
- Added staging concept documentation (`docs/STAGING-KONZEPT.md`)
- Cleaned up old documentation files (removed EDGE-FUNCTION-SETUP.md, RESEND-SETUP.md, etc.)
- Added Profile page (`src/pages/Profile.tsx`)
- Enhanced `useAuth` hook

### Phase 7: Year Grouping in Expense List (2026-01-06)
**Commit**: `db58ee5 Add year grouping to expense list`

**Features**:
- Group expenses by year, then by month within each year
- Years are collapsible with total amount and expense count
- Months are indented within their parent year
- Current year and month default to expanded
- Separate localStorage persistence for year/month expansion state
- Visual badges for "Aktuelles Jahr" (current year) and "Aktuell" (current month)

**Technical Changes**:
- Enhanced `ExpenseList.tsx` with hierarchical grouping logic
- Added types for year/month grouping in `src/types/expense.ts`
- Improved Claude service for better document analysis

### Phase 8: Notification System, Review Center & Vendor Autocomplete (2026-01-07)
**Commit**: `516f0b9 Add notification system, review center, and vendor autocomplete`

**New Components**:
- `NotificationBell.tsx`: Header notification icon with badge
- `NotificationItem.tsx`: Individual notification display
- `ReviewCenterDialog.tsx`: Central dialog for reviewing pending items
- `ReviewWizard.tsx`: Step-by-step wizard for document review
- `MassUploadReviewDialog.tsx`: Review dialog for batch uploads
- `VendorAutocomplete.tsx`: Autocomplete component for vendor names in expense forms

**New Services**:
- `notificationService.ts`: CRUD operations for notifications with real-time subscriptions
- `reviewItemService.ts`: Manage review items (pending document approvals)

**New Hooks**:
- `useNotifications.ts`: React Query integration for notification data

**New Contexts**:
- `ReviewCenterContext.tsx`: State management for review center workflow

**New Utilities**:
- `src/lib/errors.ts`: Centralized error handling utilities
- `src/lib/logger.ts`: Structured logging utilities
- `src/lib/result.ts`: Result pattern for functional error handling
- `src/utils/auth.ts`: Authentication helper functions
- `src/utils/expenseMapper.ts`: Map between different expense data formats
- `src/constants/categories.ts`: Centralized category definitions

**Database Migrations**:
- `20260106_notifications.sql`: Notifications table with real-time support
- `20260107_review_items.sql`: Review items table for document approval workflow

**Enhanced Services**:
- `claudeService.ts`: Improved analysis capabilities, better prompt engineering
- `documentProcessingService.ts`: Enhanced orchestration with review workflow
- `expenseService.ts`: Extended with review item integration
- `massUploadService.ts`: Improved batch processing with review support
- `fileUploadService.ts`: Better error handling and logging

**Edge Function Updates**:
- `analyze-document/index.ts`: Enhanced extraction with confidence scoring
- `process-inbound-email/index.ts`: Improved email parsing and notification creation

---

## Current Status

### What's Working ✅
- Manual expense creation with full database persistence
- PDF upload with AI-powered data extraction
- Email (.msg) upload with AI-powered data extraction
- Real-time upload progress tracking
- Supabase database integration (PostgreSQL)
- Supabase Storage integration
- React Query data management with caching
- Dashboard with statistics (total, average, count)
- Expense charts and visualizations (Recharts)
- Month filtering with date range queries
- Multi-currency support (EUR, USD)
- German tax/invoice fields
- Edge Function deployment (secure Claude API calls)
- Loading states and error handling
- Toast notifications
- **Document preview with form pre-fill** (Phase 6)
- **Year/month grouping in expense list** with collapsible sections (Phase 7)
- **Notification system** with real-time updates and bell icon (Phase 8)
- **Review center** for processing uploaded documents (Phase 8)
- **Vendor autocomplete** for expense forms (Phase 8)
- **Mass upload** with batch document processing (Phase 6-8)
- **Centralized error handling and logging** utilities (Phase 8)

### What's Pending ⚠️
- Database migration execution (user needs to run SQL in Supabase)
- Storage bucket configuration (create `expense-files` bucket)
- Storage bucket policies (upload/read/delete permissions)
- User authentication implementation
- Production security hardening
- Rate limiting
- File malware scanning

### Known Issues
- No user authentication implemented yet (all data is public)
- RLS policies are permissive (development mode only)
- No rate limiting on file uploads or AI processing
- No file malware/virus scanning
- Claude API key visible in client code (should use Edge Function only)

---

## Setup Instructions

### Prerequisites
- Node.js 18+ and npm
- Supabase account: https://supabase.com
- Claude API key from Anthropic: https://console.anthropic.com

### Step 1: Clone and Install
```bash
git clone https://github.com/mojo117/bill-buddy.git
cd bill-buddy
npm install
```

### Step 2: Environment Configuration
Create/verify `.env` file in project root:
```bash
VITE_SUPABASE_PROJECT_ID="tlmbvgtvazpcshzjcopm"
VITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_CPFKgzDsuLFMRaFiWXqPQg_C3mqmf4i"
VITE_SUPABASE_URL="https://tlmbvgtvazpcshzjcopm.supabase.co"
VITE_CLAUDE_API_KEY="sk-ant-api03-..."  # Your Claude API key
```

### Step 3: Database Setup
1. Go to Supabase SQL Editor:
   https://supabase.com/dashboard/project/tlmbvgtvazpcshzjcopm/sql

2. Create and run migration (if not already done):
   - Copy contents of `supabase/migrations/supabase-migration.sql`
   - Paste into SQL Editor
   - Click "Run"

3. Verify tables created:
   - `expenses` table with all fields including German tax fields
   - `uploaded_files` table

### Step 4: Storage Bucket Setup
1. Go to Supabase Storage:
   https://supabase.com/dashboard/project/tlmbvgtvazpcshzjcopm/storage/buckets

2. Create bucket:
   - Name: `expense-files`
   - Public or authenticated access (based on your needs)

3. Configure policies (Storage Policies tab):
   - Upload policy: Allow authenticated or public uploads
   - Read policy: Allow reading files
   - Delete policy: Allow deleting files

### Step 5: Edge Function Deployment
```bash
# Install Supabase CLI (if not installed)
npm install -g supabase

# Login to Supabase
supabase login

# Link your project
supabase link --project-ref tlmbvgtvazpcshzjcopm

# Set Claude API key as secret
supabase secrets set CLAUDE_API_KEY=sk-ant-api03-...

# Deploy edge function
supabase functions deploy analyze-document

# Verify deployment
supabase functions list
```

### Step 6: Run Development Server
```bash
npm run dev
```

Application will be available at: **http://localhost:8080**

### Step 7: Build for Production
```bash
npm run build      # Creates production build in dist/
npm run preview    # Preview production build locally
```

---

## API Documentation

### Database Schema

#### Table: `expenses`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| amount | numeric | Total expense amount (required) |
| description | text | Expense description |
| category | text | Category: food, transport, utilities, entertainment, shopping, health, other |
| date | timestamp | Expense date (required) |
| vendor | text | Vendor/merchant name |
| source | text | Source: 'manual', 'pdf', 'email' |
| file_id | uuid | Foreign key to uploaded_files |
| currency | text | Currency code (EUR, USD) |
| original_amount | numeric | Original amount before conversion |
| exchange_rate | numeric | Exchange rate used |
| invoice_number | text | German invoice number |
| invoice_date | timestamp | Date on invoice |
| tax_rate | numeric | VAT rate: 0, 0.07, 0.19 |
| net_amount | numeric | Amount before tax (Nettobetrag) |
| vat_amount | numeric | VAT amount (MwSt-Betrag) |
| gross_amount | numeric | Total including tax (Bruttobetrag) |
| notes | text | Additional notes |
| created_at | timestamp | Record creation time |
| updated_at | timestamp | Last update time |

**Indexes**: date, category, source

#### Table: `uploaded_files`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| file_name | text | Original filename |
| file_path | text | Storage path in bucket |
| file_type | text | File type: pdf, msg |
| file_size | bigint | File size in bytes |
| mime_type | text | MIME type |
| storage_bucket | text | Bucket name (expense-files) |
| upload_status | text | Status: uploading, uploaded, processing, processed, failed |
| processing_error | text | Error message if failed |
| claude_analysis | jsonb | AI analysis results |
| processed_at | timestamp | Processing completion time |
| created_at | timestamp | Upload time |
| updated_at | timestamp | Last update time |

### Edge Function API

#### Endpoint: `analyze-document`

**URL**: `https://tlmbvgtvazpcshzjcopm.supabase.co/functions/v1/analyze-document`

**Method**: POST

**Headers**:
```
Authorization: Bearer <SUPABASE_ANON_KEY>
Content-Type: application/json
```

**Request Body**:
```json
{
  "fileContent": "base64-encoded-file-content",
  "fileType": "pdf" | "msg"
}
```

**Response** (Success):
```json
{
  "amount": 125.50,
  "vendor": "Restaurant ABC",
  "description": "Business dinner",
  "date": "2024-01-15",
  "category": "food",
  "confidence": 0.95,
  "invoice_number": "INV-2024-001",
  "invoice_date": "2024-01-15",
  "tax_rate": 0.19,
  "net_amount": 105.46,
  "vat_amount": 20.04,
  "gross_amount": 125.50
}
```

**Response** (Error):
```json
{
  "error": "Error message",
  "details": "Additional error details"
}
```

---

## Testing Checklist

### Manual Testing
- [ ] Manual expense creation works
- [ ] All form fields save correctly (including German tax fields)
- [ ] PDF upload extracts data correctly
- [ ] Email upload extracts data correctly
- [ ] File validation rejects invalid file types
- [ ] File validation rejects oversized files (>10MB)
- [ ] Upload progress displays correctly
- [ ] Expenses persist after page refresh
- [ ] Error messages display properly
- [ ] Loading states show during operations
- [ ] Claude AI extracts accurate data
- [ ] Month filtering works correctly
- [ ] Dashboard statistics are accurate
- [ ] Charts update when data changes
- [ ] Tax calculations are correct (net + vat = gross)
- [ ] Invoice date and number display correctly

### Edge Cases to Test
- [ ] Upload with no internet connection
- [ ] Upload with invalid file content
- [ ] Large file uploads (near 10MB limit)
- [ ] Concurrent file uploads
- [ ] Special characters in filenames
- [ ] PDF with unclear/handwritten text
- [ ] Non-English invoices

---

## Future Enhancements

### Planned Features

#### User Authentication (High Priority)
- Supabase Auth integration
- User registration and login
- User-specific expense tracking
- Secure RLS policies per user
- Password reset flow

#### Review & Edit Step (Medium Priority)
- Preview extracted data before saving
- Manual corrections to AI-extracted data
- Confidence score display
- Side-by-side view (file + extracted data)
- Approve/reject workflow

#### Email Integration (Medium Priority)
- Dedicated email address for forwarding bills
- Automatic email processing pipeline
- Email parsing and attachment extraction
- Scheduled processing jobs

#### Advanced Features (Lower Priority)
- **File Management**:
  - File preview functionality (PDF viewer)
  - Bulk upload support (multiple files at once)
  - OCR for scanned documents

- **Data Export**:
  - Export expenses to PDF report
  - Export to CSV for accounting software
  - Export to Excel with charts

- **Intelligence**:
  - Recurring expense detection
  - Budget alerts and tracking
  - Spending pattern analysis
  - Duplicate detection

- **Mobile**:
  - React Native mobile app
  - Camera integration for receipt scanning
  - Offline support with sync

#### Performance Optimizations
- Implement advanced caching strategies
- Lazy loading for large datasets
- Virtual scrolling for expense lists (1000+ items)
- Image compression for file storage
- Database query optimization

---

## For AI Assistants (Important Context)

### When Working on This Project

**Critical Guidelines**:
1. **Always check database schema first** before modifying data structures
2. **Use React Query hooks** for all data fetching (don't bypass useExpenses)
3. **Follow service layer pattern** (business logic in services, not components)
4. **Maintain type safety** (update TypeScript interfaces when changing data)
5. **Test file uploads** with actual PDF/MSG files after changes
6. **Check Edge Function logs** for debugging AI extraction issues:
   ```bash
   supabase functions logs analyze-document
   ```

### Key Design Patterns Used

#### Service Layer Architecture
- Business logic separated from UI components
- Services handle: file upload, AI processing, database operations
- Components only handle UI state and user interaction
- Makes testing easier and code more maintainable

#### Custom Hooks for Data
- All data fetching abstracted into reusable hooks
- `useExpenses`, `useCreateExpense`, `useUpdateExpense`, `useDeleteExpense`
- React Query handles caching, loading states, error handling
- Don't fetch data directly in components

#### Type Safety
- Full TypeScript coverage
- Separate types for database rows vs. insert/update operations
- Shared types between frontend and backend
- Update `types/expense.ts` and `types/database.ts` together

#### Optimistic Updates
- UI updates before server confirmation
- React Query handles rollback on error
- Improves perceived performance

### Common Tasks

#### Adding a New Expense Field

1. **Update Types** (`src/types/expense.ts`):
   ```typescript
   export interface Expense {
     // ... existing fields
     new_field?: string;
   }
   ```

2. **Update Database Types** (`src/types/database.ts`):
   ```typescript
   expenses: {
     Row: {
       // ... existing fields
       new_field: string | null
     }
   }
   ```

3. **Update Database Schema**: Run migration in Supabase SQL Editor:
   ```sql
   ALTER TABLE expenses ADD COLUMN new_field TEXT;
   ```

4. **Update UI**: Add field to `AddExpenseDialog.tsx` form

5. **Update Services** (if needed): Modify `expenseService.ts` if special handling required

#### Modifying Claude AI Prompt

Edit `supabase/functions/analyze-document/index.ts`:

```typescript
const prompt = `Your updated prompt here...`;
```

Redeploy:
```bash
supabase functions deploy analyze-document
```

#### Changing Upload Limits

Edit `src/services/fileUploadService.ts`:

```typescript
const MAX_FILE_SIZE = 20 * 1024 * 1024; // Change from 10MB to 20MB
```

#### Adding New Category

1. Update `src/types/expense.ts`:
   ```typescript
   export type ExpenseCategory =
     | 'food'
     | 'transport'
     // ...
     | 'new_category';
   ```

2. Update Claude validation in `src/services/claudeService.ts`
3. Update category colors in UI components if needed

---

## Security Considerations

### Current Security Status

⚠️ **DEVELOPMENT MODE - NOT PRODUCTION READY** ⚠️

**Implemented Security Measures**:
- Edge Function protects Claude API key from client exposure
- Environment variables for sensitive configuration
- RLS enabled on database tables
- Signed URLs for secure file access (time-limited)
- File type validation (only PDF and MSG)
- File size limits (10MB)

**CRITICAL: Needed for Production**:

1. **User Authentication**:
   - Implement Supabase Auth
   - Email/password or OAuth providers
   - Protected routes

2. **Row Level Security (RLS)**:
   - User-specific policies on expenses table
   - User-specific policies on uploaded_files table
   - Example:
     ```sql
     CREATE POLICY "Users can only see own expenses"
       ON expenses FOR SELECT
       USING (auth.uid() = user_id);
     ```

3. **Rate Limiting**:
   - Limit file uploads per user/IP
   - Limit AI API calls to prevent abuse
   - Use Supabase rate limiting or custom middleware

4. **File Security**:
   - Virus/malware scanning before processing
   - Use service like ClamAV or third-party API
   - Validate file content, not just extension

5. **API Security**:
   - CORS restrictions to specific domains
   - API key rotation policy
   - Monitor Claude API usage and costs

6. **Input Validation**:
   - Sanitize all user inputs
   - Validate data types and ranges
   - Prevent SQL injection (use Supabase parameterized queries)
   - Prevent XSS attacks

7. **Secret Management**:
   - Never commit API keys to git
   - Use Supabase secrets for Edge Functions
   - Rotate secrets regularly
   - Use different keys for dev/staging/production

---

## Performance Considerations

### Optimizations Implemented

1. **React Query Caching**:
   - Reduces unnecessary database queries
   - 5-minute cache time for expense data
   - Automatic cache invalidation on mutations

2. **Database Indexes**:
   - Index on `date` column (frequently used for filtering)
   - Index on `category` column (used in aggregations)
   - Index on `source` column (used in filtering)

3. **Lazy Loading**:
   - Components loaded on demand
   - Reduces initial bundle size

4. **Optimistic UI Updates**:
   - UI updates immediately before server confirms
   - Rollback on error
   - Better perceived performance

5. **Automatic Cache Invalidation**:
   - React Query automatically refetches after mutations
   - Ensures UI always shows latest data

### Monitoring & Optimization

**Monitor**:
- Edge Function logs: `supabase functions logs analyze-document`
- Supabase dashboard for database performance
- Claude API usage dashboard (costs)
- Frontend bundle size with `npm run build`

**Optimize When Needed**:
- Add pagination for large expense lists
- Implement virtual scrolling (e.g., react-window)
- Compress images before upload
- Use database materialized views for complex aggregations
- Implement service worker for offline support

---

## Deployment

### Development

```bash
npm run dev
```
- Runs on http://localhost:8080
- Hot Module Replacement (HMR) enabled
- TypeScript checking in IDE

### Production Build

```bash
npm run build
```
- Creates optimized production build in `dist/`
- Minified and bundled
- Tree-shaking removes unused code

```bash
npm run preview
```
- Preview production build locally
- Test before deployment

### Deployment Options

#### Option 1: Lovable.dev (Easiest)
1. Push changes to GitHub
2. Lovable.dev auto-deploys on commit
3. Access via Lovable project dashboard
4. Built-in CI/CD pipeline

#### Option 2: Vercel
```bash
npm install -g vercel
vercel
```
- Automatic HTTPS
- Global CDN
- Environment variables in dashboard

#### Option 3: Netlify
```bash
npm install -g netlify-cli
netlify deploy
```
- Drag & drop dist/ folder
- Or connect GitHub repo

#### Option 4: Cloudflare Pages
- Connect GitHub repo
- Build command: `npm run build`
- Output directory: `dist`

#### Option 5: Supabase Hosting
- Coming soon (Supabase static hosting)

### Environment Variables for Production

Set these in your hosting provider:
```
VITE_SUPABASE_PROJECT_ID=tlmbvgtvazpcshzjcopm
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_SUPABASE_URL=https://tlmbvgtvazpcshzjcopm.supabase.co
VITE_CLAUDE_API_KEY=sk-ant-api03-...
```

---

## Maintenance & Updates

### Keeping This Document Updated

**This is a living document** - please update it when:

1. **Adding new features**: Update "Key Features" and "Development History"
2. **Changing architecture**: Update "Architecture" section
3. **Modifying database**: Update "API Documentation" with new schema
4. **Deploying**: Update "Current Status" section
5. **Finding bugs**: Add to "Known Issues"
6. **Planning features**: Add to "Future Enhancements"

### Version Control

**Commit this file** whenever significant changes occur to the project.

### For AI Assistants

**Read this file first** before making any changes to the codebase. It contains:
- Current project state
- Architectural decisions
- Common patterns to follow
- Security considerations
- Known issues to avoid

---

## Support & Contact

**GitHub Repository**: https://github.com/mojo117/bill-buddy
**Issues**: Report bugs and feature requests in GitHub Issues
**Claude Code**: Use this documentation for context when working on the project
**Lovable.dev AI**: Reference this file to understand project state

---

**Last Updated**: 2026-01-07
**Project Status**: Active Development
**Version**: 0.1.0 (Pre-release)
