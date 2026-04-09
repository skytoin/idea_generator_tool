import { describe, it, expect } from 'vitest';
import { FRAME_INPUT_SCHEMA } from '../../../lib/types/frame-input';

const REQUIRED_MIN = {
  skills: ['React'],
  time_per_week: '10' as const,
  money_available: 'lt_500' as const,
  ambition: 'side_project' as const,
};

describe('FRAME_INPUT_SCHEMA', () => {
  it('parses minimum explore input and defaults additional_context to empty string', () => {
    const result = FRAME_INPUT_SCHEMA.safeParse({
      mode: 'explore',
      ...REQUIRED_MIN,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.additional_context).toBe('');
    }
  });

  it('parses minimum refine input with existing_idea', () => {
    const result = FRAME_INPUT_SCHEMA.safeParse({
      mode: 'refine',
      existing_idea: 'A SOC-2 tool.',
      ...REQUIRED_MIN,
    });
    expect(result.success).toBe(true);
  });

  it('rejects mode: refine with no existing_idea', () => {
    const result = FRAME_INPUT_SCHEMA.safeParse({
      mode: 'refine',
      ...REQUIRED_MIN,
    });
    expect(result.success).toBe(false);
  });

  it('rejects mode: open_direction with empty-string existing_idea', () => {
    const result = FRAME_INPUT_SCHEMA.safeParse({
      mode: 'open_direction',
      existing_idea: '   ',
      ...REQUIRED_MIN,
    });
    expect(result.success).toBe(false);
  });

  it('rejects additional_context of length 5001', () => {
    const result = FRAME_INPUT_SCHEMA.safeParse({
      mode: 'explore',
      ...REQUIRED_MIN,
      additional_context: 'a'.repeat(5001),
    });
    expect(result.success).toBe(false);
  });

  it('accepts all optional fields omitted', () => {
    const result = FRAME_INPUT_SCHEMA.safeParse({
      mode: 'explore',
      ...REQUIRED_MIN,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty skills array', () => {
    const result = FRAME_INPUT_SCHEMA.safeParse({
      mode: 'explore',
      ...REQUIRED_MIN,
      skills: [],
    });
    expect(result.success).toBe(false);
  });
});
