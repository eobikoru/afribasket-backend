import sanitizeHtml from 'sanitize-html';

export function sanitizeBlogHtml(input: string): string {
  return sanitizeHtml(input, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'h1', 'h2', 'figure', 'figcaption'],
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'title'],
      '*': ['class'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
    },
  });
}
