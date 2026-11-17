/**
 * MDX Templates Module
 *
 * Re-exports all public API for MDX content templates.
 */

// Types and enums
export type { MdxTemplate } from './types';
export { TemplateCategory, TemplateTheme } from './types';
export { templateCategoryFor } from './template-category';

// Office templates
export {
  generalOfficeTemplate,
  engineeringOfficeTemplate,
  designOfficeTemplate,
  securityOfficeTemplate,
  officeTemplates,
} from './office-templates';

// Room templates
export {
  meetingRoomTemplate,
  projectsRoomTemplate,
  documentationRoomTemplate,
  trainingRoomTemplate,
  roomTemplates,
} from './room-templates';

import { TemplateCategory, TemplateTheme, type MdxTemplate } from './types';
import { officeTemplates } from './office-templates';
import { roomTemplates } from './room-templates';

// Collection of all templates
export const templates: MdxTemplate[] = [
  ...officeTemplates,
  ...roomTemplates,
];

// Helper functions
export function getTemplatesByCategory(category: TemplateCategory): MdxTemplate[] {
  return templates.filter(template => template.category === category);
}

export function getTemplateById(id: string): MdxTemplate | undefined {
  return templates.find(template => template.id === id);
}

export function getTemplatesByType(category: TemplateCategory, type: TemplateTheme): MdxTemplate | undefined {
  return templates.find(template => template.category === category && template.type === type);
}

export default {
  templates,
  getTemplatesByCategory,
  getTemplateById,
  getTemplatesByType
};
