import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// A writeup = one Markdown file. Tags/categories are just values here;
// the filters and arsenal links are generated from them automatically.
const writeups = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/writeups' }),
  schema: z.object({
    title: z.string(),
    title_en: z.string().optional(),
    description: z.string(),
    description_en: z.string().optional(),
    date: z.coerce.date(),
    category: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    difficulty: z.enum(['instap', 'medium', 'hard', 'pro-lab']).default('medium'),
    readingTime: z.string().default('10 min'),
    draft: z.boolean().default(false),
    pinned: z.boolean().default(false),
  }),
});

export const collections = { writeups };
