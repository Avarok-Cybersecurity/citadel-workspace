/**
 * MDX Template Types
 *
 * Type definitions and enums for MDX content templates.
 */

/**
 * Which levels a template is for, by the level's PLACE in the live schema, never by its name.
 *
 * This was `OFFICE`/`ROOM`. Those are the default schema's names, admins rename levels, and a
 * workspace may use another schema entirely; worse, the page passed `OFFICE` for every node, so
 * the room templates could not be reached at all. `templateCategoryFor` derives the category.
 */
export enum TemplateCategory {
  /** Levels the schema permits directly under the workspace ("Office" in the default schema). */
  TOP_LEVEL = 'top-level',
  /** Every other level ("Room" in the default schema). */
  NESTED = 'nested',
}

/** What a template is about; independent of the level it is offered at. */
export enum TemplateTheme {
  GENERAL = 'general',
  ENGINEERING = 'engineering',
  DESIGN = 'design',
  MARKETING = 'marketing',
  SALES = 'sales',
  HR = 'human_resources',
  FINANCE = 'finance',
  LEGAL = 'legal',
  PRODUCT = 'product',
  SECURITY = 'security',
  MEETING = 'meeting',
  PROJECTS = 'projects',
  RESOURCES = 'resources',
  ANNOUNCEMENTS = 'announcements',
  DISCUSSIONS = 'discussions',
  CHAT = 'chat',
  DOCUMENTATION = 'documentation',
  TRAINING = 'training'
}

export interface MdxTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  type: TemplateTheme;
  thumbnail?: string;
  content: string;
}
