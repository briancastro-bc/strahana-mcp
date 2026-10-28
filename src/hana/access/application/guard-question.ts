import { errors } from '../../../platform/errors/sanitized-error.js';
import { checkQuestion, QUESTION_MAX_LENGTH, QUESTION_MIN_LENGTH } from '../domain/input-guard.js';

/** Input guards of `hana_context` (step 2). Throws a sanitized error describing the fix. */
export function guardQuestion(question: string): void {
  switch (checkQuestion(question)) {
    case undefined:
      return;
    case 'looks_like_sql':
      throw errors.questionIsSql();
    case 'too_long':
      throw errors.invalidInput(`question must have at most ${QUESTION_MAX_LENGTH} characters.`);
    case 'empty':
      throw errors.invalidInput(
        `question must have at least ${QUESTION_MIN_LENGTH} non-blank characters.`,
      );
  }
}
