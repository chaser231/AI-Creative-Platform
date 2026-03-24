/**
 * Shared API Types
 *
 * DTO interfaces used by both frontend stores and backend routers.
 * Defines the contract between client and server.
 */

import type {
  Layer,
  MasterComponent,
  ComponentInstance,
  ResizeFormat,
} from "@/types";

// ─── Canvas State ────────────────────────────────────────

export interface CanvasState {
  layers: Layer[];
  masterComponents: MasterComponent[];
  componentInstances: ComponentInstance[];
  resizes: ResizeFormat[];
  artboardProps: ArtboardProps;
  canvasWidth: number;
  canvasHeight: number;
}

import type { ArtboardProps } from "@/store/canvas/types";
export type { ArtboardProps };

// ─── Project DTOs ────────────────────────────────────────

export interface ProjectSummary {
  id: string;
  name: string;
  status: string;
  goal: string;
  thumbnail: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: {
    id: string;
    name: string;
    avatarUrl: string | null;
  };
}

export interface CreateProjectInput {
  name: string;
  workspaceId: string;
  goal: string;
}

export interface UpdateProjectInput {
  name?: string;
  status?: string;
  thumbnail?: string | null;
}

// ─── Workspace DTOs ──────────────────────────────────────

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  businessUnit: string;
  logoUrl: string | null;
  role: string;
}

export interface BrandIdentityInput {
  workspaceId: string;
  colors?: BrandColorDTO[];
  fonts?: BrandFontDTO[];
  toneOfVoice?: string;
  logoUrl?: string | null;
}

export interface BrandColorDTO {
  id: string;
  name: string;
  hex: string;
  usage: string;
}

export interface BrandFontDTO {
  id: string;
  name: string;
  weights: string[];
  usage: string;
}

// ─── Template DTOs ───────────────────────────────────────

export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  categories: string[];
  contentType: string;
  isOfficial: boolean;
  thumbnailUrl: string | null;
  popularity: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TemplateFilters {
  category?: string;
  contentType?: string;
  occasion?: string;
  isOfficial?: boolean;
  search?: string;
}

// ─── Asset DTOs ──────────────────────────────────────────

export interface AssetSummary {
  id: string;
  type: string;
  filename: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
}

export interface UploadAssetInput {
  workspaceId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  type: "IMAGE" | "VIDEO" | "AUDIO" | "FONT" | "LOGO" | "OTHER";
}

// ─── AI DTOs ─────────────────────────────────────────────

export interface AISessionSummary {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
  user: {
    id: string;
    name: string;
  };
}

export interface AIMessageDTO {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  type: "text" | "image" | "error";
  model: string | null;
  costUnits: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}
