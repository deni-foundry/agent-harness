import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildReview, relevanceFilter } from '../hooks/lib/build-review.mjs';
import { resolveConfig } from '../hooks/lib/config.mjs';

const review = resolveConfig({
  review: {
    watch: ['src', 'supabase'],
    checks: ['i18n — keys exist in every locale file.'],
    conditionalChecks: [{ match: 'supabase/migrations/[^/]+\\.sql$', checks: ['Seed sync — seed.sql matches.'] }],
  },
}).review;

describe('relevanceFilter', () => {
  const isRelevant = relevanceFilter(review);

  it('accepts code under a watched directory, relative or absolute, either slash', () => {
    assert.equal(isRelevant('src/a.ts'), true);
    assert.equal(isRelevant('C:\\repo\\src\\a.tsx'), true);
    assert.equal(isRelevant('/repo/supabase/migrations/1.sql'), true);
  });

  it('rejects other directories and extensions', () => {
    assert.equal(isRelevant('docs/a.ts'), false);
    assert.equal(isRelevant('src/a.md'), false);
    assert.equal(isRelevant('mysrc/a.ts'), false);
  });

  it('accepts nothing when nothing is watched', () => {
    assert.equal(relevanceFilter({ watch: [], extensions: ['ts'] })('src/a.ts'), false);
  });
});

describe('buildReview', () => {
  it('stays silent when no relevant file changed', () => {
    assert.equal(buildReview(['README.md'], review, '/repo'), null);
  });

  it('numbers the universal check before the project checks', () => {
    const text = buildReview(['/repo/src/a.ts'], review, '/repo');
    assert.match(text, /^1\. Completeness/m);
    assert.match(text, /^2\. i18n/m);
    assert.doesNotMatch(text, /Seed sync/);
    assert.match(text, /^- src\/a\.ts$/m);
  });

  it('adds conditional checks only when their pattern matches', () => {
    const text = buildReview(['supabase\\migrations\\1.sql'], review, '/repo');
    assert.match(text, /^3\. Seed sync/m);
  });

  it('ignores an invalid conditional pattern', () => {
    const broken = { ...review, conditionalChecks: [{ match: '(', checks: ['never'] }] };
    assert.doesNotMatch(buildReview(['src/a.ts'], broken, '/repo'), /never/);
  });
});

describe('resolveConfig', () => {
  it('falls back to defaults for missing or mistyped fields', () => {
    const config = resolveConfig({ syncCommand: 42, review: { watch: 'src', checks: ['x'] } });
    assert.equal(config.syncCommand, 'npm run rules:sync');
    assert.deepEqual(config.review.watch, ['src']);
    assert.deepEqual(config.review.checks, ['x']);
    assert.deepEqual(config.generated.extraPaths, []);
  });

  it('drops malformed conditional checks', () => {
    const config = resolveConfig({ review: { conditionalChecks: [{ match: 'a' }, { match: 'b', checks: ['ok'] }] } });
    assert.deepEqual(config.review.conditionalChecks, [{ match: 'b', checks: ['ok'] }]);
  });
});
