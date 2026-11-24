/** The schema-permitted levels a new node under a parent may be, as rows of a ChoiceList; shared by the new-document and new-app-page dialogs. */
import { getEntityMetadata } from '@/lib/entity-type-registry';
import type { Choice } from './ChoiceList';

export function levelChoices(types: readonly string[]): Choice[] {
  return types.map((type: string): Choice => {
    const meta: ReturnType<typeof getEntityMetadata> = getEntityMetadata(type);
    return { value: type, label: meta.label, detail: `Created as a ${meta.label.toLowerCase()}`, icon: meta.icon, unavailable: null };
  });
}
