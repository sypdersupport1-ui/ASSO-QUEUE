import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const APP = (...p: string[]) => resolve(__dirname, '../../src/app', ...p);
const COMP = (...p: string[]) => resolve(__dirname, '../../src/components', ...p);
const read = (f: string) => readFileSync(f, 'utf8');

function walkTsx(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkTsx(p));
    else if (/\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Production crash regression: "Event handlers cannot be passed to Client
 * Component props" (digest 3621677879-class). A <form action={serverAction}>
 * in a server component is a client boundary — attaching onSubmit/onClick
 * (e.g. confirm() wrappers) makes flight serialization throw and the whole
 * route render the Application-error page. Confirmations must live in a
 * client component (ConfirmSubmitButton) with data-only props.
 */
describe('Production crash regression: no event handlers on server forms', () => {
  const serverPages = [
    ...walkTsx(APP('dashboard')),
    ...walkTsx(APP('platform')),
    ...walkTsx(APP('q')),
  ].filter((f) => !f.includes('/actions.ts'));

  it('no server-rendered form carries onSubmit/onClick/onChange', () => {
    const offenders: string[] = [];
    for (const f of serverPages) {
      const code = read(f);
      // Client components opt out via 'use client' (their handlers are legal).
      if (/^'use client';/m.test(code)) continue;
      for (const m of code.matchAll(/<form\b[^>]*\b(onSubmit|onClick|onChange)=/g)) {
        offenders.push(`${f.split('/src/app/')[1] ?? f}: <form ${m[1]}=`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no inline confirm() survives in server-rendered dashboard code', () => {
    const offenders: string[] = [];
    for (const f of serverPages) {
      const code = read(f);
      if (/^'use client';/m.test(code)) continue;
      if (/[^a-zA-Z]confirm\s*\(/.test(code)) offenders.push(f.split('/src/app/')[1] ?? f);
    }
    expect(offenders).toEqual([]);
  });

  it('destructive queue actions confirm via ConfirmSubmitButton (data props only)', () => {
    const queue = readFileSync(APP('dashboard', 'queue', 'page.tsx'), 'utf8');
    expect(queue).toContain('ConfirmSubmitButton');
    expect(queue).not.toContain('onSubmit=');
    const btn = readFileSync(COMP('dashboard', 'ConfirmSubmitButton.tsx'), 'utf8');
    expect(btn).toContain("'use client'");
    // Data-only props: a client boundary receiving functions would re-crash.
    expect(btn).not.toMatch(/onConfirm|onSubmit|onCancel=\{/);
  });

  it('dynamic session pages opt out of static prerender', () => {
    for (const f of [
      APP('platform', 'page.tsx'),
      APP('platform', 'footfall', 'page.tsx'),
      APP('dashboard', 'page.tsx'),
    ]) {
      expect(read(f)).toContain("export const dynamic = 'force-dynamic'");
    }
  });
});
