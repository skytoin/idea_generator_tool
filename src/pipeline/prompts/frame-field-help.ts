import type { Question } from '../frame/questions';
import { z, type ZodTypeAny } from 'zod';

/**
 * Build the allowed-values line for a question that has a fixed option set.
 * Returns an empty string for open-ended questions so the system prompt
 * stays clean when no list is applicable.
 */
function allowedValuesLine(question: Question): string {
  if (!question.options || question.options.length === 0) return '';
  const values = question.options.map((o) => o.value);
  return `- Allowed values: ${JSON.stringify(values)}\n`;
}

/**
 * Build the field-help system prompt. Pins the assistant to a single
 * question, forbids invention of founder facts, describes the required
 * structured response shape, and injects scenario markers for the MSW
 * mock when running under tests.
 */
function buildSystem(question: Question, scenario?: string): string {
  const marker = scenario ? `[[SCENARIO:${scenario}]]\n` : '';
  return `${marker}You help a founder fill out a single field of a profile form. Your job is to give a short, concrete answer they can act on — not to draft the whole form, not to ask a flood of follow-up questions.

The field being filled out:
- Question: ${question.label}
- Hint: ${question.hint}
- Input type: ${question.inputType}
${allowedValuesLine(question)}
You return a JSON object with two fields:
- "message": a short human-readable explanation (under 150 words) shown in the chat bubble.
- "suggested_value": a concrete value the founder can apply directly to the field, or null if no specific value makes sense yet.

Rules for suggested_value by input type:
- text, textarea: a single string (the answer the founder should type).
- select, radio: one of the allowed values above, verbatim.
- tags, chips: an array of strings — the full list the founder should have in this field.
- tags_with_duration: an array of objects with shape {area: string, years: number or null}.

Set suggested_value to null ONLY when:
- the founder's question is purely conceptual ("what does this field mean?"),
- or you cannot confidently recommend a concrete value from the context provided.

Rules for message:
1. Under 150 words.
2. If the user's question is vague, offer 2-4 concrete example answers tailored to what their profile already says.
3. Never invent facts about the user — only reason from the provided current_input context.
4. Do not ask more than one clarifying question.`;
}

/**
 * Build the field-help user prompt, serializing the founder's in-progress
 * profile as a <current_input> block so the assistant can ground its
 * suggestion in what the founder has already typed.
 */
function buildUser(userMessage: string, currentInput: Record<string, unknown>): string {
  return `User's current profile input so far:
<current_input>
${JSON.stringify(currentInput, null, 2)}
</current_input>

User's question about this field:
${userMessage}`;
}

/**
 * Build a { system, user } prompt pair for the field-help chat assist.
 * The question supplies the form metadata, the user message drives the
 * request, and currentInput lets the LLM tailor its answer to the rest
 * of the profile without inventing new facts.
 */
export function buildFieldHelpPrompt(
  question: Question,
  userMessage: string,
  currentInput: Record<string, unknown>,
  scenario?: string,
): { system: string; user: string } {
  return {
    system: buildSystem(question, scenario),
    user: buildUser(userMessage, currentInput),
  };
}

/**
 * Build the Zod schema for a question's `suggested_value` field. The shape
 * depends on the question's inputType so the LLM is constrained to produce
 * a value that can be assigned directly to the form field.
 */
export function buildSuggestedValueSchema(question: Question): ZodTypeAny {
  switch (question.inputType) {
    case 'text':
    case 'textarea':
      return z.string();
    case 'select':
    case 'radio': {
      const values = (question.options ?? []).map((o) => o.value);
      if (values.length === 0) return z.string();
      return z.enum(values as [string, ...string[]]);
    }
    case 'tags':
    case 'chips':
      return z.array(z.string());
    case 'tags_with_duration':
      return z.array(
        z.object({ area: z.string(), years: z.number().nullable() }),
      );
    default:
      return z.string();
  }
}

/**
 * Build the full field-help response schema: { message, suggested_value }
 * where suggested_value is nullable and typed per the question's input type.
 */
export function buildFieldHelpResponseSchema(question: Question) {
  return z.object({
    message: z.string(),
    suggested_value: buildSuggestedValueSchema(question).nullable(),
  });
}
