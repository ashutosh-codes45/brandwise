# BrandWise

Pre-publication brand checks that explain, suggest and keep people in control.

BrandWise checks content against a company's approved guidelines, facts and assets before it is published. Every finding comes with a reason and a source, fixes are suggested but never forced, and people make every decision.

**Live app:** https://brandwise-rho.vercel.app
**Built for:** Inkloom AI Hackathon, Round 1 (solo, Ashutosh Aloka Kumar Chauhan)

## What it does

- **Roles:** Creator, Reviewer and Brand Manager. Roles come from the database. New Creators and Reviewers join with an invite code.
- **Brand Vault:** guidelines, approved facts, terminology and assets, with tags, owner, valid-until date and a Confidential flag. PDF, DOCX and TXT upload with text extraction.
- **Brand kit:** colours, fonts and logo rules, used by the visual checks.
- **Workspace:** rich text and image sections, alt text, platform tick-boxes, document import (PDF, DOCX, TXT) and a version on every save.
- **AI review:** fixed rules, retrieval from the Vault, then an AI judge. Every finding shows a reason, a source and a quote. Findings without a verified source are dropped.
- **Visual and platform checks:** logo size, format and contrast, palette match, character limits, hashtags and email subject length.
- **Fixes you control:** tick to apply, edit, refine with your own prompt, or dismiss with a reason. Each step is kept in the finding's history, and past corrections are recommended when a mistake repeats.
- **Review and approval:** comments on content, sections and findings. Reviewers request changes, and only the Brand Manager approves. An activity trail records every step.
- **Export:** rule-based copy-paste versions for LinkedIn, X, Instagram, Facebook, Blog and Email, available only after approval. Nothing is cut automatically.
- **Insights:** repeated mistakes and guidelines that need attention.

## Try it

1. Open the live app and sign up. Choose **Create a new workspace** to become a Brand Manager.
2. Add a few Vault items and save the Brand kit.
3. On the **Team** page, generate invite codes. Sign up a Creator and a Reviewer with those codes (use separate browser profiles) to see each role's view.
4. As the Creator, write a draft, run the review, apply or dismiss findings, and send it for review.

## Tech stack

Next.js 16 (App Router), React, TypeScript, Tailwind CSS, Supabase (Postgres, Auth, Storage, Row Level Security), pgvector, Gemini API with a backup Gemini model and Groq as fallback, Vercel.

## Run locally

```bash
npm install
npm run dev
```

Create `.env.local` (see `.env.example`):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
GEMINI_API_KEY=
GEMINI_CHAT_MODEL=
GEMINI_FALLBACK_MODEL=
GEMINI_EMBED_MODEL=
EMBED_DIM=1536
GROQ_API_KEY=
GROQ_MODEL=
```

Then run every file in `supabase/migrations` in filename order in the Supabase SQL Editor. Never commit keys or the service-role key.

## Notes and limits

- AI runs on free-tier models with daily limits, shown in the app. If AI is unavailable, the rule checks, workflow and export still work. The AI can miss issues, so human review stays essential.
- Scanned PDFs, and images or tables inside imported documents, are not imported.
- Platform character limits carry a verification date and should be re-checked.
- Free-tier AI providers may use prompts to improve their products. Use dummy data in demos.

## Next

Ready-to-apply AI suggestions (for example, the exact approved colours for a palette clash), one-click publishing to supported platforms, and a local autosave backup of unsaved drafts.