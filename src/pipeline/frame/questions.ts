import type { FounderProfileField } from '../../lib/types/founder-profile';

export type QuestionInputType =
  | 'text'
  | 'textarea'
  | 'tags'
  | 'tags_with_duration'
  | 'select'
  | 'radio'
  | 'chips';

export type QuestionOption = { value: string; label: string };

/** 'mode', 'existing_idea', 'additional_context' are special cases not in FounderProfileField. */
export type QuestionTarget = FounderProfileField | 'mode' | 'existing_idea' | 'additional_context';

export type Question = {
  id: string;
  label: string;
  hint: string;
  inputType: QuestionInputType;
  profileField: QuestionTarget;
  required: boolean;
  options?: QuestionOption[];
  placeholder?: string;
  conditional?: { showIfFieldId: string; equals: string | string[] };
  examples?: string[];
};

export const QUESTIONS: readonly Question[] = [
  // Meta
  {
    id: 'M1',
    label: 'Do you have a specific idea you want to develop, or do you want help finding ideas?',
    hint: "If you already have an idea, I'll focus on validating and improving it. If you don't, I'll explore a wide range of possibilities based on your background.",
    inputType: 'radio',
    profileField: 'mode',
    required: true,
    options: [
      { value: 'explore', label: 'Help me find ideas' },
      { value: 'refine', label: 'I have an idea — help me refine it' },
      { value: 'open_direction', label: "I have a rough direction but I'm open" },
    ],
  },
  {
    id: 'M1b',
    label: 'Describe your idea or rough direction in a few sentences.',
    hint: "What is it, who is it for, and what problem does it solve? Don't worry about polish — rough is fine.",
    inputType: 'textarea',
    profileField: 'existing_idea',
    required: true,
    conditional: { showIfFieldId: 'M1', equals: ['refine', 'open_direction'] },
  },

  // Required Q1-Q4
  {
    id: 'Q1',
    label: 'What can you build, make, or do yourself, end-to-end, without needing to hire anyone?',
    hint: "List concrete outputs. Examples: 'full-stack web apps in React', 'logo and brand design in Figma', 'Python data pipelines', 'video editing', 'written articles', 'cold sales emails that get replies'. Be specific about the output, not just the tool.",
    inputType: 'tags',
    profileField: 'skills',
    required: true,
    examples: ['full-stack web apps in React', 'Figma brand design', 'Python data pipelines'],
  },
  {
    id: 'Q2',
    label: 'How many hours per week can you realistically commit to this for the next 3 months?',
    hint: 'Be honest, not optimistic. Count only hours you are sure you can protect from your job, family, and other commitments. Round down, not up.',
    inputType: 'select',
    profileField: 'time_per_week',
    required: true,
    options: [
      { value: '2', label: '2 hours' },
      { value: '5', label: '5 hours' },
      { value: '10', label: '10 hours' },
      { value: '20', label: '20 hours' },
      { value: '40', label: '40+ hours (full-time)' },
    ],
  },
  {
    id: 'Q3',
    label: 'How much money can you spend on this before it needs to make any money back?',
    hint: "Include recurring subscriptions, API costs, ads, tools, freelancer help, or hardware. If you can't afford to lose this money, don't include it.",
    inputType: 'select',
    profileField: 'money_available',
    required: true,
    options: [
      { value: 'lt_500', label: 'Under $500' },
      { value: 'lt_5k', label: 'Under $5,000' },
      { value: 'lt_50k', label: 'Under $50,000' },
      { value: 'more', label: 'More than $50,000' },
      { value: 'no_limit', label: 'Not a constraint' },
    ],
  },
  {
    id: 'Q4',
    label: 'What role will this project play in your life?',
    hint: 'This shapes what kind of ideas make sense. A side project and a business you quit your job for need different approaches.',
    inputType: 'radio',
    profileField: 'ambition',
    required: true,
    options: [
      { value: 'side_project', label: 'A side project — learning, fun, maybe some extra income' },
      {
        value: 'supplemental',
        label: 'Supplemental income — I want it to earn but not replace my job',
      },
      { value: 'replace_income', label: 'Replace my income — I want to quit my job when it works' },
      { value: 'build_company', label: 'Build a company — investors, employees, scale' },
      { value: 'unsure', label: "I'm not sure yet" },
    ],
  },

  // Recommended Q20, Q5-Q7
  {
    id: 'Q20',
    label: 'How strictly should the idea generator match your profile?',
    hint: 'Controls how far downstream generators are allowed to stray from what you stated above. Default is Balanced — a mix of fit and stretch.',
    inputType: 'radio',
    profileField: 'divergence_level',
    required: false,
    options: [
      {
        value: 'strict',
        label: 'Strict — only ideas that fit my skills, time, and budget tightly',
      },
      {
        value: 'balanced',
        label: 'Balanced — mostly fit me, with some stretch (default)',
      },
      {
        value: 'adventurous',
        label: "Adventurous — stretch me, I'll learn new things",
      },
      {
        value: 'wild',
        label: "Wild — surprise me with ideas outside my profile",
      },
    ],
  },
  {
    id: 'Q5',
    label: 'What industries, fields, or areas have you worked in — and roughly how long in each?',
    hint: "Include jobs, serious hobbies, volunteering, studies — anywhere you've spent enough time to see how things actually work. 'E-commerce, 4 years' is better than 'a little bit of retail'.",
    inputType: 'tags_with_duration',
    profileField: 'domain',
    required: false,
  },
  {
    id: 'Q6',
    label:
      "What's something you've seen broken, inefficient, or badly done up close — that someone outside that world wouldn't notice?",
    hint: "Think of processes, tools, or situations at your job, hobby, or community where you've thought 'this is ridiculous, someone should fix this'. One or two examples is enough.",
    inputType: 'textarea',
    profileField: 'insider_knowledge',
    required: false,
  },
  {
    id: 'Q7',
    label: 'Any industries, business models, or customer types you refuse to work on?',
    hint: 'This is your veto list. Anything in these areas will be excluded from every idea. Click chips or type your own.',
    inputType: 'chips',
    profileField: 'anti_targets',
    required: false,
    examples: [
      'crypto',
      'gambling',
      'advertising',
      'defense',
      'MLM',
      'selling to children',
      'adult content',
      'tobacco',
      'politics',
    ],
  },

  // Optional Q8-Q19
  {
    id: 'Q8',
    label:
      'Roughly how many people could you contact tomorrow for advice, introductions, or feedback — and in what areas?',
    hint: "Be concrete. '10 people in fintech from past jobs' is more useful than 'I network a lot'.",
    inputType: 'textarea',
    profileField: 'network',
    required: false,
  },
  {
    id: 'Q9',
    label:
      'Do you already have an audience anywhere — newsletter, Twitter/X, YouTube, Discord, podcast, Stack Overflow, a community you moderate?',
    hint: 'Even small audiences count. 500 followers in a niche can be a real advantage. List the platform and rough size.',
    inputType: 'textarea',
    profileField: 'audience',
    required: false,
  },
  {
    id: 'Q10',
    label:
      "Do you have access to any data, systems, tools, or information that most people outside your job don't?",
    hint: 'Examples: internal tools at work, unusual datasets, paid research subscriptions, niche software licenses, API access. Only list things you can actually use for a side project.',
    inputType: 'textarea',
    profileField: 'proprietary_access',
    required: false,
  },
  {
    id: 'Q11',
    label:
      "Do you have an unusual combination of skills or experience? (e.g., 'law + machine learning', 'cooking + logistics')",
    hint: 'Rare combinations are one of the best sources of ideas. Think about skills from different parts of your life that do not usually meet.',
    inputType: 'textarea',
    profileField: 'rare_combinations',
    required: false,
  },
  {
    id: 'Q12',
    label: "What's a problem you've complained about repeatedly in the last year?",
    hint: 'Pain you personally feel is strong signal. Work, hobby, home, travel — anywhere.',
    inputType: 'textarea',
    profileField: 'recurring_frustration',
    required: false,
  },
  {
    id: 'Q13',
    label: 'If you had to ship something in 4 weeks, what would you feel confident building?',
    hint: 'This reveals the realistic intersection of your skills and ambition.',
    inputType: 'textarea',
    profileField: 'four_week_mvp',
    required: false,
  },
  {
    id: 'Q14',
    label: 'What have you already tried — ideas, experiments, or projects — even informally?',
    hint: 'This prevents the pipeline from suggesting things you have already ruled out.',
    inputType: 'textarea',
    profileField: 'previous_attempts',
    required: false,
  },
  {
    id: 'Q15',
    label: 'Who do you most enjoy helping or selling to?',
    hint: 'Developers? Small business owners? Creatives? Parents? Teachers? The group you understand best is often the group you can serve best.',
    inputType: 'textarea',
    profileField: 'customer_affinity',
    required: false,
  },
  {
    id: 'Q16',
    label: 'When would you want to see first customer revenue?',
    hint: 'Affects which ideas rank highly. 2 weeks favors quick validation; 1 year favors long-build products.',
    inputType: 'select',
    profileField: 'time_to_revenue',
    required: false,
    options: [
      { value: '2_weeks', label: '2 weeks' },
      { value: '2_months', label: '2 months' },
      { value: '6_months', label: '6 months' },
      { value: '1_year_plus', label: '1 year or more' },
      { value: 'no_preference', label: 'No preference' },
    ],
  },
  {
    id: 'Q17',
    label: 'Do you want to sell to businesses, consumers, or no preference?',
    hint: 'Changes scanner targets and idea strategies significantly.',
    inputType: 'radio',
    profileField: 'customer_type_preference',
    required: false,
    options: [
      { value: 'b2b', label: 'Businesses' },
      { value: 'b2c', label: 'Consumers' },
      { value: 'both', label: 'Both' },
      { value: 'no_preference', label: 'No preference' },
    ],
  },
  {
    id: 'Q18',
    label: 'Why are you doing this now? What changed?',
    hint: 'Often reveals real motivation — frustration, life change, opportunity you have seen.',
    inputType: 'textarea',
    profileField: 'trigger',
    required: false,
  },
  {
    id: 'Q19',
    label: 'Any legal constraints — non-compete, NDA, visa status, employer restrictions?',
    hint: 'The pipeline will avoid suggesting ideas that would violate these.',
    inputType: 'textarea',
    profileField: 'legal_constraints',
    required: false,
  },

  // Catch-all
  {
    id: 'AC',
    label:
      'Anything else I should know about you? Quirks, obsessions, specific problems bugging you, strange constraints, weird interests — anything.',
    hint: '**This field is heavily weighted.** The best ideas often come from quirky context that does not fit neat categories. Write as much or as little as you want. Note: this text is sent to the LLM, so do not include anything you would not want processed by an AI provider.',
    inputType: 'textarea',
    profileField: 'additional_context',
    required: false,
  },
];

/** Get a question by id or undefined if not found. */
export function getQuestionById(id: string): Question | undefined {
  return QUESTIONS.find((q) => q.id === id);
}

/** Get all required question ids. */
export const REQUIRED_QUESTION_IDS = QUESTIONS.filter((q) => q.required).map((q) => q.id);
