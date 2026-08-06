/**
 * @pmos/shared — canonical types for the ЦУП Personal OS.
 *
 * This package is the SINGLE SOURCE OF TRUTH for:
 *  - EventEnvelope (every NATS message)
 *  - Domain entities (Profile, Note, Task, Meeting, Project, FileMeta, ...)
 *  - Shared error envelope (ApiError)
 *
 * All services import from here. If a type is defined in two places, this one wins.
 * Convention: camelCase everywhere (see ADR-007 §3).
 */

// ---------------------------------------------------------------------------
// Event envelope (ADR-007 §3, ADR-003)
// ---------------------------------------------------------------------------

export interface EventEnvelope<T = Record<string, unknown>> {
  /** UUID v4 */
  id: string;
  /** Fully-qualified event type, e.g. "pmos.notes.created" */
  type: string;
  /** Service that published, e.g. "notes" */
  source: string;
  /** ISO 8601 */
  timestamp: string;
  /** Schema version of the event payload. Starts at 1. */
  version: number;
  /** UUID, propagated through HTTP + events for tracing (ADR-005) */
  correlationId: string;
  /** Typed, camelCase payload */
  data: T;
}

// ---------------------------------------------------------------------------
// Error envelope (ADR-007 §4)
// ---------------------------------------------------------------------------

export interface ApiError {
  /** UPPER_SNAKE code, e.g. VALIDATION_ERROR, NOT_FOUND, CONFLICT */
  code: string;
  /** human-readable */
  message: string;
  details?: object | null;
}

// ---------------------------------------------------------------------------
// Error localization (ADR-007 §4)
// ---------------------------------------------------------------------------

export { localizeApiError } from "./localize.js";

// ---------------------------------------------------------------------------
// Shared Kernel entities (read-only across services)
// ---------------------------------------------------------------------------

export interface Profile {
  id: string;
  name: string;
  color: string; // #RRGGBB
  icon?: string | null;
  isDefault?: boolean;
  hidden?: boolean;
  settings?: object | null;
}

export interface SettingsEntry {
  key: string;
  value: unknown;
}

// ---------------------------------------------------------------------------
// Domain entities
// ---------------------------------------------------------------------------

export interface Note {
  id: string;
  title: string;
  bodyMd: string;
  tags: string[];
  profileIds: string[];
  linkedProjectId?: string | null;
  linkedMeetingId?: string | null;
  linkedTaskId?: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "done";
  priority: number;
  description?: string | null;
  assignee?: string | null;
  deadline?: string | null;
  projectId?: string | null;
  profileIds: string[];
  recurrence?: string | null;
  currentStreak?: number;
  bestStreak?: number;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Meeting {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  description?: string | null;
  location?: string | null;
  recurrence?: string | null;
  linkedProjectId?: string | null;
  profileIds: string[];
  linkedExternalEventId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string | null;
  goal?: string | null;
  status: "active" | "archived" | "completed";
  profileIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface FileMeta {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  ownerType?: string | null;
  ownerId?: string | null;
  storagePath: string;
  profileIds: string[];
  uploadedAt: string;
}

// ---------------------------------------------------------------------------
// Event data payloads (camelCase) — subset; extend as services are built.
// See contracts/asyncapi/events.yaml for the full catalog.
// ---------------------------------------------------------------------------

export interface NoteCreatedData {
  noteId: string;
  bodyMd: string;
  title: string;
  tags: string[];
  profileIds: string[];
}
export interface NoteTitleGeneratedData {
  noteId: string;
  title: string;
  tag?: string;
}
export interface TaskStatusChangedData {
  taskId: string;
  oldStatus: string;
  newStatus: string;
  task: Task;
}
export interface MeetingCreatedData {
  meetingId: string;
  title: string;
  startTime: string;
  endTime: string;
}
export interface FileUploadedData {
  fileId: string;
  filename: string;
  mimeType: string;
  size: number;
  storagePath: string;
  profileIds: string[];
}
export interface FileTextExtractedData {
  fileId: string;
  extractedText: string;
  mimeType: string;
}
