import { describe, expect, it } from 'vitest';
import { isGenericAnchor } from '../../src/core/config/generic-anchors.js';

describe('isGenericAnchor', () => {
  it.each([
    'Click here',
    '  read more… ',
    'Подробнее',
    'читати далі',
    'Mehr erfahren',
    'en savoir plus',
    'Leer más →',
  ])('flags %s', (anchor) => expect(isGenericAnchor(anchor)).toBe(true));

  it.each(['Pricing for teams', 'read more about crawl budgets', '', 'SEO audit checklist'])(
    'accepts %s',
    (anchor) => expect(isGenericAnchor(anchor)).toBe(false),
  );
});
