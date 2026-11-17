/**
 * The questions an event type asks its invitees (design §3.1): a label, a kind (short answer,
 * paragraph or a choice), whether it is required, and a choice's options one per line. The type
 * editor checks them (`checkEventType`); errors arrive keyed `question-<i>`.
 */
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { Question } from '@/lib/calendar/generated/Question';
import type { QuestionKind } from '@/lib/calendar/generated/QuestionKind';
import { NativeSelect } from './NativeSelect';

interface QuestionsEditorProps {
  questions: Question[];
  errors: ReadonlyMap<string, string>;
  newId: () => string;
  onChange: (next: Question[]) => void;
}

type KindName = 'text' | 'long_text' | 'choice';
const kindName = (k: QuestionKind): KindName => (typeof k === 'object' ? 'choice' : k);
const KIND_LABEL: Record<KindName, string> = { text: 'Short answer', long_text: 'Paragraph', choice: 'Choose one' };

export function QuestionsEditor({ questions, errors, newId, onChange }: QuestionsEditorProps): JSX.Element {
  const set = (i: number, q: Question): void => onChange(questions.map((x: Question, j: number) => (j === i ? q : x)));
  return (
    <fieldset className="flex min-w-0 flex-col gap-3" data-testid="calendar-questions-editor">
      <legend className="mb-1 text-sm font-semibold text-foreground">Questions for the invitee</legend>
      {questions.length === 0 && <p className="text-sm text-muted-foreground">None: invitees only pick a time.</p>}
      {questions.map((q: Question, i: number) => (
        <div key={q.id} className="flex min-w-0 flex-col gap-2 rounded-md border border-border p-3">
          <div className="flex min-w-0 items-center gap-2">
            <Input aria-label={`Question ${i + 1}`} placeholder="What should we cover?" className="h-[44px] min-w-0 flex-1" value={q.label} onChange={(e): void => set(i, { ...q, label: e.target.value })} />
            <Button type="button" variant="ghost" size="icon" className="h-[44px] w-[44px] shrink-0" aria-label={`Remove question ${i + 1}`} onClick={(): void => onChange(questions.filter((_x, j: number) => j !== i))}>
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <NativeSelect aria-label={`Question ${i + 1} answer`} value={kindName(q.kind)}
              onChange={(e): void => {
                const next: KindName = e.target.value as KindName;
                set(i, { ...q, kind: next === 'choice' ? { choice: { options: [] } } : next });
              }}>
              {(Object.keys(KIND_LABEL) as KindName[]).map((k: KindName) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </NativeSelect>
            <label className="flex min-h-[44px] items-center gap-2 text-sm text-foreground">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={q.required} onChange={(e): void => set(i, { ...q, required: e.target.checked })} />
              Required
            </label>
          </div>
          {typeof q.kind === 'object' && (
            <Textarea aria-label={`Question ${i + 1} options, one per line`} rows={3} placeholder={'Video\nVoice'} value={q.kind.choice.options.join('\n')}
              onChange={(e): void => set(i, { ...q, kind: { choice: { options: e.target.value.split('\n') } } })} />
          )}
          {errors.has(`question-${i}`) && <p role="alert" className="text-sm text-destructive-emphasis">{errors.get(`question-${i}`)}</p>}
        </div>
      ))}
      <Button type="button" variant="outline" className="h-[44px] self-start" onClick={(): void => onChange([...questions, { id: newId(), label: '', kind: 'text', required: false }])}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        <span>Add a question</span>
      </Button>
    </fieldset>
  );
}
