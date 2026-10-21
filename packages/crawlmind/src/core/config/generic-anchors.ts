/**
 * Anchor texts that say nothing about the target page. Matching is case-insensitive on the
 * whole anchor, after trimming whitespace and trailing punctuation.
 */
export const GENERIC_ANCHORS: Readonly<Record<string, readonly string[]>> = {
  en: [
    'click here',
    'here',
    'read more',
    'learn more',
    'more',
    'more info',
    'this',
    'this page',
    'link',
    'details',
    'continue reading',
    'see more',
    'find out more',
    'go',
    'website',
  ],
  ru: [
    'здесь',
    'тут',
    'сюда',
    'нажмите здесь',
    'кликните здесь',
    'подробнее',
    'читать далее',
    'читать дальше',
    'далее',
    'ещё',
    'еще',
    'узнать больше',
    'ссылка',
    'по ссылке',
    'перейти',
  ],
  uk: [
    'тут',
    'сюди',
    'натисніть тут',
    'детальніше',
    'докладніше',
    'читати далі',
    'далі',
    'ще',
    'дізнатися більше',
    'посилання',
    'за посиланням',
    'перейти',
  ],
  de: [
    'hier',
    'hier klicken',
    'klicken sie hier',
    'mehr',
    'weiterlesen',
    'mehr erfahren',
    'mehr lesen',
    'details',
    'link',
  ],
  fr: [
    'ici',
    'cliquez ici',
    'en savoir plus',
    'lire la suite',
    'plus',
    'suite',
    'lien',
    'voir plus',
  ],
  es: [
    'aquí',
    'aqui',
    'haga clic aquí',
    'haz clic aquí',
    'leer más',
    'más',
    'mas',
    'más información',
    'saber más',
    'ver más',
    'enlace',
  ],
  pl: [
    'tutaj',
    'tu',
    'kliknij tutaj',
    'więcej',
    'czytaj więcej',
    'czytaj dalej',
    'dowiedz się więcej',
    'link',
  ],
  pt: ['aqui', 'clique aqui', 'leia mais', 'saiba mais', 'mais', 'ver mais', 'link'],
  it: ['qui', 'clicca qui', 'leggi di più', 'scopri di più', 'di più', 'altro', 'link'],
};

const ALL = new Set(Object.values(GENERIC_ANCHORS).flat());

export function isGenericAnchor(anchor: string): boolean {
  const text = anchor
    .trim()
    .toLowerCase()
    .replace(/[\s.…:!?»›>→]+$/u, '')
    .replace(/\s+/g, ' ');
  return text.length > 0 && ALL.has(text);
}
