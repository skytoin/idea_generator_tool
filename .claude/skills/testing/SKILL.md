# Testing Conventions

- Test framework: Vitest + @testing-library/react + MSW
- Mock HTTP with MSW handlers, NEVER mock fetch/axios directly
- Structure: describe(functionName) > it('should behavior when condition')
- Arrange-Act-Assert pattern in every test
- Mock LLM responses with deterministic fixtures in src/__tests__/fixtures/

## Template:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { server } from '../mocks/server';

beforeAll(() => server.listen());
afterAll(() => server.close());

describe('stepName', () => {
  it('should produce valid output for standard input', async () => {
    // Arrange
    const input = createTestInput();
    // Act
    const result = await stepName(input);
    // Assert
    expect(result.ok).toBe(true);
    expect(result.value.ideas).toHaveLength(5);
  });

  it('should handle API failure gracefully', async () => {
    server.use(apiErrorHandler());
    const result = await stepName(createTestInput());
    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('API');
  });
});
```