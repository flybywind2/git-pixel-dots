import { describe, expect, it } from 'vitest';
import { objectParticle } from './koreanParticles';
import { createStageState, executePixelCommand } from './pixelEngine';

describe('Korean object particles', () => {
  it.each([
    ['feature/ui', '를'], ['UI', '를'], ['HTML', '을'], ['JSON', '을'], ['PR', '을'],
    ['feat/기능', '을'], ['feat/문서', '를'], ['기능'.normalize('NFD'), '을'],
    ['v2', '를'], ['v7', '을'], ['(#8) ', '을'], ['', '를'],
  ])('chooses the particle for %j', (word, particle) => {
    expect(objectParticle(word)).toBe(particle);
  });

  it('uses the same particle when creating or switching to a new branch', () => {
    const state = createStageState('ch3');
    expect(executePixelCommand(state, 'git branch feature/ui').bubbles[0]?.title)
      .toBe('새 길 feature/ui를 만들었어요! 🌿');
    expect(executePixelCommand(state, 'git switch -c feature/ui').bubbles[0]?.message)
      .toContain('새 브랜치 feature/ui를 만들고 이동했어요.');
  });
});
