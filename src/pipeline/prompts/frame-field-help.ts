import type { Question } from '../frame/questions';

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
 * question, forbids invention of founder facts, and injects scenario
 * markers for the MSW mock when running under tests.
 */
function buildSystem(question: Question, scenario?: string): string {
  const marker = scenario ? `[[SCENARIO:${scenario}]]\n` : '';
  return `${marker}You help a founder fill out a single field of a profile form. Your job is to give a short, concrete answer they can act on — not to draft the whole form, not to ask a flood of follow-up questions.

The field being filled out:
- Question: ${question.label}
- Hint: ${question.hint}
- Input type: ${question.inputType}
${allowedValuesLine(question)}
Rules:
1. Keep the answer under 150 words.
2. If the user's message is vague, offer 2-4 concrete example answers tailored to what the rest of their profile already says.
3. Never invent facts about the user — only reason from what's in the provided current_input context.
4. If the input type is select or radio, point at one of the allowed values above.
5. Do not ask more than one clarifying question.`;
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
