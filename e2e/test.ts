import { expect, test as base } from '@playwright/test';
import type { Locator } from '@playwright/test';

/** 모든 화면 테스트는 처리되지 않은 스크립트 오류가 없어야 통과합니다. */
export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      await use(errors);
      expect(errors, '처리되지 않은 스크립트 오류').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** 요소들의 접근성 이름(aria-label)을 화면 순서대로 읽습니다. */
export function labels(locator: Locator) {
  return locator.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('aria-label')),
  );
}
