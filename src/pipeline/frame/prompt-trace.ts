import type { Consumer } from '../../lib/types/field-coverage';

/**
 * Runtime recorder that tracks which profile fields were accessed while
 * building a prompt for a specific consumer. The recorded pairs are asserted
 * against FIELD_COVERAGE to enforce the no-orphaned-data invariant.
 */
export class PromptTrace {
  private readonly consumer: Consumer;
  private readonly used: Set<string>;

  /**
   * Create a trace attached to a specific downstream consumer (e.g. narrative,
   * tech_scout). Each use() call records an access keyed by field name.
   */
  constructor(consumer: Consumer) {
    this.consumer = consumer;
    this.used = new Set();
  }

  /**
   * Record that the named field was used while building the prompt.
   * Returns `value` unchanged so you can wrap field accesses inline:
   *   const skills = trace.use('skills', profile.skills.value);
   */
  use<T>(field: string, value: T): T {
    this.used.add(field);
    return value;
  }

  /** List of (field, consumer) pairs recorded so far, deduped by field name. */
  entries(): Array<{ field: string; consumer: Consumer }> {
    return Array.from(this.used, (field) => ({ field, consumer: this.consumer }));
  }

  /**
   * True if the given field has been recorded for this trace. If a consumer
   * is passed, also checks that it matches this trace's consumer.
   */
  hasUsed(field: string, consumer?: Consumer): boolean {
    if (!this.used.has(field)) return false;
    if (consumer !== undefined && consumer !== this.consumer) return false;
    return true;
  }

  /** The consumer name this trace is attached to. */
  get consumerName(): Consumer {
    return this.consumer;
  }
}
