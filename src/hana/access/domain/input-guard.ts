export const QUESTION_MIN_LENGTH = 3;
export const QUESTION_MAX_LENGTH = 300;

export type QuestionViolation = 'empty' | 'too_long' | 'looks_like_sql';

const OBJECT_KIND =
  '(?:column\\s+)?(?:table|view|schema|procedure|function|index|user|role|sequence)';
const STATEMENT_START = new RegExp(
  [
    '^\\s*(?:',
    'insert\\s+into\\s+\\S+',
    '|update\\s+\\S+\\s+set\\b',
    '|delete\\s+from\\s+\\S+',
    `|drop\\s+${OBJECT_KIND}\\b`,
    `|alter\\s+${OBJECT_KIND}\\b`,
    '|truncate\\s+table\\b',
    `|create\\s+(?:or\\s+replace\\s+)?${OBJECT_KIND}\\b`,
    '|merge\\s+into\\s+\\S+',
    '|(?:grant|revoke)\\s+[\\w,\\s]+\\s+(?:on|to|from)\\s+\\S+',
    '|call\\s+[\\w."]+\\s*\\(',
    '|explain\\s+plan\\b',
    '|with\\s+[\\w"]+\\s+as\\s*\\(',
    '|select\\s+(?:distinct\\s+|top\\s+\\d+\\s+)?(?:\\*|\\w+\\s*\\(|[\\w".]+\\s*,|[\\w".]+\\s+from\\b)',
    ')',
  ].join(''),
  'i',
);
const CHAINED_STATEMENT =
  /;\s*(?:select|insert\s+into|update\s+\S+\s+set|delete\s+from|drop\s+\S+|alter\s+\S+|truncate\s+\S+|create\s+\S+|merge\s+into|call\s+\S+\s*\()/i;
const SET_OPERATION = /\bunion\s+(?:all\s+)?select\b/i;
const SELECT_CLAUSES =
  /^\s*select\b[\s\S]*\bfrom\b[\s\S]*\b(?:where|join|group\s+by|order\s+by)\b/i;

/**
 * Step 2 guard of the flow (POV 3.2/3.3): the question of `hana_context` must be natural
 * language. This is a heuristic on purpose: it only catches SQL that is obviously SQL, and
 * ordinary phrases such as "select the best customers" pass. The real protection is the validator.
 */
export function checkQuestion(question: string): QuestionViolation | undefined {
  const text = question.trim();
  if (text.length < QUESTION_MIN_LENGTH) return 'empty';
  if (text.length > QUESTION_MAX_LENGTH) return 'too_long';
  if (
    STATEMENT_START.test(text) ||
    CHAINED_STATEMENT.test(text) ||
    SET_OPERATION.test(text) ||
    SELECT_CLAUSES.test(text)
  ) {
    return 'looks_like_sql';
  }
  return undefined;
}
