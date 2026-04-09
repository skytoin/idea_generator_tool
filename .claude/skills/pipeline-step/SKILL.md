# Pipeline Step Implementation

When creating or modifying a pipeline step:

1. Define input/output Zod schemas in src/lib/types/
2. Create the step function in src/pipeline/steps/
3. Write tests in src/__tests__/pipeline/steps/ FIRST
4. Each step function signature: (input: StepInput) => Promise<Result<StepOutput, StepError>>
5. Use generateObject() from Vercel AI SDK with the output Zod schema
6. Log step start/end with step name and duration
7. Handle API errors with retry logic (3 attempts, exponential backoff)

## Template:
```ts
import { generateObject } from 'ai';
import { models } from '@/lib/ai/models';
import { z } from 'zod';
import { type Result, ok, err } from '@/lib/utils/result';

const InputSchema = z.object({ /* ... */ });
const OutputSchema = z.object({ /* ... */ });

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

/** Brief description of what this step does */
export async function stepName(input: Input): Promise<Result<Output, Error>> {
  const validated = InputSchema.safeParse(input);
  if (!validated.success) return err(validated.error);

  const { object } = await generateObject({
    model: models.reasoning, // Pick from models registry
    schema: OutputSchema,
    prompt: buildPrompt(validated.data),
  });

  return ok(object);
}
```