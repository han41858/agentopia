import { repositorySlug } from '../server/model.ts';
import type { Repository } from '../server/model.ts';
import type { Snapshot } from './snapshot.ts';

export function getTokenStatus(
  hasData: boolean,
  hasRepositories: boolean,
  snapshot?: Snapshot,
) {
  if (snapshot?.error) {
    const labels: Partial<Record<number, string>> = {
      400: '토큰 형식 오류',
      401: '토큰 인증 실패',
      403: '토큰 권한·한도 확인',
      404: '저장소 접근 확인 필요',
      429: 'GitHub 요청 한도 도달',
    };
    return {
      label: labels[snapshot.httpStatus ?? 0] ?? '토큰 상태 확인 불가',
      description: snapshot.error,
      tone: 'warning',
    };
  }
  if (hasData)
    return {
      label: '토큰 접근 확인됨',
      description: '이 토큰으로 GitHub 저장소의 이슈를 조회했습니다.',
      tone: 'verified',
    };
  if (!hasRepositories)
    return {
      label: '저장소 접근 확인 전',
      description: '저장소를 추가하면 이 토큰의 접근 권한을 확인합니다.',
      tone: 'checking',
    };
  return {
    label: '토큰 확인 중',
    description: 'GitHub에서 토큰의 저장소 접근을 확인하고 있습니다.',
    tone: 'checking',
  };
}

export const initialRepositories: Repository[] = [
  { slug: 'han41858/agentopia', private: false },
];

export const legacyRepositoryListKey = 'agentopia.public-repositories';

export const settingsVersion = 2;

export const settingsKey = 'agentopia.github-settings';

export type GitHubSettings = { token: string; repositories: Repository[] };

export function readSettings(): GitHubSettings {
  try {
    const saved = localStorage.getItem(settingsKey);
    const stored: unknown = JSON.parse(saved ?? 'null');
    const settings = stored && typeof stored === 'object' ? stored : {};
    const token =
      'token' in settings && typeof settings.token === 'string'
        ? settings.token
        : '';
    const list: unknown =
      saved === null
        ? JSON.parse(localStorage.getItem(legacyRepositoryListKey) ?? '[]')
        : 'repositories' in settings
          ? settings.repositories
          : [];
    const needsMigration =
      !('version' in settings) || settings.version !== settingsVersion;
    const repositories = new Map<string, Repository>(
      needsMigration
        ? initialRepositories.map((repo) => [repo.slug, repo])
        : [],
    );
    if (Array.isArray(list)) {
      for (const item of list as unknown[]) {
        const repo = typeof item === 'object' && item !== null ? item : {};
        const candidate =
          saved === null ? item : 'slug' in repo ? repo.slug : undefined;
        const slug =
          typeof candidate === 'string' ? repositorySlug(candidate) : undefined;
        const restricted = 'private' in repo && repo.private === true;
        if (slug && (!restricted || token))
          repositories.set(slug, { slug, private: restricted });
      }
    }
    return { token, repositories: [...repositories.values()] };
  } catch {
    return { token: '', repositories: initialRepositories };
  }
}
