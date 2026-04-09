import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FieldWithHelp } from '../../../components/frame/field-with-help';
import type { Question } from '../../../pipeline/frame/questions';

/** Build a minimal Question of the given inputType for inline test cases. */
function buildQuestion(overrides: Partial<Question> & Pick<Question, 'inputType'>): Question {
  return {
    id: 'Q_TEST',
    label: 'Test label',
    hint: 'Test hint',
    profileField: 'trigger',
    required: false,
    ...overrides,
  } as Question;
}

describe('FieldWithHelp', () => {
  it('renders the question label', () => {
    const q = buildQuestion({ inputType: 'text' });
    render(
      <FieldWithHelp
        question={q}
        value=""
        onChange={vi.fn()}
        onRequestHelp={vi.fn()}
      />,
    );
    expect(screen.getByText('Test label')).toBeInTheDocument();
  });

  it('renders the question hint', () => {
    const q = buildQuestion({ inputType: 'text' });
    render(
      <FieldWithHelp
        question={q}
        value=""
        onChange={vi.fn()}
        onRequestHelp={vi.fn()}
      />,
    );
    expect(screen.getByText('Test hint')).toBeInTheDocument();
  });

  it('text input fires onChange with new string', () => {
    const onChange = vi.fn();
    const q = buildQuestion({ inputType: 'text' });
    render(
      <FieldWithHelp
        question={q}
        value=""
        onChange={onChange}
        onRequestHelp={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'abc' } });
    expect(onChange).toHaveBeenCalledWith('abc');
  });

  it('textarea input fires onChange', () => {
    const onChange = vi.fn();
    const q = buildQuestion({ inputType: 'textarea' });
    render(
      <FieldWithHelp
        question={q}
        value=""
        onChange={onChange}
        onRequestHelp={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello' } });
    expect(onChange).toHaveBeenCalledWith('hello');
  });

  it('select renders options and fires onChange', () => {
    const onChange = vi.fn();
    const q = buildQuestion({
      inputType: 'select',
      options: [
        { value: 'a', label: 'Option A' },
        { value: 'b', label: 'Option B' },
      ],
    });
    render(
      <FieldWithHelp
        question={q}
        value=""
        onChange={onChange}
        onRequestHelp={vi.fn()}
      />,
    );
    expect(screen.getByText('Option A')).toBeInTheDocument();
    expect(screen.getByText('Option B')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'b' } });
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('radio renders options and fires onChange', () => {
    const onChange = vi.fn();
    const q = buildQuestion({
      inputType: 'radio',
      options: [
        { value: 'x', label: 'X option' },
        { value: 'y', label: 'Y option' },
      ],
    });
    render(
      <FieldWithHelp
        question={q}
        value=""
        onChange={onChange}
        onRequestHelp={vi.fn()}
      />,
    );
    expect(screen.getByRole('radio', { name: 'X option' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Y option' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Y option' }));
    expect(onChange).toHaveBeenCalledWith('y');
  });

  it('tags: typing and pressing Enter adds a chip', () => {
    const onChange = vi.fn();
    const q = buildQuestion({ inputType: 'tags' });
    render(
      <FieldWithHelp
        question={q}
        value={['existing']}
        onChange={onChange}
        onRequestHelp={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText(/add/i);
    fireEvent.change(input, { target: { value: 'newtag' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['existing', 'newtag']);
  });

  it('tags: clicking × on a chip removes it', () => {
    const onChange = vi.fn();
    const q = buildQuestion({ inputType: 'tags' });
    render(
      <FieldWithHelp
        question={q}
        value={['alpha', 'beta']}
        onChange={onChange}
        onRequestHelp={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /remove alpha/i }));
    expect(onChange).toHaveBeenCalledWith(['beta']);
  });

  it('tags: Backspace on empty input removes last tag', () => {
    const onChange = vi.fn();
    const q = buildQuestion({ inputType: 'tags' });
    render(
      <FieldWithHelp
        question={q}
        value={['alpha', 'beta']}
        onChange={onChange}
        onRequestHelp={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText(/add/i);
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).toHaveBeenCalledWith(['alpha']);
  });

  it('tags_with_duration: adds {area, years} pair on Enter; clicking × removes', () => {
    const onChange = vi.fn();
    const q = buildQuestion({ inputType: 'tags_with_duration' });
    const { rerender } = render(
      <FieldWithHelp
        question={q}
        value={[{ area: 'fintech', years: 3 }]}
        onChange={onChange}
        onRequestHelp={vi.fn()}
      />,
    );
    // Chip visible
    expect(screen.getByText(/fintech/)).toBeInTheDocument();
    // Add new
    const areaInput = screen.getByPlaceholderText(/area/i);
    const yearsInput = screen.getByPlaceholderText(/years/i);
    fireEvent.change(areaInput, { target: { value: 'healthcare' } });
    fireEvent.change(yearsInput, { target: { value: '5' } });
    fireEvent.keyDown(areaInput, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith([
      { area: 'fintech', years: 3 },
      { area: 'healthcare', years: 5 },
    ]);
    // Remove existing
    rerender(
      <FieldWithHelp
        question={q}
        value={[{ area: 'fintech', years: 3 }]}
        onChange={onChange}
        onRequestHelp={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /remove fintech/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('chips: preset example chips rendered; clicking toggles selection', () => {
    const onChange = vi.fn();
    const q = buildQuestion({
      inputType: 'chips',
      examples: ['crypto', 'gambling', 'tobacco'],
    });
    render(
      <FieldWithHelp
        question={q}
        value={['crypto']}
        onChange={onChange}
        onRequestHelp={vi.fn()}
      />,
    );
    // Presets visible
    expect(screen.getByRole('button', { name: /gambling/i })).toBeInTheDocument();
    // Select unselected preset
    fireEvent.click(screen.getByRole('button', { name: /gambling/i }));
    expect(onChange).toHaveBeenCalledWith(['crypto', 'gambling']);
    // Deselect selected preset
    onChange.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /crypto/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('chips: custom chip added via text input and Enter', () => {
    const onChange = vi.fn();
    const q = buildQuestion({
      inputType: 'chips',
      examples: ['crypto'],
    });
    render(
      <FieldWithHelp
        question={q}
        value={[]}
        onChange={onChange}
        onRequestHelp={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText(/add/i);
    fireEvent.change(input, { target: { value: 'custom-veto' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['custom-veto']);
  });

  it('Help button click fires onRequestHelp(question.id)', () => {
    const onRequestHelp = vi.fn();
    const q = buildQuestion({ id: 'Q_HELP', inputType: 'text' });
    render(
      <FieldWithHelp
        question={q}
        value=""
        onChange={vi.fn()}
        onRequestHelp={onRequestHelp}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /help/i }));
    expect(onRequestHelp).toHaveBeenCalledWith('Q_HELP');
  });

  it('filling=true disables input and shows "Filling..."; editing fires onCancelFill', () => {
    const onCancelFill = vi.fn();
    const q = buildQuestion({ inputType: 'text' });
    render(
      <FieldWithHelp
        question={q}
        value=""
        onChange={vi.fn()}
        onRequestHelp={vi.fn()}
        filling={true}
        onCancelFill={onCancelFill}
      />,
    );
    expect(screen.getByText(/filling/i)).toBeInTheDocument();
    const input = screen.getByRole('textbox');
    expect(input).toBeDisabled();
    fireEvent.change(input, { target: { value: 'user edit' } });
    expect(onCancelFill).toHaveBeenCalled();
  });
});
