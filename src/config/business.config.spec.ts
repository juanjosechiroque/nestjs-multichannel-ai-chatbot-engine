import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { businessProfile } from '../../business/profile';
import { loadBusinessConfig, resolveMenuTitle } from './business.config';

const REPO_ROOT = resolve(__dirname, '../..');

function walkTypeScript(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walkTypeScript(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

const expectedCatalogDocument = {
  title: resolveMenuTitle(businessProfile),
  path: 'business/assets/menu.pdf',
};

describe('resolveMenuTitle', () => {
  it('uses an explicit menu title as-is', () => {
    expect(resolveMenuTitle({ name: 'Aurora', menuTitle: 'Nuestra carta' })).toBe('Nuestra carta');
  });

  it('derives "Carta de <name>" when no menu title is set', () => {
    expect(resolveMenuTitle({ name: 'Aurora Bistró' })).toBe('Carta de Aurora Bistró');
  });
});

describe('loadBusinessConfig', () => {
  it('exposes the business identity under the keys the engine consumes', () => {
    expect(loadBusinessConfig()).toEqual({
      BUSINESS_NAME: businessProfile.name,
      BUSINESS_TIME_ZONE: businessProfile.timeZone,
      catalogDocument: expectedCatalogDocument,
    });
  });

  it('feeds the business name, time zone and menu document to the Nest ConfigService', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, load: [loadBusinessConfig] })],
    }).compile();
    const config = moduleRef.get(ConfigService);

    expect(config.get('BUSINESS_NAME')).toBe(businessProfile.name);
    expect(config.get('BUSINESS_TIME_ZONE')).toBe(businessProfile.timeZone);
    expect(config.get('catalogDocument')).toEqual(expectedCatalogDocument);

    await moduleRef.close();
  });
});

describe('business/ folder is the only seam into the engine', () => {
  // The conversational core and channels never touch business/. Only the config
  // seam wires it in; the offline order-evaluation script may seed from it.
  const ALLOWED = ['src/config/business.config.ts', 'src/chat/evaluate-orders.ts'];

  it('is imported by nothing under src/ except the config seam', () => {
    const offenders = walkTypeScript(join(REPO_ROOT, 'src'))
      .filter((file) => !file.endsWith('.spec.ts'))
      .filter((file) => !ALLOWED.some((allowed) => file.endsWith(allowed)))
      .filter((file) => /from ['"][^'"]*\/business\/[^'"]+['"]/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(REPO_ROOT.length + 1));

    expect(offenders).toEqual([]);
  });

  it('keeps catalog data and business names out of the entry points', () => {
    // Built from fragments so this guard never itself trips a "business name in src" scan.
    const businessName = ['café', 'nube'].join(' ');
    for (const relativePath of ['src/app.module.ts', 'prisma/seed.ts']) {
      const source = readFileSync(join(REPO_ROOT, relativePath), 'utf8');
      // No product/promotion/FAQ literals inline; entry points only wire the seam.
      expect(source).not.toMatch(/slug:\s*['"]/);
      expect(source.toLowerCase()).not.toContain(businessName);
    }
  });
});
